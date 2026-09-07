
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SERPAPI_ENDPOINT = "https://serpapi.com/search.json"

CACHE_DIR = Path(__file__).parent.parent / ".cache" / "merchant_intel"

CACHE_TTL_SECONDS = 24 * 60 * 60

DEFAULT_TIMEOUT_SECONDS = 12

THRESHOLD_ELEVATED = 5
THRESHOLD_SOME = 1

COMPLAINT_DOMAINS = (
    "consumercomplaints.in",
    "complaintboard.in",
    "mouthshut.com",
    "trustpilot.com",
    "reddit.com",
    "quora.com",
    "consumerhelpline.gov.in",
    "grahakseva.com",
    "ripoffreport.com",
    "sitejabber.com",
)

COMPLAINT_TERMS = (
    "complaint", "scam", "fraud", "cheated", "not delivered", "never received",
    "no refund", "refund not", "fake", "duped", "money not returned",
)


class MerchantIntelUnavailable(Exception):
    pass


def has_api_key(env=None):
    env = os.environ if env is None else env
    return bool((env.get("SERPAPI_KEY") or "").strip())


def _cache_path(query):
    digest = hashlib.sha256(query.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def _cache_get(query):
    path = _cache_path(query)
    if not path.exists():
        return None
    try:
        blob = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if time.time() - blob.get("fetched_at", 0) > CACHE_TTL_SECONDS:
        return None
    return blob.get("payload")


def _cache_put(query, payload):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(query).write_text(
        json.dumps({"fetched_at": time.time(), "payload": payload}, ensure_ascii=False),
        encoding="utf-8",
    )


def build_query(merchant_name):
    name = (merchant_name or "").strip()
    if not name:
        raise MerchantIntelUnavailable("merchant name is empty")
    terms = " OR ".join(f'"{t}"' for t in ("complaint", "scam", "fraud", "not delivered", "refund not received"))
    return f'"{name}" ({terms})'


def _fetch(query, api_key, timeout=DEFAULT_TIMEOUT_SECONDS, opener=None):
    params = urllib.parse.urlencode({
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "num": 20,
        "hl": "en",
        "gl": "in",
    })
    url = f"{SERPAPI_ENDPOINT}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "AEDI/1.0"})
    try:
        _open = opener or urllib.request.urlopen
        with _open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        if e.code in (401, 403):
            raise MerchantIntelUnavailable(
                f"SerpAPI rejected the key (HTTP {e.code}). {detail}".strip()) from e
        if e.code == 429:
            raise MerchantIntelUnavailable(
                "SerpAPI monthly search quota is exhausted.") from e
        raise MerchantIntelUnavailable(f"SerpAPI returned HTTP {e.code}. {detail}".strip()) from e
    except urllib.error.URLError as e:
        raise MerchantIntelUnavailable(f"could not reach SerpAPI: {e.reason}") from e
    except (json.JSONDecodeError, ValueError) as e:
        raise MerchantIntelUnavailable(f"SerpAPI returned something that was not JSON: {e}") from e


def _domain_of(link):
    try:
        return (urllib.parse.urlparse(link or "").netloc or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def classify_results(organic_results):
    hits, others = [], []
    for r in organic_results or []:
        link = r.get("link", "")
        domain = _domain_of(link)
        text = f"{r.get('title', '')} {r.get('snippet', '')}".lower()
        on_complaint_site = any(domain.endswith(d) for d in COMPLAINT_DOMAINS)
        has_term = any(t in text for t in COMPLAINT_TERMS)
        record = {
            "title": r.get("title", ""),
            "link": link,
            "domain": domain,
            "snippet": r.get("snippet", ""),
            "on_complaint_site": on_complaint_site,
            "matched_terms": sorted({t for t in COMPLAINT_TERMS if t in text}),
        }
        (hits if (on_complaint_site or has_term) else others).append(record)
    return hits, others


def signal_for(n_hits):
    if n_hits >= THRESHOLD_ELEVATED:
        return "elevated"
    if n_hits >= THRESHOLD_SOME:
        return "some"
    return "clear"


def look_up(merchant_name, env=None, opener=None, use_cache=True):
    env = os.environ if env is None else env
    api_key = (env.get("SERPAPI_KEY") or "").strip()
    if not api_key:
        raise MerchantIntelUnavailable(
            "no SERPAPI_KEY in .env — add one from https://serpapi.com to enable this panel")

    query = build_query(merchant_name)

    cached = _cache_get(query) if use_cache else None
    payload = cached if cached is not None else _fetch(query, api_key, opener=opener)
    if cached is None and use_cache:
        _cache_put(query, payload)

    if isinstance(payload, dict) and payload.get("error"):
        raise MerchantIntelUnavailable(f"SerpAPI: {payload['error']}")

    hits, others = classify_results((payload or {}).get("organic_results"))
    signal = signal_for(len(hits))
    return {
        "merchant_name": merchant_name,
        "query": query,
        "signal": signal,
        "n_complaint_results": len(hits),
        "n_other_results": len(others),
        "results": hits[:10],
        "cached": cached is not None,
        "escalate_only": True,
        "advisory": (
            "Unverified public search results. This signal may route a case to a "
            "human reviewer and may never clear one, decide one, or label a business."
        ),
    }


def escalate_only(decision, signal):
    if signal == "elevated" and decision in ("contest", "accept_liability"):
        return "manual_review", True
    return decision, False
