"""
Regression tests for the adaptive output-token budget.

Groq's free tier enforces an output-tokens-per-minute ceiling that can sit
BELOW this pipeline's per-request max_tokens. The API then rejects every call
with a 429 before generating anything, and because the old retry path slept and
resent an identical request, the run could never recover — 100 cases in, 100
fallback rows out, no successful call ever placed.

These tests pin the recovery behaviour: parse the real limit out of the
rejection, shrink the request, and retry immediately rather than sleeping.

No API calls, no network.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "code"))

OTPM_ERROR = (
    "Error code: 429 - {'error': {'message': \"Request too large for model "
    "`qwen/qwen3.6-27b` in organization `org_01m1gjj1caehvr85vgz1av492h` service tier "
    "`on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1500. The "
    "request's expected output tokens exceed the enforced limit; reduce max_tokens (or "
    "the request's expected output) and try again.\", 'type': 'tokens', "
    "'code': 'rate_limit_exceeded'}}"
)

ORDINARY_RATE_LIMIT = (
    "Error code: 429 - {'error': {'message': 'Rate limit reached for model "
    "`qwen/qwen3.6-27b`. Please try again in 12.5s.', 'code': 'rate_limit_exceeded'}}"
)


@pytest.fixture
def main(monkeypatch):
    """Fresh module per test — the ceiling is process-global by design."""
    monkeypatch.delenv("AEDI_MAX_OUTPUT_TOKENS", raising=False)
    spec = importlib.util.spec_from_file_location(
        "aedi_main_under_test", REPO_ROOT / "code" / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_budget_is_unclamped_until_a_limit_is_seen(main):
    assert main.output_token_budget(3800) == 3800
    assert main.output_token_budget(1500) == 1500


def test_otpm_rejection_is_recognised_and_lowers_the_ceiling(main):
    assert main.note_output_token_limit(OTPM_ERROR) is True
    assert main.output_token_budget(3800) == 1000
    assert main.output_token_budget(1500) == 1000
    assert main.output_token_budget(500) == 500, "a smaller request should stay small"


def test_ordinary_rate_limit_is_not_mistaken_for_an_otpm_cap(main):
    assert main.note_output_token_limit(ORDINARY_RATE_LIMIT) is False
    assert main.output_token_budget(3800) == 3800, "ceiling must not move on a normal 429"


def test_otpm_rejection_retries_immediately_instead_of_sleeping(main):
    """The whole bug: sleeping and resending an identical request never
    recovers, because the rejection is deterministic, not congestion."""
    pool = main.KeyPool.__new__(main.KeyPool)   # no env keys needed
    pool._dead_until = {}
    assert main._handle_error(pool, "GROQ_API_KEY", OTPM_ERROR) == 0
    assert pool._dead_until == {}, "an oversized request must not kill the key"


def test_ordinary_rate_limit_still_backs_off(main):
    pool = main.KeyPool.__new__(main.KeyPool)
    pool._dead_until = {}
    assert main._handle_error(pool, "GROQ_API_KEY", ORDINARY_RATE_LIMIT) == pytest.approx(12.5)


def test_ceiling_only_ratchets_downward(main):
    main.note_output_token_limit(OTPM_ERROR)
    assert main.output_token_budget(3800) == 1000
    main.note_output_token_limit(OTPM_ERROR.replace("Limit 1000", "Limit 6000"))
    assert main.output_token_budget(3800) == 1000, "a later, larger limit must not raise it"


def test_ceiling_never_drops_below_a_usable_floor(main):
    main.note_output_token_limit(OTPM_ERROR.replace("Limit 1000", "Limit 8"))
    assert main.output_token_budget(3800) == main.MIN_USABLE_OUTPUT_TOKENS


def test_env_var_pins_the_ceiling_without_any_discovery(monkeypatch):
    monkeypatch.setenv("AEDI_MAX_OUTPUT_TOKENS", "900")
    spec = importlib.util.spec_from_file_location(
        "aedi_main_pinned", REPO_ROOT / "code" / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.output_token_budget(3800) == 900


def test_garbage_env_var_is_ignored_rather_than_crashing(monkeypatch):
    monkeypatch.setenv("AEDI_MAX_OUTPUT_TOKENS", "lots")
    spec = importlib.util.spec_from_file_location(
        "aedi_main_garbage", REPO_ROOT / "code" / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.output_token_budget(3800) == 3800


def _load_fresh(alias="aedi_main_reload"):
    spec = importlib.util.spec_from_file_location(alias, REPO_ROOT / "code" / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _DummyPool():
    """A KeyPool that needs no env keys, so mark_dead() can be observed."""
    import types
    pool = types.SimpleNamespace(_dead_until={}, dead=[])
    pool.mark_dead = lambda name, secs: (pool._dead_until.__setitem__(name, secs),
                                         pool.dead.append(name))
    return pool


# ── the repeat-OTPM hot loop ──────────────────────────────────────────────
#
# Observed in a real run: the ceiling was lowered to the account's limit of
# 1000, and every later OTPM rejection still returned a 0-second wait. Those
# rejections are a different failure — the per-minute output budget is spent,
# not the request oversized — so retrying instantly burned all three attempts
# in about a second and landed on the fallback row.

OTPM_1000 = (
    "Error code: 429 - {'error': {'message': \"Request too large for model "
    "`qwen/qwen3.6-27b` in organization `org_x` service tier `on_demand` on output "
    "tokens per minute (OTPM): Limit 1000, Requested 1463. The request's expected "
    "output tokens exceed the enforced limit; reduce max_tokens (or the request's "
    "expected output) and try again.\", 'type': 'tokens', 'code': 'rate_limit_exceeded'}}"
)


def test_first_otpm_rejection_resizes_and_retries_immediately(main):
    pool = _DummyPool()
    assert main._handle_error(pool, "GROQ_API_KEY", OTPM_1000) == 0
    assert main._OUTPUT_TOKEN_CEILING == 1000


def test_second_identical_rejection_waits_instead_of_spinning(main):
    """The regression. Ceiling is already 1000 and cannot go lower, so a zero
    wait would retry an identical request that cannot succeed."""
    pool = _DummyPool()
    main._handle_error(pool, "GROQ_API_KEY", OTPM_1000)      # discovery
    wait = main._handle_error(pool, "GROQ_API_KEY", OTPM_1000)  # budget spent

    assert wait > 0, "a repeat OTPM rejection must back off, not hot-loop"
    assert wait >= 30, "OTPM refills on a minute boundary — a token wait is pointless"


def test_repeat_rejection_still_does_not_kill_the_key(main):
    pool = _DummyPool()
    main._handle_error(pool, "GROQ_API_KEY", OTPM_1000)
    main._handle_error(pool, "GROQ_API_KEY", OTPM_1000)
    assert pool.dead == [], "OTPM is an account-wide budget, not a bad key"


def test_repeat_rejection_honours_an_explicit_retry_hint(main):
    pool = _DummyPool()
    main._handle_error(pool, "GROQ_API_KEY", OTPM_1000)
    hinted = OTPM_1000.replace("and try again.", "and try again in 12.5s.")
    assert main._handle_error(pool, "GROQ_API_KEY", hinted) == 12.5


def test_note_returns_false_when_the_ceiling_cannot_move(main):
    assert main.note_output_token_limit(OTPM_1000) is True
    assert main.note_output_token_limit(OTPM_1000) is False


def test_is_output_token_limit_recognises_it_either_way(main):
    assert main.is_output_token_limit(OTPM_1000) is True
    main.note_output_token_limit(OTPM_1000)
    assert main.is_output_token_limit(OTPM_1000) is True
    assert main.is_output_token_limit("429 try again in 3s") is False


def test_a_pinned_ceiling_still_backs_off_rather_than_spinning(main, monkeypatch):
    """With AEDI_MAX_OUTPUT_TOKENS already at the limit, the very first
    rejection cannot resize anything — it must wait immediately."""
    monkeypatch.setenv("AEDI_MAX_OUTPUT_TOKENS", "1000")
    mod = _load_fresh()
    assert mod._OUTPUT_TOKEN_CEILING == 1000
    assert mod._handle_error(_DummyPool(), "GROQ_API_KEY", OTPM_1000) >= 30


def test_model_is_overridable_without_editing_code(monkeypatch):
    monkeypatch.setenv("AEDI_MODEL", "llama-3.3-70b-versatile")
    assert _load_fresh().MODEL == "llama-3.3-70b-versatile"


def test_model_falls_back_to_the_default_when_unset(monkeypatch):
    monkeypatch.delenv("AEDI_MODEL", raising=False)
    assert _load_fresh().MODEL == "qwen/qwen3.6-27b"


def test_blank_model_env_does_not_produce_an_empty_model(monkeypatch):
    monkeypatch.setenv("AEDI_MODEL", "   ")
    assert _load_fresh().MODEL == "qwen/qwen3.6-27b"


# ── the interactive wait cap ──────────────────────────────────────────────

def test_analyze_case_refuses_a_wait_longer_than_the_caller_allows(main, monkeypatch):
    """A 429 can ask for a multi-minute wait, and the OTPM-exhausted path asks
    for a minute. Correct for the batch runner; it must not park a browser
    request for that long."""
    slept = []
    monkeypatch.setattr(main.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(main, "build_messages", lambda row, ctx: [])

    def slow_limit(*a, **k):
        raise main.LLMCallError(
            Exception("Error code: 429 - rate_limit_exceeded. Please try again in 300s."),
            "GROQ_API_KEY")

    monkeypatch.setattr(main, "_run_agent_turn", slow_limit)

    result = main.analyze_case(_DummyPool(), None, {"case_id": "x"}, {}, max_wait=20)
    assert result["decision"] == "manual_review", "must degrade to the safe fallback"
    assert not slept, "it must give up rather than sleep past the caller's budget"


def test_analyze_case_without_a_cap_keeps_the_batch_behaviour(main, monkeypatch):
    slept = []
    monkeypatch.setattr(main.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(main, "build_messages", lambda row, ctx: [])

    def slow_limit(*a, **k):
        raise main.LLMCallError(
            Exception("Error code: 429 - rate_limit_exceeded. Please try again in 300s."),
            "GROQ_API_KEY")

    monkeypatch.setattr(main, "_run_agent_turn", slow_limit)
    main.analyze_case(_DummyPool(), None, {"case_id": "x"}, {})
    assert slept == [300, 300], "the batch runner should still wait out a rate limit"


def test_a_wait_within_budget_is_still_honoured(main, monkeypatch):
    slept = []
    monkeypatch.setattr(main.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(main, "build_messages", lambda row, ctx: [])

    def quick_limit(*a, **k):
        raise main.LLMCallError(
            Exception("Error code: 429 - rate_limit_exceeded. Please try again in 3s."),
            "GROQ_API_KEY")

    monkeypatch.setattr(main, "_run_agent_turn", quick_limit)
    main.analyze_case(_DummyPool(), None, {"case_id": "x"}, {}, max_wait=20)
    assert slept == [3, 3], "a short wait is fine and should not be skipped"
