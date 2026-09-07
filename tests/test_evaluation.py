
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "chargeback_eval_main", Path(__file__).parent.parent / "code" / "evaluation" / "main.py"
)
_eval_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_eval_main)

confusion_matrix = _eval_main.confusion_matrix
precision_recall = _eval_main.precision_recall
coverage = _eval_main.coverage
expected_cost = _eval_main.expected_cost
COST_FALSE_POSITIVE_INR = _eval_main.COST_FALSE_POSITIVE_INR
COST_MANUAL_REVIEW_INR = _eval_main.COST_MANUAL_REVIEW_INR


def test_confusion_matrix_counts_correctly():
    predictions = {"c1": "contest", "c2": "accept_liability", "c3": "contest"}
    labels = {"c1": "contest", "c2": "accept_liability", "c3": "accept_liability"}
    matrix = confusion_matrix(predictions, labels)
    assert matrix["contest"]["contest"] == 1
    assert matrix["accept_liability"]["accept_liability"] == 1
    assert matrix["accept_liability"]["contest"] == 1


def test_confusion_matrix_skips_unpredicted_cases():
    predictions = {"c1": "contest"}
    labels = {"c1": "contest", "c2": "accept_liability"}
    matrix = confusion_matrix(predictions, labels)
    total = sum(matrix[a][p] for a in matrix for p in matrix[a])
    assert total == 1


def test_precision_recall_perfect_classifier():
    predictions = {"c1": "contest", "c2": "accept_liability"}
    labels = {"c1": "contest", "c2": "accept_liability"}
    matrix = confusion_matrix(predictions, labels)
    p, r = precision_recall(matrix, "contest")
    assert p == 1.0
    assert r == 1.0


def test_precision_recall_with_false_positive():
    predictions = {"c1": "contest", "c2": "contest"}
    labels = {"c1": "contest", "c2": "accept_liability"}
    matrix = confusion_matrix(predictions, labels)
    p, r = precision_recall(matrix, "contest")
    assert p == 0.5
    assert r == 1.0


def test_precision_recall_none_when_no_data():
    predictions = {"c1": "accept_liability"}
    labels = {"c1": "accept_liability"}
    matrix = confusion_matrix(predictions, labels)
    p, r = precision_recall(matrix, "contest")
    assert p is None
    assert r is None


def test_coverage_excludes_manual_review():
    predictions = {"c1": "contest", "c2": "manual_review", "c3": "accept_liability", "c4": "manual_review"}
    assert coverage(predictions) == 0.5


def test_coverage_empty_is_zero():
    assert coverage({}) == 0.0


def test_expected_cost_false_positive_uses_flat_rate():
    predictions = {"c1": "contest"}
    labels = {"c1": "accept_liability"}
    result = expected_cost(predictions, labels, amounts={"c1": "9999"})
    assert result["n_false_positive"] == 1
    assert result["total_cost_inr"] == COST_FALSE_POSITIVE_INR


def test_expected_cost_false_negative_uses_transaction_amount():
    predictions = {"c1": "accept_liability"}
    labels = {"c1": "contest"}
    result = expected_cost(predictions, labels, amounts={"c1": "5000"})
    assert result["n_false_negative"] == 1
    assert result["total_cost_inr"] == 5000.0


def test_expected_cost_manual_review_is_flat_regardless_of_correctness():
    predictions = {"c1": "manual_review", "c2": "manual_review"}
    labels = {"c1": "contest", "c2": "manual_review"}
    result = expected_cost(predictions, labels, amounts={"c1": "100000", "c2": "1"})
    assert result["n_manual_review"] == 2
    assert result["total_cost_inr"] == 2 * COST_MANUAL_REVIEW_INR


def test_expected_cost_flags_bypassed_review_without_pricing_it():
    predictions = {"c1": "contest"}
    labels = {"c1": "manual_review"}
    result = expected_cost(predictions, labels, amounts={"c1": "5000"})
    assert result["n_bypassed_review"] == 1
    assert result["n_false_positive"] == 0
    assert result["n_false_negative"] == 0
    assert result["total_cost_inr"] == 0


def test_bypassed_review_bonus_exposure_kept_out_of_primary_cost():
    predictions = {"c1": "contest"}
    labels = {"c1": "manual_review"}
    result = expected_cost(predictions, labels, amounts={"c1": "10000"})
    assert result["bypassed_review_exposure_inr"] == 10000 * _eval_main.BYPASSED_REVIEW_EXPOSURE_RATE
    assert result["total_cost_inr"] == 0
    assert result["cost_per_100_inr"] == 0


def test_bypassed_review_bonus_exposure_zero_when_none_bypassed():
    predictions = {"c1": "manual_review"}
    labels = {"c1": "manual_review"}
    result = expected_cost(predictions, labels, amounts={"c1": "10000"})
    assert result["n_bypassed_review"] == 0
    assert result["bypassed_review_exposure_inr"] == 0
