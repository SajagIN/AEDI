#!/usr/bin/env python3
"""Finds out why a live run fell back, one probe at a time.

The pipeline degrades to a safe fallback when the model never returns a usable
answer, and that is deliberate — a chargeback decision should fail toward a
human. But it means the interesting error is three layers down, and "check the
server log" is no help when the run happened in a browser.

So this walks the same path the pipeline walks, in order, and stops at the
first thing that breaks:

  1. is there a key, and does it look like one
  2. does the endpoint accept it
  3. does the configured model exist and answer
  4. does it accept a tools array at all
  5. does it accept the FORCED tool_choice the pipeline relies on, with
     thinking switched off the way the pipeline switches it off

Step 5 is the one that usually bites, and it fails two different ways. A model
without real function-calling support answers a named tool_choice with prose. A
reasoning model that ignores enable_thinking spends the whole allowance
deliberating and returns an empty message — same symptom, opposite fix, and the
doctor tells them apart by looking for reasoning_content.

 Plenty of models on the catalogue will
happily chat, and quite a few will even emit a tool call when they feel like
it, but the pipeline does not ask nicely — the classification round forces
tool_choice to a named function, and a model without real function-calling
support answers that with prose, an empty completion, or a 400.

    python scripts/nim_doctor.py
    python scripts/nim_doctor.py --model qwen/qwen3-next-80b-a3b-instruct
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "code"))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

OK, BAD, WARN = "  ok  ", " FAIL ", " warn "
DEFAULT_MODEL = os.environ.get("AEDI_MODEL", "").strip() or "meta/llama-3.3-70b-instruct"
BASE_URL = os.environ.get("AEDI_BASE_URL", "").strip() or "https://integrate.api.nvidia.com/v1"

PROBE_TOOL = {
    "type": "function",
    "function": {
        "name": "classify_chargeback",
        "description": "Return the decision for this chargeback.",
        "parameters": {
            "type": "object",
            "properties": {"decision": {"type": "string",
                                        "enum": ["contest", "accept_liability", "manual_review"]}},
            "required": ["decision"],
        },
    },
}


def short(e, limit=400):
    text = str(e).replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()
    model = args.model
    print(f"\nNIM doctor — {BASE_URL}\n            model: {model}\n")

    # ── 1. the key ────────────────────────────────────────────────────────
    keys = {k: v for k, v in os.environ.items()
            if re.fullmatch(r"NVIDIA_API_KEY(_\d+)?", k) and v}
    if not keys:
        print(f"{BAD} no NVIDIA_API_KEY found in .env or the environment.")
        print("       Get one at https://build.nvidia.com and put it in .env as")
        print("       NVIDIA_API_KEY=nvapi-...")
        return 1
    print(f"{OK} {len(keys)} key(s): {', '.join(sorted(keys))}")
    for name, value in sorted(keys.items()):
        if not value.startswith("nvapi-"):
            print(f"{WARN} {name} does not start with 'nvapi-'. NIM keys do. "
                  f"If this is a key for another provider it will fail at step 2.")

    try:
        from openai import OpenAI
    except ImportError:
        print(f"{BAD} the openai package is not installed.  pip install -r requirements.txt")
        return 1

    client = OpenAI(api_key=sorted(keys.items())[0][1], base_url=BASE_URL)

    # ── 2. auth ───────────────────────────────────────────────────────────
    try:
        listed = client.models.list()
        names = [m.id for m in listed.data]
        print(f"{OK} endpoint accepted the key — {len(names)} model(s) visible")
    except Exception as e:
        print(f"{BAD} the endpoint rejected the key: {short(e)}")
        print("       A 401 here means the key is wrong, revoked, or from another provider.")
        return 1

    if names and model not in names:
        near = [n for n in names if model.split("/")[-1].split("-")[0] in n][:6]
        print(f"{WARN} '{model}' is not in the visible catalogue.")
        if near:
            print(f"       Closest visible: {', '.join(near)}")
        print(f"       Set AEDI_MODEL to one that is listed, or pass --model.")

    # ── 3. plain completion ───────────────────────────────────────────────
    try:
        r = client.chat.completions.create(
            model=model, max_tokens=16, temperature=0,
            messages=[{"role": "user", "content": "Reply with the single word: ready"}])
        print(f"{OK} model answered: {(r.choices[0].message.content or '').strip()[:40]!r}")
    except Exception as e:
        print(f"{BAD} the model would not answer a plain prompt: {short(e)}")
        print("       If this is a 404, the model name is wrong. If it is a 403, your")
        print("       account may not have access to this model.")
        return 1

    # ── 4. tools offered ──────────────────────────────────────────────────
    try:
        r = client.chat.completions.create(
            model=model, max_tokens=128, temperature=0, tools=[PROBE_TOOL], tool_choice="auto",
            messages=[{"role": "user",
                       "content": "Evidence is complete and nothing is anomalous. Classify it."}])
        calls = r.choices[0].message.tool_calls or []
        print(f"{OK} model accepts a tools array ({len(calls)} call(s) offered voluntarily)")
    except Exception as e:
        print(f"{BAD} the model rejected a tools array outright: {short(e)}")
        print("       This model cannot drive the pipeline. Pick one advertised as")
        print("       supporting function calling and set AEDI_MODEL to it.")
        return 1

    # ── 5. the forced call the pipeline actually makes ───────────────────
    # Thinking off, exactly as the pipeline sends it. On a reasoning model the
    # same allowance pays for deliberation and for the answer, and a forced
    # single-function call has no essay to write.
    try:
        r = client.chat.completions.create(
            model=model, max_tokens=256, temperature=0, tools=[PROBE_TOOL],
            tool_choice={"type": "function", "function": {"name": "classify_chargeback"}},
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            messages=[{"role": "user",
                       "content": "Evidence is complete and nothing is anomalous. Classify it."}])
        msg = r.choices[0].message
        calls = msg.tool_calls or []
        reasoning = getattr(msg, "reasoning_content", None) or ""
        if not calls:
            print(f"{BAD} forced tool_choice returned NO tool call.")
            print(f"       content was:   {(msg.content or '')[:160]!r}")
            if reasoning:
                print(f"       reasoning was: {reasoning[:160]!r}")
                print(f"       finish reason: {r.choices[0].finish_reason}")
                print("       This model reasoned instead of answering, and the budget went")
                print("       with it. It ignored enable_thinking=false.")
                print("       Fix: raise the budget so it can afford both —")
                print("            AEDI_MAX_OUTPUT_TOKENS=16384  AEDI_ENABLE_THINKING=1")
                print("       or pick a model that honours the switch.")
            else:
                print("       This is the failure behind the safe fallback. The")
                print("       classification round forces a named function and this model")
                print("       answered with prose instead.")
                print("       Fix: set AEDI_MODEL to a model with real function-calling support.")
            return 1
        args_json = calls[0].function.arguments
        json.loads(args_json)
        print(f"{OK} forced tool_choice works — arguments: {args_json[:120]}")
    except Exception as e:
        print(f"{BAD} forced tool_choice failed: {short(e)}")
        print("       Some catalogue models accept tools but reject a named tool_choice.")
        print("       Fix: set AEDI_MODEL to a model that supports it.")
        return 1

    print("\nAll five probes passed. This model can drive the pipeline.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
