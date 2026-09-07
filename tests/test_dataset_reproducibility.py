
import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
DATASET_DIR = REPO_ROOT / "dataset"

GENERATED_FILES = [
    "merchant_history.csv",
    "reason_code_requirements.csv",
    "dev/cases.csv",
    "dev/labels.csv",
    "held_out/cases.csv",
    "held_out/labels.csv",
]


def _load_generator(dataset_dir: Path):
    sys.path.insert(0, str(REPO_ROOT / "code"))
    spec = importlib.util.spec_from_file_location(
        "generate_dataset_under_test", REPO_ROOT / "scripts" / "generate_dataset.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.DATASET_DIR = dataset_dir
    return mod


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def regenerated(tmp_path_factory):
    out = tmp_path_factory.mktemp("regen")
    _load_generator(out).main()
    return out


@pytest.mark.parametrize("rel", GENERATED_FILES)
def test_regenerated_file_is_byte_identical_to_committed(regenerated, rel):
    committed, fresh = DATASET_DIR / rel, regenerated / rel
    assert fresh.exists(), f"generator did not produce {rel}"
    assert _digest(fresh) == _digest(committed), (
        f"{rel} changed. If the generator was altered on purpose, the committed "
        f"dataset AND dataset/held_out/output.csv must be regenerated together — "
        f"otherwise every published metric refers to data that no longer exists."
    )


@pytest.mark.parametrize("rel", GENERATED_FILES)
def test_generated_files_use_lf_endings(regenerated, rel):
    assert b"\r" not in (regenerated / rel).read_bytes(), (
        f"{rel} was written with CRLF; .gitattributes pins the repo to eol=lf, so "
        f"this would differ from the committed copy on every regeneration."
    )


def test_generator_is_stable_across_two_runs(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    _load_generator(a).main()
    _load_generator(b).main()
    for rel in GENERATED_FILES:
        assert _digest(a / rel) == _digest(b / rel), f"{rel} differs between two runs"
