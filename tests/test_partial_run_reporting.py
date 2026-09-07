
import csv
import sys
import json
import shutil
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def server_module():
    spec = importlib.util.spec_from_file_location(
        "aedi_server_partial", REPO_ROOT / "app" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["aedi_server_partial"] = mod
    spec.loader.exec_module(mod)
    mod.app.config["TESTING"] = True
    return mod


@pytest.fixture
def dev_output():
    path = REPO_ROOT / "dataset" / "dev" / "output.csv"
    backup = path.with_suffix(".csv.testbak")
    existed = path.exists()
    if existed:
        shutil.copy2(path, backup)

    def write(n_rows):
        source = REPO_ROOT / "dataset" / "held_out" / "output.csv"
        with open(source, newline="", encoding="utf-8") as f:
            template = list(csv.DictReader(f))[0]
        with open(REPO_ROOT / "dataset" / "dev" / "cases.csv", newline="", encoding="utf-8") as f:
            dev_ids = [r["case_id"] for r in csv.DictReader(f)]
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(template), lineterminator="\n")
            w.writeheader()
            for cid in dev_ids[:n_rows]:
                w.writerow(dict(template, case_id=cid))
        return len(dev_ids)

    yield write

    if existed:
        shutil.move(backup, path)
    elif path.exists():
        path.unlink()


def _json(resp):
    return json.loads(resp.data.decode("utf-8"))


def test_health_distinguishes_a_stub_from_a_finished_run(server_module, dev_output):
    total = dev_output(1)
    body = _json(server_module.app.test_client().get("/api/health"))

    dev = body["splits"]["dev"]
    assert dev["has_predictions"] is True, "the file does exist"
    assert dev["scored"] == 1
    assert dev["complete"] is False, "one row out of a hundred is not a complete run"
    assert dev["cases"] == total


def test_health_marks_a_finished_run_complete(server_module, dev_output):
    total = dev_output(10_000)
    dev = _json(server_module.app.test_client().get("/api/health"))["splits"]["dev"]
    assert dev["scored"] == total
    assert dev["complete"] is True


def test_held_out_is_reported_complete_as_shipped(server_module):
    held = _json(server_module.app.test_client().get("/api/health"))["splits"]["held_out"]
    assert held["complete"] is True, "the committed held_out run must stay complete"
    assert held["scored"] == held["cases"] == 50


def test_the_complete_split_outranks_a_stub(server_module, dev_output):
    dev_output(1)
    splits = _json(server_module.app.test_client().get("/api/health"))["splits"]

    ranked = sorted(
        [(name, v) for name, v in splits.items() if v["scored"] > 0],
        key=lambda kv: (kv[1]["complete"], kv[1]["scored"]),
        reverse=True,
    )
    assert ranked[0][0] == "held_out"


def test_a_naive_first_with_predictions_would_have_picked_the_stub(server_module, dev_output):
    dev_output(1)
    splits = _json(server_module.app.test_client().get("/api/health"))["splits"]
    naive = next(name for name, v in splits.items() if v["has_predictions"])
    assert naive == "dev", "if this stops being true the regression test is toothless"


def test_metrics_reports_the_run_as_incomplete(server_module, dev_output):
    total = dev_output(1)
    body = _json(server_module.app.test_client().get("/api/metrics?split=dev"))
    assert body["available"] is True
    assert body["n_scored"] == 1
    assert body["n_cases"] == total
    assert body["complete"] is False


def test_metrics_on_a_partial_run_scores_baselines_on_the_whole_split(
        server_module, dev_output):
    dev_output(1)
    blocks = _json(server_module.app.test_client().get("/api/metrics?split=dev"))["blocks"]
    agent, rules, allrev = blocks
    assert agent["n"] == 1
    assert rules["n"] > 1 and allrev["n"] > 1
    assert agent["n"] != rules["n"]


def test_metrics_marks_a_finished_run_complete(server_module, dev_output):
    dev_output(10_000)
    body = _json(server_module.app.test_client().get("/api/metrics?split=dev"))
    assert body["complete"] is True
    assert body["n_scored"] == body["n_cases"]


def test_held_out_metrics_stay_complete_and_projectable(server_module):
    body = _json(server_module.app.test_client().get("/api/metrics?split=held_out"))
    assert body["complete"] is True
    assert body["n_scored"] == 50
    agent = body["blocks"][0]
    assert agent["n"] == 50, "the shipped headline numbers must not silently shrink"
    assert agent["coverage"] > 0


def test_missing_output_is_still_reported_as_unavailable(server_module, dev_output):
    path = REPO_ROOT / "dataset" / "dev" / "output.csv"
    dev_output(1)
    path.unlink()
    body = _json(server_module.app.test_client().get("/api/metrics?split=dev"))
    assert body["available"] is False
    assert "output.csv" in body["message"]
