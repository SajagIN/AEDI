
import sys
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fake_razorpay import FakeRazorpay, TEST_KEY_ID, TEST_KEY_SECRET  # noqa: E402


def _load_module():
    path = REPO_ROOT / "app" / "razorpay_live.py"
    spec = importlib.util.spec_from_file_location("aedi_razorpay_live", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["aedi_razorpay_live"] = mod
    spec.loader.exec_module(mod)
    return mod


rzp = _load_module()


@pytest.fixture
def server():
    with FakeRazorpay() as s:
        yield s


@pytest.fixture
def client(server):
    return rzp.RazorpayClient(TEST_KEY_ID, TEST_KEY_SECRET, api_base=server.base_url)


def test_live_key_is_refused_outright():
    with pytest.raises(rzp.LiveKeyRefused) as exc:
        rzp.RazorpayClient("rzp_live_RealKey123456", "some_secret")  # pragma: allowlist-fake
    assert "rzp_test_" in str(exc.value)


def test_live_key_refusal_is_a_razorpay_error_subclass():
    assert issubclass(rzp.LiveKeyRefused, rzp.RazorpayError)


def test_missing_credentials_are_refused():
    with pytest.raises(rzp.RazorpayError):
        rzp.RazorpayClient("", "")
    with pytest.raises(rzp.RazorpayError):
        rzp.RazorpayClient("rzp_test_abc", "")


def test_mask_key_never_returns_the_whole_credential():
    masked = rzp.mask_key("rzp_test_AbCdEfGhIjKlMn")  # pragma: allowlist-fake
    assert masked == "rzp_test_…KlMn"
    assert "AbCdEfGhIj" not in masked


def test_mask_key_handles_short_and_empty_values():
    assert rzp.mask_key("") is None
    assert rzp.mask_key(None) is None
    assert rzp.mask_key("rzp_test_").endswith("…")


def test_read_config_classifies_each_state():
    assert rzp.read_config({})["state"] == "unconfigured"
    assert rzp.read_config({"RAZORPAY_KEY_ID": "rzp_test_x"})["state"] == "incomplete"
    assert rzp.read_config({
        "RAZORPAY_KEY_ID": "rzp_live_x", "RAZORPAY_KEY_SECRET": "s"
    })["state"] == "refused"
    assert rzp.read_config({
        "RAZORPAY_KEY_ID": "sk_test_stripe", "RAZORPAY_KEY_SECRET": "s"
    })["state"] == "unknown_key"
    assert rzp.read_config({
        "RAZORPAY_KEY_ID": "rzp_test_x", "RAZORPAY_KEY_SECRET": "s"
    })["state"] == "configured"


def test_read_config_does_not_leak_the_secret():
    cfg = rzp.read_config({"RAZORPAY_KEY_ID": "rzp_test_AbCdEfGhIjKl",  # pragma: allowlist-fake
                           "RAZORPAY_KEY_SECRET": "super_secret_value"})
    assert "super_secret_value" not in repr(cfg)


def test_ping_succeeds_with_good_credentials(client):
    assert client.ping() is True


def test_bad_credentials_surface_razorpays_own_message(server):
    bad = rzp.RazorpayClient(TEST_KEY_ID, "wrong_secret", api_base=server.base_url)
    with pytest.raises(rzp.RazorpayError) as exc:
        bad.ping()
    assert exc.value.status == 401
    assert "incorrect key id or secret" in str(exc.value)


def test_unreachable_host_is_a_clean_error_not_a_traceback():
    client = rzp.RazorpayClient(TEST_KEY_ID, TEST_KEY_SECRET,
                                api_base="http://127.0.0.1:1")
    with pytest.raises(rzp.RazorpayError) as exc:
        client.ping()
    assert "could not reach Razorpay" in str(exc.value)


def test_create_order_returns_a_real_order_id(client):
    order = client.create_order(500000, receipt="aedi_demo")
    assert order["id"].startswith("order_")
    assert order["amount"] == 500000
    assert order["status"] == "created"


def test_create_order_rejection_is_reported_verbatim(client):
    with pytest.raises(rzp.RazorpayError) as exc:
        client.create_order(1)
    assert exc.value.status == 400
    assert "atleast INR 1.00" in str(exc.value)


def test_fetch_payment_round_trips(client, server):
    seeded = server.state.seed_payment(amount=250000, method="upi")
    fetched = client.fetch_payment(seeded["id"])
    assert fetched["id"] == seeded["id"]
    assert fetched["method"] == "upi"


def test_fetch_payments_lists_everything_seeded(client, server):
    server.state.seed_payment()
    server.state.seed_payment()
    assert len(client.fetch_payments()) == 2


def test_razorpay_has_no_dispute_create_endpoint(client):
    with pytest.raises(rzp.RazorpayError) as exc:
        client._call("POST", "/disputes", body={"payment_id": "pay_x"})
    assert exc.value.status == 404


def test_disputes_list_is_empty_on_a_fresh_test_account(client):
    assert client.fetch_disputes() == []


def test_a_real_dispute_is_marked_actionable(client, server):
    payment = server.state.seed_payment()
    server.state.seed_dispute(payment["id"])
    normalised = rzp.dispute_from_razorpay(client.fetch_disputes()[0])
    assert normalised["origin"] == "razorpay"
    assert normalised["actionable"] is True
    assert normalised["dispute_id"].startswith("disp_")


def test_a_local_dispute_is_never_actionable_and_is_labelled():
    payment = {"id": "pay_ABCDEFGHIJ1234", "amount": 500000, "currency": "INR"}
    d = rzp.local_dispute(payment, reason_code="13.1")
    assert d["origin"] == "local"
    assert d["actionable"] is False
    assert not d["dispute_id"].startswith("disp_")
    assert "no dispute-create endpoint" in d["reason_description"]


def test_contesting_a_real_dispute_moves_it_under_review(client, server):
    payment = server.state.seed_payment()
    dispute = server.state.seed_dispute(payment["id"])
    updated = client.contest_dispute(dispute["id"], {
        "amount": dispute["amount"], "summary": "evidence sufficient", "action": "submit",
    })
    assert updated["status"] == "under_review"
    assert updated["evidence"]["summary"] == "evidence sufficient"


def test_accepting_a_real_dispute_marks_it_lost_and_deducts(client, server):
    payment = server.state.seed_payment()
    dispute = server.state.seed_dispute(payment["id"])
    updated = client.accept_dispute(dispute["id"])
    assert updated["status"] == "lost"
    assert updated["amount_deducted"] == dispute["amount"]


def test_acting_twice_on_a_dispute_is_rejected(client, server):
    payment = server.state.seed_payment()
    dispute = server.state.seed_dispute(payment["id"])
    client.accept_dispute(dispute["id"])
    with pytest.raises(rzp.RazorpayError) as exc:
        client.accept_dispute(dispute["id"])
    assert "not allowed" in str(exc.value)


def test_paise_are_converted_to_rupees_as_a_two_decimal_string():
    assert rzp.paise_to_rupees(500000) == "5000.00"
    assert rzp.paise_to_rupees(1) == "0.01"
    assert rzp.paise_to_rupees(0) == "0.00"


def test_payment_to_case_matches_the_dataset_row_shape():
    import csv
    with open(REPO_ROOT / "dataset" / "dev" / "cases.csv", newline="", encoding="utf-8") as f:
        dataset_columns = set(next(csv.reader(f)))

    payment = {"id": "pay_ABCDEFGHIJ1234", "amount": 750000,
               "currency": "INR", "method": "card", "created_at": 1780000000}
    row = rzp.payment_to_case(payment, merchant_id="mch_015", reason_code="13.1",
                              narrative="Delivered on time.",
                              evidence_types=["proof_of_delivery", "shipping_carrier_record"])
    assert dataset_columns.issubset(set(row)), dataset_columns - set(row)


def test_payment_to_case_carries_the_real_payment_id_as_the_case_id():
    payment = {"id": "pay_ABCDEFGHIJ1234", "amount": 100000, "created_at": 1780000000}
    row = rzp.payment_to_case(payment, merchant_id="mch_001", reason_code="13.1")
    assert row["case_id"] == "pay_ABCDEFGHIJ1234"
    assert row["amount"] == "1000.00"


def test_payment_to_case_derives_the_date_from_the_payment_timestamp():
    payment = {"id": "pay_x", "amount": 100000, "created_at": 1780000000}
    row = rzp.payment_to_case(payment, merchant_id="mch_001", reason_code="13.1")
    assert row["transaction_date"] == "2026-05-28"


def test_evidence_rendering_round_trips_through_the_real_parser():
    sys.path.insert(0, str(REPO_ROOT / "code"))
    import risk_signals

    types = ["proof_of_delivery", "shipping_carrier_record"]
    row = {"evidence_items": rzp.format_evidence_items(types)}
    parsed = risk_signals.parse_evidence_items(row)
    assert [p["type"] for p in parsed] == types
    assert all(p["description"] for p in parsed)


def test_evidence_rendering_drops_unknown_types_rather_than_inventing_them():
    assert rzp.format_evidence_items(["not_a_real_type"]) == ""


def test_a_live_case_produces_the_expected_deterministic_signals():
    sys.path.insert(0, str(REPO_ROOT / "code"))
    import risk_signals

    payment = {"id": "pay_ABCDEFGHIJ1234", "amount": 500000,
               "currency": "INR", "method": "card", "created_at": 1780000000}
    row = rzp.payment_to_case(payment, merchant_id="mch_015", reason_code="13.1",
                              evidence_types=["proof_of_delivery", "shipping_carrier_record"])
    items = risk_signals.parse_evidence_items(row)
    sufficiency, missing = risk_signals.evidence_sufficiency(
        items, {"proof_of_delivery", "shipping_carrier_record"})
    assert sufficiency == "sufficient"
    assert missing == []


def test_missing_evidence_is_detected_on_a_live_case():
    sys.path.insert(0, str(REPO_ROOT / "code"))
    import risk_signals

    payment = {"id": "pay_x", "amount": 500000, "created_at": 1780000000}
    row = rzp.payment_to_case(payment, merchant_id="mch_015", reason_code="13.1",
                              evidence_types=["proof_of_delivery"])
    items = risk_signals.parse_evidence_items(row)
    sufficiency, missing = risk_signals.evidence_sufficiency(
        items, {"proof_of_delivery", "shipping_carrier_record"})
    assert sufficiency != "sufficient"
    assert "shipping_carrier_record" in missing


def test_every_catalog_evidence_type_is_one_the_dataset_actually_uses():
    import csv
    used = set()
    with open(REPO_ROOT / "dataset" / "reason_code_requirements.csv",
              newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            used.update(t.strip() for t in r["required_evidence_types"].split("|") if t.strip())
    assert used.issubset(set(rzp.EVIDENCE_CATALOG))


def test_every_reason_code_maps_from_some_razorpay_phase():
    import csv
    with open(REPO_ROOT / "dataset" / "reason_code_requirements.csv",
              newline="", encoding="utf-8") as f:
        known = {r["reason_code"] for r in csv.DictReader(f)}
    assert set(rzp.PHASE_TO_REASON_CODE.values()).issubset(known)


def test_contest_payload_carries_the_agents_reason_as_the_summary():
    dispute = {"dispute_id": "disp_x", "amount_paise": 500000}
    payload = rzp.contest_payload(dispute, {"reason": "Delivery proven by carrier scan."},
                                  {"case_id": "pay_x"}, ["proof_of_delivery"])
    assert payload["summary"] == "Delivery proven by carrier scan."
    assert payload["action"] == "submit"
    assert payload["amount"] == 500000


def test_contest_payload_truncates_to_razorpays_1000_char_summary_limit():
    dispute = {"dispute_id": "disp_x", "amount_paise": 1000}
    payload = rzp.contest_payload(dispute, {"reason": "x" * 5000}, {"case_id": "c"}, [])
    assert len(payload["summary"]) == 1000


def test_contest_payload_is_honest_about_document_uploads():
    payload = rzp.contest_payload({"amount_paise": 1000}, {"reason": "r"}, {"case_id": "c"}, [])
    assert "Documents API" in payload["_aedi_note"]


def test_webhook_signature_verification_accepts_a_correct_signature():
    import hmac, hashlib
    body = b'{"event":"payment.captured"}'
    secret = "whsec_test"
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert rzp.verify_webhook_signature(body, sig, secret) is True


def test_webhook_signature_verification_rejects_tampering():
    import hmac, hashlib
    secret = "whsec_test"
    sig = hmac.new(secret.encode(), b'{"event":"payment.captured"}', hashlib.sha256).hexdigest()
    assert rzp.verify_webhook_signature(b'{"event":"payment.failed"}', sig, secret) is False


def test_webhook_signature_verification_fails_closed_without_a_secret():
    assert rzp.verify_webhook_signature(b"{}", "abc", "") is False
    assert rzp.verify_webhook_signature(b"{}", "", "whsec") is False


def test_event_log_ids_increase_and_since_filters_on_them():
    log = rzp.EventLog()
    log.add("order", "one")
    second = log.add("payment", "two")
    assert [e["message"] for e in log.since(0)] == ["one", "two"]
    assert [e["message"] for e in log.since(second["id"])] == []


def test_event_log_is_bounded_so_a_long_demo_cannot_grow_memory():
    log = rzp.EventLog(maxlen=5)
    for i in range(50):
        log.add("tick", str(i))
    events = log.all()
    assert len(events) == 5
    assert events[-1]["message"] == "49"


def test_event_log_survives_concurrent_writers():
    import threading as t
    log = rzp.EventLog(maxlen=1000)

    def spam():
        for i in range(100):
            log.add("tick", str(i))

    threads = [t.Thread(target=spam) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    ids = [e["id"] for e in log.all()]
    assert len(ids) == 800
    assert len(set(ids)) == 800, "event ids must be unique under concurrency"


def test_payment_id_shape_is_validated():
    assert rzp.looks_like_payment_id("pay_ABCDEFGHIJ1234")
    assert not rzp.looks_like_payment_id("order_ABCDEFGHIJ1234")
    assert not rzp.looks_like_payment_id("pay_short")
    assert not rzp.looks_like_payment_id("")
    assert not rzp.looks_like_payment_id(None)


def _err(message, status=None, code=None):
    return rzp.RazorpayError(message, status=status, code=code)


def test_tls_failure_is_named_as_a_local_python_problem():
    cause, fix = rzp.diagnose(_err(
        "could not reach Razorpay at https://api.razorpay.com/v1: "
        "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"))
    assert "certificates" in cause.lower()
    assert "Install Certificates" in fix or "ca-certificates" in fix
    assert "keys" in fix.lower(), "must reassure that the credentials are not at fault"


def test_dns_failure_is_named():
    cause, _ = rzp.diagnose(_err("could not reach Razorpay: [Errno -2] Name or service not known"))
    assert "DNS" in cause


def test_blocked_network_is_named():
    for message in ("Connection refused", "The read operation timed out",
                    "Network is unreachable"):
        cause, fix = rzp.diagnose(_err(f"could not reach Razorpay: {message}"))
        assert "blocked" in cause.lower(), message
        assert "firewall" in fix.lower() or "proxy" in fix.lower()


def test_401_is_named_as_a_credential_problem_not_a_gateway_problem():
    cause, fix = rzp.diagnose(_err(
        "Authentication failed due to incorrect key id or secret", status=401))
    assert "key id / secret" in cause
    assert "Settings -> API Keys" in fix


def test_403_is_distinguished_from_401():
    cause_401, _ = rzp.diagnose(_err("nope", status=401))
    cause_403, _ = rzp.diagnose(_err("nope", status=403))
    assert cause_401 != cause_403
    assert "not allowed" in cause_403.lower()


def test_razorpay_side_outage_is_not_blamed_on_the_user():
    cause, fix = rzp.diagnose(_err("Internal Server Error", status=500))
    assert "Razorpay" in cause
    assert "nothing wrong on your side" in fix.lower()


def test_unknown_failures_return_empty_rather_than_guessing():
    cause, fix = rzp.diagnose(_err("something nobody predicted", status=418))
    assert cause == "" and fix == ""


def test_error_payload_carries_cause_and_fix_alongside_the_raw_message():
    payload = rzp.error_payload(_err("Authentication failed", status=401))
    assert payload["error"] == "Authentication failed"
    assert payload["status"] == 401
    assert payload["cause"] and payload["fix"]


def test_error_payload_never_omits_the_original_message():
    payload = rzp.error_payload(_err("some unmapped thing", status=418))
    assert payload["error"] == "some unmapped thing"
    assert payload["cause"] == ""


def test_a_cut_tls_connection_is_distinguished_from_a_certificate_problem():
    cut_cause, cut_fix = rzp.diagnose(_err(
        "could not reach Razorpay at https://api.razorpay.com/v1: "
        "TLS/SSL connection has been closed (EOF) (_ssl.c:992)"))
    cert_cause, _ = rzp.diagnose(_err("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"))

    assert cut_cause != cert_cause
    assert "cut" in cut_cause.lower() or "interfer" in cut_fix.lower()
    assert "firewall" in cut_fix.lower()


def test_tls_handshake_variants_are_all_recognised():
    for message in ("SSL: WRONG_VERSION_NUMBER", "EOF occurred in violation of protocol",
                    "handshake failure"):
        cause, _ = rzp.diagnose(_err(f"could not reach Razorpay: {message}"))
        assert cause, message


def test_certificate_diagnosis_still_wins_over_the_generic_tls_one():
    cause, fix = rzp.diagnose(_err("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"))
    assert "certificates" in cause.lower()
    assert "Install Certificates" in fix
