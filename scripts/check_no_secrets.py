
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

PATTERNS = [
    ("Gemini API key", re.compile(r"AIza[A-Za-z0-9_\-]{20,}")),
    ("Groq API key (legacy)", re.compile(r"gsk_[A-Za-z0-9]{20,}")),
    ("Payment gateway API key", re.compile(r"rzp_(live|test)_[A-Za-z0-9]{10,}")),
    ("AWS access key ID", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Private key block", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----")),
]

PLACEHOLDER_LOOKALIKES = re.compile(
    r"^(your[_-]?key.*|xxx+|changeme|placeholder|<.*>|\.\.\.|example|none|null|test|dummy"
    r"|[A-Za-z][A-Za-z0-9_-]{0,15}[-_]?\.\.\.)$",
    re.IGNORECASE,
)

NON_SECRET_SHAPES = re.compile(
    r"""^(
          [-+]?\d[\d_]*(\.\d+)?      # 1000, 1_000, 2.5
        | (0[xXbBoO])[0-9A-Fa-f_]+   # 0x1f
        | [Tt]rue | [Ff]alse | None
        | [A-Za-z_][A-Za-z0-9_.]*\(.*  # a call: int(...), os.getenv(...)
        | _?[A-Z][A-Z0-9_]*          # another CONSTANT_NAME being aliased
        | \{[^}]+\}                  # an f-string hole: RAZORPAY_KEY_SECRET={VAR}
    )$""",
    re.VERBOSE,
)

ASSIGNMENT_PATTERN = re.compile(
    r"""(?P<name>[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*["']?(?P<value>[^\s"'#]+)""",
)

ALLOWED_PLACEHOLDER_FILES = {".env.example"}

#   2. The line carries an explicit `pragma: allowlist-fake` comment.
FAKE_MARKERS = re.compile(
    r"(your[_-]|fake|example|placeholder|dummy|redacted|changeme|do[_-]?not[_-]?use|_here\b|x{4,})",
    re.IGNORECASE,
)

ALLOWLIST_PRAGMA = "pragma: allowlist-fake"

SKIP_DIRS = {".git", ".venv", "venv", "__pycache__", ".cache", "node_modules", ".pytest_cache"}


def _line_of(text: str, index: int) -> str:
    start = text.rfind("\n", 0, index) + 1
    end = text.find("\n", index)
    return text[start:end if end != -1 else len(text)]


def _is_obviously_fake(value: str, line: str) -> bool:
    return bool(FAKE_MARKERS.search(value)) or ALLOWLIST_PRAGMA in line


def get_staged_files() -> list:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return [REPO_ROOT / f for f in result.stdout.splitlines() if f]


def get_all_files() -> list:
    out = []
    for p in REPO_ROOT.rglob("*"):
        if p.is_file() and not any(part in SKIP_DIRS for part in p.parts):
            out.append(p)
    return out


def scan_file(path: Path) -> list:
    findings = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return findings

    for name, pattern in PATTERNS:
        for m in pattern.finditer(text):
            if _is_obviously_fake(m.group(0), _line_of(text, m.start())):
                continue
            findings.append(f"{path.relative_to(REPO_ROOT)}: possible {name} ({m.group(0)[:12]}...)")

    if path.name not in ALLOWED_PLACEHOLDER_FILES:
        for m in ASSIGNMENT_PATTERN.finditer(text):
            value = m.group("value").strip("\"'")
            if (
                value
                and not PLACEHOLDER_LOOKALIKES.match(value)
                and not NON_SECRET_SHAPES.match(value)
                and not _is_obviously_fake(value, _line_of(text, m.start()))
                and len(value) >= 8
            ):

                findings.append(
                    f"{path.relative_to(REPO_ROOT)}: {m.group('name')} assigned a non-placeholder-looking value"
                )
    return findings


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--all":
        files = get_all_files()
    elif args:
        files = [Path(a).resolve() for a in args]
    else:
        files = get_staged_files()

    all_findings = []
    for f in files:
        if f.exists() and f.is_file():
            all_findings.extend(scan_file(f))

    if all_findings:
        print("check_no_secrets: possible secret(s) found — commit blocked:\n")
        for finding in all_findings:
            print(f"  - {finding}")
        print("\nIf this is a genuine false positive, fix the pattern in scripts/check_no_secrets.py")
        print("rather than committing anyway — the point is nothing gets through unreviewed.")
        return 1

    print(f"check_no_secrets: {len(files)} file(s) scanned, nothing found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
