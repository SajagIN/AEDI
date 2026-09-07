
import argparse
import csv
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "code"))
import risk_signals  # noqa: E402

COST_FALSE_POSITIVE_INR = 800


COST_MANUAL_REVIEW_INR = 150

BYPASSED_REVIEW_EXPOSURE_RATE = 0.10

DECISION_VALUES = ["contest", "accept_liability", "manual_review"]
POSITIVE_CLASSES = ["contest", "accept_liability"]


def load_csv(path: Path) -> list:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def confusion_matrix(predictions: dict, labels: dict) -> dict:
    matrix = {a: {p: 0 for p in DECISION_VALUES} for a in DECISION_VALUES}
    for case_id, actual in labels.items():
        predicted = predictions.get(case_id)
        if predicted is None:
            continue
        matrix[actual][predicted] += 1
    return matrix


def precision_recall(matrix: dict, positive_class: str) -> tuple:
    tp = matrix[positive_class][positive_class]
    fp = sum(matrix[a][positive_class] for a in DECISION_VALUES if a != positive_class)
    fn = sum(matrix[positive_class][p] for p in DECISION_VALUES if p != positive_class)
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    return precision, recall


def coverage(predictions: dict) -> float:
    if not predictions:
        return 0.0
    decided = sum(1 for d in predictions.values() if d != "manual_review")
    return decided / len(predictions)


def expected_cost(predictions: dict, labels: dict, amounts: dict) -> dict:
    total_cost = 0.0
    n_fp = n_fn = n_review = n_scored = 0
    for case_id, actual in labels.items():
        predicted = predictions.get(case_id)
        if predicted is None:
            continue
        n_scored += 1
        if predicted == "contest" and actual == "accept_liability":
            total_cost += COST_FALSE_POSITIVE_INR
            n_fp += 1
        elif predicted == "accept_liability" and actual == "contest":
            total_cost += float(amounts.get(case_id, 0))
            n_fn += 1
        elif predicted == "manual_review":
            total_cost += COST_MANUAL_REVIEW_INR
            n_review += 1
    per_100 = (total_cost / n_scored * 100) if n_scored else 0.0

    bypassed_ids = [
        case_id for case_id, actual in labels.items()
        if actual == "manual_review" and predictions.get(case_id) in ("contest", "accept_liability")
    ]
    bypassed_review_exposure_inr = sum(
        float(amounts.get(case_id, 0)) * BYPASSED_REVIEW_EXPOSURE_RATE for case_id in bypassed_ids
    )
    return {
        "n_scored": n_scored, "total_cost_inr": total_cost, "cost_per_100_inr": per_100,
        "n_false_positive": n_fp, "n_false_negative": n_fn, "n_manual_review": n_review,
        "n_bypassed_review": len(bypassed_ids),
        "bypassed_review_exposure_inr": bypassed_review_exposure_inr,
        "bypassed_review_exposure_per_100_inr": (bypassed_review_exposure_inr / n_scored * 100) if n_scored else 0.0,
    }


def baseline_predictions(cases: list, ds_requirements: dict) -> dict:
    preds = {}
    for row in cases:
        req = ds_requirements.get(row["reason_code"], {})
        required_types = risk_signals.required_evidence_types(req)
        evidence_items = risk_signals.parse_evidence_items(row)
        sufficiency, _ = risk_signals.evidence_sufficiency(evidence_items, required_types)
        preds[row["case_id"]] = "contest" if sufficiency == "sufficient" else "accept_liability"
    return preds


def always_manual_review_predictions(cases: list) -> dict:
    return {row["case_id"]: "manual_review" for row in cases}


