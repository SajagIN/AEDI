
import os
import re
import json
import hmac
import time
import base64
import hashlib
import threading
import urllib.error
import urllib.request
from collections import deque

DEFAULT_API_BASE = "https://api.razorpay.com/v1"

TIMEOUT_SECONDS = 12


class RazorpayError(Exception):

    def __init__(self, message, status=None, code=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code

    def as_dict(self):
        return {"error": self.message, "status": self.status, "code": self.code}


class LiveKeyRefused(RazorpayError):
    pass


class RazorpayClient:

    def __init__(self, key_id, key_secret, api_base=None):
        key_id = (key_id or "").strip()
        key_secret = (key_secret or "").strip()
        if not key_id or not key_secret:
            raise RazorpayError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set")
        if key_id.startswith("rzp_live_"):
            raise LiveKeyRefused(
                "That is a LIVE Razorpay key (rzp_live_…). This console creates orders and can "
                "submit dispute responses — accepting a dispute is irreversible and moves real "
                "money — so it only runs with a test key (rzp_test_…). Generate one from the "
                "Razorpay Dashboard with the Test/Live toggle set to Test."
            )
        self.key_id = key_id
        self.key_secret = key_secret
        self.api_base = (api_base or os.getenv("RAZORPAY_API_BASE") or DEFAULT_API_BASE).rstrip("/")


    @property
    def _auth_header(self):
        raw = f"{self.key_id}:{self.key_secret}".encode("utf-8")
        return "Basic " + base64.b64encode(raw).decode("ascii")

    def _call(self, method, path, body=None, params=None):
        url = f"{self.api_base}{path}"
        if params:
            pairs = [f"{k}={urllib.request.quote(str(v))}" for k, v in params.items() if v is not None]
            if pairs:
                url += "?" + "&".join(pairs)

        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth_header)
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "AEDI-console")

        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                payload = resp.read().decode("utf-8") or "{}"
                return json.loads(payload)
        except urllib.error.HTTPError as e:
            detail = {}
            try:
                detail = json.loads(e.read().decode("utf-8")).get("error", {})
            except Exception:
                pass
            raise RazorpayError(
                detail.get("description") or f"Razorpay returned HTTP {e.code}",
                status=e.code,
                code=detail.get("code"),
            ) from None
        except urllib.error.URLError as e:
            raise RazorpayError(f"could not reach Razorpay at {self.api_base}: {e.reason}") from None
        except json.JSONDecodeError:
            raise RazorpayError("Razorpay returned a response that was not JSON") from None


    def ping(self):
        self._call("GET", "/payments", params={"count": 1})
        return True

    def create_order(self, amount_paise, currency="INR", receipt=None, notes=None):
        return self._call("POST", "/orders", body={
            "amount": int(amount_paise),
            "currency": currency,
            "receipt": receipt or f"aedi_{int(time.time())}",
            "notes": notes or {},
        })

    def fetch_payment(self, payment_id):
        return self._call("GET", f"/payments/{payment_id}")

    def fetch_payments(self, count=20):
        return self._call("GET", "/payments", params={"count": int(count)}).get("items", [])

    def fetch_disputes(self, count=20):
        return self._call("GET", "/disputes", params={"count": int(count)}).get("items", [])

    def accept_dispute(self, dispute_id):
        return self._call("POST", f"/disputes/{dispute_id}/accept")

    def contest_dispute(self, dispute_id, payload):
        return self._call("PATCH", f"/disputes/{dispute_id}/contest", body=payload)


def read_config(env=None):
    env = env if env is not None else os.environ
    key_id = (env.get("RAZORPAY_KEY_ID") or "").strip()
    secret = (env.get("RAZORPAY_KEY_SECRET") or "").strip()

    if not key_id and not secret:
        state, detail = "unconfigured", "No RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env."
    elif not key_id or not secret:
        state, detail = "incomplete", "Both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required."
    elif key_id.startswith("rzp_live_"):
        state, detail = "refused", "Live keys are refused — use a test key (rzp_test_…)."
    elif not key_id.startswith("rzp_test_"):
        state, detail = "unknown_key", "Key id does not start with rzp_test_ — is it a Razorpay key?"
    else:
        state, detail = "configured", "Test-mode credentials present."

    return {
        "state": state,
        "detail": detail,
        "key_id_masked": mask_key(key_id),
        "api_base": (env.get("RAZORPAY_API_BASE") or DEFAULT_API_BASE).rstrip("/"),
        "webhook_secret_set": bool((env.get("RAZORPAY_WEBHOOK_SECRET") or "").strip()),
    }


