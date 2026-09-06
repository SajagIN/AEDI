"""
Evaluation harness — structure only for now.

MANDATORY operational rule: the held-out file is opened exactly
once, after code freeze. Every number produced before then is a
dev-set number. This module enforces that split at the file level — it
takes a `--split` flag and refuses to let held-out be the default, so
running this script with no arguments can never accidentally touch it.

Planned outputs once wired up:
- Confusion matrix over {contest, accept_liability, manual_review}.
- Precision/recall for `contest` and for `accept_liability` specifically —
  NOT overall accuracy. `manual_review` is an abstention, not a class.
- Coverage: share of cases decided automatically (not manual_review) vs
  routed to review. Reported next to precision/recall so a system that
  abstains on everything can't look artificially good.
- Expected cost per 100 cases, from the false-positive/false-negative cost
  model — rupee cost per error direction, stated as an
  assumption in the README, not just an error rate.
- Baseline comparison: rules-only and always-manual-review, same held-out
  set.
"""

import argparse
import csv
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent


def load_labeled(path: Path) -> list:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--split", choices=["dev", "held_out"], required=True,
        help="Which split to evaluate against. No default on purpose — "
             "held_out must be named explicitly, never reached by accident.",
    )
    parser.add_argument("--dataset-dir", default="dataset")
    args = parser.parse_args()

    if args.split == "held_out":
        print(
            "Refusing to run: held-out evaluation is not wired up yet, and "
            "it must only be opened once, after code "
            "freeze. This guard stays until that's genuinely true."
        )
        raise SystemExit(1)

    print("Dev-set evaluation not yet implemented.")


if __name__ == "__main__":
    main()
