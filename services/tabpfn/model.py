"""Late-payment model: TabPFN when it is installed and its weights load, otherwise a gradient-boosting baseline.

The engine that actually ran is always reported back (`engine`, `engine_note`), so a demo never claims TabPFN
when the fallback produced the numbers.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import OrdinalEncoder

from synthetic import BILLING_CYCLES, CATEGORICAL, FEATURES, PRODUCT_FAMILIES, generate_history

LABELS = {
    "amount_log": "Invoice amount",
    "terms_days": "Payment term",
    "billing_cycle": "Billing cycle",
    "family": "Product family",
    "issue_month": "Issue month (year-end effect)",
    "cust_avg_delay": "Customer's usual delay",
    "cust_late_rate": "Customer's share of late payments",
    "cust_open_count": "Number of open invoices",
}


@dataclass
class Prediction:
    probability: float
    drivers: list[dict]


class LateModel:
    def __init__(self, engine: str, note: str, estimator, encoder: OrdinalEncoder, history: pd.DataFrame):
        self.engine = engine
        self.note = note
        self._estimator = estimator
        self._encoder = encoder
        self._reference = history[FEATURES].median(numeric_only=True).to_dict()
        self._reference.update({c: history[c].mode().iloc[0] for c in CATEGORICAL})
        self.training_rows = len(history)
        self._lock = threading.Lock()

    def _encode(self, frame: pd.DataFrame) -> np.ndarray:
        out = frame[FEATURES].copy()
        out[CATEGORICAL] = self._encoder.transform(out[CATEGORICAL])
        return out.to_numpy(dtype=float)

    def _proba(self, frame: pd.DataFrame) -> np.ndarray:
        with self._lock:
            return self._estimator.predict_proba(self._encode(frame))[:, 1]

    def predict(self, frame: pd.DataFrame, top: int = 3) -> list[Prediction]:
        if frame.empty:
            return []
        base = self._proba(frame)
        # Driver = how much the score drops when one feature is set to the typical value of the history.
        # Cheap and model-agnostic; it explains this score, it is not a causal statement.
        shifts = np.zeros((len(frame), len(FEATURES)))
        for j, name in enumerate(FEATURES):
            neutral = frame.copy()
            neutral[name] = self._reference[name]
            shifts[:, j] = base - self._proba(neutral)
        results = []
        for i, p in enumerate(base):
            order = np.argsort(-np.abs(shifts[i]))[:top]
            drivers = [
                {"feature": FEATURES[j], "label": LABELS[FEATURES[j]], "value": _plain(frame.iloc[i][FEATURES[j]]), "effectPct": round(float(shifts[i, j]) * 100, 1)}
                for j in order
                if abs(shifts[i, j]) >= 0.01
            ]
            results.append(Prediction(probability=float(p), drivers=drivers))
        return results


def _plain(value):
    if isinstance(value, (np.floating, float)):
        return round(float(value), 2)
    if isinstance(value, (np.integer, int)):
        return int(value)
    return str(value)


def _encoder() -> OrdinalEncoder:
    enc = OrdinalEncoder(categories=[BILLING_CYCLES, PRODUCT_FAMILIES], handle_unknown="use_encoded_value", unknown_value=-1)
    enc.fit(pd.DataFrame({"billing_cycle": BILLING_CYCLES + [BILLING_CYCLES[0]] * (len(PRODUCT_FAMILIES) - len(BILLING_CYCLES)), "family": PRODUCT_FAMILIES}))
    return enc


def _fit_tabpfn(x: np.ndarray, y: np.ndarray):
    from tabpfn import TabPFNClassifier  # imported lazily: heavy, optional

    device = os.environ.get("TABPFN_DEVICE", "cpu")
    model = TabPFNClassifier(device=device, categorical_features_indices=[2, 3], random_state=0)
    model.fit(x, y)
    return model


def train(engine: str | None = None, rows: int = 600, seed: int = 7) -> LateModel:
    wanted = (engine or os.environ.get("TABPFN_ENGINE", "auto")).lower()
    history = generate_history(rows, seed)
    enc = _encoder()
    x = history[FEATURES].copy()
    x[CATEGORICAL] = enc.transform(x[CATEGORICAL])
    x, y = x.to_numpy(dtype=float), history["late"].to_numpy()

    note = ""
    if wanted in ("auto", "tabpfn"):
        try:
            estimator = _fit_tabpfn(x, y)
            return LateModel("tabpfn", "TabPFN foundation model, in-context on synthetic history.", estimator, enc, history)
        except Exception as error:  # missing package, weights not accepted/downloadable, no GPU memory, ...
            if wanted == "tabpfn":
                raise RuntimeError(f"TabPFN requested but not available: {error}") from error
            note = f"TabPFN not available ({type(error).__name__}: {str(error)[:160]}); using the gradient-boosting baseline."
    estimator = HistGradientBoostingClassifier(max_depth=4, learning_rate=0.08, max_iter=150, random_state=0).fit(x, y)
    return LateModel("baseline", note or "Gradient-boosting baseline (TABPFN_ENGINE=baseline).", estimator, enc, history)
