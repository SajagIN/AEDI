#!/usr/bin/env python3
"""
Diagnose a Razorpay connection, one layer at a time.

The console can only report that a call failed. This walks the whole path —
credentials present, key shape, DNS, TLS, authentication, then each endpoint
it actually uses — and stops at the first thing that is broken, with the fix.

    python scripts/razorpay_doctor.py

Reads the same .env the console does. Never prints a secret.
"""

import os
import sys
import socket
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "app"))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except Exception:
    pass

import razorpay_live as rzp  # noqa: E402

GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"
)
if not sys.stdout.isatty() or os.name == "nt":
    GREEN = RED = YELLOW = DIM = BOLD = RESET = ""

FAILED = []


def ok(label, detail=""):
    print(f"  {GREEN}PASS{RESET}  {label}" + (f"  {DIM}{detail}{RESET}" if detail else ""))


def warn(label, detail=""):
    print(f"  {YELLOW}WARN{RESET}  {label}" + (f"  {DIM}{detail}{RESET}" if detail else ""))


def fail(label, cause="", fix=""):
    print(f"  {RED}FAIL{RESET}  {label}")
    if cause:
        print(f"        {BOLD}{cause}{RESET}")
    if fix:
        for line in _wrap(fix, 68):
            print(f"        {line}")
    FAILED.append(label)


def _wrap(text, width):
    words, line, out = text.split(), "", []
    for w in words:
        if len(line) + len(w) + 1 > width:
            out.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        out.append(line)
    return out


