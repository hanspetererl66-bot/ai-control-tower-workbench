"""Quantile regression shared by the budget forecast and the accrual estimate.

Engine: TabPFN regressor when it is installed and its weights load, otherwise one gradient-boosting model per quantile.
The engine that actually ran is reported back, like in the late-payment model. The TabPFN call
(`predict(..., output_type="quantiles", quantiles=[...])`) follows the tabpfn 2.x documentation but has NOT been run
against the real weights from the cloud sandbox; if it fails while the model is being set up, the baseline is used and
the note says so.
"""

from __future__ import annotations

import os
import threading

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]


class QuantileModel:
    def __init__(self, engine: str, note: str, predict_fn, rows: int):
        self.engine = engine
        self.note = note
        self.training_rows = rows
        self._predict = predict_fn
        self._lock = threading.Lock()

    def quantiles(self, x: np.ndarray) -> np.ndarray:
        """Return an (n, len(LEVELS)) array, each row sorted so the quantiles never cross."""
        if len(x) == 0:
            return np.zeros((0, len(LEVELS)))
        with self._lock:
            out = np.asarray(self._predict(np.asarray(x, dtype=float)), dtype=float)
        return np.sort(out, axis=1)


def _tabpfn_predict(x: np.ndarray, y: np.ndarray, categorical: list[int]):
    from tabpfn import TabPFNRegressor  # lazy: heavy and optional

    model = TabPFNRegressor(device=os.environ.get("TABPFN_DEVICE", "cpu"), categorical_features_indices=categorical or None, random_state=0)
    model.fit(x, y)

    def predict(rows: np.ndarray) -> np.ndarray:
        result = model.predict(rows, output_type="quantiles", quantiles=LEVELS)
        return np.column_stack(result) if isinstance(result, (list, tuple)) else np.asarray(result).reshape(len(rows), len(LEVELS))

    predict(x[:2])  # fail now, not on the first real request
    return predict


def _baseline_predict(x: np.ndarray, y: np.ndarray):
    models = [HistGradientBoostingRegressor(loss="quantile", quantile=q, max_depth=3, learning_rate=0.08, max_iter=120, random_state=0).fit(x, y) for q in LEVELS]
    return lambda rows: np.column_stack([m.predict(rows) for m in models])


def train_quantile(x: np.ndarray, y: np.ndarray, categorical: list[int] | None = None, engine: str | None = None) -> QuantileModel:
    wanted = (engine or os.environ.get("TABPFN_ENGINE", "auto")).lower()
    note = ""
    if wanted in ("auto", "tabpfn"):
        try:
            return QuantileModel("tabpfn", "TabPFN regressor, in-context on synthetic history (quantile output).", _tabpfn_predict(x, y, categorical or []), len(x))
        except Exception as error:
            if wanted == "tabpfn":
                raise RuntimeError(f"TabPFN requested but not available: {error}") from error
            note = f"TabPFN not available ({type(error).__name__}: {str(error)[:160]}); using the gradient-boosting baseline."
    return QuantileModel("baseline", note or "Gradient-boosting quantile baseline (TABPFN_ENGINE=baseline).", _baseline_predict(x, y), len(x))


def probability_above(values: list[float], threshold: float) -> float:
    """P(y > threshold) from the predicted quantiles, by linear interpolation of the CDF.

    Approximate on purpose: beyond the 5 % / 95 % quantiles the probability is held at 2.5 % / 97.5 %.
    """
    levels = np.array(LEVELS)
    lo, hi = 0.025, 0.975
    cdf = float(np.interp(threshold, values, levels, left=lo, right=hi))
    return round(1 - min(hi, max(lo, cdf)), 3)
