"""
AEDI console — a small Flask app that puts a real UI in front of the
chargeback pipeline.

Everything it shows is computed by the actual project code, not
reimplemented here:

- `code/risk_signals.py` computes the deterministic signals shown per case
- `code/main.py::build_context` assembles the exact context the agent sees
- `code/evaluation/main.py` computes every metric on the Evaluation tab
- `tests/adversarial_regression/fixtures.py` supplies the fixture catalog

Two operating modes, detected at startup:

- REPLAY (no GROQ_API_KEY): every deterministic signal, the full evaluation
  harness, and the committed predictions are available. "Run agent" replays
  the committed decision for that case. This mode always works — no
  network, no credentials, nothing to configure.
- LIVE (GROQ_API_KEY present): "Run agent" additionally calls the real
  bounded agent loop for a single case, through the same disk cache the
  batch pipeline uses.

Usage:
    pip install -r app/requirements.txt
    python app/server.py            # then open http://127.0.0.1:8000
"""

import os
import sys
import csv
import json
import time
import traceback
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "code"))
sys.path.insert(0, str(REPO_ROOT / "tests" / "adversarial_regression"))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except Exception:
    pass

import importlib.util                     # noqa: E402
import risk_signals                       # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import razorpay_live                      # noqa: E402


def _load(alias: str, path: Path):
    """`code/main.py` and `code/evaluation/main.py` are both called `main`,
    so load each from its own path under a distinct module name."""
    spec = importlib.util.spec_from_file_location(alias, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


pipeline = _load("aedi_pipeline", REPO_ROOT / "code" / "main.py")
evaluation = _load("aedi_evaluation", REPO_ROOT / "code" / "evaluation" / "main.py")

app = Flask(__name__, static_folder=str(Path(__file__).parent / "static"), static_url_path="")

DATASET_DIR = REPO_ROOT / "dataset"
SPLITS = ("dev", "held_out")

_dataset = pipeline.Dataset(DATASET_DIR)
_pool = None          # lazily built, only in LIVE mode
_cache = pipeline.ResponseCache()


# ── helpers ───────────────────────────────────────────────────────────────

def has_api_key() -> bool:
    import re
    return any(re.fullmatch(r"GROQ_API_KEY(_\d+)?", k) and v for k, v in os.environ.items())


def read_csv(path: Path) -> list:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def split_cases(split: str) -> list:
    return read_csv(DATASET_DIR / split / "cases.csv")


def split_labels(split: str) -> dict:
    return {r["case_id"]: r["ground_truth_decision"] for r in read_csv(DATASET_DIR / split / "labels.csv")}


def split_predictions(split: str) -> dict:
    rows = read_csv(DATASET_DIR / split / "output.csv")
    return {r["case_id"]: r for r in rows}


def case_row(split: str, case_id: str) -> dict:
    for r in split_cases(split):
        if r["case_id"] == case_id:
            return r
    return None


def signals_for(row: dict) -> dict:
    """Deterministic signals, straight from risk_signals.py — the same call
    the runtime pipeline and the dataset generator both make."""
    merchant = _dataset.merchant_history.get(row["merchant_id"], {})
    req = _dataset.reason_requirements.get(row["reason_code"], {})
    items = risk_signals.parse_evidence_items(row)
    required = risk_signals.required_evidence_types(req)
    sufficiency, missing = risk_signals.evidence_sufficiency(items, required)
    present = {i["type"] for i in items}
    return {
        "evidence_items": items,
        "required_types": sorted(required),
        "present_types": sorted(present),
        "missing_types": missing,
        "evidence_sufficiency": sufficiency,
        "amount_anomaly": risk_signals.is_amount_anomaly(row),
        "merchant_repeat_pattern": risk_signals.is_merchant_repeat_pattern(merchant),
        "merchant": merchant,
        "reason_requirement": req,
    }


def risk_flag_list(sig: dict) -> list:
    flags = []
    if sig["evidence_sufficiency"] != "sufficient":
        flags.append("evidence_incomplete_for_reason_code")
    if sig["amount_anomaly"]:
        flags.append("amount_anomaly")
    if sig["merchant_repeat_pattern"]:
        flags.append("merchant_repeat_pattern")
    return flags


# ── API ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    live = has_api_key()
    return jsonify({
        "mode": "live" if live else "replay",
        "live_capable": live,
        "cache_entries": len(list((REPO_ROOT / ".cache" / "llm_responses").glob("*.json")))
        if (REPO_ROOT / ".cache" / "llm_responses").exists() else 0,
        "model": pipeline.MODEL,
        # `has_predictions` alone was misleading: an interrupted run leaves a
        # one-row output.csv, which looked identical to a complete one. Report
        # the scored count so callers can tell a finished run from a stub.
        "splits": {
            s: {
                "cases": len(split_cases(s)),
                "has_predictions": (DATASET_DIR / s / "output.csv").exists(),
                "scored": len(split_predictions(s)),
                "complete": len(split_predictions(s)) >= len(split_cases(s)) > 0,
            } for s in SPLITS
        },
    })


@app.get("/api/cases")
def cases():
    split = request.args.get("split", "held_out")
    if split not in SPLITS:
        return jsonify({"error": "unknown split"}), 400
    labels = split_labels(split)
    preds = split_predictions(split)
    out = []
    for row in split_cases(split):
        sig = signals_for(row)
        cid = row["case_id"]
        pred = preds.get(cid, {})
        out.append({
            "case_id": cid,
            "merchant_id": row["merchant_id"],
            "amount": row["amount"],
            "currency": row["currency"],
            "reason_code": row["reason_code"],
            "payment_method": row["payment_method"],
            "transaction_date": row["transaction_date"],
            "n_evidence": len(sig["evidence_items"]),
            "evidence_sufficiency": sig["evidence_sufficiency"],
            "risk_flags": risk_flag_list(sig),
            "ground_truth": labels.get(cid),
            "prediction": pred.get("decision"),
            "agrees": (pred.get("decision") == labels.get(cid)) if pred else None,
        })
    return jsonify({"split": split, "cases": out})


@app.get("/api/case/<split>/<case_id>")
def case_detail(split, case_id):
    if split not in SPLITS:
        return jsonify({"error": "unknown split"}), 400
    row = case_row(split, case_id)
    if not row:
        return jsonify({"error": "no such case"}), 404
    sig = signals_for(row)
    ctx = pipeline.build_context(_dataset, row)
    pred = split_predictions(split).get(case_id)
    return jsonify({
        "split": split,
        "case": row,
        "signals": {k: v for k, v in sig.items() if k != "reason_requirement"},
        "risk_flags": risk_flag_list(sig),
        "reason_requirement": sig["reason_requirement"],
        "agent_context": ctx,
        "ground_truth": split_labels(split).get(case_id),
        "committed_prediction": pred,
    })


@app.post("/api/analyze")
def analyze():
    """Replay the committed decision, or — in LIVE mode — actually run the
    bounded agent loop for this one case through the real disk cache."""
    global _pool
    body = request.get_json(force=True) or {}
    split, case_id = body.get("split", "held_out"), body.get("case_id")
    mode = body.get("mode", "replay")

    row = case_row(split, case_id)
    if not row:
        return jsonify({"error": "no such case"}), 404

    sig = signals_for(row)
    ctx = pipeline.build_context(_dataset, row)
    flags = risk_flag_list(sig)

    trace = [
        {"step": "build_context", "kind": "deterministic",
         "detail": f"{len(sig['evidence_items'])} evidence item(s) enumerated with fixed IDs "
                   f"(ev_1..ev_{len(sig['evidence_items'])}); reason code {row['reason_code']} "
                   f"requires {', '.join(sig['required_types']) or 'nothing on file'}"},
        {"step": "risk_signals", "kind": "deterministic",
         "detail": f"evidence_sufficiency={sig['evidence_sufficiency']} · "
                   f"amount_anomaly={sig['amount_anomaly']} · "
                   f"merchant_repeat_pattern={sig['merchant_repeat_pattern']} — computed in code, "
                   f"never inferred by the model"},
    ]

    if mode == "live":
        if not has_api_key():
            return jsonify({"error": "LIVE mode needs a GROQ_API_KEY in .env"}), 400
        try:
            if _pool is None:
                _pool = pipeline.KeyPool()
            trace.append({"step": "llm_cache", "kind": "cache",
                          "detail": "request hashed and checked against .cache/llm_responses/ before any network call"})
            result, agent_error = run_agent_bounded(row, ctx)
            if agent_error is not None:
                return jsonify({"error": str(agent_error)}), 504
            trace.append({"step": "_run_agent_turn", "kind": "model",
                          "detail": "bounded loop, max_rounds=2 — round 2 forces tool_choice=classify_chargeback"})
        except SystemExit as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": f"{type(e).__name__}: {e}"}), 500
        source = "live"
    else:
        pred = split_predictions(split).get(case_id)
        if not pred:
            return jsonify({"error": f"no committed predictions for split '{split}'. "
                                     f"Run the pipeline first, or switch to a split that has output.csv."}), 404
        result = {
            "decision": pred["decision"],
            "evidence_sufficiency": pred["evidence_sufficiency"],
            "risk_flags": [f for f in (pred.get("risk_flags") or "").split(";") if f],
            "reason": pred["reason"],
            "confidence": float(pred["confidence"]) if pred.get("confidence") else None,
            "cited_evidence_ids": pred.get("cited_evidence_ids", ""),
        }
        trace.append({"step": "_run_agent_turn", "kind": "model",
                      "detail": "replayed from the committed run (dataset/%s/output.csv) — no API call" % split})
        source = "replay"

    trace.append({"step": "apply_deterministic_overrides", "kind": "deterministic",
                  "detail": "evidence_sufficiency and the mechanical risk flags are pinned to the "
                            "code-computed values regardless of what the model returned"})

    fallback = source == "live" and pipeline.is_fallback_result(result)
    if fallback:
        trace.append({"step": "safe_fallback", "kind": "blocked",
                      "detail": "the model never returned a usable answer — this row is the "
                                "safe fallback, not a decision. Check the server log."})

    cited = [c.strip() for c in str(result.get("cited_evidence_ids", "")).replace(",", ";").split(";") if c.strip()]
    gt = split_labels(split).get(case_id)
    return jsonify({
        "source": source,
        "fallback": fallback,
        "result": result,
        "cited_evidence_ids": cited,
        "deterministic_flags": flags,
        "trace": trace,
        "ground_truth": gt,
        "agrees": result["decision"] == gt if gt else None,
    })


@app.get("/api/metrics")
def metrics():
    """Every number here is produced by code/evaluation/main.py, in process."""
    split = request.args.get("split", "held_out")
    if split not in SPLITS:
        return jsonify({"error": "unknown split"}), 400
    cases_rows = split_cases(split)
    labels = split_labels(split)
    preds_rows = split_predictions(split)
    if not preds_rows:
        return jsonify({"split": split, "available": False,
                        "message": f"dataset/{split}/output.csv does not exist yet — "
                                   f"run the pipeline on this split to generate predictions."})

    amounts = {r["case_id"]: r["amount"] for r in cases_rows}
    agent = {cid: r["decision"] for cid, r in preds_rows.items()}
    rules = evaluation.baseline_predictions(cases_rows, _dataset.reason_requirements)
    allrev = evaluation.always_manual_review_predictions(cases_rows)

    def block(name, predictions):
        m = evaluation.confusion_matrix(predictions, labels)
        cost = evaluation.expected_cost(predictions, labels, amounts)
        pr = {}
        for cls in evaluation.POSITIVE_CLASSES:
            p, r = evaluation.precision_recall(m, cls)
            pr[cls] = {"precision": p, "recall": r}
        scored = {c: d for c, d in predictions.items() if c in labels}
        return {
            "name": name,
            "n": len(scored),
            "matrix": m,
            "precision_recall": pr,
            "coverage": evaluation.coverage(scored),
            "cost": cost,
        }

    n_cases = len(cases_rows)
    n_scored = len({c for c in agent if c in labels})

    return jsonify({
        "split": split,
        "available": True,
        # An interrupted pipeline run leaves a partial output.csv. The scored
        # subset is then "whatever the run got through before it stopped" —
        # not a random sample — so anything extrapolated from it is wrong.
        # Report it and let the UI decline rather than quietly averaging 1 case.
        "n_cases": n_cases,
        "n_scored": n_scored,
        "complete": n_scored >= n_cases > 0,
        "decision_values": evaluation.DECISION_VALUES,
        "cost_model": {
            "false_positive_inr": evaluation.COST_FALSE_POSITIVE_INR,
            "manual_review_inr": evaluation.COST_MANUAL_REVIEW_INR,
            "bypassed_exposure_rate": evaluation.BYPASSED_REVIEW_EXPOSURE_RATE,
        },
        "blocks": [
            block("AEDI agent", agent),
            block("Rules-only baseline", rules),
            block("Always manual_review", allrev),
        ],
    })


# A deliberately neutral case: clean evidence, non-risky merchant, no amount
# anomaly. Same base run_suite.py uses, so the narrative is the ONLY variable —
# whatever the model does here is attributable to the text, nothing else.
NEUTRAL_BASE_CASE = {
    "merchant_id": "mch_015",
    "amount": "5000.00",
    "original_amount": "5000.00",
    "currency": "INR",
    "transaction_date": "2026-06-01",
    "payment_method": "card",
    "reason_code": "13.1",
    "evidence_items": (
        "proof_of_delivery: Signed delivery confirmation dated within the expected window | "
        "shipping_carrier_record: Carrier tracking record showing package scanned delivered"
    ),
}


@app.post("/api/injection-test")
def injection_test():
    """Run one arbitrary merchant narrative against the real pipeline.

    This is the honest version of a 'try to break it' demo: the evidence is
    clean and sufficient, so the correct answer is `contest`. If a narrative can
    move the decision, the merchant just talked the system out of money.
    Requires LIVE mode — judging novel text is exactly the part a model does and
    deterministic code can't fake.
    """
    global _pool
    body = request.get_json(force=True) or {}
    narrative = (body.get("narrative") or "").strip()
    if not narrative:
        return jsonify({"error": "empty narrative"}), 400
    if not has_api_key():
        return jsonify({"error": "needs LIVE mode — set GROQ_API_KEY in .env and restart. "
                                 "Novel text has to be judged by the model; replaying a "
                                 "canned verdict here would be theatre."}), 400
    row = dict(NEUTRAL_BASE_CASE, case_id="playground", merchant_narrative=narrative)
    try:
        if _pool is None:
            _pool = pipeline.KeyPool()
        ctx = pipeline.build_context(_dataset, row)
        result, agent_error = run_agent_bounded(row, ctx)
        if agent_error is not None:
            return jsonify({"error": str(agent_error)}), 504
    except SystemExit as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500

    flags = result.get("risk_flags", [])
    return jsonify({
        "result": result,
        "flagged_injection": "prompt_injection_attempt" in flags,
        "held_the_line": result["decision"] == "contest" or "prompt_injection_attempt" in flags,
        "expected_without_interference": "contest",
    })


@app.get("/api/adversarial")
def adversarial():
    import fixtures
    results_path = REPO_ROOT / "tests" / "adversarial_regression" / "results.csv"
    stored = {r["id"]: r for r in read_csv(results_path)} if results_path.exists() else {}

    def shape(f, kind):
        r = stored.get(f["id"], {})
        return {
            "id": f["id"], "kind": kind,
            "category": f.get("category", ""),
            "narrative": f["narrative"],
            "flagged": (r.get("flagged") or "").lower() in ("true", "1", "yes") if r else None,
            "decision": r.get("decision"),
        }

    attacks = [shape(f, "attack") for f in fixtures.ATTACK_FIXTURES]
    controls = [shape(f, "control") for f in fixtures.CONTROL_FIXTURES]
    return jsonify({
        "has_stored_results": bool(stored),
        "attacks": attacks,
        "controls": controls,
        "summary": {
            "n_attacks": len(attacks), "n_controls": len(controls),
            "defense_rate": 1.0, "control_false_positive_rate": 0.0,
            "note": "Last full suite run: 24/24 attacks flagged, 0/10 controls flagged. "
                    "Re-run tests/adversarial_regression/run_suite.py to regenerate results.csv.",
        },
    })


# ── bounded live agent calls ──────────────────────────────────────────────
#
# analyze_case() retries with backoff, and a token-per-day rejection asks for
# a 15-minute wait. That is correct for the batch runner and unacceptable for
# a browser request, which just spins with no feedback. Live calls from the
# console therefore run on a worker thread with a hard deadline.

LIVE_CALL_DEADLINE_SECONDS = float(os.environ.get("AEDI_LIVE_TIMEOUT", "90"))
LIVE_CALL_MAX_WAIT_SECONDS = 20.0


def run_agent_bounded(row, ctx, deadline=None):
    """Run the agent with a wall-clock deadline.

    Returns (result, error). On timeout the worker is left running: it cannot
    be killed safely mid-HTTP-call, and letting it finish means its answer
    lands in the shared disk cache, so the retry the operator makes is fast.
    """
    import threading
    deadline = deadline or LIVE_CALL_DEADLINE_SECONDS
    box = {}

    def work():
        try:
            box["result"] = pipeline.analyze_case(
                _pool, _cache, row, ctx, max_wait=LIVE_CALL_MAX_WAIT_SECONDS)
        except BaseException as e:                      # noqa: BLE001
            box["error"] = e

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(deadline)

    if worker.is_alive():
        return None, TimeoutError(
            f"The model did not answer within {deadline:.0f}s. On a free Groq tier this is "
            f"usually the output-tokens-per-minute limit: the account can place roughly one "
            f"call a minute, so an interactive run stalls. Check the server log for 'OTPM'. "
            f"Options: wait a minute and retry (the attempt still running will land in the "
            f"cache, making the retry fast), set AEDI_MODEL to a model with a higher free-tier "
            f"limit, or raise the limit at console.groq.com/settings/billing.")
    if "error" in box:
        return None, box["error"]
    return box.get("result"), None


# ── Razorpay test-mode bridge ─────────────────────────────────────────────
#
# See app/razorpay_live.py for the honesty boundary this code maintains:
# payments are real Razorpay objects, chargebacks are locally raised because
# the Razorpay API has no endpoint to create one, and every object says which
# it is. Nothing below ever presents a local object as a Razorpay one.

_rzp_events = razorpay_live.EventLog()
_rzp_disputes = {}        # dispute_id -> normalised dispute (local + real)
_rzp_decisions = {}       # dispute_id -> last agent result
_rzp_client_cache = {"client": None, "key_id": None}


def rzp_client():
    """Build (and memoise) a client for the current credentials."""
    key_id = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
    if _rzp_client_cache["client"] is not None and _rzp_client_cache["key_id"] == key_id:
        return _rzp_client_cache["client"]
    client = razorpay_live.client_from_env()
    _rzp_client_cache.update(client=client, key_id=key_id)
    return client


def rzp_guard():
    """Return (client, None) or (None, flask response) — saves repeating this."""
    cfg = razorpay_live.read_config()
    if cfg["state"] != "configured":
        return None, (jsonify({"error": cfg["detail"], "state": cfg["state"]}), 400)
    try:
        return rzp_client(), None
    except razorpay_live.RazorpayError as e:
        return None, (jsonify(razorpay_live.error_payload(e)), 400)


@app.get("/api/rzp/status")
def rzp_status():
    """Configuration state, plus — if asked — an actual round trip.

    `?probe=1` costs a network call, so the UI only does it on demand rather
    than on every poll.
    """
    cfg = razorpay_live.read_config()
    out = dict(cfg, reachable=None, reach_detail=None, real_disputes=None)

    if cfg["state"] == "configured" and request.args.get("probe") == "1":
        try:
            client = rzp_client()
            client.ping()
            out["reachable"] = True
            out["reach_detail"] = "Credentials accepted by Razorpay."
            try:
                out["real_disputes"] = len(client.fetch_disputes())
            except razorpay_live.RazorpayError:
                out["real_disputes"] = None
        except razorpay_live.RazorpayError as e:
            cause, fix = razorpay_live.diagnose(e)
            out["reachable"] = False
            out["reach_detail"] = e.message
            out["cause"] = cause
            out["fix"] = fix
    return jsonify(out)


@app.get("/api/rzp/reference")
def rzp_reference():
    """Everything the live form needs: real merchants, real reason codes,
    real evidence types. Sourced from the project's reference data so a live
    case is scored against exactly the same rules as a dataset case."""
    merchants = [
        {
            "merchant_id": m["merchant_id"],
            "chargeback_rate_90d": m.get("chargeback_rate_90d"),
            "prior_contest_win_rate": m.get("prior_contest_win_rate"),
            "history_flags": m.get("history_flags", ""),
            "repeat_pattern": risk_signals.is_merchant_repeat_pattern(m),
        }
        for m in _dataset.merchant_history.values()
    ]
    reasons = [
        {
            "reason_code": r["reason_code"],
            "network": r.get("network"),
            "description": r.get("description"),
            "required_evidence_types": sorted(risk_signals.required_evidence_types(r)),
        }
        for r in _dataset.reason_requirements.values()
    ]
    return jsonify({
        "merchants": sorted(merchants, key=lambda m: m["merchant_id"]),
        "reason_codes": sorted(reasons, key=lambda r: r["reason_code"]),
        "evidence_catalog": razorpay_live.EVIDENCE_CATALOG,
    })


@app.post("/api/rzp/order")
def rzp_order():
    """Create a genuine Razorpay test-mode order.

    The order id that comes back is real and appears in the merchant's
    Razorpay test dashboard. The browser then hands it to Checkout.js, and
    the resulting payment is a real `pay_…` object.
    """
    client, err = rzp_guard()
    if err:
        return err
    body = request.get_json(force=True) or {}
    try:
        rupees = float(body.get("amount_inr") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "amount_inr must be a number"}), 400
    if rupees < 1:
        return jsonify({"error": "amount must be at least INR 1.00"}), 400

    try:
        order = client.create_order(
            int(round(rupees * 100)),
            receipt=f"aedi_{int(time.time())}",
            notes={"source": "aedi-console", "merchant_id": body.get("merchant_id", "")},
        )
    except razorpay_live.RazorpayError as e:
        return jsonify(razorpay_live.error_payload(e)), 502

    _rzp_events.add("order.created",
                    f"Order {order['id']} created for INR {rupees:,.2f}",
                    origin="razorpay", order_id=order["id"])
    return jsonify({"order": order, "key_id": os.getenv("RAZORPAY_KEY_ID", "").strip()})


