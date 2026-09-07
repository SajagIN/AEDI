"""
Tests for the SerpAPI merchant-intel enrichment.

No network. Every SerpAPI call is served by a fake opener, in the same style
as tests/fake_razorpay.py.

The tests that matter most here are not the parsing ones. They are:

  * test_pipeline_never_imports_merchant_intel — the committed metrics must
    stay reproducible from the repo alone, which is only true while the
    scoring path has no search dependency. This asserts that structurally
    rather than trusting a comment.

  * the escalate_only block — an external, gameable signal is allowed to buy
    a case human attention and nothing else. Every direction that would let
    it clear, decide, or improve a case is pinned shut.
"""

import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "app"))

import merchant_intel as mi  # noqa: E402


# ── fake SerpAPI ──────────────────────────────────────────────────────────

class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
        return False


def fake_opener(payload, capture=None):
    """Returns an opener that answers every call with `payload`."""
    def _open(request, timeout=None):
        if capture is not None:
            capture.append(request.full_url)
        return _Response(json.dumps(payload).encode("utf-8"))
    return _open


def http_error_opener(code, body=None):
    def _open(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url, code, "err", {},
            io.BytesIO(json.dumps(body or {}).encode("utf-8")))
    return _open


def result(title="t", link="https://example.com/a", snippet=""):
    return {"title": title, "link": link, "snippet": snippet}


ENV = {"SERPAPI_KEY": "test_key"}


# ── the structural guarantee ──────────────────────────────────────────────

def test_pipeline_never_imports_merchant_intel():
    """The held-out numbers must be recomputable offline. That is only true
    while no scoring-path module reaches for the network."""
    for rel in ("code/main.py", "code/risk_signals.py",
                "code/llm_cache.py", "code/evaluation/main.py"):
        source = (REPO_ROOT / rel).read_text(encoding="utf-8")
        assert "merchant_intel" not in source, (
            f"{rel} imports merchant_intel — this makes the committed metrics "
            f"depend on live search results and stop being reproducible")


def test_module_lives_outside_the_pipeline_directory():
    assert (REPO_ROOT / "app" / "merchant_intel.py").exists()
    assert not (REPO_ROOT / "code" / "merchant_intel.py").exists()


# ── the one-directional contract ──────────────────────────────────────────

@pytest.mark.parametrize("decision", ["contest", "accept_liability"])
def test_elevated_signal_escalates_an_automated_decision(decision):
    assert mi.escalate_only(decision, "elevated") == ("manual_review", True)


@pytest.mark.parametrize("signal", ["clear", "some", "elevated"])
def test_manual_review_is_never_downgraded(signal):
    """The whole point: a clean search can never buy a case its way out of
    human review."""
    assert mi.escalate_only("manual_review", signal) == ("manual_review", False)


@pytest.mark.parametrize("signal", ["clear", "some"])
@pytest.mark.parametrize("decision", ["contest", "accept_liability", "manual_review"])
def test_below_elevated_changes_nothing(decision, signal):
    assert mi.escalate_only(decision, signal) == (decision, False)


def test_unknown_signal_is_inert():
    assert mi.escalate_only("contest", "banana") == ("contest", False)


def test_payload_advertises_the_constraint():
    payload = mi.look_up("Acme", env=ENV, opener=fake_opener({"organic_results": []}),
                         use_cache=False)
    assert payload["escalate_only"] is True
    assert "never" in payload["advisory"].lower()


# ── query construction ────────────────────────────────────────────────────

def test_query_quotes_the_merchant_name():
    """Unquoted, a two-word brand matches every page containing either word."""
    assert mi.build_query("Blue Cart").startswith('"Blue Cart"')


def test_query_includes_complaint_terms():
    q = mi.build_query("Acme")
    assert "complaint" in q and "scam" in q


def test_empty_name_is_refused():
    for name in ("", "   ", None):
        with pytest.raises(mi.MerchantIntelUnavailable):
            mi.build_query(name)


def test_request_targets_indian_results():
    seen = []
    mi.look_up("Acme", env=ENV, opener=fake_opener({"organic_results": []}, seen),
               use_cache=False)
    assert "gl=in" in seen[0]
    assert "engine=google" in seen[0]


def test_api_key_is_sent():
    seen = []
    mi.look_up("Acme", env=ENV, opener=fake_opener({"organic_results": []}, seen),
               use_cache=False)
    assert "api_key=test_key" in seen[0]


# ── classification ────────────────────────────────────────────────────────

def test_complaint_site_counts_even_without_keywords():
    hits, others = mi.classify_results([
        result(title="Acme", link="https://www.consumercomplaints.in/acme")])
    assert len(hits) == 1 and not others
    assert hits[0]["on_complaint_site"] is True


def test_keyword_counts_even_off_a_complaint_site():
    hits, _ = mi.classify_results([
        result(title="Acme scam warning", link="https://news.example.com/x")])
    assert len(hits) == 1
    assert hits[0]["on_complaint_site"] is False
    assert "scam" in hits[0]["matched_terms"]


def test_ordinary_result_is_not_a_hit():
    hits, others = mi.classify_results([
        result(title="Acme Traders — Official Store", link="https://acme.example/")])
    assert not hits and len(others) == 1


def test_snippet_is_searched_not_just_title():
    hits, _ = mi.classify_results([
        result(title="Acme", link="https://x.example/", snippet="Order never received.")])
    assert len(hits) == 1


def test_www_prefix_is_stripped_from_domain():
    hits, _ = mi.classify_results([result(link="https://www.reddit.com/r/x")])
    assert hits[0]["domain"] == "reddit.com"


