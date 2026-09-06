"""
Regression tests for reasoning-budget starvation.

The failure this pins, seen on a live account:

    400 - {'code': 'tool_use_failed', 'failed_generation': ''}

repeated three times, then a fallback row. It reads like a malformed prompt and
is nothing of the sort. The default model is a reasoning model, and on Groq the
output-token budget is spent on thinking AND on speaking — reasoning_format
"hidden" strips the thinking from the response but the tokens are still
generated against the same ceiling. On an account whose OTPM ceiling is 1000,
the model can spend the entire budget thinking and emit nothing at all.

The old recovery path made it strictly worse: each retry appended a corrective
nudge, so the request that already had no room to answer got larger.

No API calls, no network.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "code"))

# The exact shape Groq returned on the reported run.
STARVED = (
    "Error code: 400 - {'error': {'message': \"Failed to call a function. Please adjust "
    "your prompt. See 'failed_generation' for more details.\", 'type': "
    "'invalid_request_error', 'code': 'tool_use_failed', 'failed_generation': ''}}"
)

# Same error code, but the model *did* answer — this one is recoverable and
# must not be mistaken for starvation.
MALFORMED = (
    "Error code: 400 - {'error': {'message': \"Failed to call a function.\", 'code': "
    "'tool_use_failed', 'failed_generation': '{\"decision\": \"contest\"}'}}"
)


def _load(alias, env=None, monkeypatch=None):
    if monkeypatch is not None:
        for k in ("AEDI_MAX_OUTPUT_TOKENS", "AEDI_REASONING_EFFORT", "AEDI_MODEL"):
            monkeypatch.delenv(k, raising=False)
        for k, v in (env or {}).items():
            monkeypatch.setenv(k, v)
    spec = importlib.util.spec_from_file_location(alias, REPO_ROOT / "code" / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def main(monkeypatch):
    return _load("aedi_main_reasoning", monkeypatch=monkeypatch)


# ── telling the two tool_use_failed cases apart ───────────────────────────

def test_an_empty_generation_is_recognised_as_starvation(main):
    assert main.is_starved_tool_call(STARVED) is True


def test_a_populated_generation_is_not_starvation(main):
    """That one is recoverable — the model answered, it just missed the schema."""
    assert main.is_starved_tool_call(MALFORMED) is False


def test_the_recoverable_case_is_still_recovered(main):
    """Guard against the new predicate stealing work from the old path."""
    assert main._recover_failed_generation(Exception(MALFORMED)) == {"decision": "contest"}


def test_unrelated_errors_are_not_starvation(main):
    for err in ("429 rate limit reached", "401 invalid api key", "Connection error."):
        assert main.is_starved_tool_call(err) is False


# ── the budget decides whether reasoning is affordable ────────────────────

def test_an_unconstrained_account_leaves_reasoning_alone(main):
    assert main.reasoning_effort_for(3800) is None, "don't send the parameter at all"


def test_a_modest_first_round_ask_does_not_disable_reasoning(main):
    """ROUND_MAX_TOKENS is a deliberate choice, not a constraint. Reading it as
    one would disable reasoning on healthy accounts and quietly change the
    behaviour the committed metrics were measured under."""
    assert main.ROUND_MAX_TOKENS < main.REASONING_MIN_BUDGET, "premise of this test"
    assert main.reasoning_effort_for(main.ROUND_MAX_TOKENS) is None


def test_a_squeezed_account_turns_reasoning_off(main):
    main.note_output_token_limit("output tokens per minute (OTPM): Limit 1000, Requested 1463")
    assert main.reasoning_effort_for(1000) == "none"


def test_the_threshold_is_the_documented_one(main):
    main.note_output_token_limit(
        f"output tokens per minute (OTPM): Limit {main.REASONING_MIN_BUDGET}, Requested 9999")
    assert main.reasoning_effort_for(3800) is None

    main.note_output_token_limit(
        f"output tokens per minute (OTPM): Limit {main.REASONING_MIN_BUDGET - 1}, Requested 9999")
    assert main.reasoning_effort_for(3800) == "none"


def test_an_explicit_override_wins_even_on_a_squeezed_account(monkeypatch):
    mod = _load("aedi_main_effort_env", {"AEDI_REASONING_EFFORT": "default"}, monkeypatch)
    mod.note_output_token_limit("output tokens per minute (OTPM): Limit 500, Requested 1463")
    assert mod.reasoning_effort_for(500) == "default", (
        "AEDI_REASONING_EFFORT=default must force reasoning back on")


def test_an_override_also_applies_to_a_healthy_budget(monkeypatch):
    mod = _load("aedi_main_effort_env2", {"AEDI_REASONING_EFFORT": "none"}, monkeypatch)
    assert mod.reasoning_effort_for(3800) == "none"


def test_a_low_otpm_ceiling_reaches_the_reasoning_decision(main):
    """The two mechanisms have to compose: an OTPM ceiling of 1000 must end up
    disabling reasoning, because 1000 is what the account actually allows."""
    main.note_output_token_limit(
        "output tokens per minute (OTPM): Limit 1000, Requested 1463")
    budget = main.output_token_budget(main.CLASSIFY_MAX_TOKENS)
    assert budget == 1000
    assert main.reasoning_effort_for(budget) == "none"


# ── what a starved call does next ─────────────────────────────────────────

class _Boom:
    """Fails with `err` for the first `fails` calls, then answers."""

    def __init__(self, err, fails=99):
        self.err, self.fails, self.calls = err, fails, []

    def __call__(self, pool, cache, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) <= self.fails:
            raise Exception(self.err)
        return ({"content": None, "tool_calls": [{
            "id": "c1", "function": {"name": "classify_chargeback",
                                     "arguments": '{"decision": "contest"}'}}]}, "GROQ_API_KEY")


def _turn(main, monkeypatch, boom, max_rounds=1):
    """max_rounds=1 makes the single round the FORCED one, which is where the
    starvation recovery lives."""
    monkeypatch.setattr(main, "_call_llm", boom)
    monkeypatch.setattr(main, "_execute_tool", lambda *a, **k: {})
    return main._run_agent_turn(object(), object(), [{"role": "user", "content": "x"}], {},
                                max_rounds=max_rounds)


def test_a_starved_call_retries_with_reasoning_disabled(main, monkeypatch):
    boom = _Boom(STARVED, fails=1)   # first attempt starves, second answers
    _turn(main, monkeypatch, boom)

    assert len(boom.calls) == 2
    assert boom.calls[1]["reasoning_effort"] == "none", (
        "the retry must free the budget, not repeat the request")


def test_a_starved_retry_does_not_make_the_prompt_longer(main, monkeypatch):
    """The nudge is the wrong medicine here: it spends the retry enlarging a
    request that already had no room to answer."""
    boom = _Boom(STARVED, fails=1)
    _turn(main, monkeypatch, boom)

    lengths = [len(c["messages"]) for c in boom.calls]
    assert lengths[0] == lengths[1], "no nudge should have been appended"
    assert not any(main.FORCE_CLASSIFY_NUDGE in str(c["messages"]) for c in boom.calls)


def test_a_malformed_generation_still_gets_the_nudge(main, monkeypatch):
    """The old recovery path must keep working for the failure it was built
    for — a model that answered but broke the schema."""
    unrecoverable = MALFORMED.replace('{\"decision\": \"contest\"}', 'not json at all')
    boom = _Boom(unrecoverable, fails=2)
    _turn(main, monkeypatch, boom)
    assert any(main.FORCE_CLASSIFY_NUDGE in str(c["messages"]) for c in boom.calls)


def test_starving_with_reasoning_already_off_gives_up(main, monkeypatch):
    """Nothing left to free. Retrying is a certainty, not a chance."""
    boom = _Boom(STARVED)             # never recovers
    with pytest.raises(main.OutputBudgetTooSmall):
        _turn(main, monkeypatch, boom)
    assert len(boom.calls) == 2, "one probe, one retry with reasoning off, then stop"


def test_the_give_up_message_names_the_ways_out(main, monkeypatch):
    boom = _Boom(STARVED)
    with pytest.raises(main.OutputBudgetTooSmall) as exc:
        _turn(main, monkeypatch, boom)
    assert "AEDI_MODEL" in str(exc.value)


def test_analyze_case_does_not_sleep_on_a_proven_dead_end(main, monkeypatch):
    """The reported log burned three attempts at five seconds each on a
    deterministic 400. That is fifteen seconds spent proving a certainty."""
    slept = []
    monkeypatch.setattr(main.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(main, "build_messages", lambda row, ctx: [])
    monkeypatch.setattr(main, "_run_agent_turn",
                        lambda *a, **k: (_ for _ in ()).throw(main.OutputBudgetTooSmall("nope")))

    result = main.analyze_case(object(), None, {"case_id": "x"}, {})
    assert result["decision"] == "manual_review"
    assert not slept, "an unwinnable configuration must not be retried"


# ── the request Groq actually receives ────────────────────────────────────

def test_the_budget_is_sent_as_max_completion_tokens(main, monkeypatch):
    """On a reasoning model max_tokens is deprecated and does not describe
    thinking plus answer; max_completion_tokens does."""
    boom = _Boom(STARVED, fails=0)
    _turn(main, monkeypatch, boom)
    assert "max_completion_tokens" in boom.calls[0]
    assert "max_tokens" not in boom.calls[0]


def test_reasoning_format_stays_hidden_for_tool_calling(main, monkeypatch):
    """Groq requires parsed or hidden whenever tools are in play."""
    boom = _Boom(STARVED, fails=0)
    _turn(main, monkeypatch, boom)
    assert boom.calls[0]["extra_body"]["reasoning_format"] == "hidden"


def test_an_unconstrained_account_sends_no_reasoning_effort_at_all(main, monkeypatch):
    """Leaving the parameter off keeps the committed metrics reproducible —
    they were measured with the model's default reasoning behaviour."""
    boom = _Boom(STARVED, fails=0)
    _turn(main, monkeypatch, boom)
    assert "reasoning_effort" not in boom.calls[0]