def report(name: str, predictions: dict, labels: dict, amounts: dict) -> None:
    matrix = confusion_matrix(predictions, labels)
    n = sum(matrix[a][p] for a in DECISION_VALUES for p in DECISION_VALUES)
    print(f"\n=== {name} (n={n} scored) ===")
    if n == 0:
        print("  No predictions available to score yet.")
        return
    print("  Confusion matrix (rows=actual, cols=predicted):")
    col_w = max(len(p) for p in DECISION_VALUES) + 4
    header = " " * 20 + "".join(f"{p:>{col_w}}" for p in DECISION_VALUES)
    print(header)
    for a in DECISION_VALUES:
        print(f"  {a:<18}" + "".join(f"{matrix[a][p]:>{col_w}}" for p in DECISION_VALUES))

    for cls in POSITIVE_CLASSES:
        p, r = precision_recall(matrix, cls)
        p_str = f"{p:.0%}" if p is not None else "n/a (no predictions of this class)"
        r_str = f"{r:.0%}" if r is not None else "n/a (no actual cases of this class)"
        print(f"  {cls}: precision={p_str}, recall={r_str}")

    cov = coverage(predictions)
    print(f"  coverage (share not routed to manual_review): {cov:.0%}")

    cost = expected_cost(predictions, labels, amounts)
    print(f"  expected cost: INR {cost['cost_per_100_inr']:.0f} per 100 cases "
          f"(FP={cost['n_false_positive']} x INR{COST_FALSE_POSITIVE_INR}, "
          f"FN={cost['n_false_negative']} x transaction amount, "
          f"manual_review={cost['n_manual_review']} x INR{COST_MANUAL_REVIEW_INR})")
    if cost["n_bypassed_review"]:
        print(f"  WARNING: {cost['n_bypassed_review']} case(s) had actual=manual_review but were "
              f"auto-decided anyway - not priced in the primary cost above (which prices only "
              f"the contest/accept_liability error directions).")
        print(f"  BONUS (not part of the primary cost model, exploratory only): modeling that "
              f"exposure at {BYPASSED_REVIEW_EXPOSURE_RATE:.0%} of transaction amount gives "
              f"INR {cost['bypassed_review_exposure_per_100_inr']:.0f} per 100 cases in unpriced risk "
              f"- reported separately so it's never confused with the primary cost number.")
    if n < 30:
        print(f"  NOTE: small sample (n={n}) - treat these rates as directional, not final.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--split", choices=["dev", "held_out"], required=True,
        help="Which split to evaluate against. No default on purpose.",
    )
    parser.add_argument("--dataset-dir", default="dataset")
    parser.add_argument("--predictions", default=None, help="Path to the pipeline's output CSV")
    parser.add_argument(
        "--i-am-opening-held-out-for-real", action="store_true",
        help="Required to run --split held_out. Forces a deliberate choice, not a "
             "flag flipped absent-mindedly on data that's supposed to be opened once.",
    )
    args = parser.parse_args()

    dataset_dir = REPO_ROOT / args.dataset_dir
    marker_path = dataset_dir / "held_out" / ".opened_at_commit"

    if args.split == "held_out":
        if not args.i_am_opening_held_out_for_real:
            print(
                "Refusing to run: pass --i-am-opening-held-out-for-real to confirm this "
                "is the genuine, one-time open - not something to pass casually."
            )
            raise SystemExit(1)
        if marker_path.exists():
            print(f"NOTE: held_out was already opened once - see {marker_path}")
            print(marker_path.read_text(encoding="utf-8"))
            print("Re-running is for display purposes only; held-out discipline is "
                  "about not TUNING after seeing this, not about a technical rerun block.")

    split_dir = dataset_dir / args.split
    cases = load_csv(split_dir / "cases.csv")
    labels_rows = load_csv(split_dir / "labels.csv")
    labels = {r["case_id"]: r["ground_truth_decision"] for r in labels_rows}
    amounts = {r["case_id"]: r["amount"] for r in cases}
    req_rows = load_csv(dataset_dir / "reason_code_requirements.csv")
    ds_requirements = {r["reason_code"]: r for r in req_rows}

    if args.predictions:
        pred_rows = load_csv(REPO_ROOT / args.predictions)
        predictions = {r["case_id"]: r["decision"] for r in pred_rows}
        report(f"Agent ({args.split})", predictions, labels, amounts)
    else:
        print(f"No --predictions given - run code/main.py against {args.split}/cases.csv first, "
              "or pass --predictions explicitly. Showing baselines only.")

    report("Baseline: rules-only", baseline_predictions(cases, ds_requirements), labels, amounts)
    report("Baseline: always manual_review", always_manual_review_predictions(cases), labels, amounts)

    if args.split == "held_out" and not marker_path.exists():
        import datetime
        import subprocess
        try:
            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
            ).stdout.strip()
        except Exception:
            commit = "unknown"
        marker_path.write_text(
            f"held_out opened for the first time at {datetime.datetime.now().isoformat()}\n"
            f"git commit at open time: {commit}\n"
            f"This file is proof of when held_out was first opened - committing it to the "
            f"repo makes the open time verifiable in git log, not just claimed in prose.\n",
            encoding="utf-8",
        )
        print(f"\nWrote {marker_path} - commit this file to make the open time verifiable.")


if __name__ == "__main__":
    main()
