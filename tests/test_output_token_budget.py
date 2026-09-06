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
