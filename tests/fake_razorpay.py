
import json
import base64
import random
import string
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

TEST_KEY_ID = "rzp_test_FakeKey123456"
TEST_KEY_SECRET = "fake_secret_do_not_use"


def _rid(prefix):
    body = "".join(random.choices(string.ascii_letters + string.digits, k=14))
    return f"{prefix}_{body}"


class FakeRazorpayState:

    def __init__(self):
        self.orders = {}
        self.payments = {}
        self.disputes = {}
        self.calls = []
        self.key_id = TEST_KEY_ID
        self.key_secret = TEST_KEY_SECRET

    def seed_payment(self, amount=500000, method="card", status="captured", currency="INR"):
        pid = _rid("pay")
        self.payments[pid] = {
            "id": pid,
            "entity": "payment",
            "amount": amount,
            "currency": currency,
            "status": status,
            "method": method,
            "captured": status == "captured",
            "order_id": _rid("order"),
            "description": "AEDI test transaction",
            "email": "test@example.com",
            "contact": "+919999999999",
            "fee": int(amount * 0.02),
            "tax": 0,
            "notes": {},
            "created_at": 1780000000,
        }
        return self.payments[pid]

    def seed_dispute(self, payment_id, amount=500000, phase="chargeback", status="open"):
        did = _rid("disp")
        self.disputes[did] = {
            "id": did,
            "entity": "dispute",
            "payment_id": payment_id,
            "amount": amount,
            "currency": "INR",
            "amount_deducted": 0,
            "reason_code": phase,
            "reason_description": "Seeded dispute",
            "respond_by": 1790000000,
            "status": status,
            "phase": phase,
            "created_at": 1780000100,
            "evidence": {"amount": amount, "summary": None, "submitted_at": None},
        }
        return self.disputes[did]


class _Handler(BaseHTTPRequestHandler):
    state = None

    def log_message(self, *args):
        pass


    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, description):
        self._send(status, {"error": {"code": code, "description": description}})

    def _authed(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            raw = base64.b64decode(header[6:]).decode("utf-8")
            key_id, _, secret = raw.partition(":")
        except Exception:
            return False
        return key_id == self.state.key_id and secret == self.state.key_secret

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def _path(self):
        return self.path.split("?", 1)[0]

    def _dispatch(self, method):
        path = self._path()
        self.state.calls.append((method, path))

        if not self._authed():
            return self._error(401, "BAD_REQUEST_ERROR",
                               "Authentication failed due to incorrect key id or secret")

        if method == "GET" and path == "/payments":
            return self._send(200, {"entity": "collection",
                                    "count": len(self.state.payments),
                                    "items": list(self.state.payments.values())})

        if method == "GET" and path.startswith("/payments/"):
            pid = path.rsplit("/", 1)[-1]
            payment = self.state.payments.get(pid)
            if not payment:
                return self._error(400, "BAD_REQUEST_ERROR", "The id provided does not exist")
            return self._send(200, payment)

        if method == "POST" and path == "/orders":
            body = self._body()
            amount = body.get("amount")
            if not isinstance(amount, int) or amount < 100:
                return self._error(400, "BAD_REQUEST_ERROR",
                                   "The amount must be atleast INR 1.00")
            order = {
                "id": _rid("order"),
                "entity": "order",
                "amount": amount,
                "amount_paid": 0,
                "amount_due": amount,
                "currency": body.get("currency", "INR"),
                "receipt": body.get("receipt"),
                "status": "created",
                "attempts": 0,
                "notes": body.get("notes", {}),
                "created_at": 1780000200,
            }
            self.state.orders[order["id"]] = order
            return self._send(200, order)

        if method == "GET" and path == "/disputes":
            return self._send(200, {"entity": "collection",
                                    "count": len(self.state.disputes),
                                    "items": list(self.state.disputes.values())})

        if method == "GET" and path.startswith("/disputes/") and path.count("/") == 2:
            dispute = self.state.disputes.get(path.rsplit("/", 1)[-1])
            if not dispute:
                return self._error(400, "BAD_REQUEST_ERROR", "The id provided does not exist")
            return self._send(200, dispute)

        if method == "POST" and path.endswith("/accept"):
            did = path.split("/")[2]
            dispute = self.state.disputes.get(did)
            if not dispute:
                return self._error(400, "BAD_REQUEST_ERROR", "The id provided does not exist")
            if dispute["status"] != "open":
                return self._error(400, "BAD_REQUEST_ERROR",
                                   f"Action not allowed when dispute is in {dispute['status']} status.")
            dispute["status"] = "lost"
            dispute["amount_deducted"] = dispute["amount"]
            return self._send(200, dispute)

        if method == "PATCH" and path.endswith("/contest"):
            did = path.split("/")[2]
            dispute = self.state.disputes.get(did)
            if not dispute:
                return self._error(400, "BAD_REQUEST_ERROR", "The id provided does not exist")
            if dispute["status"] != "open":
                return self._error(400, "BAD_REQUEST_ERROR",
                                   f"Action not allowed when dispute is in {dispute['status']} status.")
            body = self._body()
            dispute["evidence"]["summary"] = body.get("summary")
            if body.get("action") == "submit":
                dispute["status"] = "under_review"
                dispute["evidence"]["submitted_at"] = 1780000300
            return self._send(200, dispute)

        return self._error(404, "BAD_REQUEST_ERROR", f"no handler for {method} {path}")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")


class FakeRazorpay:

    def __init__(self, port=0, host="127.0.0.1"):
        self.state = FakeRazorpayState()
        handler = type("BoundHandler", (_Handler,), {"state": self.state})
        self._server = HTTPServer((host, port), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def base_url(self):
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
        return False
