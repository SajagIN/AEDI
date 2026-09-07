
PLATFORM_BASELINE_CHARGEBACK_RATE = 0.6

AMOUNT_ANOMALY_TOLERANCE = 0.01


def parse_evidence_items(row: dict) -> list:
    raw = (row.get("evidence_items") or "").strip()
    if not raw:
        return []
    items = []
    for i, chunk in enumerate([c.strip() for c in raw.split("|") if c.strip()], 1):
        if ":" in chunk:
            tag, desc = chunk.split(":", 1)
            tag, desc = tag.strip(), desc.strip()
        else:
            tag, desc = "unknown", chunk
        items.append({"evidence_id": f"ev_{i}", "type": tag, "description": desc})
    return items


def required_evidence_types(req_row: dict) -> set:
    raw = (req_row.get("required_evidence_types") or "").strip()
    return {t.strip() for t in raw.split("|") if t.strip()}


def evidence_sufficiency(evidence_items: list, required_types: set) -> tuple:
    if not evidence_items:
        return "not_enough_information", sorted(required_types)
    present = {item["type"] for item in evidence_items}
    missing = required_types - present
    if missing:
        return "insufficient", sorted(missing)
    return "sufficient", []


def is_amount_anomaly(row: dict) -> bool:
    try:
        amount = float(row.get("amount", 0))
        original = float(row.get("original_amount", amount))
    except (TypeError, ValueError):
        return False
    if amount > original + AMOUNT_ANOMALY_TOLERANCE:
        return True
    return abs(amount - original) > AMOUNT_ANOMALY_TOLERANCE and amount != original


def is_merchant_repeat_pattern(merchant_row: dict, baseline: float = PLATFORM_BASELINE_CHARGEBACK_RATE) -> bool:
    try:
        rate = float(merchant_row.get("chargeback_rate_90d", 0))
        win_rate = float(merchant_row.get("prior_contest_win_rate", 1))
    except (TypeError, ValueError):
        return False
    return rate > baseline and win_rate < 0.4
