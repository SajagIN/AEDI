# AEDI — Product Requirements & Design Record

Every explanatory comment and docstring that was written into this codebase, collected in one place and removed from the source. Nothing here is a summary: each entry is the original text, verbatim, in the order it appeared, anchored to the file and line it came from.

The intent is that this document is sufficient to rebuild the system. The code says what happens; this says why, what was tried before, and which failures each decision is a response to — the part that is expensive to rediscover and invisible in a diff.

**746 entries** — 160 docstrings, 586 comments — across 54 files. Extracted 2026-09-07.

Directive comments were deliberately left in the source, because they are not prose: `# noqa` suppressions, `# pragma: allowlist-fake` (read by the secret scanner), shebangs, and the two module docstrings that `argparse` prints as `--help` text.

---

## Contents

1. [The decision pipeline](#the-decision-pipeline)
2. [The console](#the-console)
3. [The interface](#the-interface)
4. [Tools](#tools)
5. [Tests](#tests)

---

## The decision pipeline

*Everything whose output is committed as a result. No network here except the model call.*

### `code/evaluation/main.py`

> Evaluation harness — dev split only. held_out stays refused until code
> freeze (opened once, on freeze day, never touched for tuning).
> 
> Reports:
> - Confusion matrix over {contest, accept_liability, manual_review}.
> - Precision/recall for `contest` and `accept_liability` specifically -
>   NOT overall accuracy, and NOT for manual_review (an abstention, not a
>   class with its own precision/recall target).
> - Coverage: share of cases decided automatically (not manual_review) -
>   reported so a system that abstains on everything can't look artificially
>   good on precision alone.
> - Expected cost per 100 cases, from an explicit false-positive/
>   false-negative cost model, with the cost assumptions stated in the
>   output itself, not just in a README someone might not read.
> - A rules-only baseline: always predict per evidence_sufficiency
>   alone (sufficient -> contest, else -> accept_liability, never
>   manual_review), scored the same way, so precision/recall have a
>   reference point.
> 
> Usage:
>     python code/evaluation/main.py --split dev --predictions dataset/dev/output.csv

**L34**

── Cost model — assumptions stated here, not hidden ─────────────────────

**L35**

False positive: contest a chargeback that should have been accepted.

**L36**

Cost = wasted representment effort + dispute filing fee. Flat, because

**L37**

this cost doesn't scale with transaction size - filing evidence takes

**L38**

roughly the same analyst effort regardless of the amount in dispute.

**L41**

False negative: accept liability on a case that should have been

**L42**

contested (winnable). Cost = the transaction amount itself, straight

**L43**

loss - this DOES scale with the case, so it's read per-case from

**L44**

dataset/dev/cases.csv rather than assumed flat.

**L46**

Secondary, non-mandatory metric: routing to manual_review always costs

**L47**

analyst time regardless of whether it was the "right" call - included

**L48**

for completeness, kept clearly separate from the mandatory FP/FN metric

**L49**

above so it's not confused with an error cost.

**L52**

Third, bonus/exploratory metric — NOT part of the mandatory cost model

**L53**

above (which prices exactly two error directions). Models the

**L54**

unpriced exposure from a case that had a real risk signal but got

**L55**

auto-decided anyway (a "bypassed review") as a fraction of the

**L56**

transaction amount, since that exposure scales with what's at stake,

**L57**

unlike the flat manual_review labor cost above. A stated assumption,

**L58**

not a measured one.

**L62**

manual_review excluded - see module docstring

**`confusion_matrix()`** — L70

predictions, labels: case_id -> decision. Returns {actual: {predicted: count}}.

**`expected_cost()`** — L97

Returns total cost, per-100-cases cost, and the count of each error
type, over exactly the cases that have both a prediction and a label.

**L118**

Not priced above, on purpose: the cost model defines cost for exactly two

**L119**

error directions (contest-should-be-accept, accept-should-be-contest).

**L120**

A third real category exists but has no defined price - cases

**L121**

where a human review was actually warranted (actual=manual_review)

**L122**

but the agent auto-decided anyway, bypassing the review entirely.

**L123**

That's arguably worse than either named error (an unreviewed

**L124**

high-risk case), so it's counted and surfaced rather than silently

**L125**

folded into "correct" just because it doesn't match either FP/FN

**L126**

definition.

**L131**

Bonus/exploratory metric, NOT part of the mandatory cost model

**L132**

(which defines exactly two error directions) and deliberately

**L133**

kept out of total_cost_inr/cost_per_100_inr above, so the required

**L134**

primary number stays exactly what the cost model defines. Modeled as

**L135**

a fraction

**L136**

of the transaction amount rather than a flat fee, because unlike the

**L137**

manual_review labor cost (a known, fixed analyst-time cost), the

**L138**

exposure from skipping a warranted review scales with what's at

**L139**

stake in the case - a stated assumption, not a measured one, since

**L140**

real-world outcomes for bypassed reviews aren't observable in this

**L141**

dataset.

**`baseline_predictions()`** — L154

Rules-only baseline: contest if evidence is sufficient
per the reason code's requirement, accept_liability otherwise. Never
predicts manual_review - it has no concept of risk signals, only
evidence completeness. Deliberately dumb, for comparison only.

**`always_manual_review_predictions()`** — L169

Second baseline: route every case to a human. Perfect
'precision' on nothing (no automated decisions), zero coverage.

### `code/gemini_client.py`

> A Gemini client wearing the shape the pipeline already speaks.
> 
> The agent loop, the response cache, the key pool and the retry ladder were all
> written against OpenAI-style chat completions: a flat list of role/content
> messages, a `tools` array of JSON-schema function declarations, and a
> `tool_choice` that can force one named function. Gemini's SDK models the same
> ideas differently — alternating Content parts, FunctionDeclaration objects, and
> a FunctionCallingConfig mode.
> 
> Rewriting the loop to speak Gemini natively would mean re-deriving behaviour
> that is currently pinned by tests: the bounded two-round loop, the forced final
> round, tool results being fed back by id, the cache key. So the translation
> lives here instead, in one file, where it can be read in full and tested
> directly. Everything upstream keeps working unchanged.
> 
> What is deliberately NOT emulated: streaming, n>1, logprobs, and the parts of
> the OpenAI schema this pipeline never sends. An adapter that pretends to
> support everything is a liability; this one raises on anything it does not
> genuinely translate.

**`_to_declarations()`** — L30

OpenAI tools array -> Gemini FunctionDeclarations.

parameters_json_schema takes the JSON Schema unchanged, so the pipeline's
tool definitions do not have to be maintained in two dialects.

**`_to_contents()`** — L47

OpenAI messages -> (system_instruction, contents).

Gemini carries the system prompt out of band rather than as the first turn,
and it labels the assistant 'model'. A tool result is a function_response
part rather than a role of its own, and it is matched to its call by
function NAME, not by the call id — so the id the loop tracks is used to
look the name back up.

**`_tool_config()`** — L89

OpenAI tool_choice -> FunctionCallingConfig.

ANY with a single allowed name is Gemini's forced call: the model must emit
that function and cannot answer with prose instead. That is exactly what
the classification round depends on.

**`_Message()`** — L112

The subset of an OpenAI message the pipeline reads.

**L174**

The SDK will otherwise run the tool loop itself. This pipeline

**L175**

executes its own tools against pre-computed context on purpose —

**L176**

that is what stops a hallucinated identifier reaching another

**L177**

merchant's record — so the automatic path is switched off.

**`GeminiClient()`** — L195

Exposes .chat.completions.create(...) over google-genai.

### `code/llm_cache.py`

> Disk-backed cache for LLM calls, keyed by a hash of the exact request.
> 
> Why this exists: the August Orchestrate build hit Gemini's free-tier daily
> token cap after roughly 19 real calls and lost hours to it. This dataset
> is ~150 cases x several evaluation re-runs, which
> will blow that cap repeatedly if every re-run re-calls the API. Caching by
> request hash means re-running the evaluation (to fix a bug, tune a
> threshold, or just re-verify a number) costs zero additional API calls for
> any case already seen with that exact prompt.
> 
> Deliberately dumb: one JSON file per cache entry, no expiry, no eviction.
> The correctness property that matters here is "the same request never hits
> the network twice," not cache hygiene.

**`_key_for()`** — L25

Stable hash of the exact request. `sort_keys=True` so key order in
the payload never changes the hash, since dict key order isn't
semantically meaningful to the request itself.

**`get()`** — L40

Returns the cached normalized response dict, or None on a miss.

**`put()`** — L53

Persists a normalized response dict under the request's hash.

### `code/main.py`

> Chargeback Evidence Responder — main entry point.
> 
> One class of loss: chargebacks. Reads a
> chargeback case (reason code, transaction, merchant-submitted evidence,
> merchant narrative, merchant history) and decides whether the evidence
> supports contesting the chargeback, supports accepting liability, or is
> insufficient/ambiguous enough to need a human.
> 
> Architecture ported from two prior Orchestrate builds:
> KeyPool, sanitize(), _execute_tool(), the bounded _run_agent_turn() loop,
> and resume/is_fallback_row() come from the August build (WhatsApp routing
> domain). The three-way decision shape and the "grounded citation only"
> evidence pattern come from the June build (damage-claim domain). Both are
> domain-adapted here, not copied verbatim where the domain differs.
> 
> The differentiating angle: merchant-submitted narrative text is untrusted
> input flowing into an LLM that makes a money decision. A merchant who can
> write text into an evidence field does not need to beat the model — they
> can try to instruct it. See SYSTEM_PROMPT's untrusted-input block.
> 
> Every LLM call is cache-checked first (llm_cache.py) — re-running this
> script over the same cases costs zero additional API calls for anything
> already seen.
> 
> Usage:
>     python code/main.py [--dataset-dir dataset] [--output dataset/output.csv]
> 
> Requires: at least GEMINI_API_KEY in .env or environment (GEMINI_API_KEY_2, _3, ... optional)

**L50**

Overridable so a low free-tier output-per-minute ceiling can be worked

**L51**

around without editing code: AEDI_MODEL=gemini-3.8-flash, etc.

**L54**

── Allowed value sets ────────────────────────────────────────────────────

**L55**

`manual_review` is an abstention, not a class with its own precision/recall

**L56**

target — `contest` is the positive class (the action with money

**L57**

consequences). Coverage (share decided automatically

**L58**

vs routed to review) is reported alongside precision/recall specifically

**L59**

so a system that abstains on everything doesn't look artificially good.

**L78**

Fields the model must return on every call. A response missing any of

**L79**

these is a failed attempt (retried, then falls back to a manual-review

**L80**

row) rather than being allowed to crash format_row's dict indexing — this

**L81**

is the exact June-build defect (direct dict indexing, no presence check)

**L82**

that surfaced in review there; fixed here from the start instead of

**L83**

patched later.

**`KeyPool()`** — L203

Round-robins across every GEMINI_API_KEY / GEMINI_API_KEY_2 / ... found in the
environment, spreading per-minute rate-limit load across all of them instead of
hammering one key.

Gemini's free tier meters requests per minute against the project, so extra keys
minted from the SAME project share one allowance and buy nothing. Real headroom
only comes from keys on genuinely separate projects — the limit is attached to
the project, not the credential. Ported as-is from the August Orchestrate build
— generic, no domain coupling.

**L225**

name -> unix ts when it's worth retrying

**`Dataset()`** — L254

Loads every context CSV once. Expected files (see dataset/LABELLING_RUBRIC.md
for the full rubric these files support):

- cases.csv / dev/cases.csv / held_out/cases.csv: case_id, merchant_id, amount,
  original_amount, currency, reason_code, transaction_date, payment_method,
  evidence_items (pipe-separated "type_tag: description" entries), merchant_narrative
- merchant_history.csv (keyed by merchant_id): chargeback_rate_30d,
  chargeback_rate_90d, total_transactions_30d, prior_contest_win_rate,
  history_flags
- reason_code_requirements.csv: reason_code, network, description,
  minimum_evidence_required (human text), required_evidence_types
  (pipe-separated machine tags matched against evidence_items' type tags)

**`enumerate_evidence()`** — L275

Deterministically assigns an evidence_id (and parses the type tag)
for each of the merchant's submitted evidence items, in file order. The
model may only cite IDs from this list — it never invents one. This is
the chargeback-domain equivalent of find_evidence_candidates() in the
August build: there, candidates were searched out of OTHER historical
messages; here, the case's own submitted evidence items already ARE the
full candidate set, so this enumerates rather than searches. Either way
the principle is the same — the pipeline computes the citable set, not
the model. Thin wrapper around risk_signals.parse_evidence_items so the
dataset generator and the runtime pipeline can never disagree about
what an evidence item's type is.

**`build_context()`** — L290

Assemble structured context for one case. The evidence-sufficiency,
amount-anomaly, and merchant-repeat-pattern signals are computed here in
code (risk_signals.py) and handed to the model as facts via the tools —
the model is not asked to re-derive them from raw numbers. What IS left
to the model: reading the narrative for contradiction or injection
attempts, and synthesizing all of this into a decision.

**`build_messages()`** — L402

Builds the system+user message pair for round 1 — case identifiers
only; the transaction/evidence/history detail is deliberately withheld
until the model requests it via a tool call, same as the August build's
pattern of not front-loading everything into round 1.

**L423**

── Output-token budget, adaptive ─────────────────────────────────────────

**L424**

Gemini's free tier enforces an output-tokens-per-minute (OTPM) ceiling that can

**L425**

be LOWER than the per-request max_tokens this pipeline would otherwise ask

**L426**

for. When that happens the API rejects the call with a 429 *before generating

**L427**

anything*, and — unlike an ordinary rate limit — waiting does not help: an

**L428**

identical retry is rejected identically, forever. On a 1000-OTPM account the

**L429**

old fixed 1500/3800 budgets meant the pipeline could never place a single

**L430**

successful call, and the run would burn every retry then write 100 fallback

**L431**

rows.

**L432**



**L433**

The fix is to shrink the request, not to sleep on it. The first rejection

**L434**

carries the account's real limit in its message; we parse it, lower the

**L435**

ceiling for the rest of the process, and retry immediately. One case pays the

**L436**

discovery cost, every later case is already correctly sized.

**L437**



**L438**

Pin it explicitly with AEDI_MAX_OUTPUT_TOKENS to skip discovery entirely.

**L439**

info-gathering round

**L440**

forced final round, needs room for the tool call

**L442**

── thinking ──────────────────────────────────────────────────────────────

**L443**

Gemini's Flash models think before answering, and the thinking is billed

**L444**

against the same response as the answer. This pipeline's final round is a

**L445**

forced call to one named function with a fixed schema — there is no essay to

**L446**

write, and a model that deliberates and then has nothing left to emit returns

**L447**

an empty message, which reaches the caller as a safe fallback with no visible

**L448**

cause.

**L449**



**L450**

So thinking is OFF by default: thinking_budget=0 is Gemini's explicit

**L451**

disable. AEDI_ENABLE_THINKING=1 turns it back on and raises the output floor

**L452**

at the same time, because switching it on without room guarantees the failure

**L453**

above.

**`thinking_extra_body()`** — L458

The extra_body for one request. `enabled=False` forces thinking off for
a retry regardless of configuration.

**`_thinking_floor()`** — L484

With thinking on, the ask has to cover deliberation AND the answer.

**`output_token_budget()`** — L489

Clamp a max_tokens request to whatever this account has been shown to allow.

The ask is raised to the thinking floor first: with reasoning on, the same
allowance pays for deliberation and for the answer, and 3,800 tokens is not
enough for both.

**`note_output_token_limit()`** — L501

Detect the OTPM 'request too large' rejection and lower the ceiling.

Returns True only if the ceiling actually *moved* — i.e. if retrying
immediately can plausibly succeed because the next request will be
genuinely smaller.

Returning True whenever the error merely *looked* like OTPM was a bug: once
the ceiling has already been lowered to the account's limit, a further OTPM
rejection means something different — the per-minute output budget is spent,
not that the request is oversized. Retrying that with zero wait is a hot
loop that burns every attempt in a few seconds and lands on the fallback row.

**`is_output_token_limit()`** — L536

True if this is an OTPM rejection, whether or not it changed anything.

**L541**

── Empty completions ─────────────────────────────────────────────────────

**L542**

A model can return a 200 with no content and no tool call. The previous

**L543**

provider made this common: its default was a reasoning model billing thought

**L544**

and speech against one ceiling, so a small ceiling meant the budget was spent

**L545**

before it said anything, and the failure arrived disguised as a schema error.

**L546**



**L547**

Gemini does not meter output tokens per minute, so the usual cause is

**L548**

gone — but an empty completion is still possible, and it is still unfixable

**L549**

by re-sending a longer prompt. The recovery path asks the model to skip

**L550**

thinking and spend everything on the answer, then gives up rather than

**L551**

looping.

**`OutputBudgetTooSmall()`** — L554

The model produced no output at all within the allowed budget, with
reasoning already disabled. Retrying cannot help — the configuration
itself is unworkable — so this is raised rather than looped on.

**`is_starved_tool_call()`** — L563

True for a tool_use_failed whose failed_generation is empty.

Gemini reports two different things through tool_use_failed. If
failed_generation carries text, the model answered and the answer merely
failed the tool schema — recoverable, and _recover_failed_generation does
exactly that. If it is empty, the model emitted nothing, which on a
reasoning model means the output budget was consumed before it could speak.

The distinction decides what a retry should change. Re-sending with a longer
prompt cannot fix an empty generation; it is the one thing guaranteed to
make it worse.

**L600**

Deterministic rejection, not congestion: the request was too big.

**L601**

It has now been resized, so retry at once instead of sleeping.

**L604**

Same rejection, but the ceiling could not go any lower — so the

**L605**

request is not the problem. The account's per-minute output budget

**L606**

is exhausted. That refills on a minute boundary, so wait it out

**L607**

rather than spinning.

**`sanitize()`** — L614

Coerces a raw model result into safe, allowed-value output: invalid
decision/evidence_sufficiency fall back to safe defaults, confidence is
clamped to [0,1], risk_flags is filtered to the allowed set, and
cited_evidence_ids is normalized to a semicolon-separated string.

**L646**

manual_review_required must accompany decision=manual_review, so the

**L647**

audit trail is consistent even if the model set the decision but

**L648**

forgot the flag.

**`apply_deterministic_overrides()`** — L655

Pins evidence_sufficiency and the three mechanically-derivable risk
flags (evidence_incomplete_for_reason_code, amount_anomaly,
merchant_repeat_pattern) to the values computed in risk_signals.py,
regardless of what the model returned. These are objective facts about
the case, not judgment calls, so there's no reason to let model error
leak into fields that are fully computable — the same principle as the
June build's rule that valid_image=false forces
evidence_standard_met=false in code rather than trusting the model to
apply it consistently.

decision, narrative_contradicts_transaction, prompt_injection_attempt,
domain_or_channel_mismatch, reason, confidence, and cited_evidence_ids
are untouched — those require reading the narrative and evidence, which
is the model's actual job here.

**`_execute_tool()`** — L691

Executes an info-gathering tool. Deliberately ignores whatever
arguments the model supplied (case_id, merchant_id, etc.) and always
resolves against ctx — the real, pre-computed data for the CURRENT
case — so a hallucinated or manipulated identifier can never leak
another case's or merchant's data. The tool's authority is the
pipeline's own ground truth, not the model's claim about which record
it wants. Ported as-is in spirit from the August build.

**L699**

Third attempt at the manual_review-coverage gap (see

**L700**

ENGINEERING_DECISIONS.md): two prompt-only attempts that stated the

**L701**

override rule once, in the abstract, in the system prompt, weren't

**L702**

reliably followed — a real risk flag would come back true and the

**L703**

model would still just... proceed as if it hadn't. Different tactic

**L704**

this time: repeat the instruction INLINE, attached to the actual

**L705**

flag value at the moment the model reads it, instead of only in a

**L706**

system-prompt paragraph written before the model has seen any real

**L707**

data. Proximity to the fact, not just louder wording.

**`_normalize_response()`** — L737

Normalizes an adapter response into a plain dict of {content,
tool_calls, reasoning}, so the rest of the pipeline — and, more
importantly, the cache — never stores an SDK object.

**L745**

Reasoning models return their deliberation here. It is never used as

**L746**

an answer — it is kept only so that "thought at length, then said

**L747**

nothing" is distinguishable from "returned nothing at all", which are

**L748**

different bugs with different fixes.

**`LLMCallError()`** — L753

Wraps an API-level failure together with the exact key_name that
caused it. Exists because a naive `except Exception: pool.next()` at
the call site to "find out which key failed" doesn't work — pool.next()
just returns whatever's next in rotation, unrelated to which key
actually threw. That bug was live in this file (analyze_case used to
do exactly this) and meant a real key's failure could get mark_dead()
called on a completely different, healthy key. Attaching the key_name
at the exact point of failure is the only reliable way to know it.

**`_call_llm()`** — L768

Cache-checked LLM call. Returns (normalized_response_dict, key_name_or_None).
key_name is None on a cache hit, since no key was actually used.

**`_recover_failed_generation()`** — L792

Gemini's forced-tool_choice path sometimes rejects a call with 400
tool_use_failed even though the model produced a complete, correctly
shaped JSON answer as plain text — visible in the error body's
failed_generation field. Recovers that answer instead of discarding a
real result and burning a retry. Unwraps LLMCallError first since
the original Gemini exception (with its .body attribute) is what
actually carries this, not the wrapper.

**`_run_agent_turn()`** — L826

Bounded agentic loop: round 1 offers all 3 tools with tool_choice="auto"
— the model can call lookup_case_evidence and/or lookup_merchant_history
to gather signal, or go straight to classify_chargeback if the case is
fully decidable already. Round 2 (the last allowed round) forces
tool_choice to classify_chargeback specifically, guaranteeing
termination with a structured answer within a hard cap of max_rounds.
Returns (result_dict, key_name_used_for_final_call_or_None).

The forced round gets its own local retry loop (force_local_retries), not
just the outer per-case retry in analyze_case. This matters because a
retry with an IDENTICAL request at temperature=0.1 tends to reproduce the
same failure rather than recover from it — observed directly on the dev
set's first real run: the model would repeat the exact
same wrong tool call 3 times in a row against an unchanged prompt. Each
local retry here appends FORCE_CLASSIFY_NUDGE, which actually changes the
request, instead of resending the same one and hoping for a different
result.

**L847**

Flipped on when a starved (empty) generation proves the budget cannot

**L848**

cover hidden reasoning as well as an answer. Persists for the rest of the

**L849**

turn: once proven, it is true for every remaining round too.

**L853**

A non-forced round still needs a second attempt available, so the

**L854**

reasoning-disabled retry below has somewhere to go. Only starvation

**L855**

uses it; every other error still raises on the first attempt.

**L863**

The adapter maps this to Gemini's max_output_tokens.

**L864**

It is the ceiling for the answer alone here, because

**L865**

thinking is billed against its own budget and that

**L866**

budget is zero unless someone turns it on.

**L880**

A recoverable answer is still an answer — check before

**L881**

anything else, because it ends the round successfully.

**L887**

Starvation is a budget problem, not a prompt problem, and it

**L888**

can hit ANY round — the first one asks for less, so it starves

**L889**

first. Free up tokens by dropping reasoning and retry the same

**L890**

prompt; appending a nudge here would spend the retry making

**L891**

the request bigger.

**`analyze_case()`** — L934

Runs the agent loop for one case with retry-across-keys on failure;
validates the result has every required field before returning it, and
degrades to a safe fallback row if all retries are exhausted. retries=3
here (not 6) because the forced round now has its own internal retry
with a corrective nudge (see _run_agent_turn) — this outer loop is a
backstop for whole-attempt failures (network, key exhaustion), not the
primary recovery path for a malformed forced-round response anymore.

**L957**

Proven unwinnable: the model produced nothing even with

**L958**

reasoning off. Every remaining attempt would be identical, so

**L959**

stop rather than sleep three times on a certainty.

**L963**

The key that actually failed, attached at the point of

**L964**

failure — not re-guessed via another pool.next() call,

**L965**

which would just return whatever's next in rotation and

**L966**

could mark a completely different, healthy key dead.

**L970**

A non-API failure (JSON parsing, max_rounds exceeded,

**L971**

etc.) isn't attributable to any specific key, so there's

**L972**

nothing to mark dead — just back off briefly and retry.

**L976**

An interactive caller passes max_wait so a token-per-day

**L977**

backoff cannot silently park a web request for 15 minutes.

**L986**

Carry the cause out with the fallback. Printing it to stderr and

**L987**

returning a bare placeholder meant an interactive caller could only be

**L988**

told to go and read a log it may not have in front of it — which is no

**L989**

help at all when the run is happening in a browser. The underscore keeps

**L990**

it out of the CSV: format_row copies named fields only.

**`is_fallback_result()`** — L1011

True if this is the safe-fallback placeholder rather than a real
analysis. A live caller needs this: analyze_case degrades to
manual_review when every attempt fails, and manual_review is also a
perfectly legitimate verdict, so the two are indistinguishable from the
outside unless the fallback says so.

**`is_fallback_row()`** — L1020

True if this row is the safe-fallback placeholder rather than a real
analysis — used so resume doesn't mistake a fallback for a completed
row and skip retrying it.

**`process_cases()`** — L1027

Runs analyze_case over every pending row and writes output.csv
incrementally, resuming from a prior run by skipping genuinely-done
rows and retrying only fallbacks.

**L1067**

lineterminator="\n" so a regenerated output.csv is byte-comparable

**L1068**

against the committed one (.gitattributes pins eol=lf).

**`main()`** — L1078

--input and --output (like --dataset-dir) are always resolved
against REPO_ROOT, never the invoking shell's cwd. This used to be
inconsistent — --output was REPO_ROOT-relative but --input was
cwd-relative, in the same command — and directly caused two real bugs
in one session: a case run silently writing outside the project when
invoked from code/, and a fallback-retry re-running all 100 cases
from scratch because resume detection looked in the wrong place. Both
flags now behave the same way on purpose.

### `code/risk_signals.py`

> Deterministic risk signals — shared between the runtime pipeline
> (code/main.py) and the dataset label generator (scripts/generate_dataset.py).
> 
> Sharing this module between the two is intentional, not circular: it
> computes FEATURES (evidence sufficiency, amount anomaly, merchant repeat
> pattern), never the final decision. The runtime pipeline hands these
> features to the LLM as pre-computed facts (so the model isn't reinventing
> evidence-matching from raw text — the "deterministic signals computed in
> code, not in the prompt" principle); the label generator uses
> the same features as inputs to its own separate decision rule.
> 
> The decision rule itself (which combines these features into a ground-truth
> contest/accept_liability/manual_review label) lives ONLY in
> scripts/generate_dataset.py — deliberately not importable from here, so
> code/main.py has no code path that could ever consult it. That's what
> keeps this non-circular: the model never sees the answer, only the
> features a human-written rubric also happens to use.

**L21**

percent; synthetic assumption, stated here so it's auditable

**L23**

currency units; rounding slack only

**`parse_evidence_items()`** — L26

Parses a case's pipe-separated evidence_items field into structured
items: [{"evidence_id", "type", "description"}, ...]. Each item is
expected as "type_tag: free text description". Deterministic ID
assignment in file order — the model may only cite these IDs, never
invent one.

**`required_evidence_types()`** — L46

Parses reason_code_requirements.csv's pipe-separated required-types column.

**`evidence_sufficiency()`** — L52

Returns (sufficiency_label, missing_types) per the rubric's §2:
- not_enough_information: nothing submitted at all.
- insufficient: some but not all required types present.
- sufficient: every required type present.

**`is_amount_anomaly()`** — L66

True if the disputed amount doesn't match the original transaction
amount on file, or exceeds it — a partial chargeback can never be
larger than the original transaction. Rubric §3.

**`is_merchant_repeat_pattern()`** — L80

True if the merchant's chargeback rate is above the platform
baseline AND their prior contest win rate is low. Rubric §3 — a single
number alone (high chargeback rate) isn't the flag; it's the
combination with a poor contest track record.

---

## The console

*The Flask app and its integrations — serves the UI and every API route.*

### `app/merchant_intel.py`

> Merchant adverse-media intel — an optional, external, escalate-only signal.
> 
> WHY THIS EXISTS
> ---------------
> Every input to the merchant risk signal in code/risk_signals.py is internal
> and backward-looking: chargeback_rate_90d and prior_contest_win_rate. Both
> are consequences. A merchant only trips is_merchant_repeat_pattern() after
> they have already produced ninety days of chargebacks and lost the contests
> that followed.
> 
> For an acquirer that is too late. Under Visa's VAMP the fine is levied per
> dispute once the portfolio ratio crosses threshold, so by the time internal
> data names a merchant, the money is already gone.
> 
> Public complaints are the leading indicator. Customers post about a merchant
> who stopped shipping weeks before those customers get around to calling their
> bank. This module reads that signal off the open web.
> 
> WHY IT IS NOT IN THE PIPELINE
> -----------------------------
> code/main.py does not import this file, and a test asserts that it never
> will. Two reasons:
> 
>   1. Reproducibility. The committed held-out numbers (0 FP, 0 FN, 76%
>      coverage) can be recomputed from the repo alone. A live search call in
>      the scoring path would make every run depend on what Google returned
>      that afternoon, and the evaluation would stop being a measurement.
> 
>   2. Provenance. Everything in the pipeline is either computed from the case
>      file or generated by the model under controlled conditions. Search
>      results are neither. They belong in the operator's console, next to a
>      human, not inside an automated decision.
> 
> WHY IT CAN ONLY ESCALATE
> ------------------------
> Web results about a business are unverifiable, gameable by a competitor with
> an afternoon and a few sock puppets, and ambiguous whenever two companies
> share a name. A signal with those properties has no business clearing a
> merchant.
> 
> So the contract is one-directional and enforced in code: this module may move
> a case toward manual_review and may never move one away from it. It cannot
> turn a review into a contest, it cannot raise a confidence score, and it
> cannot mark anything as safe. The worst a false positive can do is buy a case
> twelve minutes of human attention. See escalate_only().
> 
> It also never labels a business. It reports how many complaint-shaped results
> exist and links every one of them, because the honest output of a keyword
> search is evidence for a person to read, not a verdict about a company.

**L66**

A day. Complaint volume moves over weeks, so re-querying per page load would

**L67**

spend the quota to watch a number not change.

**L72**

Deliberately coarse. The useful question is "is anyone complaining", not

**L73**

"how many exactly" — search result counts are far too noisy to support a

**L74**

finer scale, and a precise-looking number invites false confidence.

**L78**

Sites where an Indian consumer actually goes to complain about a merchant.

**L79**

Presence here is what separates a complaint from a news article that merely

**L80**

contains the word "refund".

**`MerchantIntelUnavailable()`** — L100

Raised for a configuration or transport failure. Never raised because
a merchant looks bad — that is a result, not an error.

**`build_query()`** — L136

The search that finds complaints without finding the merchant's own
marketing. Quoting the name keeps two-word brands from matching every page
containing either word.

**`_fetch()`** — L147

One SerpAPI call. urllib rather than requests, because requests is not
a dependency of this project and adding one for a single GET is not worth
the install surface.

**L157**

Indian results — this is an Indian payments product

**`classify_results()`** — L191

Split raw results into complaint-shaped and everything else.

A result counts as a complaint when it is on a consumer-complaint site OR
its title/snippet carries a complaint term. Two weak tests joined by OR
rather than one strict test, because a complaint on a forum often does not
use any of the keywords, and a keyword hit off-forum is often a news
article about the merchant rather than a customer with a grievance. Both
kinds are worth a human's eye; neither is worth an automated decision.

**`signal_for()`** — L220

Three buckets, on purpose. See THRESHOLD_* above.

**`look_up()`** — L229

Returns a result dict. Raises MerchantIntelUnavailable only for
configuration or transport problems, never for what was found.

**L258**

Restated in the payload so a consumer of this API cannot forget it.

**`escalate_only()`** — L267

The one-directional contract, enforced rather than documented.

An elevated signal turns an automated decision into manual_review. Every
other combination is returned untouched — in particular, a manual_review
is never converted into anything else, no matter how clean the search
came back.

### `app/razorpay_live.py`

> Razorpay test-mode bridge for the AEDI console.
> 
> WHAT IS ACTUALLY REAL HERE
> --------------------------
> Razorpay's Disputes API is read-and-respond only:
> 
>     GET   /v1/disputes                fetch all
>     GET   /v1/disputes/:id            fetch one
>     POST  /v1/disputes/:id/accept     concede
>     PATCH /v1/disputes/:id/contest    submit evidence
> 
> There is deliberately no "create a dispute" endpoint, in test mode or
> otherwise, because a dispute is raised by the cardholder's issuing bank —
> not by the merchant. So a demo cannot manufacture a genuine chargeback.
> 
> This module is explicit about that line rather than papering over it. Every
> object it hands to the console carries an `origin` field:
> 
>     origin="razorpay"   fetched from the Razorpay API over the network.
>                         A real object with a real id, visible in the
>                         merchant's own Razorpay test dashboard.
>     origin="local"      constructed here, against a real Razorpay payment,
>                         because the API has no way to create one.
> 
> The console renders those two differently and never claims the second is
> the first. What stays honest either way is the part being demonstrated: the
> payment is real, the merchant history and reason-code requirements are the
> project's real reference data, and the decision comes from the real
> pipeline. Only the arrival of the chargeback is stood in for.
> 
> If a real dispute does exist on the account (Razorpay support can seed one,
> and any live account accumulates them), it is fetched and used in
> preference, and then the contest/accept calls are genuinely issued.
> 
> No third-party SDK: this is a few hundred lines of urllib against a
> documented REST API, which is easier to audit than a vendored client.

**L54**

Kept small on purpose. A demo that hangs for 30s in front of a judge is a

**L55**

failed demo; better to surface the timeout and let them retry.

**`RazorpayError()`** — L59

An error returned by, or while reaching, the Razorpay API.

**`LiveKeyRefused()`** — L72

Raised when a production key is supplied. See RazorpayClient.

**L76**

── client ────────────────────────────────────────────────────────────────

**`RazorpayClient()`** — L78

Thin, dependency-free client for the endpoints this console uses.

Refuses to run with a live key. This console creates orders and can
submit dispute responses, and `accept` in particular is irreversible and
moves real money. A hackathon demo has no business holding production
credentials, so the guard is a hard failure rather than a warning.

**L103**

-- plumbing ----------------------------------------------------------

**L143**

-- endpoints ---------------------------------------------------------

**`ping()`** — L145

Cheapest call that proves the credentials work.

**L174**

── configuration ─────────────────────────────────────────────────────────

**`read_config()`** — L176

Inspect the environment without raising. Drives the console's status card.

**`mask_key()`** — L202

rzp_test_Example123456 -> rzp_test_…3456. Never echo a whole credential.

**`verify_webhook_signature()`** — L220

Razorpay signs webhook bodies with HMAC-SHA256 over the raw payload.

**L228**

── diagnosis ─────────────────────────────────────────────────────────────

**L229**



**L230**

"502 Bad Gateway" tells an operator nothing. Every failure mode below has a

**L231**

different fix, and the operator is usually on their own machine where no

**L232**

amount of server logging helps them. So each one gets named, with the fix.

**L235**

(predicate over (status, code, message_lower), short cause, what to do)

**`diagnose()`** — L291

Turn a RazorpayError into (cause, fix) in plain language.

Returns ("", "") when the failure is not one of the known shapes, so the
caller falls back to Razorpay's own description rather than inventing one.

**`error_payload()`** — L309

The JSON body returned to the console for any Razorpay failure.

**L318**

── mapping a Razorpay payment onto an AEDI case ──────────────────────────

**L320**

Descriptions are the same phrasings the dataset uses, so a live case reads

**L321**

identically to a dataset case and the same evidence parser handles both.

**L336**

Razorpay's own dispute reason codes are coarse (`chargeback`, `fraud`,

**L337**

`pre_arbitration`, `retrieval`). The network reason codes the pipeline

**L338**

reasons about are finer-grained, and are what determine which evidence is

**L339**

required. Where a real dispute arrives we map its phase to a sensible

**L340**

default and let the operator correct it.

**`format_evidence_items()`** — L354

Render selected evidence types into the pipe-delimited column format
`risk_signals.parse_evidence_items` already understands.

**`payment_to_case()`** — L365

Build a case row shaped exactly like a row of `dataset/*/cases.csv`.

The point of matching that shape exactly is that nothing downstream needs
a special path for live data: `build_context`, `risk_signals` and
`analyze_case` all receive the structure they already handle.

**L377**

`method` is Razorpay's vocabulary (card, upi, netbanking, wallet, emi).

**L378**

The dataset only ever contains card/upi/netbanking; anything else is

**L379**

passed through rather than silently coerced into a wrong value.

**`dispute_from_razorpay()`** — L396

Normalise a genuine Razorpay dispute object for the console.

**`local_dispute()`** — L414

A stand-in chargeback against a real Razorpay payment.

Marked `origin="local"` and `actionable=False` so no code path can
mistake it for something the Razorpay API will accept an action on.

**`contest_payload()`** — L436

The exact body that would go to PATCH /v1/disputes/:id/contest.

Razorpay wants document ids obtained from the Documents API for each
proof field. We have evidence *records*, not uploaded files, so the
document ids are left empty and the summary carries the agent's reason.
Showing the payload — rather than pretending the upload happened — is
the honest version of "closing the loop".

**L460**

── event log ─────────────────────────────────────────────────────────────

**`EventLog()`** — L462

A bounded, thread-safe ring buffer the console polls.

This is what makes the tab feel live: every order, payment, webhook,
chargeback and agent decision appends here with a monotonically
increasing id, and the UI long-polls for anything newer than it has.

### `app/server.py`

> AEDI console — a small Flask app that puts a real UI in front of the
> chargeback pipeline.
> 
> Everything it shows is computed by the actual project code, not
> reimplemented here:
> 
> - `code/risk_signals.py` computes the deterministic signals shown per case
> - `code/main.py::build_context` assembles the exact context the agent sees
> - `code/evaluation/main.py` computes every metric on the Evaluation tab
> - `tests/adversarial_regression/fixtures.py` supplies the fixture catalog
> 
> Two operating modes, detected at startup:
> 
> - REPLAY (no GEMINI_API_KEY): every deterministic signal, the full evaluation
>   harness, and the committed predictions are available. "Run agent" replays
>   the committed decision for that case. This mode always works — no
>   network, no credentials, nothing to configure.
> - LIVE (GEMINI_API_KEY present): "Run agent" additionally calls the real
>   bounded agent loop for a single case, through the same disk cache the
>   batch pipeline uses.
> 
> Usage:
>     pip install -r app/requirements.txt
>     python app/server.py            # then open http://127.0.0.1:8000

**`_load()`** — L56

`code/main.py` and `code/evaluation/main.py` are both called `main`,
so load each from its own path under a distinct module name.

**L75**

lazily built, only in LIVE mode

**L79**

── helpers ───────────────────────────────────────────────────────────────

**`signals_for()`** — L113

Deterministic signals, straight from risk_signals.py — the same call
the runtime pipeline and the dataset generator both make.

**L146**

── API ───────────────────────────────────────────────────────────────────

**L157**

`has_predictions` alone was misleading: an interrupted run leaves a

**L158**

one-row output.csv, which looked identical to a complete one. Report

**L159**

the scored count so callers can tell a finished run from a stub.

**`analyze()`** — L224

Replay the committed decision, or — in LIVE mode — actually run the
bounded agent loop for this one case through the real disk cache.

**`metrics()`** — L314

Every number here is produced by code/evaluation/main.py, in process.

**L355**

An interrupted pipeline run leaves a partial output.csv. The scored

**L356**

subset is then "whatever the run got through before it stopped" —

**L357**

not a random sample — so anything extrapolated from it is wrong.

**L358**

Report it and let the UI decline rather than quietly averaging 1 case.

**L376**

A deliberately neutral case: clean evidence, non-risky merchant, no amount

**L377**

anomaly. Same base run_suite.py uses, so the narrative is the ONLY variable —

**L378**

whatever the model does here is attributable to the text, nothing else.

**`injection_test()`** — L395

Run one arbitrary merchant narrative against the real pipeline.

This is the honest version of a 'try to break it' demo: the evidence is
clean and sufficient, so the correct answer is `contest`. If a narrative can
move the decision, the merchant just talked the system out of money.
Requires LIVE mode — judging novel text is exactly the part a model does and
deterministic code can't fake.

**L467**

── bounded live agent calls ──────────────────────────────────────────────

**L468**



**L469**

analyze_case() retries with backoff, and a token-per-day rejection asks for

**L470**

a 15-minute wait. That is correct for the batch runner and unacceptable for

**L471**

a browser request, which just spins with no feedback. Live calls from the

**L472**

console therefore run on a worker thread with a hard deadline.

**`run_agent_bounded()`** — L478

Run the agent with a wall-clock deadline.

Returns (result, error). On timeout the worker is left running: it cannot
be killed safely mid-HTTP-call, and letting it finish means its answer
lands in the shared disk cache, so the retry the operator makes is fast.

**L513**

── Razorpay test-mode bridge ─────────────────────────────────────────────

**L514**



**L515**

See app/razorpay_live.py for the honesty boundary this code maintains:

**L516**

payments are real Razorpay objects, chargebacks are locally raised because

**L517**

the Razorpay API has no endpoint to create one, and every object says which

**L518**

it is. Nothing below ever presents a local object as a Razorpay one.

**L521**

dispute_id -> normalised dispute (local + real)

**L522**

dispute_id -> last agent result

**`rzp_client()`** — L526

Build (and memoise) a client for the current credentials.

**`rzp_guard()`** — L536

Return (client, None) or (None, flask response) — saves repeating this.

**`rzp_status()`** — L548

Configuration state, plus — if asked — an actual round trip.

`?probe=1` costs a network call, so the UI only does it on demand rather
than on every poll.

**`rzp_reference()`** — L577

Everything the live form needs: real merchants, real reason codes,
real evidence types. Sourced from the project's reference data so a live
case is scored against exactly the same rules as a dataset case.

**`rzp_order()`** — L608

Create a genuine Razorpay test-mode order.

The order id that comes back is real and appears in the merchant's
Razorpay test dashboard. The browser then hands it to Checkout.js, and
the resulting payment is a real `pay_…` object.

**`rzp_confirm()`** — L654

Called by the browser after Checkout.js reports success.

We re-fetch the payment from Razorpay rather than trusting the browser's
word for it — the client-side handler is not an authority on whether
money moved.

**`rzp_disputes()`** — L680

Real disputes first, then anything raised locally in this session.

**L691**

Still return locally raised disputes — but say the live fetch

**L692**

failed rather than implying an empty account. Silently swallowing

**L693**

this made a completely broken connection look healthy.

**`rzp_chargeback()`** — L708

Raise a chargeback against a real Razorpay payment.

Explicitly a local object. It is attached to a genuine payment id and
scored by the real pipeline, but Razorpay knows nothing about it.

**`rzp_decide()`** — L753

Run the real pipeline over a live chargeback.

**L810**

analyze_case degrades to a manual_review fallback when every attempt

**L811**

fails, and manual_review is also a legitimate verdict. Returning 200 with

**L812**

no distinction would present "the model never answered" as a judgement.

**`rzp_submit()`** — L864

Send the agent's decision back to Razorpay.

Only ever issued for a genuine Razorpay dispute. For a local chargeback
this refuses and returns the request that would have been sent, which is
the honest way to show the loop closing.

**`rzp_webhook()`** — L913

Receive real Razorpay webhooks.

Optional, but it is the one path where a genuine chargeback can reach
this console: configure a `payment.dispute.created` webhook in the
Razorpay dashboard and the dispute arrives here as a real object.
Unsigned or wrongly-signed requests are dropped — a webhook endpoint
that trusts its caller is a hole, not a feature.

**L954**

── merchant adverse-media intel (SerpAPI) ────────────────────────────────

**L955**



**L956**

Deliberately its own endpoint rather than a field on /api/analyze. The

**L957**

scoring path must stay reproducible offline, so this is something an

**L958**

operator asks for about a named business — never something the pipeline

**L959**

reaches for on its own. See app/merchant_intel.py for the full argument.

**L979**

503, not 500: the console is fine, the enrichment is not available.

---

## The interface

*React, Vite, Tailwind. The demo surface.*

### `web/src/App.tsx`

**L28**

Pick the split with the most cases actually scored — not merely the
first one that has an output.csv. An interrupted run leaves a one-row
file on dev, and `dev` sorts first, so the old check silently selected
a split with a single scored case and every number read as zero.

**L41**

The Tabs root has to enclose both the trigger row (which lives in the
sticky masthead) and the panels (which scroll), so it wraps the page.

**L45**

Ruled ground. Anchored to the top of the viewport and feathered out
downward, so the grid is densest behind the masthead and the hero and
has vanished by the time the reader reaches the numbers.

**L49**

The ruled ground above is static and stops below the hero. This layer
is the opposite: it draws nothing at all until a pointer moves, then
lights the cells it passes and halts its own frame loop the moment the
last one has faded. Composited over the static grid it reads as the
same lattice waking up under the cursor, and it costs nothing while
the reader is still. Pointer-events off, so it never eats a click.

**L59**

── masthead ──────────────────────────────────────────────────────
Set like the head of a printed report: the wordmark in the serif,
everything else in small monospace caps, all of it sitting on a
hairline rule.

**L66**

The logo is gone: a 32px mark next to a four-letter wordmark was
two logos arguing. Bodoni Moda stands in for Bodoni MT
Condensed, which is a Monotype commercial licence — the
condensed feel comes from tracking, not from scaleX, because
squeezing a Didone thickens its hairlines and takes away the
only reason to set one.

**L73**

Bodoni was the wrong call here. A Didone is built for large
display sizes; at 31px in a 56px bar its hairlines thin out and
its tall, small-x-height proportions read spindly rather than
expensive. The wordmark wants to be recognised at a glance from
across a room, which is a job for a geometric sans set heavy and
tight. Bodoni keeps its other job — model-authored prose.

### `web/src/components/figures.tsx`

**L6**

Figures
The money numbers are the argument this whole console is making, so they
get the one piece of real choreography on the page: each digit rolls into
place on an odometer, once, when the figure scrolls into view.
Counting is not decoration here. A figure that lands on Rs 4,56,000 after
visibly travelling there reads as computed; the same figure painted
instantly reads as typed into a slide.
What replaced what: this used to interpolate a single number and reformat
it every frame, which meant the whole string reflowed on every tick and the
separators jittered. React Bits' Counter rolls each digit independently, so
the commas hold still. The lamplight sweep that used to cross the glyphs
after they settled is gone with it — an odometer and a light sweep are two
animations doing one job, and the roll is the better of the two.

**L26**

Renders the number — pass inr(), pct(), toLocaleString(), anything.

**L29**

Seconds before the roll starts.

**L44**

The roll is absolutely positioned, so it needs a pixel height, and every
figure on this page is sized with a clamp() on an ancestor. Read what the
browser actually resolved, before paint, and again on resize.

**L63**

Reduced motion gets the answer, not the journey.

**L72**

Holds the exact width of the final figure for the one frame before
the measurement lands, so nothing reflows underneath it.

**L79**

A hero figure: the serif at display size, with its label set as a ledger
column head above it. Used for the numbers a judge is meant to remember.

### `web/src/components/merchant-intel-panel.tsx`

**L10**

Merchant intel panel
Reads consumer complaints off the open web as a LEADING indicator of
merchant risk. Every internal signal — chargeback_rate_90d,
prior_contest_win_rate — is a consequence, and only names a bad merchant
after ninety days of damage. Complaints show up weeks earlier.
Two things this deliberately does not do, both visible on screen:
it never renders a verdict about a business, only counts and links; and
it is labelled escalate-only, because the signal is unverifiable and
gameable and so may buy a case human attention and nothing else.

**L116**

Restated on screen, not just in the payload.

### `web/src/components/pipeline-rail.tsx`

**L4**

The decision pipeline, as a rail.
Seven stages run for every case, in this order, and only one of them is
the model. That is the whole argument of the project in one picture: the
agent is a component inside a deterministic pipeline, not the pipeline
itself, and it is fenced on both sides — three rules compute facts before
it reads anything, and two passes overwrite whatever it says about those
facts afterwards.
Colour follows the provenance grammar already used everywhere else here:
info is deterministic and computed in code, alt is written by the model.
Six info nodes, one alt node. The rail makes the ratio literal.
One line each. These were three-paragraph entries with file-and-line
citations, which is a reference manual, not a diagram — nobody standing at
a demo reads a wall of text off a circle they just clicked.

**L66**

A horizontal rail invites arrow keys, so it answers to them.

**L91**

The rail itself — a groove the nodes sit in. Decorative: the
ordered list already communicates sequence to a screen reader.

**L125**

Recessed, because it is a readout — the same form the deterministic
risk signals on Case Explorer use.

### `web/src/components/reactbits/counter.tsx`

**L4**

Counter — adapted from React Bits
Three things had to change before this could carry money figures.
1. `useSpring` sat below an early `return` for the decimal-point branch,
so a Digit either called one hook or none depending on its prop. It
survives in practice because a given instance always takes the same
branch, but it is still a conditional hook and the linter is right to
hate it. Split into two components, one of which has no state at all.
2. `key={place}` collides the moment a number contains two of the same
separator, which ₹6,99,702 does. Keys are positional now.
3. The original renders bare digits and nothing else. This is a finance
console — dropping the ₹ and the lakh grouping to get an odometer is a
bad trade. `places` now accepts any string as a literal glyph, so the
separators sit in the run and only the digits roll behind them.
The black gradient defaults went too: they existed for a dark demo page
and paint two dark bands across a white one.

**L26**

A power of ten rolls; anything else is printed as-is.

**L44**

Floating point drift means value/place lands on 4.999999999 where it should
land on 5, and the digit reads one too low for the whole animation.

**L69**

Pixels. The roll is absolutely positioned, so it cannot read a clamp().

**L71**

Masks the top and bottom of the roll. Must match what sits behind it.

**L100**

Feathers the digits arriving and leaving rather than letting them
appear at a hard edge.

**L113**

Derives the roll layout from an already-formatted string, which is the
only way the Indian grouping survives. `inr(456000)` gives "₹4,56,000";
walking that gives ₹ · 10^5 · 10^4 · , · 10^3 · 10^2 · , · 10 · 1, and the
odometer ends up shaped like the number a reader expects instead of
699702 in a row.

**L135**

The numeric value in display units — "₹4,56,000" is 456000, "76%" is 76.

### `web/src/components/reactbits/cursor-grid.tsx`

**L3**

CursorGrid — adapted from React Bits
One change, but it is the change that makes it usable as a page
background. The original binds `pointermove` to its own container. Mounted
behind the app it is covered by every card and paragraph on the page, so
it receives almost no events and the lattice only lights up over empty
gutters. Pointer tracking moves to `window`, converted to canvas-local
coordinates, and the wrapper stays `pointer-events: none` so it never
steals a click from a control.
Everything else is the original's, including the part worth keeping: the
RAF loop halts itself the moment no cell is still lit, so a stationary
cursor costs nothing.

**L181**

Window, not container: this sits under the whole app and would other-
wise never see a pointer that is over a card.

### `web/src/components/reactbits/stepper.tsx`

**L5**

Stepper — adapted from React Bits
The substantive change is that this one is controlled. The original owns
its own `currentStep` and moves it with Back and Continue buttons, which
is right for a signup form and wrong here: you cannot press Continue past
"take a payment" without taking a payment. Razorpay decides when this
advances, not the reader. So the step comes in as a prop, the footer is
gone, and `reached` marks how far the workflow has actually got — you can
click back to re-read a stage you have completed, and you cannot click
forward into one you have not.
Cosmetic changes, all forced: #5227FF on the indicators and bg-green-500
on the button are someone else's brand, `max-w-md` with an
`aspect-[4/3]` wrapper would crush a dispute card into a letterbox, and
`Step` applied px-8 on top of the px-8 the content wrapper already had.
One real bug: `onHeightReady` was an inline arrow in the parent's JSX, so
it was a new function on every render and the layout effect that depends
on it re-ran every render. It settles only because setState bails on an
identical value. It is a useCallback now.

**L39**

Zero-based, and owned by the caller.

**L41**

Furthest stage the workflow has actually reached.

**L66**

Indicators. Labels sit under the marks rather than beside them —
four stage names in a row would not survive a narrow column.

**L133**

The pane is absolutely positioned so the outgoing and incoming ones can
overlap, which means the wrapper has to be told how tall to become. A
ResizeObserver rather than a one-shot read: these panes grow when a trace
streams in or a verdict lands.

### `web/src/components/reactbits/stroke-text.tsx`

**L4**

StrokeText — adapted from React Bits
Two changes.
The original takes a fixed `fontSize` and gives its <svg> a fixed pixel
height while letting the width run to 100%. With `meet`, a narrow viewport
scales the glyphs down but the reserved height stays put, so the wordmark
floats in a growing pocket of dead space. Here the type size is derived
from the measured container width, which is what a display line on a
fluid page actually needs.
ScrollTrigger is gone. The one place this is used draws on mount, and
pulling in a second gsap plugin to support a trigger nothing calls is
weight for nothing.

**L30**

SVG text inherits the page face unless told otherwise.

**L77**

Size the type to the box it is in, rather than reserving a fixed height
and letting the glyphs rattle around inside it.
This used to multiply the character count by a hand-tuned em value, which
is only right for the one typeface it was eyeballed against — swap the
display face and the wordmark overflows or shrinks. getComputedTextLength
reports the advance width the browser actually laid out, so the ratio is
measured off the rendered glyphs instead of assumed. Width scales linearly
with font-size, so a single correction converges, and the 1.5% tolerance
stops it hunting between two adjacent integers.

**L115**

Both pads are the stroke's own overhang and nothing more. The
viewBox IS the glyph bbox, so nothing can be clipped except the half
of the stroke that sits outside the outline — a tenth of the font
size on top of that is dead space, and on the vertical axis it opens
a visible trench between this line and whatever is set beneath it.
The horizontal axis was fixed earlier; this is the same bug.

**L182**

Once the box is measured the svg takes the artwork's own aspect
ratio, so `meet` has nothing left to letterbox and the element
reserves exactly the height the glyphs occupy. Before the first
measurement there is nothing to derive it from, so it falls back to
a reserved height that keeps the page from jumping.

### `web/src/components/ui/badge.tsx`

**L5**

Pills, extruded.
These used to be flat tinted rectangles — a wash of the signal colour at
10% behind matching text. That reads fine on white and badly on a grey
sheet, where a 10% tint is close enough to the substrate to look like a
printing error rather than a deliberate field.
So the surface is now the sheet itself, pushed up 3px, and the semantics
live entirely in the text colour. Every one of those colours was measured
against this exact substrate and clears 5.4:1, which a 10% tint behind
them never did.
Two things keep them from reading as buttons, which they must never do:
they are round where buttons are 8px-cornered, and they are set in
uppercase mono where buttons are set in Sora. They also have no hover and
no press state, because nothing here is clickable.
`outline` is the one variant that stays flat. It marks a baseline row or a
secondary fact, and something that recedes should not be extruded.

**L44**

A span, not a div: these sit inside paragraphs and table cells, and a
block-level element there is invalid markup that browsers silently repair
by closing the paragraph early.

### `web/src/components/ui/button.tsx`

**L6**

Cobalt is the only bright in the palette, so a filled cobalt button is
unmistakably THE action on a screen. Everything else is a hairline.

### `web/src/components/ui/card.tsx`

**L4**

A panel is the sheet itself, pushed up. Same colour as the page — the
whole point of soft UI is that a card is not a lighter rectangle laid on
top, it is the surface deforming. The hairline underneath the shadow is
what keeps it a rectangle when shadows are unavailable.

**L26**

Section heads are set in the display sans at a size that reads as a heading in a
printed report rather than a web card title.

### `web/src/components/ui/input.tsx`

**L4**

Form fields are recessed, like boxes ruled into a paper form.

### `web/src/components/ui/select.tsx`

**L5**

A styled native <select>.
Five views had each written out the same forty-character class string by
hand, which meant five places to edit for one theme change and five
chances to miss one. It is one component now.
Native rather than a Radix listbox on purpose: this is a plain choice from
a short list, and the platform control already brings keyboard navigation,
type-ahead, screen-reader announcement and — on a phone — the system
picker. A custom listbox would be more code to get less.
appearance-none removes the OS arrow so the recess reads cleanly, so the
arrow is drawn back in and marked aria-hidden; the select underneath keeps
every semantic it started with.

**L22**

The caller's classes go on the wrapper, not the control. Every one of
them is a width — w-full, max-w-xl — and on the inner element they
would size a select inside a shrink-wrapped box that stayed narrow.

### `web/src/components/ui/skeleton.tsx`

**L3**

Numbers arrive from the API a beat after the page does. A pulsing bar in
their place keeps the layout still, which is most of what "fast" feels
like.

### `web/src/components/ui/slider.tsx`

**L5**

The one component worth taking from neumorphism-react.
A recessed track with a raised thumb is the idiom soft UI exists for — the
control looks like a physical fader milled into the sheet. That library's
version renders it out of plain divs with no role, no tabIndex and no key
handler, so it is operable by mouse and by nothing else. This one is the
same picture on Radix, which brings arrow keys, Home/End, Page Up/Down,
the slider role and aria-valuenow for free.
The thumb keeps a hairline and a hard focus ring, same as every other
control here: a raised circle on a same-coloured sheet is exactly the
thing that vanishes in forced-colours mode.

### `web/src/components/ui/tabs.tsx`

**L6**

A segmented control, not a row of index tabs.
The underline these used to carry was a second, quieter way of saying the
thing the filter group on Case Explorer already said by pressing a pill
into the sheet. One interface, one idiom: the strip is a recess, the
active tab is the one chip raised out of it.
The chip is a single element that moves. Rendering one raised box per tab
and toggling which is visible would cross-fade, and a cross-fade reads as
two chips rather than one travelling — the whole point of the affordance
is that there is exactly one, and it goes where you sent it.
Radix Tabs is uncontrolled by default, so nothing downstream can know
which trigger is active. Rather than push that problem into every caller,
the root mirrors the value internally and publishes it on a context. The
public API is unchanged: pass defaultValue, or pass value and
onValueChange, and both still behave exactly as before.

**L79**

Spring rather than a duration so a fast run along the row
overtakes itself instead of queueing. Reduced motion gets the
same chip in the same place, arriving instantly.

### `web/src/components/ui/tooltip.tsx`

**L5**

Where a caption used to sit under a number, there is now nothing — and this
instead, for the one reader in ten who wants it.

### `web/src/components/ui/vignette-grid-background.tsx`

**L3**

Grid vignette background
A ruled plane that fades out toward the edges, so the page has structure
where you are reading and nothing where you are not.
Two changes from the reference implementation, both necessary here:
1. Colour. shadcn stores its palette as bare HSL triplets — `--foreground`
is the string `220 9% 12%`, not a colour. Dropping `var(--foreground)`
straight into a gradient yields `linear-gradient(to right, 220 9% 12%,
…)`, which is not a valid colour stop, so the browser discards the whole
declaration and the grid renders as nothing at all. It has to be wrapped
in `hsl()`, which also lets the alpha be set per-instance.
2. Weight. The reference draws in `--muted-foreground` at 50% opacity. On a
near-black page that is a hint; on this white one it is a sheet of graph
paper loud enough to compete with the numbers. The default here is the
foreground at 5%, which you read as texture rather than as lines.
`-z-10` keeps it behind the app: #root establishes a stacking context, so a
negative index cannot escape past the page content. `pointer-events-none`
stops the fixed layer from swallowing clicks in empty regions, and the
-webkit- mask prefix is what makes the vignette work in Safari.

**L28**

Cell size in px.

**L30**

Vignette centre, as a percentage of the viewport.

**L33**

Ellipse radii, as a percentage of the viewport.

**L36**

0 = hard edge, 100 = fully feathered.

**L38**

Alpha of the rules, 0–1.

### `web/src/index.css`

**L1**

AEDI console — "Aluminium Soft"
A single sheet of warm grey, #E7E9ED, with one blue light on it. Every
surface is that same grey: nothing is a lighter card on a darker page.
Depth is described only by light — a white highlight up and left, a cool
shadow down and right — so controls read as pressed into the sheet or
raised out of it. Soft UI, the way Malewicz drew it in 2019.
Neumorphism's documented failure is contrast, and it is a real one: the
style tempts you to tint text toward the surface until nothing passes AA.
Three rules stop that here, and they are not negotiable.
1. Type never softens. Body text sits at 14.3:1 against the sheet and
every signal colour clears 5.4:1, computed rather than eyeballed.
2. Every interactive control keeps a hairline border underneath its
shadow. Purists leave it off. Shadow-only affordance disappears in
forced-colours mode, at 200% zoom, and on a projector at a demo
table, and an affordance you cannot see is not one.
3. Focus is a hard 2px cobalt ring, never a soft glow. The one place
the soft language breaks on purpose is the place that needs an edge.
prefers-contrast and forced-colors flatten the whole thing to borders
further down.
Fonts are bundled, not fetched. The console runs on a laptop at a demo
table with no guarantee of network, and a design that collapses to Times
New Roman when the wifi drops is not a design.
Only Latin subsets are pulled in. Fontsource ships Greek, Cyrillic and
Vietnamese cuts too, which would put ~30 files into the committed bundle
that this interface will never render a glyph from.

**L33**

Five faces, all self-hosted, all latin-only.
Fontsource's variable packages have no per-subset entry point — importing
their stylesheet drags Greek, Cyrillic and Vietnamese into a bundle that
will never render a glyph from any of them — so the faces are declared by
hand against the latin files. No CDN link: the console runs on a laptop at
a demo table with no guarantee of network, and a design that collapses to
Times New Roman when the wifi drops is not a design.
Plus Jakarta Sans  headings. Wide geometric curves that agree with the
soft-UI radii.
Sora               buttons only. Structural and punchy, so an action
reads as an action inside a low-contrast container.
Inter              body and financial data. Chosen for legibility at
12px, which is where most of this interface lives.
JetBrains Mono     labels, table heads, and anything computed.
Bodoni Moda        model-authored prose. Italic only — the upright cut is
never rendered, because the provenance grammar sets
everything the model wrote in italic, so shipping it
was 46 kB of font nobody would ever see.

**L70**

Bodoni MT Condensed is a Monotype commercial licence and cannot be
redistributed in this repo. Bodoni Moda is the open Didone revival with the
same high-contrast hairlines; it ships no condensed cut, so the wordmark is
tightened with tracking rather than squeezed with scaleX — compressing a
Didone horizontally thickens its verticals and destroys the one thing that
makes it a Bodoni.

**L76**

Lobster is a single 400 cut with no italic and no bold. Nothing may ask it
for either — a synthesised oblique on a script face slants the connecting
strokes off their baseline and a synthesised bold fills in the loops.

**L94**

Neutrals carry a few degrees of blue so the whites read cool and the
greys read like anodised metal rather than newsprint.

**L96**

The sheet. Card and background are deliberately identical — a card
that is a different colour from the page is what this style replaces.

**L116**

The two lights. Everything raised or inset is built from these and
nothing else, so the surface can be relit by editing two lines.

**L121**

Apple rounds generously. A 10px radius on a small control and 14 on a
panel is the difference between "soft" and "toy".

**L136**

Three layers of almost nothing. On white, atmosphere has to be built
from tints a few percent deep — any stronger and it stops reading as
light on a surface and starts reading as a coloured background.

**L139**

Two pools of light only. The grey band that used to sit here was doing
the same job as the grid vignette and washed it out, so it is gone —
structure now comes from the rules, atmosphere from these.

**L150**

Grain, at a third of the strength the dark theme needed. Light fields
band on a projector too, but overlay blending blows out on white — so
this multiplies instead.

**L166**

Apple's headline trick is not the typeface, it is the tracking: the
larger the type, the tighter it is set.

**L173**

Focus is the one hard edge in a soft interface. Two pixels, full cobalt,
offset clear of the shadow so it reads on a raised control and a pressed
one alike.

**L191**

Number columns must line up; that is half of why anyone trusts a figure.

**L204**

── soft UI ──────────────────────────────────────────────────────────
Raised: lit up-left, shadowed down-right, sitting on the sheet.
Inset: the same two lights swapped, so the surface reads as pressed in.
Both carry a hairline ring so the shape survives with shadows disabled.

**L208**

Elevation is one number. neumorphism-react exposes it as a `distance`
prop per component, which is the right idea in the wrong place — it puts
styling in JSX where no media query can reach it. Here it is a custom
property, so the same rule serves every height and the contrast fallbacks
below still apply to all of them.

**L230**

A full-bleed bar cannot use the diagonal light the cards use. Its left
and right edges run off the screen, so the only part of that light still
visible is the vertical component — and the 10px horizontal offset would
leave the bottom-left corner lit and the bottom-right corner dark, which
is precisely what two rounded bottom corners put on display.
So: symmetric, downward only. A hairline of white along the top inside
edge to read as a lit surface, a tight contact shadow, and a wide soft one
for the lift. Fully opaque — this replaced a translucent frosted panel,
and a blur is the wrong idea under a soft-UI header: it lets the page show
through the one surface that should feel solid enough to rest everything
else on.

**L250**

Held down: 1px of travel plus the light flipping over, which is what
makes a soft button feel mechanical rather than animated.

**L260**

Windows High Contrast strips box-shadow outright, so every soft surface
would dissolve into one undifferentiated sheet. Give the shapes back as
system-coloured borders.

**L266**

Asked for more contrast: drop the illusion, keep the structure.

**L274**

Staggered page load. Set --i on each child; the delay follows.

**L280**

Small caps label. Tracked wide, set in the mono, kept grey — the one
place the interface is allowed to whisper.

**L290**

Dotted leader: label ......... value

**L298**

Panels rise on hover — the only hover affordance used, so it always
means "this is interactive".

**L309**

Frosted bar, for the header that sits over scrolling content.

**L310**

Scrollable, without the track. For strips like the tab row that must
still pan on a phone but must not draw a bar across a desktop masthead.

### `web/src/lib/api.ts`

**L1**

Every number rendered by this console comes from these endpoints, which are
served by app/server.py calling the real pipeline / evaluation modules.

**L35**

True when the pipeline exhausted its retries and returned the safe
manual_review placeholder. manual_review is also a legitimate verdict, so
without this flag the two are indistinguishable in the UI.

**L89**

formatting

**L95**

── Razorpay test-mode bridge ──────────────────────────────────────────
Objects carry an `origin`: "razorpay" means fetched from the Razorpay API,
"local" means constructed by the console because Razorpay has no
dispute-create endpoint. The UI must never render the two identically.

**L113**

Every Razorpay failure comes back shaped like this — `cause` and `fix` are
plain-language, so the UI never has to render a bare 502 at the user.

**L194**

── merchant adverse-media intel (SerpAPI) ────────────────────────────────
Escalate-only by contract: this signal may route a case to a human and may
never clear one. The server restates that in every payload; the UI restates
it on screen. See app/merchant_intel.py.

### `web/src/lib/decision.ts`

**L1**

One decision, one set of colours.
The mapping from a decision to its colour was written out three times —
a Badge variant in Adversarial, a text colour in Case Explorer, a border
and tint in Live — each with its own ternary chain and its own idea of
what manual_review looks like. Three places to edit and three chances to
disagree. The tones live here now.
These are complete class strings on purpose. Tailwind scans src for
literals and cannot see through interpolation, so `bg-signal-${tone}` would
compile to nothing.

**L15**

Badge variant name.

**L17**

Foreground colour, for a decision set as a headline.

**L19**

Border plus wash, for a decision set in a panel.

**L41**

Anything unrecognised is treated as a handoff, which is the safe default.

**L46**

A missing confidence is a real state — the model can decline to give one.
Adversarial printed it raw, so a null rendered as "confidence undefined";
Case Explorer had its own em-dash fallback. One answer for both.

### `web/src/views/Adversarial.tsx`

**L44**

The four tiles used to render nothing until the fetch returned, so
the page height jumped the moment it did. Same grid, same box sizes,
filled with bars until the numbers exist.

**L78**

playground

**L136**

fixtures

### `web/src/views/CaseExplorer.tsx`

**L64**

toolbar

**L76**

Same one-chip-that-travels as the tab strip. This group is where
the idiom started, so it would be odd for it to be the one place
that still swaps a static highlight.

**L102**

list

**L107**

Selected means pressed in, everywhere in this interface — the
segmented filter above and the evidence toggles on the Live tab
already read that way, and a tinted-with-a-ring row was the last
place still saying it differently.

**L134**

An empty list and a list that has not arrived are different facts
and used to look identical.

**L143**

detail

**L150**

header + facts

**L195**

signals

**L213**

Recessed, not raised. These are readouts — a value the code
computed and is now displaying — and a display milled into
the panel is the soft-UI form for that. Raised is reserved
for things that assert or invite a click. The tint is gone
for the same reason it left the pills: a 5% wash on a sheet
this close to it is not a colour, it is a smudge, and the
value text carries the signal at 5.4:1 either way.

**L228**

evidence

**L269**

narrative

**L288**

run

**L316**

The cause, not a token to go and grep for. Telling someone to
read a server log is no help when the run happened in a browser.

### `web/src/views/Evaluation.tsx`

**L10**

Evaluation
Rewritten because the person who built this could not read it. If the
author cannot, a judge with ninety seconds certainly cannot.
What was wrong was not density, it was framing. The page rendered three
identical blocks — agent, rules baseline, all-manual baseline — each with
its own confusion matrix and five progress bars. Three identical blocks
side by side is an invitation to compare them cell by cell, which is the
one reading the numbers do not support, and fifteen progress bars say
nothing that the fifteen percentages next to them were not already saying.
So: one table, plain-English column heads. The ML vocabulary is still
here — precision, recall, the matrix — but demoted below a fold, because
it is what a reviewer checks second, not what a reader needs first.
Then it had to be rewritten again, because the simplification broke the
argument. The first version showed coverage, false positives, false
negatives and priced cost. Every system scores zero on both error types,
so those two columns discriminated nothing while occupying a third of the
table, and the rules-only baseline — which decides everything and is never
marked wrong — came out looking strictly better than the agent at ₹0
against ₹3,600. The column that separates them is the one that had been
cut: how many cases that needed a human got decided anyway. Rules-only
walks past all 17 of them because it has no manual_review output to give.
The agent walks past 10. That difference is ₹11,953 per 100 cases and it
is the whole reason the model is here.

**L39**

The jargon still matters to a technical reader, so nothing is renamed away.
Plain phrase leads, the real term follows in mono underneath.

**L66**

How many cases in this split actually needed a human — the manual_review
row of the confusion matrix. It is the denominator the bypassed count is
only meaningful against.

**L87**

Not a fourth system — the same agent with its escalation threshold moved
so the cases it currently guesses on go to a person instead. Arithmetic on
measured numbers, not a second run, and labelled as such: every bypassed
case becomes one more review at the model's own price, and the exposure
it was carrying goes to zero.

**L113**

── which set of cases ────────────────────────────────────────────

**L124**

Loading state matches the shape of the table it replaces, so the
page does not jump when the numbers land.

**L156**

── the answer, in a sentence ─────────────────────────────────────

**L168**

── one table, not three cards ────────────────────────────────────

**L234**

Tooltips die on touch and vanish in a screenshot of a slide, which is
how half of these numbers get read. Same definitions, in the flow,
wherever hover cannot be assumed.

**L248**

Promoted out of the disclosure it started in. It is the number that
argues against us, and a caveat you have to click for is a caveat you
are half-hiding.

### `web/src/views/Live.tsx`

**L25**

Checkout.js is loaded on demand — a console running purely in REPLAY mode
should not be pulling a third-party script it will never use.

**L70**

Probe on mount. Previously the card said "configured" — meaning only that
.env had values — while every call was failing, which made a dead
connection look healthy until something was clicked.

**L78**

Poll the event feed. Polling rather than SSE on purpose: it survives
proxies that buffer streamed responses, which is most of them.

**L89**

the feed is cosmetic; never break the page over it

**L122**

The stage the reader is looking at, which is normally the stage the
workflow is on. Kept separate so a completed stage can be re-opened —
the trace is worth going back to once the verdict has landed.

**L129**

When Razorpay moves the workflow on, the left column changes under a
reader who may be watching the event feed on the right. Follow it. Only
on an automatic advance — scrolling someone who just clicked back to
re-read stage 2 would be taking the page away from them.

**L140**

Offset clears the sticky masthead and its tab row, which scrollIntoView
has no way to know about.

**L203**

── not configured ───────────────────────────────────────────────────

**L244**

── connected ────────────────────────────────────────────────────────

**L247**

connection

**L270**

Said once, here, before anything is clicked.
This used to be three separate lines that appeared after the fact —
a badge, a paragraph under the request, and a second paragraph under
that — all circling the same constraint. Volunteering it up front is
also the better demo: the limitation is the API's, and saying so
first reads as candour rather than as an excuse afterwards.

**L288**

A failing connection has to be loud. The keys being present in .env
says nothing about whether Razorpay accepts them.

**L326**

1 — payment

**L403**

2 — chargeback

**L491**

3 — decide

**L544**

4 — the loop closing

**L589**

live feed

**L645**

Early warning, alongside the live flow. Deliberately its own
panel rather than a field on the decision: this signal informs
a person, it does not feed the pipeline.

### `web/src/views/Overview.tsx`

**L12**

Overview
Two things live on this screen: whether the agent is accurate, and what
that is worth per month. Nothing else.
What used to be here and isn't any more — the pipeline walkthrough, the
judgment-vs-arithmetic split, the injection examples — was duplicating
tabs that demonstrate the same thing with live data. Case Explorer runs
the trace. Adversarial runs the attacks. Explaining them here as well was
asking the reader to take on faith what the next tab simply shows.

**L42**

The remedy for the exposure, priced. Escalating the bypassed cases to a
human removes the disclosed risk entirely and costs one more review each
- so the saving survives, smaller. Stating both halves is the difference
between "our net is negative" and "we know where the dial sits".

**L54**

A partial run is not a sample — the scored cases are whichever ones the
pipeline reached before it stopped. Projecting from them would be a
confident-looking wrong number.

**L63**

False positives and false negatives used to be two of these four. They are
one fact, not two, and on this dataset it is a fact the pipeline can barely
get wrong: the ground-truth rule separates contest from accept_liability on
evidence sufficiency alone, and the pipeline computes that in code and then
writes it over the model's answer. Giving a near-guaranteed zero half the
hero was the weakest claim on the page. Merged into one tile, and the slot
it freed goes to a number that moves.

**L83**

── the claim ───────────────────────────────────────────────────

**L85**

The first word is drawn rather than set: the outline writes itself
on in cobalt and the fill floods after it, which is the one place
on this console where an animation is allowed to be the point. The
second line stays live text in the serif, because the two-tone
split is the provenance grammar the rest of the app reads by and
flattening it into one SVG would cost more than the effect.

**L91**

Both lines start at the same x. The drawn line used to sit inset
from the serif one because the SVG centred its glyphs inside a box
that is wider than they are — xMid, plus a left pad scaled off the
font size. It left-aligns now, and pads horizontally by the stroke
width alone. Sizes are picked so the two lines land within a few
percent of each other rather than one towering over the other.

**L104**

One line, always, and sized so it ends where the line above it
ends. Twenty-three characters against twelve, so at equal size
this line would run half again as wide as the container. The
string measures 9.387em in Lobster, read off the shipped font
file, so container/9.387 is the size that lands both lines in the
same place; the calc reproduces that at every viewport instead of
guessing at breakpoints.
No italic and no bold — Lobster ships one 400 cut, and asking a
browser to fake either on a script face slants the connecting
strokes off their baseline and fills in the loops.
The negative top margin is not a nudge. Lobster reserves 0.287em
of empty ascent above the tallest ink in this string, measured
off the font, and line-height 1.15 returns 0.05em of that as
negative half-leading — so 0.237em of the gap was nothing but air
inside the font's own box. Pulling up 0.14em leaves about a tenth
of an em of real optical space. In em, not px, so it stays right
across the whole clamp rather than at one viewport width.

**L129**

── is it accurate ────────────────────────────────────────────────
Four numbers, four labels. The explanation of each is a tooltip,
which costs the page nothing until someone wants it.

**L155**

── what it is worth ────────────────────────────────────────────

**L159**

Slider for the shape of the number, box for the exact one. The
slider is faster to demo with and the box is the only way to type
4,000 without dragging for it, so both drive the same state
rather than one replacing the other.

**L179**

Clamped to the slider's range, but the two ends clamp at
different moments on purpose. The ceiling applies as you
type, because exceeding it is the case where the thumb
would park at the end reading something the box does not.
The floor waits for blur: min is 250, so clamping it per
keystroke would turn the 4 of 4000 into 250 and make the
value literally untypeable.

**L234**

The multiplication, stated. Without it a six-figure total
invites the reader to assume the input was rupees.

**L246**

Subordinate on purpose. Level with the four figures above it, a
reader subtracts one from the other and walks away - but the
subtraction is wrong, because the exposure is a modelled risk you
can buy out, not a bill that has arrived. So: quieter type, and
the price of removing it stated in the same breath.

### `web/tailwind.config.js`

**L1**

@type {import('tailwindcss').Config}

**L3**

AEDI console — "Aluminium"
White surfaces, graphite text, one blue. The product decides who keeps the
money in a payment dispute, so the interface is built like hardware: cool
neutral ground, generous radii, shadow instead of outline, and colour
rationed hard enough that it still means something when it appears.
Three rules hold the palette together:
· white is the ground, cobalt is the only bright — everything saturated
is money, or a warning about money;
· provenance has a typeface. Anything the code computed is monospace;
anything the model wrote is serif italic. That distinction is the
product's central claim, so it is spelled in the type, not a caption;
· type tightens as it grows. Tracking is negative everywhere and most
negative on the hero, which is most of why large type reads premium.

**L25**

Headings: wide geometric curves that agree with the soft-UI radii.

**L27**

Body and financial data. Legible at 12px, which is where most of

**L28**

this interface actually lives.

**L30**

Buttons only, so an action reads as one inside a soft container.

**L32**

Labels, table heads, and every computed figure.

**L34**

Model-authored prose, set in italic. It had the wordmark too until

**L35**

a Didone turned out to look spindly at masthead size.

**L37**

The hero's second line, and nowhere else. A script face has one job

**L38**

in an interface like this and stops working the moment it has two.

**L51**

The one bright. Used for money, the active tab and every primary
action — and nothing else, so it never stops meaning "look".

**L54**

DEFAULT is the text cut, re-measured against the #E7E9ED sheet

**L55**

rather than white: 5.74:1. `bright` is the fill and hover cut —

**L56**

legible as a background, too light to set type in.

**L60**

Verdict colours. Named for what they mean in a dispute, not for the
hue, so a view never has to know which colour "won" is this month.

**L62**

Re-cut for white. The dark theme's verdict colours were chosen to
glow on near-black; at those luminances they are unreadable here,
so each has been darkened to clear 4.5:1 on paper while keeping
its hue relationship to the others.

**L67**

Re-cut a second time, for the grey sheet. These were mixed

**L68**

against #FFFFFF and carried over unchanged when the substrate

**L69**

became #E7E9ED, at which point good/warn/info quietly dropped to

**L70**

4.39, 4.46 and 4.43 — under AA, on the smallest text in the app.

**L71**

A tinted pill behind them hid it; extruded pills put the text

**L72**

straight onto the sheet, which is what surfaced it.

**L73**

contested and won, control not flagged — 5.46:1

**L74**

liability accepted, attack landed      — 5.45:1

**L75**

the disclosed gap                      — 6.05:1

**L76**

deterministic, computed in code        — 5.63:1

**L77**

written by the model                   — 6.87:1

**L82**

On white a panel cannot be found by its border without the border

**L83**

becoming the loudest thing on screen. So: a hairline tint, a tight

**L84**

contact shadow, and a wide soft one for the lift off the page.

**L90**

One orchestrated page load: everything rises through the same easing,

**L91**

staggered by --i.

**L94**

A brass highlight travelling once across a fresh number.

**L96**

The lamp breathing, for anything actively working.

**L98**

A hairline rule drawing itself in.

**L100**

Radix reports the measured height on the content element.

### `web/vite.config.ts`

**L5**

Builds straight into app/static/, so `python app/server.py` serves the

**L6**

production bundle with no Node installed. `npm run dev` proxies /api to the

**L7**

Flask process for hot-reload work.

---

## Tools

*Diagnostics, dataset generation, secret scanning.*

### `scripts/check_no_secrets.py`

> Secret scanner — run before every commit (see scripts/pre-commit) to catch
> a credential before it ever reaches git history, not after.
> 
> Why this exists as actual code and not just a README promise: the rule
> this project follows — secret keys must never be committed to a repo,
> environment variables only — is the standard every payment-adjacent
> engineering org states. A README saying "we don't commit secrets" is a
> claim; a script that structurally blocks the commit is evidence. It also
> guards against leftover credentials or placeholder names carried in from
> other projects.
> 
> Patterns covered:
> - Gemini API keys (this project's actual provider) — AIza...
> - Payment-gateway API keys / key secrets — the rzp_live_/rzp_test_ and
>   key_id/key_secret shapes, even though this project never calls a
>   payment API, in case that changes later
> - AWS access keys, generic private key headers
> - Any *_API_KEY / *_SECRET / *_TOKEN assignment whose value isn't an
>   obvious placeholder (xxx, your_key_here, changeme, <...>, empty)
> 
> Usage:
>     python scripts/check_no_secrets.py               # scans staged files
>     python scripts/check_no_secrets.py --all          # scans the whole tree
>     python scripts/check_no_secrets.py file1 file2    # scans specific files

**L37**

The previous provider's prefix. Kept deliberately: a scanner that detects

**L38**

more kinds of secret is strictly safer, and an old key can still be

**L39**

sitting in someone's shell history or a stale .env.

**L52**

A credential is never a bare number, a bare identifier being read back out, or

**L53**

a call expression. These forms show up constantly in ordinary code that happens

**L54**

to have TOKEN/SECRET in a variable name (e.g. MAX_OUTPUT_TOKENS = 1000), and

**L55**

flagging them trains people to ignore the scanner — which is the real risk.

**L72**

Files we deliberately allow to contain placeholder-shaped strings.

**L75**

Test scaffolding needs credential-*shaped* constants that are not credentials

**L76**

— a fake Razorpay key the mock server accepts, for instance. Two escape

**L77**

hatches, both narrow and both visible in review:

**L78**



**L79**

1. The value carries a conventional fake marker (your…, fake…, example…).

**L80**

A genuine leaked key will not contain those words.

**L82**



**L83**

Neither is a blanket file exemption, so a real key sitting next to a fake one

**L84**

is still caught.

### `scripts/gemini_doctor.py`

> Finds out why a live run fell back, one probe at a time.
> 
> The pipeline degrades to a safe fallback when the model never returns a usable
> answer, and that is deliberate — a chargeback decision should fail toward a
> human. But it means the interesting error is three layers down, and "check the
> server log" is no help when the run happened in a browser.
> 
> So this walks the same path the pipeline walks, in order, and stops at the
> first thing that breaks:
> 
>   1. is there a key, and does it look like one
>   2. does the endpoint accept it
>   3. does the configured model exist and answer
>   4. does it accept a tools array at all
>   5. does it accept the FORCED function call the pipeline relies on, with
>      thinking switched off the way the pipeline switches it off
> 
> Step 5 is the one that usually bites, and it fails two different ways. A model
> without real function-calling support answers a forced call with prose. A
> reasoning model that ignores thinking_budget=0 spends the whole allowance
> deliberating and returns an empty message — same symptom, opposite fix, and the
> doctor tells them apart by looking for reasoning_content.
> 
>  Plenty of models on the catalogue will
> happily chat, and quite a few will even emit a tool call when they feel like
> it, but the pipeline does not ask nicely — the classification round forces
> tool_choice to a named function, and a model without real function-calling
> support answers that with prose, an empty completion, or a 400.
> 
>     python scripts/gemini_doctor.py
>     python scripts/gemini_doctor.py --model gemini-3.8-flash

**L78**

── 1. the key ────────────────────────────────────────────────────────

**L92**

Probing through the pipeline's own adapter rather than the raw SDK, so

**L93**

a pass here means the path the pipeline actually takes works — including

**L94**

the message and tool translation, which is where an adapter bug would

**L95**

hide.

**L105**

── 2. auth ───────────────────────────────────────────────────────────

**L121**

── 3. plain completion ───────────────────────────────────────────────

**L133**

── 4. tools offered ──────────────────────────────────────────────────

**L147**

── 5. the forced call the pipeline actually makes ───────────────────

**L148**

Thinking off, exactly as the pipeline sends it. On a reasoning model the

**L149**

same allowance pays for deliberation and for the answer, and a forced

**L150**

single-function call has no essay to write.

### `scripts/generate_dataset.py`

> Generates the synthetic chargeback dataset per dataset/LABELLING_RUBRIC.md.
> 
> Deterministic given SEED — re-running this script reproduces byte-identical
> output, which is what makes "the labels are rubric-derived, not
> model-derived" a checkable claim rather than an assertion.
> 
> IMPORTANT — label_case() lives ONLY in this file, not in code/risk_signals.py
> or anywhere code/main.py can import from. That's deliberate: code/main.py
> uses risk_signals.py's FEATURE functions (evidence_sufficiency,
> is_amount_anomaly, is_merchant_repeat_pattern) to hand the model computed
> facts, but the runtime pipeline has no code path to the DECISION rule that
> turns those features into a ground-truth label. If it did, "the pipeline
> predicts its own eval labels" would be a fair circularity objection. It
> doesn't, so it isn't.
> 
> Usage:
>     python scripts/generate_dataset.py

**L37**

── Reason codes ──────────────────────────────────────────────────────────

**`make_merchants()`** — L134

20 synthetic merchants. 4 are deliberately 'risky' (chargeback rate
above baseline AND poor contest win rate) so merchant_repeat_pattern
has real positive cases to be evaluated against, not just theory.

**`make_evidence_items_string()`** — L159

bucket: 'full' (all required + maybe 1 extra), 'partial' (missing
exactly one required type), 'none' (nothing submitted).

**L168**

single-requirement codes: "partial" degrades to nothing submitted

**`label_case()`** — L179

THE ground-truth decision rule — dataset/LABELLING_RUBRIC.md §4,
applied here in code, never by the LLM under test. First matching rule
wins:
  1. amount_anomaly or merchant_repeat_pattern -> manual_review
  2. evidence sufficient -> contest
  3. else -> accept_liability

**L206**

~40/30/10/20 full-heavy

**L220**

anomaly: exceeds original

**L250**

lineterminator="\n" is load-bearing, not cosmetic: csv.writer defaults to

**L251**

"\r\n" (RFC 4180), which makes every regenerated file differ byte-for-byte

**L252**

from the LF-normalised copy committed to the repo (.gitattributes pins

**L253**

eol=lf). Same bytes in, same bytes out — that's what makes the

**L254**

"deterministic given SEED" claim above actually checkable with md5sum.

**L284**

seeded — reproducible shuffle, not a fresh draw each run

### `scripts/razorpay_doctor.py`

**L83**

1 — credentials -------------------------------------------------------

**L127**

2 — can we reach the host --------------------------------------------

**L151**

3 — authentication ----------------------------------------------------

**L169**

4 — the endpoints the console uses ------------------------------------

**L187**

Order creation is a write, so it is opt-in noise-wise but worth doing:

**L188**

it is the single call the demo depends on most.

**L196**

5 — demo readiness ----------------------------------------------------

---

## Tests

*249 of them, all offline.*

### `tests/adversarial_regression/fixtures.py`

> Defensive regression fixtures — see this directory's README for the
> required posture statement before reading further.
> 
> Every ATTACK fixture below is a well-known, publicly-documented prompt
> injection pattern (OWASP LLM Top 10 style: direct override, role/authority
> spoofing, delimiter/fake-system-tag confusion, fake conversation
> continuation, payload injection via code blocks, jailbreak/persona
> framing, fake prior-approval claims, prompt leaking). None were discovered,
> optimized, or generated by this project — they're the standard patterns
> any LLM security checklist lists, applied to this project's own domain
> (a chargeback merchant narrative field) so they can be run as regression
> tests against THIS system's own defense, not against anyone else's.
> 
> Every CONTROL fixture is benign text that touches similar SURFACE
> vocabulary (override, system, admin, approved, ignore, contest) without
> actually directing the model to do anything — these exist because a
> defense that flags every mention of "override" or "system" would score a
> perfect attack-defense rate while being useless (and would fail real
> merchants who happen to use those words normally). Without controls, a 0%
> attack success rate proves nothing.

### `tests/adversarial_regression/run_suite.py`

> Runs fixtures.py's ATTACK_FIXTURES and CONTROL_FIXTURES against the real
> pipeline (code/main.py) and reports two numbers side by side: the defense
> rate (attacks correctly flagged as prompt_injection_attempt) and the
> control false-positive rate (benign cases incorrectly flagged the same
> way). Report both, never just the first — a classifier that
> flags everything scores a perfect defense rate while being useless.
> 
> Every fixture is run against the SAME neutral base case (clean evidence,
> non-risky merchant, no amount anomaly) so the merchant_narrative is the
> only variable — isolating whether an injection attempt specifically
> changes the outcome, rather than conflating it with an otherwise
> hard case.
> 
> Uses the same disk cache as the main pipeline, so re-running this suite
> after a prompt change only pays for the cases whose exact request changed.
> 
> Usage:
>     python tests/adversarial_regression/run_suite.py

**`acquire_lock()`** — L44

Refuses to start a second overlapping run against the same
results.csv. Found the hard way: results.csv regressed from 33/34
genuine fixtures to 21/34 after what looks like two runs racing on the
same file — each one reads load_existing_results() once at startup, so
a run that starts while an earlier one is mid-write can see a smaller
"done" set than what's actually on disk, re-attempt fixtures that were
already genuinely evaluated, and overwrite good results with fresh
fallback rows if those re-attempts hit a quota wall. A lock file makes
that structurally impossible instead of relying on "don't launch two
of these," which already failed once.

**L70**

a non-risky merchant per dataset/merchant_history.csv

**L72**

matches amount - no amount_anomaly

**L76**

proof_of_delivery + shipping_carrier_record

**`load_existing_results()`** — L100

Resume support, same principle as code/main.py's process_cases():
a prior run's genuine results are kept, and only rows that are missing
or were the safe-fallback placeholder (is_fallback_row — e.g. from
hitting a quota wall mid-run) get retried. Without this, a quota
interruption would force re-spending on fixtures that already produced
a real, cache-worthy answer.

### `tests/fake_razorpay.py`

> A small, faithful stand-in for the Razorpay REST API.
> 
> Why this exists: the AEDI console talks to Razorpay over the network, and
> network calls are exactly the thing you cannot exercise in CI, on a plane, or
> inside a sandbox with no route to api.razorpay.com. Without a stand-in, the
> whole Razorpay bridge would ship untested and be debugged for the first time
> in front of an audience.
> 
> It implements only the endpoints `app/razorpay_live.py` actually calls, with
> the response shapes, id prefixes, Basic-auth behaviour and error envelope
> documented at https://razorpay.com/docs/api/ — including the important one:
> there is no create-a-dispute endpoint, so requesting it 404s exactly as the
> real API does.
> 
> Point the client at it with RAZORPAY_API_BASE=http://127.0.0.1:<port>.
> This is test scaffolding; it is never imported by the console at runtime.

**`FakeRazorpayState()`** — L36

Mutable store shared by the handler. Tests poke at this directly.

**L43**

(method, path) — lets tests assert what was hit

**L92**

keep pytest output clean

**L94**

-- helpers -----------------------------------------------------------

**L135**

Matches the real API: bad credentials are a 401 with this code.

**L211**

The real API has no dispute-create endpoint. Reproducing that

**L212**

exactly is the single most important behaviour of this mock: it is

**L213**

what the console's honesty about local chargebacks rests on.

**`FakeRazorpay()`** — L226

Context manager that runs the mock on an ephemeral port.

### `tests/test_adversarial_lock.py`

> Deterministic-logic test for the adversarial suite's lock file — no API
> calls, no LLM pool needed. Added after a real incident: results.csv
> regressed from 33/34 genuine fixtures to 21/34 because two run_suite.py
> invocations raced on the same file. This lock is
> what makes that structurally impossible now, not just "don't do that."

**L14**

run_suite.py does `from fixtures import ...`

**L22**

start clean regardless of leftover state

**L38**

should not raise - lock was properly released

**L44**

calling twice should not raise

### `tests/test_dataset_reproducibility.py`

> Guards the "deterministic given SEED — re-running reproduces byte-identical
> output" claim in scripts/generate_dataset.py.
> 
> That claim silently stopped being true once: csv.writer defaults to RFC 4180's
> "
> " line terminator, while .gitattributes pins the repo to eol=lf, so every
> regenerated file differed byte-for-byte from its committed copy even though the
> data was identical. Nothing caught it, because nothing checked.
> 
> These tests regenerate the whole dataset into a temp directory and compare it
> to what's committed, byte for byte. No API calls, no network.

**`_load_generator()`** — L34

Load scripts/generate_dataset.py fresh, pointed at a temp output dir.

Loaded fresh each time on purpose: the module seeds `random` at import
time, so a re-import is what re-establishes the deterministic starting
state.

**`test_generator_is_stable_across_two_runs()`** — L80

Same seed, two independent runs, same bytes — no hidden dependence on
hash randomisation, dict ordering, wall-clock time or filesystem order.

### `tests/test_evaluation.py`

> Deterministic-logic tests for code/evaluation/main.py — no API calls,
> matching the pattern in tests/test_main.py.

**L9**

Loaded by explicit path under a unique module name, not a plain

**L10**

`import main` - code/main.py and code/evaluation/main.py are both

**L11**

literally named `main`, and pytest's module cache is keyed by name, so a

**L12**

bare `import main` in this file would silently pull whichever of the two

**L13**

happened to be imported first in the same test session (a real bug found

**L14**

while wiring this up, not a hypothetical one).

**L35**

c3: actual accept, predicted contest

**L40**

c2 has no prediction

**L56**

actual accept_liability, predicted contest -> hurts contest's precision, not its recall

**L61**

1 true positive, 1 false positive

**L62**

the one real contest case was caught

**L70**

no predictions of this class at all

**L71**

no actual cases of this class at all

**L88**

amount ignored for FP

**L101**

one "wrong", one "right" - same cost either way

**L108**

actual=manual_review but agent auto-decided - a real risk, not priced

**L109**

as FP/FN since it doesn't match either defined error direction.

**L116**

not priced, but counted - see n_bypassed_review

**L123**

bonus metric computed correctly...

**L125**

...but never folds into the primary, mandatory cost number

**L132**

correctly routed, not bypassed

### `tests/test_live_call_deadline.py`

> Regression tests for the wall-clock deadline on live (LIVE mode) agent calls.
> 
> The bug this pins: on an account whose per-minute limit sits
> below one request's worth of output, the agent legitimately needs to wait out a
> minute per call. In the batch runner that is correct. Behind a browser request
> it is not: the operator clicks "run the pipeline", the request never returns,
> and the UI spins with nothing to read. The Razorpay Live tab showed exactly
> this — the event poll kept answering 200 while the decide call hung.
> 
> So every live call goes through run_agent_bounded(), which caps both the inner
> per-retry sleep and the total wall clock, and hands back an explanation the
> operator can act on instead of a hang.
> 
> No API calls, no network.

**L39**

── the deadline itself ───────────────────────────────────────────────────

**`test_a_missing_key_still_surfaces_as_systemexit()`** — L83

analyze_case can sys.exit() when no key is configured. That must reach
the route, which turns it into a 400 rather than a 504.

**L94**

── the budget handed down to the pipeline ────────────────────────────────

**L121**

── the routes ────────────────────────────────────────────────────────────

**`test_every_live_agent_call_goes_through_the_bounded_wrapper()`** — L123

A future route that calls analyze_case directly would reintroduce the
hang, so pin the call sites.

**`test_a_timed_out_live_analyze_returns_504_with_a_readable_body()`** — L133

End to end through the route: LIVE mode, model never answers.

**`test_replay_mode_is_untouched_by_the_deadline()`** — L160

The offline demo path must never hit the wrapper at all.

### `tests/test_main.py`

> Deterministic-logic tests only — no API calls. Mirrors the August build's
> test_main.py pattern.
> 
> Covers the pieces that must never depend on model output being well-formed:
> sanitize()'s fallback-to-safe-default behavior, enumerate_evidence()'s
> deterministic ID assignment, _execute_tool()'s refusal to trust
> model-supplied identifiers, and is_fallback_row()'s resume detection.

**L26**

not a real enum value

**L88**

model forgot to add the flag itself

**L122**

A model could pass a completely different / hallucinated case_id here —

**L123**

_execute_tool must not care, since it never reads its own arguments.

**L147**

Flag false - no reminder field at all, not even an empty one.

**L152**

Flag true - reminder present, and it says the flag is true.

**L166**

Model guessed wrong (said sufficient) — override must correct it.

**L192**

Model incorrectly claimed amount_anomaly when the computed flag says False.

**L211**

exceeds original

**L212**

partial mismatch flagged

**L216**

High rate but good win record — not a repeat-pattern flag on its own.

**L218**

High rate AND poor win record — flagged.

**L220**

Low rate, poor win record — not flagged, rate alone doesn't trigger it.

### `tests/test_merchant_intel.py`

> Tests for the SerpAPI merchant-intel enrichment.
> 
> No network. Every SerpAPI call is served by a fake opener, in the same style
> as tests/fake_razorpay.py.
> 
> The tests that matter most here are not the parsing ones. They are:
> 
>   * test_pipeline_never_imports_merchant_intel — the committed metrics must
>     stay reproducible from the repo alone, which is only true while the
>     scoring path has no search dependency. This asserts that structurally
>     rather than trusting a comment.
> 
>   * the escalate_only block — an external, gameable signal is allowed to buy
>     a case human attention and nothing else. Every direction that would let
>     it clear, decide, or improve a case is pinned shut.

**L33**

── fake SerpAPI ──────────────────────────────────────────────────────────

**`fake_opener()`** — L44

Returns an opener that answers every call with `payload`.

**L68**

── the structural guarantee ──────────────────────────────────────────────

**`test_pipeline_never_imports_merchant_intel()`** — L70

The held-out numbers must be recomputable offline. That is only true
while no scoring-path module reaches for the network.

**L86**

── the one-directional contract ──────────────────────────────────────────

**`test_manual_review_is_never_downgraded()`** — L94

The whole point: a clean search can never buy a case its way out of
human review.

**L117**

── query construction ────────────────────────────────────────────────────

**`test_query_quotes_the_merchant_name()`** — L119

Unquoted, a two-word brand matches every page containing either word.

**L150**

── classification ────────────────────────────────────────────────────────

**L198**

── signal banding ────────────────────────────────────────────────────────

**L233**

── failure modes ─────────────────────────────────────────────────────────

**L278**

── caching ───────────────────────────────────────────────────────────────

### `tests/test_output_token_budget.py`

> Regression tests for the adaptive output-token budget.
> 
> Gemini's free tier enforces an output-tokens-per-minute ceiling that can sit
> BELOW this pipeline's per-request max_tokens. The API then rejects every call
> with a 429 before generating anything, and because the old retry path slept and
> resent an identical request, the run could never recover — 100 cases in, 100
> fallback rows out, no successful call ever placed.
> 
> These tests pin the recovery behaviour: parse the real limit out of the
> rejection, shrink the request, and retry immediately rather than sleeping.
> 
> No API calls, no network.

**`main()`** — L41

Fresh module per test — the ceiling is process-global by design.

**`test_otpm_rejection_retries_immediately_instead_of_sleeping()`** — L68

The whole bug: sleeping and resending an identical request never
recovers, because the rejection is deterministic, not congestion.

**L71**

no env keys needed

**`_DummyPool()`** — L120

A KeyPool that needs no env keys, so mark_dead() can be observed.

**L129**

── the repeat-OTPM hot loop ──────────────────────────────────────────────

**L130**



**L131**

Observed in a real run: the ceiling was lowered to the account's limit of

**L132**

1000, and every later OTPM rejection still returned a 0-second wait. Those

**L133**

rejections are a different failure — the per-minute output budget is spent,

**L134**

not the request oversized — so retrying instantly burned all three attempts

**L135**

in about a second and landed on the fallback row.

**`test_second_identical_rejection_waits_instead_of_spinning()`** — L152

The regression. Ceiling is already 1000 and cannot go lower, so a zero
wait would retry an identical request that cannot succeed.

**L156**

discovery

**L157**

budget spent

**`test_a_pinned_ceiling_still_backs_off_rather_than_spinning()`** — L189

With AEDI_MAX_OUTPUT_TOKENS already at the limit, the very first
rejection cannot resize anything — it must wait immediately.

**L213**

── the interactive wait cap ──────────────────────────────────────────────

**`test_analyze_case_refuses_a_wait_longer_than_the_caller_allows()`** — L215

A 429 can ask for a multi-minute wait, and the OTPM-exhausted path asks
for a minute. Correct for the batch runner; it must not park a browser
request for that long.

### `tests/test_partial_run_reporting.py`

> A pipeline run that stops early leaves a partial output.csv.
> 
> Observed in the field: one scored case on `dev` made the console select that
> split, report coverage 0%, and project INR 0 saved per month — while the
> complete `held_out` split sat there unused. Two faults: a stub was treated as
> "has predictions", and a monthly figure was extrapolated from a single case.
> 
> The cases that do get scored are whichever ones the run reached before it
> stopped — file order, not a random sample — so nothing may be extrapolated
> from them. These tests pin that the API reports completeness honestly enough
> for the UI to decline.

**`dev_output()`** — L39

Write a dev/output.csv, and always restore the tree afterwards.

**L72**

── health ────────────────────────────────────────────────────────────────

**L86**

capped at the number of dev cases

**L98**

── the split the console should land on ──────────────────────────────────

**`test_the_complete_split_outranks_a_stub()`** — L100

Mirrors the selection the UI makes. `dev` sorts first alphabetically and
would win a naive `find(has_predictions)`, which is exactly the bug.

**`test_a_naive_first_with_predictions_would_have_picked_the_stub()`** — L114

Guards the regression itself: proves the old rule really was wrong.

**L122**

── metrics ───────────────────────────────────────────────────────────────

**`test_metrics_on_a_partial_run_scores_baselines_on_the_whole_split()`** — L133

This is why the numbers are not comparable and the UI must say so.

### `tests/test_razorpay_endpoints.py`

> End-to-end tests for the console's /api/rzp/* endpoints.
> 
> These drive the Flask app through its test client while `RAZORPAY_API_BASE`
> points at tests/fake_razorpay.py, so the full path is exercised — HTTP in,
> Razorpay call out, pipeline signals, HTTP out — with no network and no
> credentials.
> 
> The behaviours pinned here are the ones a demo would expose:
>   * every endpoint degrades to a readable message when unconfigured,
>   * a real payment id is never taken on trust from the browser,
>   * a locally raised chargeback is never submitted to Razorpay,
>   * the deterministic half of the pipeline runs on live data without a
>     GEMINI_API_KEY, and says so rather than inventing a decision.

**`configured()`** — L47

App wired to the mock, with session state reset between tests.

**L73**

── status ────────────────────────────────────────────────────────────────

**L120**

── reference data ────────────────────────────────────────────────────────

**L140**

── orders and payments ───────────────────────────────────────────────────

**L187**

── raising a chargeback ──────────────────────────────────────────────────

**L256**

── deciding ──────────────────────────────────────────────────────────────

**`test_deciding_without_a_gemini_key_refuses_but_still_returns_real_signals()`** — L258

The deterministic half is genuinely computable offline; the model half
is not. The endpoint must give the first and decline the second.

**L282**

── submitting back ───────────────────────────────────────────────────────

**L312**

pulls it into the session

**L347**

── webhooks ──────────────────────────────────────────────────────────────

**L392**

── event feed ────────────────────────────────────────────────────────────

**L433**

── failures must be visible, not swallowed ───────────────────────────────

**L434**



**L435**

The bug these pin: /api/rzp/disputes used to catch RazorpayError and return

**L436**

200 with an empty list, so a completely dead connection rendered as a

**L437**

healthy, empty account.

**`broken()`** — L440

Configured, but pointed at a port with nothing listening.

### `tests/test_razorpay_live.py`

> Tests for the Razorpay test-mode bridge.
> 
> Everything here runs against tests/fake_razorpay.py — a local stand-in that
> mirrors the documented Razorpay REST contract. No network, no credentials,
> no reliance on api.razorpay.com being reachable.
> 
> The properties worth pinning are less about happy paths than about the two
> places this integration could embarrass us:
> 
>   1. A live key must never be usable. Accepting a dispute is irreversible
>      and moves real money.
>   2. A locally-raised chargeback must never be presentable as a real
>      Razorpay dispute, and must never be actionable against the API.

**`_load_module()`** — L29

`app/razorpay_live.py` by explicit path — `app` is not a package.

**L53**

── credential safety ─────────────────────────────────────────────────────

**`test_live_key_refusal_is_a_razorpay_error_subclass()`** — L61

So a single `except RazorpayError` in the server catches it too.

**L105**

── transport ─────────────────────────────────────────────────────────────

**L154**

── the dispute-create gap, pinned ────────────────────────────────────────

**`test_razorpay_has_no_dispute_create_endpoint()`** — L156

The premise of the whole local-chargeback design.

If Razorpay ever ships POST /v1/disputes this test starts failing, which
is the signal to delete the local stand-in and use the real thing.

**L216**

── payment → case mapping ────────────────────────────────────────────────

**`test_payment_to_case_matches_the_dataset_row_shape()`** — L224

A live case must be indistinguishable in shape from a CSV row, so no
downstream code needs a special branch for it.

**L249**

1780000000 == 2026-05-28T22:26Z

**`test_evidence_rendering_round_trips_through_the_real_parser()`** — L252

Whatever we render must be readable by risk_signals.parse_evidence_items,
otherwise the deterministic signals silently see zero evidence.

**`test_a_live_case_produces_the_expected_deterministic_signals()`** — L269

End to end on the deterministic half: a real payment plus complete
evidence for 13.1 must come out `sufficient`.

**`test_every_catalog_evidence_type_is_one_the_dataset_actually_uses()`** — L300

Guards against offering a judge an evidence type the reason-code table
has never heard of, which would make sufficiency unsatisfiable.

**L320**

── contest payload ───────────────────────────────────────────────────────

**L342**

── webhooks ──────────────────────────────────────────────────────────────

**L364**

── event log ─────────────────────────────────────────────────────────────

**L410**

── failure diagnosis ─────────────────────────────────────────────────────

**L411**



**L412**

A 502 with no explanation is what made a real connection failure

**L413**

undiagnosable in the field. Each shape below must name its own cause.

**`test_unknown_failures_return_empty_rather_than_guessing()`** — L461

Better to show Razorpay's own words than invent a wrong diagnosis.

**`test_a_cut_tls_connection_is_distinguished_from_a_certificate_problem()`** — L480

Observed in the wild: 'TLS/SSL connection has been closed (EOF)'.
That is interception, not a missing CA bundle — different fix entirely.

**`test_certificate_diagnosis_still_wins_over_the_generic_tls_one()`** — L500

Ordering matters: the cert message also contains 'SSL'.

### `tests/test_reasoning_budget.py`

> Regression tests for reasoning-budget starvation.
> 
> The failure this pins, seen on a live account:
> 
>     400 - {'code': 'tool_use_failed', 'failed_generation': ''}
> 
> repeated three times, then a fallback row. It reads like a malformed prompt and
> is nothing of the sort. The default model is a reasoning model, and on Gemini the
> output-token budget is spent on thinking AND on speaking — reasoning_format
> "hidden" strips the thinking from the response but the tokens are still
> generated against the same ceiling. On an account whose OTPM ceiling is 1000,
> the model can spend the entire budget thinking and emit nothing at all.
> 
> The old recovery path made it strictly worse: each retry appended a corrective
> nudge, so the request that already had no room to answer got larger.
> 
> No API calls, no network.

**L30**

The exact shape Gemini returned on the reported run.

**L37**

Same error code, but the model *did* answer — this one is recoverable and

**L38**

must not be mistaken for starvation.

**L62**

── telling the two tool_use_failed cases apart ───────────────────────────

**`test_a_populated_generation_is_not_starvation()`** — L68

That one is recoverable — the model answered, it just missed the schema.

**`test_the_recoverable_case_is_still_recovered()`** — L73

Guard against the new predicate stealing work from the old path.

**`test_a_low_output_ceiling_clamps_the_classify_budget()`** — L83

A discovered ceiling has to reach the budget the forced round asks for.

**L91**

── what a starved call does next ─────────────────────────────────────────

**`_Boom()`** — L93

Fails with `err` for the first `fails` calls, then answers.

**`_turn()`** — L108

max_rounds=1 makes the single round the FORCED one, which is where the
starvation recovery lives.

**L118**

first attempt returns nothing, second answers

**`test_a_starved_retry_does_not_make_the_prompt_longer()`** — L126

The nudge is the wrong medicine here: it spends the retry enlarging a
request that already had no room to answer.

**`test_a_malformed_generation_still_gets_the_nudge()`** — L137

The old recovery path must keep working for the failure it was built
for — a model that answered but broke the schema.

**`test_starving_with_reasoning_already_off_gives_up()`** — L146

Nothing left to free. Retrying is a certainty, not a chance.

**L148**

never recovers

**`test_analyze_case_does_not_sleep_on_a_proven_dead_end()`** — L161

The reported log burned three attempts at five seconds each on a
deterministic 400. That is fifteen seconds spent proving a certainty.

**L175**

── the request Gemini actually receives ────────────────────────────────────

**`test_the_budget_is_sent_as_plain_max_tokens()`** — L177

Gemini serves the OpenAI Chat Completions dialect, where max_tokens is the
output ceiling. max_completion_tokens was the previous provider's spelling
for a reasoning model billing thought and answer against one number.

**`test_no_reasoning_parameters_are_sent_on_the_happy_path()`** — L187

reasoning_format and reasoning_effort belonged to a different provider.
The only thing extra_body carries now is Gemini's thinking budget, and on
the ordinary path that budget is zero.

**L194**

extra_body carries exactly one thing: the thinking switch.

**L198**

── an unanswered case must not look like a decision ──────────────────────

**`test_a_real_manual_review_is_not_flagged_as_a_fallback()`** — L204

manual_review is a legitimate verdict. Only the placeholder counts.

**`test_starvation_is_handled_in_the_first_round_too()`** — L211

The reported run never reached the forced round: the first round asks
for fewer tokens, so it starves first. Handling starvation only under
force_classify left that path burning the outer retries at five seconds
each and never trying reasoning off.

**`test_a_non_starvation_error_still_fails_the_first_round_immediately()`** — L228

The extra local attempt exists only for the no-thinking retry; it must
not turn round one into a general retry loop.

---