def step(n, title):
    print(f"\n{BOLD}{n}. {title}{RESET}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=None,
                        help="override the API host to test (default: from RAZORPAY_API_BASE)")
    args = parser.parse_args()

    print(f"{BOLD}Razorpay connection check{RESET}")

    # 1 — credentials -------------------------------------------------------
    step(1, "Credentials in .env")
    cfg = rzp.read_config()
    base = args.host or cfg["api_base"]

    if cfg["state"] == "unconfigured":
        fail("No credentials found",
             "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.",
             f"Add both to {REPO_ROOT / '.env'} and re-run. Generate them in the "
             "Razorpay Dashboard with the Test/Live toggle set to Test, under "
             "Settings -> API Keys.")
        return report()
    if cfg["state"] == "incomplete":
        have = "RAZORPAY_KEY_ID" if os.getenv("RAZORPAY_KEY_ID") else "RAZORPAY_KEY_SECRET"
        missing = "RAZORPAY_KEY_SECRET" if have == "RAZORPAY_KEY_ID" else "RAZORPAY_KEY_ID"
        fail("Only one of the two is set",
             f"{have} is present, {missing} is not.",
             "Both are required. The secret is shown only once, when the key is "
             "created — if you no longer have it, generate a new pair.")
        return report()
    if cfg["state"] == "refused":
        fail("That is a LIVE key",
             "Keys beginning rzp_live_ are refused on purpose.",
             "This console can submit dispute responses, and accepting a dispute "
             "is irreversible and moves real money. Switch the Dashboard toggle to "
             "Test and generate a test key.")
        return report()
    if cfg["state"] == "unknown_key":
        warn("Key id does not start with rzp_test_", cfg["key_id_masked"] or "")
    else:
        ok("Both values present", cfg["key_id_masked"])

    secret = os.getenv("RAZORPAY_KEY_SECRET", "")
    if secret != secret.strip():
        warn("Secret has surrounding whitespace", "it is stripped before use, but check .env")
    if len(secret) < 20:
        warn("Secret looks short", f"{len(secret)} characters — Razorpay secrets are usually 24")
    if secret.startswith("rzp_"):
        fail("The secret looks like a key id",
             "RAZORPAY_KEY_SECRET starts with 'rzp_', which is the shape of a key ID.",
             "You have probably pasted the Key ID into both fields. The secret is a "
             "separate random string shown once when the key is created.")
        return report()

    # 2 — can we reach the host --------------------------------------------
    step(2, "Network")
    host = base.split("//", 1)[-1].split("/", 1)[0].split(":")[0]
    port = 443 if base.startswith("https") else int(
        base.split(":")[-1].split("/")[0]) if base.count(":") > 1 else 80
    try:
        socket.gethostbyname(host)
        ok(f"DNS resolves {host}")
    except OSError as e:
        fail(f"Cannot resolve {host}",
             f"DNS lookup failed: {e}",
             "The machine is offline, or a VPN/proxy is intercepting DNS.")
        return report()

    try:
        with socket.create_connection((host, port), timeout=8):
            ok(f"TCP connect to {host}:{port}")
    except OSError as e:
        fail(f"Cannot connect to {host}:{port}",
             str(e),
             "Usually a firewall or a proxy. Try a phone hotspot to confirm; if "
             "you need the proxy, set HTTPS_PROXY in the environment.")
        return report()

    # 3 — authentication ----------------------------------------------------
    step(3, "Authentication")
    try:
        client = rzp.RazorpayClient(os.getenv("RAZORPAY_KEY_ID"), secret, base)
    except rzp.RazorpayError as e:
        fail("Client refused the credentials", e.message)
        return report()

    try:
        client.ping()
        ok("Razorpay accepted the key/secret pair")
    except rzp.RazorpayError as e:
        cause, fix = rzp.diagnose(e)
        fail("Razorpay rejected the call", cause or e.message, fix or "")
        if e.status:
            print(f"        {DIM}HTTP {e.status} · {e.code or 'no code'} · {e.message}{RESET}")
        return report()

    # 4 — the endpoints the console uses ------------------------------------
    step(4, "Endpoints the console calls")

    checks = [
        ("GET  /v1/payments", lambda: client.fetch_payments(count=3), True),
        ("GET  /v1/disputes", lambda: client.fetch_disputes(count=3), True),
    ]
    payments = []
    for label, call, required in checks:
        try:
            result = call()
            if label.endswith("/v1/payments"):
                payments = result
            ok(label, f"{len(result)} item(s)")
        except rzp.RazorpayError as e:
            cause, fix = rzp.diagnose(e)
            (fail if required else warn)(label, cause or e.message, fix or "")

    # Order creation is a write, so it is opt-in noise-wise but worth doing:
    # it is the single call the demo depends on most.
    try:
        order = client.create_order(100, receipt="aedi_doctor")
        ok("POST /v1/orders", f"created {order['id']} (INR 1.00, harmless)")
    except rzp.RazorpayError as e:
        cause, fix = rzp.diagnose(e)
        fail("POST /v1/orders", cause or e.message, fix or "")

    # 5 — demo readiness ----------------------------------------------------
    step(5, "Demo readiness")
    if payments:
        ok(f"{len(payments)} payment(s) on the account", "the 'reuse a payment' list will not be empty")
    else:
        warn("No payments on this account yet",
             "take one from the Live tab, or the reuse list will be empty")

    if cfg["webhook_secret_set"]:
        ok("RAZORPAY_WEBHOOK_SECRET is set", "real disputes can arrive by webhook")
    else:
        warn("No RAZORPAY_WEBHOOK_SECRET",
             "optional — without it, no genuine dispute can reach the console")

    if not os.getenv("NVIDIA_API_KEY"):
        warn("No NVIDIA_API_KEY",
             "the Live tab will compute real signals but refuse to decide")
    else:
        ok("NVIDIA_API_KEY present", "the Live tab can run the full pipeline")

    return report()


def report():
    print()
    if FAILED:
        print(f"{RED}{BOLD}{len(FAILED)} check(s) failed.{RESET} "
              f"Fix the first one above and re-run — later checks depend on it.")
        return 1
    print(f"{GREEN}{BOLD}All checks passed.{RESET} "
          f"Start the console with 'python app/server.py' and open the Live tab.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
