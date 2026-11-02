"""Accrual estimate: how likely is it that a proposed accrual will be corrected, and between which amounts will the invoice land.

Training data is synthetic: the real ratio of final invoice to proposed accrual is drawn with a wider spread for
low-confidence accruals and for lines that are hard to estimate (legal, delivery partners, personnel).
"""

from __future__ import annotations

import threading

import numpy as np

from quantile import LEVELS, QuantileModel, probability_above, train_quantile

LINES = ["cloud", "license", "services", "hosting", "delivery", "personnel", "marketing", "travel", "it", "legal", "da", "other"]
ENTITIES = ["DE10", "FR10", "UK10", "US10"]
CONFIDENCE = {"high": 0, "medium": 1, "low": 2}
FEATURES = ["amount_log", "line", "entity", "confidence", "age_wd"]
CATEGORICAL = [1, 2]
TOLERANCE = 0.10  # "corrected" means the final amount differs by more than 10 %
_BIAS = {"legal": 0.08, "personnel": -0.03, "travel": -0.04, "delivery": 0.02, "hosting": 0.03}
_SPREAD = {"legal": 1.8, "delivery": 1.4, "personnel": 1.3, "other": 1.5, "marketing": 1.2, "hosting": 1.1}
_BY_CONFIDENCE = [0.04, 0.11, 0.24]
_STATE: dict[str, QuantileModel] = {}
_LOCK = threading.Lock()


def _row(amount_k: float, line: str, entity: str, confidence: str, age_wd: float) -> list[float]:
    return [float(np.log(max(amount_k, 1.0))), LINES.index(line) if line in LINES else len(LINES), ENTITIES.index(entity) if entity in ENTITIES else len(ENTITIES), CONFIDENCE.get(confidence, 1), age_wd]


def generate_history(n: int = 600, seed: int = 13) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    rows, ratio = [], []
    for _ in range(n):
        line, entity = rng.choice(LINES), rng.choice(ENTITIES)
        conf = rng.choice(list(CONFIDENCE), p=[0.4, 0.4, 0.2])
        amount, age = float(np.exp(rng.normal(4.2, 1.1))), float(rng.integers(0, 8))
        sd = _BY_CONFIDENCE[CONFIDENCE[conf]] * _SPREAD.get(str(line), 1.0) * (1 + 0.04 * age) * (1 + 0.05 * max(0.0, np.log(amount) - 4))
        rows.append(_row(amount, str(line), str(entity), conf, age))
        ratio.append(float(np.exp(_BIAS.get(str(line), 0.0) + rng.normal(0, sd))))
    return np.array(rows), np.array(ratio)


def model() -> QuantileModel:
    with _LOCK:
        if "m" not in _STATE:
            x, y = generate_history()
            _STATE["m"] = train_quantile(x, y, CATEGORICAL)
        return _STATE["m"]


def estimate(accruals: list[dict], as_of_wd: int) -> dict:
    """accruals: [{id, entity, line, amountK, confidence, fromWd}]; returns the interval of the final amount for each."""
    m = model()
    quantiles = m.quantiles(np.array([_row(a["amountK"], a["line"], a["entity"], a.get("confidence", "medium"), max(0, as_of_wd - int(a.get("fromWd", as_of_wd)))) for a in accruals])) if accruals else np.zeros((0, len(LEVELS)))
    items = []
    for a, q in zip(accruals, quantiles):
        amount = float(a["amountK"])
        low, high = 1 - TOLERANCE, 1 + TOLERANCE
        risk = round(min(1.0, (1 - probability_above(list(q), low)) + probability_above(list(q), high)), 3)
        items.append({
            "id": a["id"], "entity": a["entity"], "line": a["line"], "amountK": round(amount),
            "p10K": round(float(q[1]) * amount), "p50K": round(float(q[3]) * amount), "p90K": round(float(q[5]) * amount),
            "correctionProbability": risk,
            "risk": "high" if risk >= 0.5 else "medium" if risk >= 0.25 else "low",
        })
    items.sort(key=lambda i: -i["correctionProbability"])
    return {"engine": m.engine, "engineNote": m.note, "trainedOn": f"{m.training_rows} synthetic accruals", "band": "80 % interval (10th to 90th percentile)", "tolerancePct": int(TOLERANCE * 100), "asOfWd": as_of_wd, "count": len(items), "items": items}