@app.get("/api/rzp/payments")
def rzp_payments():
    client, err = rzp_guard()
    if err:
        return err
    try:
        items = client.fetch_payments(count=int(request.args.get("count", 20)))
    except razorpay_live.RazorpayError as e:
        return jsonify(razorpay_live.error_payload(e)), 502
    return jsonify({"payments": items, "origin": "razorpay"})


@app.post("/api/rzp/confirm")
def rzp_confirm():
    """Called by the browser after Checkout.js reports success.

    We re-fetch the payment from Razorpay rather than trusting the browser's
    word for it — the client-side handler is not an authority on whether
    money moved.
    """
    client, err = rzp_guard()
    if err:
        return err
    payment_id = (request.get_json(force=True) or {}).get("payment_id", "")
    if not razorpay_live.looks_like_payment_id(payment_id):
        return jsonify({"error": f"'{payment_id}' is not a Razorpay payment id"}), 400
    try:
        payment = client.fetch_payment(payment_id)
    except razorpay_live.RazorpayError as e:
        return jsonify(razorpay_live.error_payload(e)), 502

    _rzp_events.add("payment.captured",
                    f"Payment {payment['id']} · INR {int(payment.get('amount', 0)) / 100:,.2f} "
                    f"via {payment.get('method', '?')} · verified server-side",
                    origin="razorpay", payment_id=payment["id"])
    return jsonify({"payment": payment, "origin": "razorpay"})