def mask_key(key_id):
    key_id = (key_id or "").strip()
    if not key_id:
        return None
    prefix = key_id[:9] if key_id.startswith(("rzp_test_", "rzp_live_")) else key_id[:4]
    return f"{prefix}…{key_id[-4:]}" if len(key_id) > len(prefix) + 4 else f"{prefix}…"


def client_from_env(env=None):
    env = env if env is not None else os.environ
    return RazorpayClient(
        env.get("RAZORPAY_KEY_ID"),
        env.get("RAZORPAY_KEY_SECRET"),
        env.get("RAZORPAY_API_BASE"),
    )


def verify_webhook_signature(body_bytes, signature, secret):
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)


_DIAGNOSES = (
    (lambda s, c, m: "certificate_verify_failed" in m or "certificate verify failed" in m,
     "Your Python cannot verify HTTPS certificates.",
     "This is a local Python install problem, not a Razorpay one. On macOS run "
     "'/Applications/Python 3.x/Install Certificates.command'. On Linux install "
     "or update the ca-certificates package. Nothing about your keys is wrong."),

    (lambda s, c, m: any(x in m for x in (
        "ssl", "tls", "handshake", "wrong_version_number", "eof occurred")),
     "The HTTPS connection to Razorpay was cut before it completed.",
     "Something between you and Razorpay is interfering — usually a corporate or "
     "campus firewall, an antivirus that inspects HTTPS, or a captive-portal wifi "
     "you have not signed into. Check with 'curl -sSv https://api.razorpay.com "
     "-o /dev/null'. A phone hotspot is the fastest way to confirm it is the "
     "network and not your keys."),

    (lambda s, c, m: any(x in m for x in (
        "name or service not known", "nodename nor servname", "temporary failure in name",
        "getaddrinfo")),
     "DNS cannot resolve api.razorpay.com.",
     "The machine is offline, or a VPN/proxy is intercepting DNS. Check with "
     "'curl -I https://api.razorpay.com'."),

    (lambda s, c, m: any(x in m for x in ("connection refused", "timed out", "timeout",
                                          "network is unreachable", "no route to host")),
     "Network route to Razorpay is blocked.",
     "Usually a corporate/college firewall or a proxy that needs configuring. "
     "Try a phone hotspot to confirm, then set HTTPS_PROXY if you need the proxy."),

    (lambda s, c, m: s == 401 or "authentication failed" in m,
     "Razorpay rejected the key id / secret pair.",
     "Most often the secret belongs to a different key id, or one of the two was "
     "pasted with a character missing. Regenerate both together in Dashboard -> "
     "Settings -> API Keys with the toggle on Test, and paste both fresh. The "
     "secret is shown only once at creation — if you no longer have it, generate "
     "a new pair rather than guessing."),

    (lambda s, c, m: s == 403,
     "The key is valid but not allowed to do this.",
     "The Razorpay account may not have completed signup, or this API is not "
     "enabled on it. Open the Razorpay dashboard and finish any pending steps."),

    (lambda s, c, m: s == 400 and "amount" in m,
     "Razorpay rejected the amount.",
     "Minimum is INR 1.00. Amounts are sent in paise."),

    (lambda s, c, m: s == 429,
     "Rate limited by Razorpay.",
     "Wait a few seconds and retry."),

    (lambda s, c, m: s is not None and s >= 500,
     "Razorpay's own API returned an error.",
     "Nothing wrong on your side. Check https://status.razorpay.com and retry."),
)


def diagnose(exc):
    status = getattr(exc, "status", None)
    code = getattr(exc, "code", None) or ""
    message = str(getattr(exc, "message", exc) or "").lower()
    for predicate, cause, fix in _DIAGNOSES:
        try:
            if predicate(status, code, message):
                return cause, fix
        except Exception:
            continue
    return "", ""


def error_payload(exc):
    cause, fix = diagnose(exc)
    payload = exc.as_dict()
    payload["cause"] = cause
    payload["fix"] = fix
    return payload


EVIDENCE_CATALOG = {
    "proof_of_delivery": "Signed delivery confirmation dated within the expected window",
    "shipping_carrier_record": "Carrier tracking record showing package scanned delivered",
    "product_listing_match": "Product listing screenshot matching the SKU shipped",
    "communication_log": "Support ticket thread with the customer discussing the item received",
    "avs_cvv_match": "Payment gateway log confirming AVS full-match and CVV verified",
    "device_fingerprint_or_ip_log": "Device fingerprint log showing this device on 3 prior successful orders",
    "cardholder_ip_device_match": "Login history showing this device used the cardholder's account before",
    "prior_purchase_history": "Account history showing 5 prior orders paid with the same card",
    "transaction_log_dedup": "Ledger export confirming no duplicate authorization for this order ID",
    "return_policy_ack": "Checkout screenshot showing the customer accepted the return policy",
    "service_completion_record": "Technician check-in/check-out record for the scheduled service",
}

