"""Synthetic invoice history for the late-payment demo.

Nothing here is real customer data. The generator draws invoices for a made-up set of customers and decides
whether each one was paid more than LATE_DAYS after the due date, using a simple rule plus noise. The model
learns that rule back from the table, which is exactly what makes a small-data demo easy to follow.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

LATE_DAYS = 14

PRODUCT_FAMILIES = ["erp", "platform", "analytics", "procurement", "commerce", "ai_units", "other"]
BILLING_CYCLES = ["annual", "quarterly", "monthly"]

FEATURES = [
    "amount_log",
    "terms_days",
    "billing_cycle",
    "family",
    "issue_month",
    "cust_avg_delay",
    "cust_late_rate",
    "cust_open_count",
]
CATEGORICAL = ["billing_cycle", "family"]


def generate_history(n: int = 600, seed: int = 7) -> pd.DataFrame:
    """Return `n` historic invoices with the same features the live scoring computes, plus `late` (0/1)."""
    rng = np.random.default_rng(seed)
    n_customers = 40
    # Every customer has a stable payment habit: how many days after the due date it usually pays.
    habit = rng.gamma(shape=1.6, scale=4.0, size=n_customers) - 4.0
    customer = rng.integers(0, n_customers, size=n)

    amount = np.exp(rng.normal(11.6, 1.1, size=n))  # median around 110k EUR
    terms = rng.choice([14, 30, 45, 60], size=n, p=[0.1, 0.6, 0.2, 0.1])
    cycle = rng.choice(BILLING_CYCLES, size=n, p=[0.55, 0.35, 0.10])
    family = rng.choice(PRODUCT_FAMILIES, size=n, p=[0.2, 0.2, 0.15, 0.15, 0.1, 0.12, 0.08])
    month = rng.integers(1, 13, size=n)
    open_count = rng.poisson(1.2, size=n)

    cust_avg = habit[customer] + rng.normal(0, 1.5, size=n)
    cust_late_rate = np.clip(1 / (1 + np.exp(-(cust_avg - 6) / 3)) + rng.normal(0, 0.05, size=n), 0, 1)

    delay = (
        cust_avg
        + 3.0 * (np.log(amount) - 11.6)  # big invoices go through more approvals
        + 0.08 * (terms - 30)
        + np.where(cycle == "annual", 2.5, 0.0)
        + np.where(np.isin(month, [12, 1]), 4.0, 0.0)  # year-end closing
        + 1.2 * open_count
        + np.where(family == "other", 2.0, 0.0)
        + rng.normal(0, 4.0, size=n)
    )

    frame = pd.DataFrame(
        {
            "amount_log": np.log(amount),
            "terms_days": terms,
            "billing_cycle": cycle,
            "family": family,
            "issue_month": month,
            "cust_avg_delay": cust_avg,
            "cust_late_rate": cust_late_rate,
            "cust_open_count": open_count,
        }
    )
    frame["late"] = (delay > LATE_DAYS).astype(int)
    return frame