def test_subdomain_of_a_complaint_site_still_counts():
    hits, _ = mi.classify_results([result(link="https://in.trustpilot.com/review/x")])
    assert hits[0]["on_complaint_site"] is True


def test_malformed_result_does_not_crash():
    hits, others = mi.classify_results([{}, {"link": None}])
    assert len(hits) + len(others) == 2


def test_none_results_is_empty():
    assert mi.classify_results(None) == ([], [])


# ── signal banding ────────────────────────────────────────────────────────

@pytest.mark.parametrize("n,expected", [
    (0, "clear"), (1, "some"), (4, "some"), (5, "elevated"), (50, "elevated")])
def test_signal_bands(n, expected):
    assert mi.signal_for(n) == expected


def test_end_to_end_signal_from_payload():
    payload = {"organic_results": [
        result(link="https://www.consumercomplaints.in/1"),
        result(link="https://www.consumercomplaints.in/2"),
        result(title="Acme fraud", link="https://a.example/3"),
        result(title="Acme Official", link="https://acme.example/"),
    ]}
    out = mi.look_up("Acme", env=ENV, opener=fake_opener(payload), use_cache=False)
    assert out["n_complaint_results"] == 3
    assert out["n_other_results"] == 1
    assert out["signal"] == "some"


def test_results_are_capped_for_the_ui():
    payload = {"organic_results": [
        result(link=f"https://www.consumercomplaints.in/{i}") for i in range(40)]}
    out = mi.look_up("Acme", env=ENV, opener=fake_opener(payload), use_cache=False)
    assert out["n_complaint_results"] == 40
    assert len(out["results"]) == 10


def test_every_returned_result_carries_its_link():
    payload = {"organic_results": [result(link="https://www.mouthshut.com/x")]}
    out = mi.look_up("Acme", env=ENV, opener=fake_opener(payload), use_cache=False)
    assert out["results"][0]["link"].startswith("https://")


# ── failure modes ─────────────────────────────────────────────────────────

def test_missing_key_is_a_clear_message_not_a_crash():
    with pytest.raises(mi.MerchantIntelUnavailable) as e:
        mi.look_up("Acme", env={}, use_cache=False)
    assert "SERPAPI_KEY" in str(e.value)


def test_has_api_key():
    assert mi.has_api_key(ENV) is True
    assert mi.has_api_key({}) is False
    assert mi.has_api_key({"SERPAPI_KEY": "  "}) is False


@pytest.mark.parametrize("code,needle", [
    (401, "rejected the key"), (403, "rejected the key"), (429, "quota")])
def test_http_errors_are_named(code, needle):
    with pytest.raises(mi.MerchantIntelUnavailable) as e:
        mi.look_up("Acme", env=ENV, opener=http_error_opener(code), use_cache=False)
    assert needle in str(e.value).lower()


def test_serpapi_error_field_is_surfaced():
    opener = fake_opener({"error": "Google hasn't returned any results"})
    with pytest.raises(mi.MerchantIntelUnavailable) as e:
        mi.look_up("Acme", env=ENV, opener=opener, use_cache=False)
    assert "hasn't returned" in str(e.value)


def test_non_json_response_is_named():
    def _open(request, timeout=None):
        return _Response(b"<html>gateway timeout</html>")
    with pytest.raises(mi.MerchantIntelUnavailable) as e:
        mi.look_up("Acme", env=ENV, opener=_open, use_cache=False)
    assert "not JSON" in str(e.value)


def test_unreachable_host_is_named():
    def _open(request, timeout=None):
        raise urllib.error.URLError("Name or service not known")
    with pytest.raises(mi.MerchantIntelUnavailable) as e:
        mi.look_up("Acme", env=ENV, opener=_open, use_cache=False)
    assert "could not reach" in str(e.value)


# ── caching ───────────────────────────────────────────────────────────────

def test_second_lookup_is_served_from_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(mi, "CACHE_DIR", tmp_path)
    calls = []
    opener = fake_opener({"organic_results": []}, calls)
    first = mi.look_up("CacheCo", env=ENV, opener=opener)
    second = mi.look_up("CacheCo", env=ENV, opener=opener)
    assert len(calls) == 1, "the second lookup hit the network"
    assert first["cached"] is False and second["cached"] is True


def test_expired_cache_refetches(tmp_path, monkeypatch):
    monkeypatch.setattr(mi, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(mi, "CACHE_TTL_SECONDS", -1)
    calls = []
    opener = fake_opener({"organic_results": []}, calls)
    mi.look_up("StaleCo", env=ENV, opener=opener)
    mi.look_up("StaleCo", env=ENV, opener=opener)
    assert len(calls) == 2


def test_corrupt_cache_file_refetches(tmp_path, monkeypatch):
    monkeypatch.setattr(mi, "CACHE_DIR", tmp_path)
    calls = []
    opener = fake_opener({"organic_results": []}, calls)
    mi.look_up("BadCache", env=ENV, opener=opener)
    for f in tmp_path.glob("*.json"):
        f.write_text("{not json", encoding="utf-8")
    mi.look_up("BadCache", env=ENV, opener=opener)
    assert len(calls) == 2


def test_different_merchants_do_not_share_a_cache_entry(tmp_path, monkeypatch):
    monkeypatch.setattr(mi, "CACHE_DIR", tmp_path)
    calls = []
    opener = fake_opener({"organic_results": []}, calls)
    mi.look_up("AlphaCo", env=ENV, opener=opener)
    mi.look_up("BetaCo", env=ENV, opener=opener)
    assert len(calls) == 2