PHASE_TO_REASON_CODE = {
    "fraud": "10.4",
    "chargeback": "13.1",
    "retrieval": "4863",
    "pre_arbitration": "13.1",
    "arbitration": "13.1",
}


def paise_to_rupees(paise):
    return f"{int(paise) / 100:.2f}"


def format_evidence_items(types):
    out = []
    for t in types or []:
        desc = EVIDENCE_CATALOG.get(t)
        if desc:
            out.append(f"{t}: {desc}")
    return " | ".join(out)


def payment_to_case(payment, *, merchant_id, reason_code, narrative="",
                    evidence_types=None, case_id=None, original_amount=None):
    amount = paise_to_rupees(payment.get("amount", 0))
    created = payment.get("created_at")
    date = time.strftime("%Y-%m-%d", time.gmtime(created)) if created else time.strftime("%Y-%m-%d")

    method = payment.get("method") or "card"

    return {
        "case_id": case_id or payment.get("id", "live_case"),
        "merchant_id": merchant_id,
        "amount": amount,
        "original_amount": original_amount if original_amount is not None else amount,
        "currency": payment.get("currency", "INR"),
        "transaction_date": date,
        "payment_method": method,
        "reason_code": reason_code,
        "evidence_items": format_evidence_items(evidence_types),
        "merchant_narrative": narrative or "",
    }


def dispute_from_razorpay(dispute):
    return {
        "origin": "razorpay",
        "dispute_id": dispute.get("id"),
        "payment_id": dispute.get("payment_id"),
        "amount_paise": dispute.get("amount"),
        "currency": dispute.get("currency", "INR"),
        "status": dispute.get("status"),
        "phase": dispute.get("phase"),
        "razorpay_reason_code": dispute.get("reason_code"),
        "reason_description": dispute.get("reason_description"),
        "respond_by": dispute.get("respond_by"),
        "created_at": dispute.get("created_at"),
        "actionable": True,
    }


def local_dispute(payment, *, reason_code, phase="chargeback"):
    return {
        "origin": "local",
        "dispute_id": f"local_disp_{payment.get('id', 'unknown')}",
        "payment_id": payment.get("id"),
        "amount_paise": payment.get("amount"),
        "currency": payment.get("currency", "INR"),
        "status": "open",
        "phase": phase,
        "razorpay_reason_code": phase,
        "reason_description": "Raised in the console — the Razorpay API has no dispute-create endpoint.",
        "respond_by": int(time.time()) + 7 * 24 * 3600,
        "created_at": int(time.time()),
        "actionable": False,
    }


def contest_payload(dispute, result, case_row, evidence_types):
    summary = (result.get("reason") or "").strip()
    return {
        "amount": dispute.get("amount_paise"),
        "summary": summary[:1000],
        "action": "submit",
        "_aedi_note": (
            "Proof fields expect document ids from Razorpay's Documents API "
            "(POST /v1/documents). Upload each evidence artefact first, then "
            "attach the returned doc_… ids to the matching field below."
        ),
        "_aedi_evidence_types": list(evidence_types or []),
        "_aedi_case_id": case_row.get("case_id"),
    }


class EventLog:

    def __init__(self, maxlen=200):
        self._events = deque(maxlen=maxlen)
        self._next_id = 1
        self._lock = threading.Lock()

    def add(self, kind, message, **extra):
        with self._lock:
            event = {
                "id": self._next_id,
                "at": time.time(),
                "kind": kind,
                "message": message,
                **extra,
            }
            self._next_id += 1
            self._events.append(event)
            return event

    def since(self, after_id=0):
        with self._lock:
            return [e for e in self._events if e["id"] > int(after_id or 0)]

    def all(self):
        with self._lock:
            return list(self._events)

    def clear(self):
        with self._lock:
            self._events.clear()


def is_valid_reason_code(reason_code, known_codes):
    return reason_code in known_codes


PAYMENT_ID_RE = re.compile(r"^pay_[A-Za-z0-9]{10,}$")


def looks_like_payment_id(value):
    return bool(PAYMENT_ID_RE.match(str(value or "")))
