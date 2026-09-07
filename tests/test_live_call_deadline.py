"""
Regression tests for the wall-clock deadline on live (LIVE mode) agent calls.

The bug this pins: on a NVIDIA account whose output-tokens-per-minute limit sits
below one request's worth of output, the agent legitimately needs to wait out a
minute per call. In the batch runner that is correct. Behind a browser request
it is not: the operator clicks "run the pipeline", the request never returns,
and the UI spins with nothing to read. The Razorpay Live tab showed exactly
this — the event poll kept answering 200 while the decide call hung.

So every live call goes through run_agent_bounded(), which caps both the inner
per-retry sleep and the total wall clock, and hands back an explanation the
operator can act on instead of a hang.

No API calls, no network.
"""

import importlib.util
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent


@pytest.fixture
def server(monkeypatch):
    monkeypatch.delenv("AEDI_LIVE_TIMEOUT", raising=False)
    spec = importlib.util.spec_from_file_location(
        "aedi_server_deadline", REPO_ROOT / "app" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["aedi_server_deadline"] = mod
    spec.loader.exec_module(mod)
    return mod


# ── the deadline itself ───────────────────────────────────────────────────

def test_a_prompt_answer_is_returned_unchanged(server, monkeypatch):
    monkeypatch.setattr(server.pipeline, "analyze_case",
                        lambda *a, **k: {"decision": "contest"})
    result, error = server.run_agent_bounded({"case_id": "x"}, {})
    assert error is None
    assert result == {"decision": "contest"}


def test_an_overrunning_call_gives_up_instead_of_hanging(server, monkeypatch):
    monkeypatch.setattr(server.pipeline, "analyze_case",
                        lambda *a, **k: time.sleep(30))
    started = time.monotonic()
    result, error = server.run_agent_bounded({"case_id": "x"}, {}, deadline=0.3)
    elapsed = time.monotonic() - started

    assert result is None
    assert isinstance(error, TimeoutError)
    assert elapsed < 5, "the request must return on the deadline, not on the worker"


def test_the_timeout_message_names_the_real_cause_and_the_ways_out(server, monkeypatch):
    monkeypatch.setattr(server.pipeline, "analyze_case",
                        lambda *a, **k: time.sleep(30))
    _, error = server.run_agent_bounded({"case_id": "x"}, {}, deadline=0.2)
    text = str(error)

    assert "OTPM" in text, "the operator needs the token to grep the server log for"
    assert "AEDI_MODEL" in text, "switching model is the fastest way out"
    assert "cache" in text.lower(), "explain why the retry will be quick"
    assert "build.nvidia.com" in text


def test_an_ordinary_failure_is_reported_as_itself_not_as_a_timeout(server, monkeypatch):
    def boom(*a, **k):
        raise ValueError("malformed case row")

    monkeypatch.setattr(server.pipeline, "analyze_case", boom)
    result, error = server.run_agent_bounded({"case_id": "x"}, {})
    assert result is None
    assert isinstance(error, ValueError)
    assert not isinstance(error, TimeoutError)


def test_a_missing_key_still_surfaces_as_systemexit(server, monkeypatch):
    """analyze_case can sys.exit() when no key is configured. That must reach
    the route, which turns it into a 400 rather than a 504."""
    def no_key(*a, **k):
        raise SystemExit("Error: no NVIDIA_API_KEY* found.")

    monkeypatch.setattr(server.pipeline, "analyze_case", no_key)
    _, error = server.run_agent_bounded({"case_id": "x"}, {})
    assert isinstance(error, SystemExit)


# ── the budget handed down to the pipeline ────────────────────────────────

def test_the_inner_retry_sleep_is_capped(server, monkeypatch):
    seen = {}
    monkeypatch.setattr(server.pipeline, "analyze_case",
                        lambda *a, **k: seen.update(k) or {"decision": "contest"})
    server.run_agent_bounded({"case_id": "x"}, {})

    assert "max_wait" in seen, "a live call must not inherit the batch runner's patience"
    assert 0 < seen["max_wait"] <= server.LIVE_CALL_DEADLINE_SECONDS


def test_the_deadline_is_configurable_without_editing_code(monkeypatch):
    monkeypatch.setenv("AEDI_LIVE_TIMEOUT", "12")
    spec = importlib.util.spec_from_file_location(
        "aedi_server_deadline_env", REPO_ROOT / "app" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["aedi_server_deadline_env"] = mod
    spec.loader.exec_module(mod)
    assert mod.LIVE_CALL_DEADLINE_SECONDS == 12.0


def test_the_default_deadline_is_short_enough_to_watch(server):
    assert 30 <= server.LIVE_CALL_DEADLINE_SECONDS <= 180, (
        "a demo audience will not wait more than a couple of minutes")


# ── the routes ────────────────────────────────────────────────────────────

def test_every_live_agent_call_goes_through_the_bounded_wrapper(server):
    """A future route that calls analyze_case directly would reintroduce the
    hang, so pin the call sites."""
    source = (REPO_ROOT / "app" / "server.py").read_text()
    body = source[source.index("def run_agent_bounded"):]
    body = body[body.index("# ── Razorpay test-mode bridge"):]
    assert "pipeline.analyze_case" not in body, (
        "call run_agent_bounded() instead of pipeline.analyze_case() in a request handler")


def test_a_timed_out_live_analyze_returns_504_with_a_readable_body(server, monkeypatch):
    """End to end through the route: LIVE mode, model never answers."""
    monkeypatch.setattr(server, "has_api_key", lambda: True)
    monkeypatch.setattr(server.pipeline, "KeyPool", lambda: object())
    monkeypatch.setattr(server.pipeline, "analyze_case", lambda *a, **k: time.sleep(30))
    monkeypatch.setattr(server, "LIVE_CALL_DEADLINE_SECONDS", 0.3, raising=False)

    started = time.monotonic()
    resp = server.app.test_client().post(
        "/api/analyze", json={"split": "held_out", "case_id": "cb_0142", "mode": "live"})
    elapsed = time.monotonic() - started

    assert resp.status_code == 504, "a stalled model is a gateway timeout, not a 500"
    assert elapsed < 5, "the route must not wait on the worker"
    body = resp.get_json()
    assert body and "OTPM" in body.get("error", ""), (
        "never fail a live call with an empty or unactionable body")


def test_a_live_call_without_a_key_is_still_a_400_not_a_504(server, monkeypatch):
    monkeypatch.setattr(server, "has_api_key", lambda: False)
    resp = server.app.test_client().post(
        "/api/analyze", json={"split": "held_out", "case_id": "cb_0142", "mode": "live"})
    assert resp.status_code == 400
    assert "NVIDIA_API_KEY" in resp.get_json()["error"]


def test_replay_mode_is_untouched_by_the_deadline(server, monkeypatch):
    """The offline demo path must never hit the wrapper at all."""
    def must_not_run(*a, **k):
        raise AssertionError("replay mode called the model")

    monkeypatch.setattr(server.pipeline, "analyze_case", must_not_run)
    resp = server.app.test_client().post(
        "/api/analyze", json={"split": "held_out", "case_id": "cb_0142"})
    assert resp.status_code == 200
    assert resp.get_json()["source"] == "replay"