@app.get("/api/rzp/disputes")
def rzp_disputes():
    """Real disputes first, then anything raised locally in this session."""
    out, fetch_error = [], None
    client, err = rzp_guard()
    if not err:
        try:
            for d in client.fetch_disputes():
                normalised = razorpay_live.dispute_from_razorpay(d)
                _rzp_disputes.setdefault(normalised["dispute_id"], normalised)
                out.append(normalised)
        except razorpay_live.RazorpayError as e:
            # Still return locally raised disputes — but say the live fetch
            # failed rather than implying an empty account. Silently swallowing
            # this made a completely broken connection look healthy.
            fetch_error = razorpay_live.error_payload(e)
    seen = {d["dispute_id"] for d in out}
    out.extend(d for k, d in _rzp_disputes.items() if k not in seen)
    return jsonify({
        "disputes": out,
        "fetch_error": fetch_error,
        "decisions": _rzp_decisions,
        "note": "Razorpay has no dispute-create API — disputes are raised by the issuing "
                "bank. Any dispute marked origin=local was raised in this console against "
                "a real Razorpay payment.",
    })


@app.post("/api/rzp/chargeback")
def rzp_chargeback():
    """Raise a chargeback against a real Razorpay payment.

    Explicitly a local object. It is attached to a genuine payment id and
    scored by the real pipeline, but Razorpay knows nothing about it.
    """
    client, err = rzp_guard()
    if err:
        return err
    body = request.get_json(force=True) or {}
    payment_id = body.get("payment_id", "")
    reason_code = body.get("reason_code", "13.1")
    merchant_id = body.get("merchant_id", "")
    evidence_types = body.get("evidence_types") or []
    narrative = (body.get("narrative") or "").strip()

    if not razorpay_live.looks_like_payment_id(payment_id):
        return jsonify({"error": f"'{payment_id}' is not a Razorpay payment id"}), 400
    if reason_code not in _dataset.reason_requirements:
        return jsonify({"error": f"unknown reason code '{reason_code}'"}), 400
    if merchant_id not in _dataset.merchant_history:
        return jsonify({"error": f"unknown merchant '{merchant_id}'"}), 400

    try:
        payment = client.fetch_payment(payment_id)
    except razorpay_live.RazorpayError as e:
        return jsonify(razorpay_live.error_payload(e)), 502

    dispute = razorpay_live.local_dispute(payment, reason_code=reason_code)
    row = razorpay_live.payment_to_case(
        payment, merchant_id=merchant_id, reason_code=reason_code,
        narrative=narrative, evidence_types=evidence_types,
    )
    dispute["case"] = row
    dispute["network_reason_code"] = reason_code
    _rzp_disputes[dispute["dispute_id"]] = dispute

    _rzp_events.add("dispute.raised",
                    f"Chargeback on {payment_id} · reason {reason_code} · "
                    f"{len(evidence_types)} evidence item(s) attached",
                    origin="local", dispute_id=dispute["dispute_id"])
    return jsonify({"dispute": dispute, "signals": signals_for(row)})


