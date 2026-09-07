#!/usr/bin/env python3
"""
Run a local stand-in for the Razorpay API, pre-seeded with test data.

This exists so the console's Live tab can be exercised — and demoed — without
Razorpay credentials, without network access, and without a Razorpay account.
It serves the same endpoints `app/razorpay_live.py` calls, using the response
shapes documented at https://razorpay.com/docs/api/.

    python scripts/razorpay_mock.py                 # starts on :9911

Then, in another terminal:

    RAZORPAY_KEY_ID=rzp_test_FakeKey123456 \
    RAZORPAY_KEY_SECRET=fake_secret_do_not_use \
    RAZORPAY_API_BASE=http://127.0.0.1:9911 \
    python app/server.py

Everything on the Live tab works against it except the Checkout popup, which
is Razorpay's own hosted page and needs a real key — use the "reuse a payment
already on the account" list instead, which is seeded below.

This is a development aid. It is never imported by the console at runtime.
"""

import sys
import time
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tests"))

from fake_razorpay import FakeRazorpay, TEST_KEY_ID, TEST_KEY_SECRET  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=9911)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--with-real-dispute", action="store_true",
                        help="seed a genuine-looking dispute so the actionable "
                             "contest/accept path can be demonstrated too")
    args = parser.parse_args()

    mock = FakeRazorpay(port=args.port, host=args.host)

    seeded = [
        mock.state.seed_payment(amount=500000, method="card"),
        mock.state.seed_payment(amount=129900, method="upi"),
        mock.state.seed_payment(amount=2450000, method="netbanking"),
    ]
    if args.with_real_dispute:
        dispute = mock.state.seed_dispute(seeded[0]["id"], amount=seeded[0]["amount"])
        print(f"  seeded REAL dispute {dispute['id']} on {seeded[0]['id']}")

    with mock:
        print(f"Razorpay API stand-in listening on {mock.base_url}")
        print("  point the console at it with:\n")
        print(f"    RAZORPAY_KEY_ID={TEST_KEY_ID} \\")
        print(f"    RAZORPAY_KEY_SECRET={TEST_KEY_SECRET} \\")
        print(f"    RAZORPAY_API_BASE={mock.base_url} \\")
        print("    python app/server.py\n")
        print(f"  {len(seeded)} payment(s) seeded:")
        for p in seeded:
            print(f"    {p['id']}  INR {p['amount'] / 100:>10,.2f}  {p['method']}")
        print("\nCtrl-C to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nstopped.")


if __name__ == "__main__":
    main()
