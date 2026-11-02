"""Budget forecast per cost group: where will the month end, with an uncertainty band, and how likely is an overrun.

Training data is synthetic. A group is described by its spend so far this month, how far into the month we are and its
last months' month-end spend (all as a share of the monthly budget).
"""

from __future__ import annotations

import threading

import numpy as np

from quantile import LEVELS, QuantileModel, probability_above, train_quantile

FEATURES = ["day_frac", "mtd_ratio", "run_rate_ratio", "hist_mean", "hist_last", "hist_trend", "hist_vol"]
_STATE: dict[str, QuantileModel] = {}
_LOCK = threading.Lock()


def generate_history(n: int = 500, seed: int = 11) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    level = rng.uniform(0.25, 1.15, n)
    trend = rng.normal(0.01, 0.03, n)
    vol = rng.uniform(0.02, 0.09, n)
    months = np.arange(-6, 0)
    hist = level[:, None] + trend[:, None] * months[None, :] + rng.normal(0, 1, (n, 6)) * vol[:, None]
    end = level + trend * 0.5 + rng.normal(0, 1, n) * vol
    day_frac = rng.uniform(0.45, 0.97, n)
    mtd = np.clip(end * (day_frac + rng.normal(0, 0.035, n)), 0.01, None)
    x = np.column_stack([day_frac, mtd, mtd / day_frac, hist.mean(1), hist[:, -1], _slope(hist), hist.std(1)])
    return x, end


def _slope(hist: np.ndarray) -> np.ndarray:
    k = np.arange(hist.shape[1]) - (hist.shape[1] - 1) / 2
    return (hist * k).sum(1) / (k**2).sum()


def model() -> QuantileModel:
    with _LOCK:
        if "m" not in _STATE:
            x, y = generate_history()
            _STATE["m"] = train_quantile(x, y)
        return _STATE["m"]


def forecast(groups: list[dict], day: int, days_in_month: int) -> dict:
    """groups: [{name, budgetK, mtdK, historyK: [month-end spend of earlier months]}]"""
    m = model()
    day_frac = min(max(day / days_in_month, 0.05), 1.0)
    rows, kept = [], []
    for g in groups:
        budget = float(g["budgetK"])
        if budget <= 0:
            continue
        hist = np.array([float(v) / budget for v in g.get("historyK", [])][-6:])
        if len(hist) < 3:
            hist = np.full(6, float(g["mtdK"]) / budget / day_frac)  # no history: assume the current run rate
        elif len(hist) < 6:
            hist = np.concatenate([np.full(6 - len(hist), hist[0]), hist])
        mtd = float(g["mtdK"]) / budget
        rows.append([day_frac, mtd, mtd / day_frac, hist.mean(), hist[-1], _slope(hist[None, :])[0], hist.std()])
        kept.append((g, budget, mtd))
    quantiles = m.quantiles(np.array(rows)) if rows else np.zeros((0, len(LEVELS)))
    items = []
    for (g, budget, mtd), q in zip(kept, quantiles):
        q = np.maximum(q, mtd)  # month-end spend cannot be below what is already booked
        k = [round(float(v) * budget) for v in q]
        over = probability_above(list(q), 1.0)
        items.append({
            "name": g["name"],
            "budgetK": round(budget),
            "spentK": round(mtd * budget),
            "runRateK": round(mtd / day_frac * budget),
            "p10K": k[1], "p50K": k[3], "p90K": k[5],
            "p50Pct": round(float(q[3]) * 100), "p10Pct": round(float(q[1]) * 100), "p90Pct": round(float(q[5]) * 100),
            "overrunProbability": over,
            "status": "likely over" if over >= 0.6 else "at risk" if over >= 0.25 else "on track",
        })
    items.sort(key=lambda i: -i["overrunProbability"])
    return {"engine": m.engine, "engineNote": m.note, "trainedOn": f"{m.training_rows} synthetic group-months", "band": "80 % band (10th to 90th percentile)", "day": day, "daysInMonth": days_in_month, "count": len(items), "items": items}