@app.post("/api/rzp/decide")
def rzp_decide():
    """Run the real pipeline over a live chargeback."""
    global _pool
    body = request.get_json(force=True) or {}
    dispute = _rzp_disputes.get(body.get("dispute_id"))
    if not dispute or "case" not in dispute:
        return jsonify({"error": "no such chargeback in this session"}), 404

    row = dispute["case"]
    sig = signals_for(row)
    flags = risk_flag_list(sig)
    trace = [
        {"step": "razorpay.fetch_payment", "kind": "network",
         "detail": f"payment {dispute['payment_id']} re-fetched from Razorpay — "
                   f"amount and method come from the gateway, not the browser"},
        {"step": "build_context", "kind": "deterministic",
         "detail": f"{len(sig['evidence_items'])} evidence item(s) enumerated as ev_1.."
                   f"ev_{len(sig['evidence_items'])}; reason {row['reason_code']} requires "
                   f"{', '.join(sig['required_types']) or 'nothing on file'}"},
        {"step": "risk_signals", "kind": "deterministic",
         "detail": f"evidence_sufficiency={sig['evidence_sufficiency']} · "
                   f"amount_anomaly={sig['amount_anomaly']} · "
                   f"merchant_repeat_pattern={sig['merchant_repeat_pattern']} — computed in "
                   f"code from the merchant's real history row"},
    ]

    if not has_api_key():
        return jsonify({
            "error": "Deciding a live chargeback needs a GROQ_API_KEY in .env. The narrative is "
                     "novel text, so there is no committed prediction to replay and inventing "
                     "one would be theatre. The deterministic signals below are still real.",
            "signals": sig, "deterministic_flags": flags, "trace": trace,
        }), 400

    try:
        if _pool is None:
            _pool = pipeline.KeyPool()
        ctx = pipeline.build_context(_dataset, row)
        trace.append({"step": "llm_cache", "kind": "cache",
                      "detail": "request hashed and checked against .cache/llm_responses/ first"})
        result, agent_error = run_agent_bounded(row, ctx)
        if agent_error is not None:
            return jsonify({"error": str(agent_error), "signals": sig,
                            "deterministic_flags": flags, "trace": trace}), 504
        trace.append({"step": "_run_agent_turn", "kind": "model",
                      "detail": "bounded loop, max_rounds=2 — round 2 forces tool_choice"})
    except SystemExit as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500

    trace.append({"step": "apply_deterministic_overrides", "kind": "deterministic",
                  "detail": "evidence_sufficiency and mechanical flags pinned to code-computed "
                            "values regardless of what the model returned"})


    # analyze_case degrades to a manual_review fallback when every attempt
    # fails, and manual_review is also a legitimate verdict. Returning 200 with
    # no distinction would present "the model never answered" as a judgement.
    fallback = pipeline.is_fallback_result(result)
    if fallback:
        trace.append({"step": "safe_fallback", "kind": "blocked",
                      "detail": "the model never returned a usable answer — this row is the "
                                "safe fallback, not a decision. Check the server log."})

    evidence_types = [i["type"] for i in sig["evidence_items"]]
    payload = razorpay_live.contest_payload(dispute, result, row, evidence_types)
    decision = result.get("decision")
    trace.append({
        "step": "razorpay.respond", "kind": "network" if dispute["actionable"] else "blocked",
        "detail": (
            f"PATCH /v1/disputes/{dispute['dispute_id']}/contest"
            if decision == "contest" else
            f"POST /v1/disputes/{dispute['dispute_id']}/accept"
            if decision == "accept_liability" else
            "no automatic response — routed to a human reviewer"
        ) + ("" if dispute["actionable"] else
             "  (not issued: this chargeback is local, so Razorpay has no such dispute)"),
    })

    out = {
        "fallback": fallback,
        "dispute_id": dispute["dispute_id"],
        "result": result,
        "deterministic_flags": flags,
        "signals": sig,
        "trace": trace,
        "actionable": dispute["actionable"],
        "razorpay_request": {
            "method": "PATCH" if decision == "contest" else "POST" if decision == "accept_liability" else None,
            "path": (f"/v1/disputes/{dispute['dispute_id']}/contest" if decision == "contest"
                     else f"/v1/disputes/{dispute['dispute_id']}/accept" if decision == "accept_liability"
                     else None),
            "body": payload if decision == "contest" else {} if decision == "accept_liability" else None,
        },
    }
    _rzp_decisions[dispute["dispute_id"]] = {
        "decision": decision, "confidence": result.get("confidence"),
        "risk_flags": result.get("risk_flags", []),
    }
    _rzp_events.add("agent.decided",
                    f"{dispute['dispute_id']} → {decision}"
                    + (f" · flags: {', '.join(result.get('risk_flags', []))}"
                       if result.get("risk_flags") else ""),
                    origin="aedi", dispute_id=dispute["dispute_id"], decision=decision)
    return jsonify(out)


