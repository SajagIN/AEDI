"""
End-to-end tests for the console's /api/rzp/* endpoints.

These drive the Flask app through its test client while `RAZORPAY_API_BASE`
points at tests/fake_razorpay.py, so the full path is exercised — HTTP in,
Razorpay call out, pipeline signals, HTTP out — with no network and no
credentials.

The behaviours pinned here are the ones a demo would expose:
  * every endpoint degrades to a readable message when unconfigured,
  * a real payment id is never taken on trust from the browser,
  * a locally raised chargeback is never submitted to Razorpay,
  * the deterministic half of the pipeline runs on live data without a
    GROQ_API_KEY, and says so rather than inventing a decision.
"""

import sys
import json
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fake_razorpay import FakeRazorpay, TEST_KEY_ID, TEST_KEY_SECRET  # noqa: E402


@pytest.fixture(scope="module")
def server_module():
    spec = importlib.util.spec_from_file_location(
        "aedi_server_under_test", REPO_ROOT / "app" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["aedi_server_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def fake():
    with FakeRazorpay() as f:
        yield f


@pytest.fixture
def configured(server_module, fake, monkeypatch):
    """App wired to the mock, with session state reset between tests."""
    monkeypatch.setenv("RAZORPAY_KEY_ID", TEST_KEY_ID)
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", TEST_KEY_SECRET)
    monkeypatch.setenv("RAZORPAY_API_BASE", fake.base_url)
    server_module._rzp_client_cache.update(client=None, key_id=None)
    server_module._rzp_disputes.clear()
    server_module._rzp_decisions.clear()
    server_module._rzp_events.clear()
    server_module.app.config["TESTING"] = True
    return server_module.app.test_client()


@pytest.fixture
def unconfigured(server_module, monkeypatch):
    monkeypatch.delenv("RAZORPAY_KEY_ID", raising=False)
    monkeypatch.delenv("RAZORPAY_KEY_SECRET", raising=False)
    server_module._rzp_client_cache.update(client=None, key_id=None)
    server_module.app.config["TESTING"] = True
    return server_module.app.test_client()


def _json(resp):
    return json.loads(resp.data.decode("utf-8"))


# ── status ────────────────────────────────────────────────────────────────

def test_status_reports_unconfigured_without_crashing(unconfigured):
    body = _json(unconfigured.get("/api/rzp/status"))
    assert body["state"] == "unconfigured"
    assert body["key_id_masked"] is None


def test_status_probe_confirms_reachability(configured):
    body = _json(configured.get("/api/rzp/status?probe=1"))
    assert body["state"] == "configured"
    assert body["reachable"] is True
    assert body["real_disputes"] == 0


def test_status_probe_reports_bad_credentials_rather_than_500(server_module, fake, monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", TEST_KEY_ID)
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "wrong")
    monkeypatch.setenv("RAZORPAY_API_BASE", fake.base_url)
    server_module._rzp_client_cache.update(client=None, key_id=None)
    body = _json(server_module.app.test_client().get("/api/rzp/status?probe=1"))
    assert body["reachable"] is False
    assert "incorrect key id or secret" in body["reach_detail"]


def test_status_never_returns_the_secret(configured):
    raw = configured.get("/api/rzp/status?probe=1").data.decode()
    assert TEST_KEY_SECRET not in raw


def test_status_does_not_probe_unless_asked(configured, fake):
    configured.get("/api/rzp/status")
    assert fake.state.calls == []


def test_a_live_key_is_refused_at_the_endpoint(server_module, monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_live_Something123")  # pragma: allowlist-fake
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    server_module._rzp_client_cache.update(client=None, key_id=None)
    client = server_module.app.test_client()

    assert _json(client.get("/api/rzp/status"))["state"] == "refused"
    resp = client.post("/api/rzp/order", json={"amount_inr": 100})
    assert resp.status_code == 400
    assert "test key" in _json(resp)["error"].lower()


# ── reference data ────────────────────────────────────────────────────────

def test_reference_exposes_the_projects_real_merchants_and_reason_codes(configured):
    body = _json(configured.get("/api/rzp/reference"))
    assert len(body["merchants"]) == 20
    assert {r["reason_code"] for r in body["reason_codes"]} >= {"13.1", "10.4", "4853"}
    assert body["evidence_catalog"]["proof_of_delivery"]


def test_reference_marks_which_merchants_carry_a_repeat_pattern(configured):
    merchants = _json(configured.get("/api/rzp/reference"))["merchants"]
    assert any(m["repeat_pattern"] for m in merchants)
    assert any(not m["repeat_pattern"] for m in merchants)


def test_every_reason_code_lists_the_evidence_it_requires(configured):
    for r in _json(configured.get("/api/rzp/reference"))["reason_codes"]:
        assert r["required_evidence_types"], r["reason_code"]


# ── orders and payments ───────────────────────────────────────────────────

def test_creating_an_order_hits_razorpay_and_logs_an_event(configured, fake):
    resp = configured.post("/api/rzp/order", json={"amount_inr": 5000, "merchant_id": "mch_015"})
    assert resp.status_code == 200
    body = _json(resp)
    assert body["order"]["id"].startswith("order_")
    assert body["order"]["amount"] == 500000
    assert body["key_id"] == TEST_KEY_ID
    assert ("POST", "/orders") in fake.state.calls

    events = _json(configured.get("/api/rzp/events"))["events"]
    assert any(e["kind"] == "order.created" for e in events)


def test_order_amount_is_validated_before_any_network_call(configured, fake):
    assert configured.post("/api/rzp/order", json={"amount_inr": 0}).status_code == 400
    assert configured.post("/api/rzp/order", json={"amount_inr": "abc"}).status_code == 400
    assert fake.state.calls == []


def test_order_endpoint_is_unavailable_when_unconfigured(unconfigured):
    resp = unconfigured.post("/api/rzp/order", json={"amount_inr": 100})
    assert resp.status_code == 400
    assert "RAZORPAY_KEY_ID" in _json(resp)["error"]


def test_confirm_refetches_the_payment_instead_of_trusting_the_browser(configured, fake):
    payment = fake.state.seed_payment(amount=250000, method="upi")
    fake.state.calls.clear()
    body = _json(configured.post("/api/rzp/confirm", json={"payment_id": payment["id"]}))
    assert body["payment"]["amount"] == 250000
    assert ("GET", f"/payments/{payment['id']}") in fake.state.calls


def test_confirm_rejects_a_forged_payment_id_shape(configured, fake):
    resp = configured.post("/api/rzp/confirm", json={"payment_id": "'; DROP TABLE --"})
    assert resp.status_code == 400
    assert fake.state.calls == []


def test_confirm_surfaces_an_unknown_payment_as_502_not_500(configured):
    resp = configured.post("/api/rzp/confirm", json={"payment_id": "pay_DoesNotExist12"})
    assert resp.status_code == 502
    assert "does not exist" in _json(resp)["error"]


# ── raising a chargeback ──────────────────────────────────────────────────

def _raise_chargeback(client, fake, **overrides):
    payment = fake.state.seed_payment(amount=500000)
    payload = {
        "payment_id": payment["id"],
        "merchant_id": "mch_015",
        "reason_code": "13.1",
        "evidence_types": ["proof_of_delivery", "shipping_carrier_record"],
        "narrative": "Delivered and signed for.",
    }
    payload.update(overrides)
    return payment, client.post("/api/rzp/chargeback", json=payload)


def test_raising_a_chargeback_computes_real_signals(configured, fake):
    payment, resp = _raise_chargeback(configured, fake)
    body = _json(resp)
    assert body["dispute"]["payment_id"] == payment["id"]
    assert body["signals"]["evidence_sufficiency"] == "sufficient"
    assert body["signals"]["missing_types"] == []


def test_incomplete_evidence_is_detected_on_a_live_chargeback(configured, fake):
    _, resp = _raise_chargeback(configured, fake, evidence_types=["proof_of_delivery"])
    signals = _json(resp)["signals"]
    assert signals["evidence_sufficiency"] != "sufficient"
    assert "shipping_carrier_record" in signals["missing_types"]


def test_a_raised_chargeback_is_labelled_local_and_not_actionable(configured, fake):
    _, resp = _raise_chargeback(configured, fake)
    dispute = _json(resp)["dispute"]
    assert dispute["origin"] == "local"
    assert dispute["actionable"] is False


def test_chargeback_validates_reason_code_and_merchant(configured, fake):
    _, bad_reason = _raise_chargeback(configured, fake, reason_code="99.9")
    assert bad_reason.status_code == 400
    assert "reason code" in _json(bad_reason)["error"]

    _, bad_merchant = _raise_chargeback(configured, fake, merchant_id="mch_999")
    assert bad_merchant.status_code == 400
    assert "merchant" in _json(bad_merchant)["error"]


def test_chargeback_requires_a_real_payment_id(configured, fake):
    resp = configured.post("/api/rzp/chargeback", json={
        "payment_id": "made_up", "merchant_id": "mch_015", "reason_code": "13.1"})
    assert resp.status_code == 400


def test_disputes_listing_includes_both_origins(configured, fake):
    real_payment = fake.state.seed_payment()
    fake.state.seed_dispute(real_payment["id"])
    _raise_chargeback(configured, fake)

    disputes = _json(configured.get("/api/rzp/disputes"))["disputes"]
    origins = {d["origin"] for d in disputes}
    assert origins == {"razorpay", "local"}
    assert all(d["actionable"] for d in disputes if d["origin"] == "razorpay")
    assert not any(d["actionable"] for d in disputes if d["origin"] == "local")


def test_disputes_listing_explains_the_missing_create_api(configured):
    assert "no dispute-create API" in _json(configured.get("/api/rzp/disputes"))["note"]


# ── deciding ──────────────────────────────────────────────────────────────

def test_deciding_without_a_groq_key_refuses_but_still_returns_real_signals(
        configured, fake, monkeypatch):
    """The deterministic half is genuinely computable offline; the model half
    is not. The endpoint must give the first and decline the second."""
    for key in [k for k in list(__import__("os").environ) if k.startswith("GROQ_API_KEY")]:
        monkeypatch.delenv(key, raising=False)

    _, resp = _raise_chargeback(configured, fake)
    dispute_id = _json(resp)["dispute"]["dispute_id"]

    decide = configured.post("/api/rzp/decide", json={"dispute_id": dispute_id})
    assert decide.status_code == 400
    body = _json(decide)
    assert "GROQ_API_KEY" in body["error"]
    assert body["signals"]["evidence_sufficiency"] == "sufficient"
    assert any(t["step"] == "risk_signals" for t in body["trace"])
    assert any(t["step"] == "razorpay.fetch_payment" for t in body["trace"])


def test_deciding_an_unknown_dispute_is_a_404(configured):
    resp = configured.post("/api/rzp/decide", json={"dispute_id": "nope"})
    assert resp.status_code == 404


# ── submitting back ───────────────────────────────────────────────────────

def test_submitting_a_local_chargeback_is_refused_with_an_explanation(
        configured, fake, server_module):
    _, resp = _raise_chargeback(configured, fake)
    dispute_id = _json(resp)["dispute"]["dispute_id"]
    server_module._rzp_decisions[dispute_id] = {"decision": "contest"}

    submit = configured.post("/api/rzp/submit", json={"dispute_id": dispute_id})
    assert submit.status_code == 409
    body = _json(submit)
    assert body["submitted"] is False
    assert "raised in the console" in body["reason"]


def test_submitting_a_local_chargeback_issues_no_razorpay_call(
        configured, fake, server_module):
    _, resp = _raise_chargeback(configured, fake)
    dispute_id = _json(resp)["dispute"]["dispute_id"]
    server_module._rzp_decisions[dispute_id] = {"decision": "accept_liability"}
    fake.state.calls.clear()

    configured.post("/api/rzp/submit", json={"dispute_id": dispute_id})
    assert not any(p.startswith("/disputes") for _, p in fake.state.calls), \
        "a local chargeback must never reach the Razorpay disputes API"


def test_contesting_a_real_dispute_is_actually_submitted(configured, fake, server_module):
    payment = fake.state.seed_payment()
    dispute = fake.state.seed_dispute(payment["id"])
    configured.get("/api/rzp/disputes")            # pulls it into the session
    server_module._rzp_decisions[dispute["id"]] = {"decision": "contest"}

    resp = configured.post("/api/rzp/submit", json={
        "dispute_id": dispute["id"],
        "payload": {"summary": "carrier scan proves delivery", "action": "submit"},
    })
    assert resp.status_code == 200
    body = _json(resp)
    assert body["submitted"] is True
    assert body["dispute"]["status"] == "under_review"
    assert fake.state.disputes[dispute["id"]]["evidence"]["summary"] == \
        "carrier scan proves delivery"


def test_accepting_a_real_dispute_is_actually_submitted(configured, fake, server_module):
    payment = fake.state.seed_payment()
    dispute = fake.state.seed_dispute(payment["id"])
    configured.get("/api/rzp/disputes")
    server_module._rzp_decisions[dispute["id"]] = {"decision": "accept_liability"}

    body = _json(configured.post("/api/rzp/submit", json={"dispute_id": dispute["id"]}))
    assert body["dispute"]["status"] == "lost"


def test_manual_review_has_nothing_to_submit(configured, fake, server_module):
    _, resp = _raise_chargeback(configured, fake)
    dispute_id = _json(resp)["dispute"]["dispute_id"]
    server_module._rzp_decisions[dispute_id] = {"decision": "manual_review"}

    submit = configured.post("/api/rzp/submit", json={"dispute_id": dispute_id})
    assert submit.status_code == 400
    assert "manual review" in _json(submit)["error"]


# ── webhooks ──────────────────────────────────────────────────────────────

def test_webhook_without_a_signature_is_rejected(configured):
    resp = configured.post("/api/rzp/webhook", json={"event": "payment.captured"})
    assert resp.status_code == 401


def test_webhook_with_a_wrong_signature_is_rejected(configured, monkeypatch):
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", "whsec_test")
    resp = configured.post("/api/rzp/webhook",
                           data=b'{"event":"payment.captured"}',
                           headers={"X-Razorpay-Signature": "deadbeef",
                                    "Content-Type": "application/json"})
    assert resp.status_code == 401


def test_a_signed_dispute_webhook_creates_a_real_actionable_dispute(configured, monkeypatch):
    import hmac, hashlib
    secret = "whsec_test"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", secret)

    body = json.dumps({
        "event": "payment.dispute.created",
        "payload": {"dispute": {"entity": {
            "id": "disp_RealFromBank1", "payment_id": "pay_ABCDEFGHIJ1234",
            "amount": 500000, "currency": "INR", "status": "open",
            "phase": "chargeback", "reason_code": "chargeback",
            "respond_by": 1790000000, "created_at": 1780000000,
        }}},
    }).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    resp = configured.post("/api/rzp/webhook", data=body,
                           headers={"X-Razorpay-Signature": sig,
                                    "Content-Type": "application/json"})
    assert resp.status_code == 200
    assert _json(resp)["dispute_id"] == "disp_RealFromBank1"

    disputes = _json(configured.get("/api/rzp/disputes"))["disputes"]
    arrived = [d for d in disputes if d["dispute_id"] == "disp_RealFromBank1"]
    assert arrived and arrived[0]["origin"] == "razorpay"
    assert arrived[0]["actionable"] is True
    assert arrived[0]["network_reason_code"] == "13.1"


# ── event feed ────────────────────────────────────────────────────────────

def test_event_feed_supports_incremental_polling(configured, fake):
    configured.post("/api/rzp/order", json={"amount_inr": 100})
    first = _json(configured.get("/api/rzp/events"))["events"]
    assert first

    latest = first[-1]["id"]
    assert _json(configured.get(f"/api/rzp/events?after={latest}"))["events"] == []

    configured.post("/api/rzp/order", json={"amount_inr": 200})
    after = _json(configured.get(f"/api/rzp/events?after={latest}"))["events"]
    assert len(after) == 1


def test_the_full_workflow_emits_the_expected_event_sequence(configured, fake):
    configured.post("/api/rzp/order", json={"amount_inr": 5000, "merchant_id": "mch_015"})
    payment = fake.state.seed_payment()
    configured.post("/api/rzp/confirm", json={"payment_id": payment["id"]})
    configured.post("/api/rzp/chargeback", json={
        "payment_id": payment["id"], "merchant_id": "mch_015", "reason_code": "13.1",
        "evidence_types": ["proof_of_delivery", "shipping_carrier_record"],
        "narrative": "Delivered.",
    })

    kinds = [e["kind"] for e in _json(configured.get("/api/rzp/events"))["events"]]
    assert kinds == ["order.created", "payment.captured", "dispute.raised"]


def test_events_record_which_side_each_step_came_from(configured, fake):
    payment = fake.state.seed_payment()
    configured.post("/api/rzp/confirm", json={"payment_id": payment["id"]})
    configured.post("/api/rzp/chargeback", json={
        "payment_id": payment["id"], "merchant_id": "mch_015", "reason_code": "13.1",
        "evidence_types": [], "narrative": ""})

    events = {e["kind"]: e["origin"] for e in _json(configured.get("/api/rzp/events"))["events"]}
    assert events["payment.captured"] == "razorpay"
    assert events["dispute.raised"] == "local"
