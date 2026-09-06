# Running AEDI

Two ways to run this project: the **web console** (best for a demo) and the
**command line** (what the results in the README were produced with).

Everything except a live model call works with **no API key and no network**.

---

## 0. Prerequisites

Python 3.9+ and `git`. Nothing else.

```bash
git clone https://github.com/SajagIN/AEDI.git
cd AEDI
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
```

---

## 1. Fastest check that it works — run the tests

No API key, no network, ~0.2 seconds.

```bash
pip install -r requirements.txt
python -m pytest tests/ -v
```

Expected: **46 passed**. This exercises the deterministic core — sanitisation,
risk signals, tool-argument isolation, the evaluation harness's maths, the
adversarial lock file, and byte-for-byte dataset reproducibility.

---

## 2. Web console (recommended for a demo)

```bash
pip install -r app/requirements.txt
python app/server.py
```

Open **http://127.0.0.1:8000**.

It starts in one of two modes, detected automatically:

| Mode | When | What you get |
|---|---|---|
| **REPLAY** | no `GROQ_API_KEY` | Everything except a live model call: every deterministic signal computed on the fly, the full evaluation harness, the committed predictions, the adversarial fixture catalogue. No network access at all. |
| **LIVE** | `GROQ_API_KEY` in `.env` | The above, plus a **Run live** button that calls the real bounded agent loop for a single case through the disk cache. |

Five tabs:

- **Overview** — what the system does, the deterministic-vs-model dividing line, the threat model. The headline numbers are computed live, not hard-coded in the page.
- **Case Explorer** — the actual demo. Pick a case, see its evidence with pipeline-assigned IDs, the reason code's requirement checklist, the deterministic risk signals, and the untrusted merchant narrative. Hit **Replay committed decision** to watch the pipeline trace step through and land on a decision, with the cited evidence highlighted and compared against ground truth.
- **Evaluation** — confusion matrix, precision/recall, coverage and the cost model for the agent and both baselines, all computed in-process by `code/evaluation/main.py`.
- **Live · Razorpay** — the pipeline against a real Razorpay test-mode payment rather than a CSV row. See §2b for exactly which parts are real.
- **Adversarial** — the 24 attack fixtures and 10 benign controls, with the defence posture statement, plus an **injection playground**: paste any narrative and run it against a deliberately neutral case whose correct answer is `contest`. If your text moves the decision, the defence just failed in front of you. (The playground needs LIVE mode — in REPLAY it refuses rather than fabricating a verdict.)

Change the port with `PORT=9000 python app/server.py`.

---

## 2b. Connecting Razorpay (test mode)

The **Live · Razorpay** tab runs the pipeline against a real payment instead
of a CSV row. Add test credentials to `.env` and restart:

```bash
RAZORPAY_KEY_ID=rzp_test_your_key_id_here
RAZORPAY_KEY_SECRET=your_key_here
```

Generate them from the Razorpay Dashboard with the Test/Live toggle set to
**Test** → Settings → API Keys. A key beginning `rzp_live_` is **refused at
startup**: the console can submit dispute responses, and accepting a dispute
is irreversible and moves real money.

The tab walks four steps — take a payment, raise a chargeback, let AEDI
decide, respond to Razorpay — with a live event feed down the side.

### What is real, and what is not

This matters, because a judge will ask.