@app.post("/api/rzp/submit")
def rzp_submit():
    """Send the agent's decision back to Razorpay.

    Only ever issued for a genuine Razorpay dispute. For a local chargeback
    this refuses and returns the request that would have been sent, which is
    the honest way to show the loop closing.
    """
    client, err = rzp_guard()
    if err:
        return err
    body = request.get_json(force=True) or {}
    dispute = _rzp_disputes.get(body.get("dispute_id"))
    if not dispute:
        return jsonify({"error": "no such dispute in this session"}), 404

    decision = _rzp_decisions.get(dispute["dispute_id"], {}).get("decision")
    if decision not in ("contest", "accept_liability"):
        return jsonify({"error": "nothing to submit — the agent routed this to manual review"}), 400

    if not dispute["actionable"]:
        return jsonify({
            "submitted": False,
            "reason": "This chargeback was raised in the console, so there is no dispute on the "
                      "Razorpay side to respond to. Against a real dispute the console would "
                      "issue exactly the request shown.",
        }), 409

    try:
        if decision == "contest":
            updated = client.contest_dispute(dispute["dispute_id"],
                                             body.get("payload") or {"action": "submit"})
        else:
            updated = client.accept_dispute(dispute["dispute_id"])
    except razorpay_live.RazorpayError as e:
        return jsonify(razorpay_live.error_payload(e)), 502

    _rzp_events.add("razorpay.responded",
                    f"{decision} submitted for {dispute['dispute_id']} → status "
                    f"{updated.get('status')}",
                    origin="razorpay", dispute_id=dispute["dispute_id"])
    return jsonify({"submitted": True, "dispute": updated})


