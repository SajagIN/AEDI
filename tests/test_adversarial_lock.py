
import importlib.util
import sys
from pathlib import Path

_ADVERSARIAL_DIR = Path(__file__).parent / "adversarial_regression"
sys.path.insert(0, str(_ADVERSARIAL_DIR))

_spec = importlib.util.spec_from_file_location("adversarial_run_suite", _ADVERSARIAL_DIR / "run_suite.py")
_run_suite = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_run_suite)


def test_lock_blocks_a_second_acquire():
    _run_suite.release_lock()
    _run_suite.acquire_lock()
    try:
        try:
            _run_suite.acquire_lock()
            assert False, "acquiring an already-held lock should have raised"
        except _run_suite.AlreadyRunningError:
            pass
    finally:
        _run_suite.release_lock()


def test_release_then_acquire_works():
    _run_suite.release_lock()
    _run_suite.acquire_lock()
    _run_suite.release_lock()
    _run_suite.acquire_lock()
    _run_suite.release_lock()


def test_release_is_safe_when_no_lock_held():
    _run_suite.release_lock()
    _run_suite.release_lock()
