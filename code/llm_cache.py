
import hashlib
import json
from pathlib import Path
from typing import Optional

CACHE_DIR = Path(__file__).parent.parent / ".cache" / "llm_responses"


def _key_for(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class ResponseCache:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.hits = 0
        self.misses = 0

    def get(self, payload: dict) -> Optional[dict]:
        path = self.dir / f"{_key_for(payload)}.json"
        if not path.exists():
            self.misses += 1
            return None
        try:
            self.hits += 1
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            self.misses += 1
            return None

    def put(self, payload: dict, response: dict) -> None:
        path = self.dir / f"{_key_for(payload)}.json"
        path.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")

    def stats(self) -> str:
        total = self.hits + self.misses
        rate = (self.hits / total * 100) if total else 0.0
        return f"cache: {self.hits}/{total} hits ({rate:.0f}%)"