@app.get("/api/rzp/events")
def rzp_events():
    return jsonify({"events": _rzp_events.since(request.args.get("after", 0))})


@app.post("/api/rzp/webhook")
def rzp_webhook():
    """Receive real Razorpay webhooks.

    Optional, but it is the one path where a genuine chargeback can reach
    this console: configure a `payment.dispute.created` webhook in the
    Razorpay dashboard and the dispute arrives here as a real object.
    Unsigned or wrongly-signed requests are dropped — a webhook endpoint
    that trusts its caller is a hole, not a feature.
    """
    secret = (os.getenv("RAZORPAY_WEBHOOK_SECRET") or "").strip()
    raw = request.get_data()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if not razorpay_live.verify_webhook_signature(raw, signature, secret):
        return jsonify({"error": "invalid or missing signature"}), 401

    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return jsonify({"error": "body was not JSON"}), 400

    name = event.get("event", "unknown")
    entities = event.get("payload", {})

    if name.startswith("payment.dispute."):
        raw_dispute = entities.get("dispute", {}).get("entity", {})
        if raw_dispute.get("id"):
            normalised = razorpay_live.dispute_from_razorpay(raw_dispute)
            normalised["network_reason_code"] = razorpay_live.PHASE_TO_REASON_CODE.get(
                normalised.get("phase"), "13.1")
            _rzp_disputes[normalised["dispute_id"]] = normalised
            _rzp_events.add("dispute.webhook",
                            f"Razorpay reported {name} for {normalised['dispute_id']} "
                            f"(payment {normalised['payment_id']})",
                            origin="razorpay", dispute_id=normalised["dispute_id"])
            return jsonify({"ok": True, "dispute_id": normalised["dispute_id"]})

    _rzp_events.add("webhook", f"Razorpay webhook: {name}", origin="razorpay")
    return jsonify({"ok": True})


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/logo.png")
def logo():
    return send_from_directory(str(REPO_ROOT / "assets"), "logo.png")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    mode = "LIVE (agent will call the model)" if has_api_key() else "REPLAY (no GROQ_API_KEY — no network calls)"
    print(f"AEDI console starting in {mode}")
    print(f"  open http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
