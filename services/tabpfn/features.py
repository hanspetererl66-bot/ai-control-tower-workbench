"""Turn a customer's invoice list (as the Sub4Me portfolio has it) into the model's feature table."""

from __future__ import annotations

import math
from datetime import date

import pandas as pd

from synthetic import BILLING_CYCLES, LATE_DAYS, PRODUCT_FAMILIES

FAMILY_KEYWORDS = [
    ("erp", ("s/4hana", "erp")),
    ("platform", ("business technology platform", "btp", "integration suite", "ai core")),
    ("analytics", ("analytics",)),
    ("procurement", ("ariba", "procurement")),
    ("commerce", ("commerce",)),
    ("ai_units", ("ai units", "joule", "document ai")),
]


def family_of(text: str) -> str:
    lowered = (text or "").lower()
    for family, words in FAMILY_KEYWORDS:
        if any(word in lowered for word in words):
            return family
    return "other"


def cycle_of(text: str) -> str:
    lowered = (text or "").lower()
    if "quarter" in lowered:
        return "quarterly"
    if "month" in lowered:
        return "monthly"
    return "annual"


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def customer_habit(invoices: list[dict]) -> tuple[float, float]:
    """Average days paid after due date, and share paid more than LATE_DAYS late, over the invoices already paid."""
    delays = []
    for invoice in invoices:
        if invoice.get("type", "Invoice") != "Invoice":
            continue
        due, paid = _date(invoice.get("due")), _date(invoice.get("paidOn"))
        if due and paid:
            delays.append((paid - due).days)
    if not delays:
        return 0.0, 0.0
    return sum(delays) / len(delays), sum(1 for d in delays if d > LATE_DAYS) / len(delays)


def open_invoices(invoices: list[dict]) -> list[dict]:
    return [i for i in invoices if i.get("type", "Invoice") == "Invoice" and i.get("status") in ("Open", "Overdue")]


def build_features(invoices: list[dict], as_of: date) -> tuple[list[dict], pd.DataFrame]:
    """Return (open invoices, one feature row per open invoice)."""
    avg_delay, late_rate = customer_habit(invoices)
    todo = open_invoices(invoices)
    rows = []
    for invoice in todo:
        issued, due = _date(invoice.get("issued")), _date(invoice.get("due"))
        terms = (due - issued).days if issued and due else 30
        gross = max(float(invoice.get("grossEur") or invoice.get("netEur") or 1.0), 1.0)
        text = f"{invoice.get('description', '')} {invoice.get('period', '')}"
        cycle = cycle_of(text)
        rows.append(
            {
                "amount_log": math.log(gross),
                "terms_days": terms,
                "billing_cycle": cycle if cycle in BILLING_CYCLES else "annual",
                "family": family_of(text),
                "issue_month": issued.month if issued else as_of.month,
                "cust_avg_delay": avg_delay,
                "cust_late_rate": late_rate,
                "cust_open_count": len(todo),
            }
        )
    frame = pd.DataFrame(rows, columns=["amount_log", "terms_days", "billing_cycle", "family", "issue_month", "cust_avg_delay", "cust_late_rate", "cust_open_count"])
    return todo, frame


assert set(PRODUCT_FAMILIES) >= {family for family, _ in FAMILY_KEYWORDS}