# ── an unanswered case must not look like a decision ──────────────────────

def test_the_safe_fallback_identifies_itself(main):
    assert main.is_fallback_result(dict(main.SAFE_FALLBACK)) is True


def test_a_real_manual_review_is_not_flagged_as_a_fallback(main):
    """manual_review is a legitimate verdict. Only the placeholder counts."""
    real = dict(main.SAFE_FALLBACK)
    real["reason"] = "Evidence contradicts the merchant's narrative; a human should look."
    assert main.is_fallback_result(real) is False


def test_starvation_is_handled_in_the_first_round_too(main, monkeypatch):
    """The reported run never reached the forced round: the first round asks
    for fewer tokens, so it starves first. Handling starvation only under
    force_classify left that path burning the outer retries at five seconds
    each and never trying reasoning off."""
    boom = _Boom(STARVED, fails=1)
    monkeypatch.setattr(main, "_call_llm", boom)
    monkeypatch.setattr(main, "_execute_tool", lambda *a, **k: {})
    main._run_agent_turn(object(), object(), [{"role": "user", "content": "x"}], {},
                         max_rounds=2)

    assert boom.calls[0].get("reasoning_effort") is None
    assert boom.calls[1]["reasoning_effort"] == "none", (
        "round one must be able to disable reasoning without waiting for round two")


def test_a_non_starvation_error_still_fails_the_first_round_immediately(main, monkeypatch):
    """The extra local attempt exists only for the reasoning flip; it must not
    turn round one into a general retry loop."""
    boom = _Boom("500 internal server error", fails=99)
    monkeypatch.setattr(main, "_call_llm", boom)
    with pytest.raises(Exception, match="internal server error"):
        main._run_agent_turn(object(), object(), [{"role": "user", "content": "x"}], {},
                             max_rounds=2)
    assert len(boom.calls) == 1, "one attempt, then out"
