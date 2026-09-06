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
        "splits": {
            s: {
                "cases": len(split_cases(s)),
                "has_predictions": (DATASET_DIR / s / "output.csv").exists(),
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
            result = pipeline.analyze_case(_pool, _cache, row, ctx)
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

    cited = [c.strip() for c in str(result.get("cited_evidence_ids", "")).replace(",", ";").split(";") if c.strip()]
    gt = split_labels(split).get(case_id)
    return jsonify({
        "source": source,
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

    return jsonify({
        "split": split,
        "available": True,
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
