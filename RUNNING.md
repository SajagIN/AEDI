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

Four tabs:

- **Overview** — what the system does, the deterministic-vs-model dividing line, the threat model. The headline numbers are computed live, not hard-coded in the page.
- **Case Explorer** — the actual demo. Pick a case, see its evidence with pipeline-assigned IDs, the reason code's requirement checklist, the deterministic risk signals, and the untrusted merchant narrative. Hit **Replay committed decision** to watch the pipeline trace step through and land on a decision, with the cited evidence highlighted and compared against ground truth.
- **Evaluation** — confusion matrix, precision/recall, coverage and the cost model for the agent and both baselines, all computed in-process by `code/evaluation/main.py`.
- **Adversarial** — the 24 attack fixtures and 10 benign controls, with the defence posture statement, plus an **injection playground**: paste any narrative and run it against a deliberately neutral case whose correct answer is `contest`. If your text moves the decision, the defence just failed in front of you. (The playground needs LIVE mode — in REPLAY it refuses rather than fabricating a verdict.)

Change the port with `PORT=9000 python app/server.py`.

### Rebuilding the console UI

The console is a React + TypeScript + Tailwind app using [shadcn/ui](https://ui.shadcn.com)
component sources, kept in `web/`. **The built bundle is committed to `app/static/`**, so
`python app/server.py` works on a machine with no Node installed — you only need the
toolchain if you want to change the UI.

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
| `--split held_out is refused` | Pass `--i-am-opening-held-out-for-real`. The guard is deliberate. |
| `AlreadyRunningError` from the adversarial suite | A lock file is preventing two overlapping runs from corrupting `results.csv`. Delete `.run_suite.lock` if nothing else is running. |
| `ModuleNotFoundError: flask` | `pip install -r app/requirements.txt` — the web console's dependency, not the pipeline's. |
| `429 ... tokens per minute (TPM)` / `Please try again in 12.5s` | An ordinary rate limit. The pipeline already handles it: it parses the retry hint, sleeps, and resends. Nothing to do. |
| `429 ... output tokens per minute (OTPM)` / `reduce max_tokens` | **Not** a transient limit — resending the identical request can never succeed, because the request's own `max_tokens` exceeds your tier's per-minute output ceiling. The pipeline detects this specific message, reads the advertised `Limit`, permanently lowers its output ceiling for the rest of the run, and retries immediately with no sleep. If you'd rather pin it up front and skip the discovery round-trip, set `AEDI_MAX_OUTPUT_TOKENS=1000` in `.env`. The floor is 256 tokens; below that a response can't fit the required JSON. |
| The console looks unstyled, or a tab renders blank | `app/static/` is stale or partially deleted. Rebuild it: `cd web && npm install && npm run build`. |