| Step | Real? |
|---|---|
| Order created (`order_…`) | **Real.** A genuine Razorpay object, visible in your test dashboard. |
| Payment taken via Checkout (`pay_…`) | **Real.** Pay with test card `4111 1111 1111 1111`, any future expiry/CVV, or UPI id `success@razorpay`. Verified server-side by re-fetching from Razorpay — the browser's claim is not trusted. |
| Merchant history, reason-code rules, evidence requirements | **Real.** The project's own reference data, so a live case is scored by exactly the same rules as a dataset case. |
| Deterministic signals and the agent's decision | **Real.** The same `risk_signals` and `analyze_case` the batch pipeline uses. |
| **Chargeback arriving** | **Stood in for.** Razorpay has no dispute-create endpoint — [disputes are raised by the issuing bank](https://razorpay.com/docs/api/disputes/), not the merchant, so no sandbox can manufacture one. Chargebacks raised in the console are labelled `raised in console` and are **never** submitted to Razorpay. |
| Contest / accept submitted back | **Real, but only for a real dispute.** For a locally-raised one the console shows the exact `PATCH /v1/disputes/:id/contest` body it would send and refuses to pretend otherwise. |

### Getting a genuine dispute to arrive

Set a webhook secret and point a Razorpay webhook at `POST /api/rzp/webhook`:

```bash
RAZORPAY_WEBHOOK_SECRET=your_key_here
```

Subscribe to `payment.dispute.created` in the Dashboard. Requests with a
missing or wrong HMAC-SHA256 signature are dropped. A dispute arriving this
way is labelled `live from Razorpay`, is actionable, and contest/accept are
genuinely issued against it.

### When something goes wrong

Run the doctor. It walks the whole path — credentials, key shape, DNS, TCP,
TLS, authentication, then each endpoint the console calls — and stops at the
first broken layer with the fix for that specific layer:

```bash
python scripts/razorpay_doctor.py
```

It never prints a secret. A `502` from the console always carries the same
diagnosis in its JSON body (`cause` and `fix` fields), and the Live tab shows
it as a red banner rather than failing silently.

### Trying it without a Razorpay account

`scripts/razorpay_mock.py` serves the same endpoints locally, pre-seeded with
payments and one real-looking dispute:

```bash
python scripts/razorpay_mock.py --with-real-dispute
```

It prints the three environment variables to export — including the throwaway
credentials it accepts — so copy that block into a second terminal and start
the console with them:

```bash
RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_API_BASE=http://127.0.0.1:9911 \
python app/server.py
```

Everything works except the Checkout popup, which is Razorpay's own hosted
page and needs a real key — use the "reuse a payment already on the account"
list instead. This is also what the test suite runs against, so the Razorpay
bridge is covered with no network and no credentials.

---

### Rebuilding the console UI

The console is a React + TypeScript + Tailwind app using [shadcn/ui](https://ui.shadcn.com)
component sources, kept in `web/`. **The built bundle is committed to `app/static/`**, so
`python app/server.py` works on a machine with no Node installed — you only need the
toolchain if you want to change the UI.

The theme is documented at the top of `web/tailwind.config.js`. Three conventions are
worth knowing before you edit a view:

- **Colour carries meaning.** The ground is white and the neutrals are a few degrees
  cool, so cobalt `#0066CC` is the only saturated thing on a screen that is not a
  verdict. Everything bright is money, or a warning about money. Verdict colours are
  cut to clear 4.5:1 on paper: good `#0F7B43`, bad `#C62A1B`, warn `#9A5B00`,
  info `#1F6FA8`, model `#5B4BB8`.
- **Provenance has a typeface.** Anything the code computed is set in IBM Plex Mono;
  anything the model wrote is set in Instrument Serif italic (`font-quote`). That
  distinction is the product's central claim, so it is spelled in the type, not a
  caption. The interface itself is Manrope, tracked tighter as it gets larger.
- **Always use the `signal-*` names**, never a raw hue. A view should not have to know
  which colour "won" is this month, and the light and dark cuts of the theme differ.

Fonts are bundled through `@fontsource`, not fetched from a CDN — the console is meant to
survive a demo table with no network.

```bash
cd web
npm install
npm run build     # type-checks, then emits into ../app/static/
```

For hot reload while Flask keeps serving the API:

```bash
python app/server.py       # terminal 1 — API on :8000
cd web && npm run dev      # terminal 2 — UI on :5173, proxies /api to :8000
```

Open **http://127.0.0.1:5173** for the dev server. Run `npm run build` before committing
so the no-Node path stays working; `web/node_modules/` is gitignored.

---

## 3. Command line

### Score the committed held-out predictions (no API key needed)

```bash
python code/evaluation/main.py --split held_out \
  --predictions dataset/held_out/output.csv \
  --i-am-opening-held-out-for-real
```

This reproduces the held-out table in the README exactly: contest 73%/100%,
accept_liability 75%/71%, coverage 76%, INR 3,600 per 100 cases.

### Run the agent over a whole split (needs an API key)

```bash
cp .env.example .env       # then put a real GROQ_API_KEY in it
python code/main.py --input dataset/dev/cases.csv --output dataset/dev/output.csv
python code/evaluation/main.py --split dev --predictions dataset/dev/output.csv
```

`dataset/dev/output.csv` is **not** committed, so `--split dev` has no
predictions to score until you generate them. `dataset/held_out/output.csv`
**is** committed, which is why the held-out numbers are reproducible without
a key.

Runs are resume-safe and every LLM call is disk-cached by request hash, so
re-running over cases already seen costs zero additional API calls.

### Adversarial regression suite (needs an API key)

```bash
python tests/adversarial_regression/run_suite.py
```

Writes `tests/adversarial_regression/results.csv` (git-ignored). Refuses to
start a second overlapping run; if you're certain nothing else is running,
delete `.run_suite.lock` and retry.

---

## 4. Getting an API key

A free key from [console.groq.com](https://console.groq.com) is enough. Put it
in `.env` — `cp .env.example .env` first; that file already ships the
correctly-named placeholder, so you only replace its value.

The free tier's daily token cap is enforced **per account**, not per key — extra
keys generated from the same account share one pool and only help spread
per-minute limits. `KeyPool` will round-robin across `GROQ_API_KEY`,
`GROQ_API_KEY_2`, `GROQ_API_KEY_3`, … if you have keys from separate accounts.

Never commit `.env`. Install the guard once per clone:

```bash
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: no GROQ_API_KEY* found` | Only the live agent needs a key. The tests, the web console in REPLAY mode, and held-out scoring all run without one. |
| `FileNotFoundError: dataset/dev/output.csv` | That file isn't committed. Generate it with `python code/main.py --input dataset/dev/cases.csv --output dataset/dev/output.csv`, or score `held_out` instead. |
| Overview shows `Auto-decided 0` and `₹0` saved | The selected split has an incomplete run. The banner names it — finish the run, or switch to `held_out`, which ships complete. |
| Numbers look wrong right after running `code/main.py` | If the run stopped early, `output.csv` holds only the cases it reached. That is not a random sample, so the console declines to project from it. Re-run the same command; it resumes from cache. |
| `--split held_out is refused` | Pass `--i-am-opening-held-out-for-real`. The guard is deliberate. |
| `AlreadyRunningError` from the adversarial suite | A lock file is preventing two overlapping runs from corrupting `results.csv`. Delete `.run_suite.lock` if nothing else is running. |
| `ModuleNotFoundError: flask` | `pip install -r app/requirements.txt` — the web console's dependency, not the pipeline's. |
| `429 ... tokens per minute (TPM)` / `Please try again in 12.5s` | An ordinary rate limit. The pipeline already handles it: it parses the retry hint, sleeps, and resends. Nothing to do. |
| `429 ... output tokens per minute (OTPM)` / `reduce max_tokens` | Your tier's per-minute **output** ceiling is below what one request asks for. The pipeline reads the advertised `Limit` out of the message, lowers its own ceiling for the rest of the run, and retries immediately — no sleep, because resending an identical oversized request can never succeed. Pin it up front with `AEDI_MAX_OUTPUT_TOKENS=1000` to skip the discovery round-trip. Floor is 256 tokens; below that a response cannot fit the required JSON. |
| The same OTPM error keeps repeating after the ceiling has already dropped | A *different* failure wearing the same message. Once the request already fits, a further OTPM rejection means the minute's output budget is spent, so the fix is to wait rather than shrink. The pipeline now backs off for the rest of the window instead of retrying instantly. If you see it every call, your account supports roughly one call a minute: set `AEDI_MODEL` to a model with a higher allowance, or raise the limit at console.groq.com/settings/billing. |
| Clicking **AEDI decides** in the Live tab spins forever | It no longer can. A live call is capped at `AEDI_LIVE_TIMEOUT` seconds (default 90) and then returns a 504 naming the likely cause. The attempt that overran is left to finish so its answer lands in `.cache/llm_responses/` — your retry is then instant. If it times out repeatedly, check the server log for `OTPM`. |
| `400 tool_use_failed` with `'failed_generation': ''` | Not a prompt problem, despite what the message says. The default model is a reasoning model, and on Groq the output budget is spent on thinking **and** on answering — so a low output ceiling lets it burn the whole budget thinking and emit nothing. The pipeline now detects the empty generation and retries once with `reasoning_effort=none`, which hands the entire budget to the answer. If that also returns nothing it stops instead of retrying, because the configuration cannot work. Pin the behaviour with `AEDI_REASONING_EFFORT`. |
| `400 tool_use_failed` with a populated `failed_generation` | A different failure with the same code: the model *did* answer, it just broke the tool schema. That answer is recovered out of the error body rather than discarded, so it costs nothing. Nothing to do. |
| A live decision comes back as `manual_review` with confidence 0 | Check whether the console shows the red **The model never answered** banner. If it does, that row is the safe fallback after every attempt failed — not a judgement — and the server log has the cause. Without the banner it is a real verdict. |
| The console looks unstyled, or a tab renders blank | `app/static/` is stale or partially deleted. Rebuild it: `cd web && npm install && npm run build`. |
| The Live tab says "Razorpay not connected" | Add `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to `.env` and restart. Both are required. |
| `That is a LIVE Razorpay key (rzp_live_…)` | Deliberate. Generate a key with the Dashboard toggle set to Test. |
| Live tab loads but "Test connection" fails | The message is Razorpay's own. `Authentication failed` means the key/secret pair is wrong or from the other mode; `could not reach Razorpay` means no network route. |
| Checkout popup never opens | `checkout.razorpay.com` is blocked, or the key id is a test key while the dashboard is in live mode. Reuse an existing payment from the list instead. |
| Razorpay webhook returns 401 | `RAZORPAY_WEBHOOK_SECRET` must match the secret set on the webhook in the Dashboard. Unsigned requests are dropped on purpose. |
| Live tab: `The HTTPS connection to Razorpay was cut` | Not your keys. A firewall, HTTPS-inspecting antivirus, or captive-portal wifi is interfering. Confirm with a phone hotspot, or `curl -sSv https://api.razorpay.com -o /dev/null`. |
| Live tab: `Your Python cannot verify HTTPS certificates` | Local Python install, not Razorpay. macOS: run `Install Certificates.command`. Linux: update `ca-certificates`. |
| Live tab: `Razorpay rejected the key id / secret pair` | The secret belongs to a different key id, or one was pasted incomplete. Regenerate **both together** in Dashboard → Settings → API Keys with the toggle on Test. The secret is shown only once. |
| `/api/rzp/*` returns 502 | The body has `cause` and `fix`. `curl -s localhost:8000/api/rzp/payments \| python -m json.tool`, or just run `python scripts/razorpay_doctor.py`. |
