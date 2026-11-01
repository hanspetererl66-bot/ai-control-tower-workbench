import json
import os
from pathlib import Path

os.environ["TABPFN_ENGINE"] = "baseline"  # tests must not depend on downloaded weights

import pytest
from fastapi.testclient import TestClient

from app import app

PORTFOLIO = Path(__file__).resolve().parents[2] / "examples" / "sub4me" / "portfolio.json"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def invoices(customer_index=None):
    data = json.loads(PORTFOLIO.read_text())
    return data["invoices"] if customer_index is None else data["otherCustomers"][customer_index]["invoices"]


def test_health_says_which_engine_ran(client):
    body = client.get("/health").json()
    assert body["engine"] == "baseline"
    assert body["data"] == "synthetic"


def test_scores_only_open_invoices_sorted_by_risk(client):
    body = client.post("/predict/late-payment", json={"customer": "muster", "as_of": "2026-10-29", "invoices": invoices()}).json()
    open_ids = {i["id"] for i in invoices() if i["status"] in ("Open", "Overdue") and i["type"] == "Invoice"}
    assert {item["id"] for item in body["items"]} == open_ids
    probabilities = [item["lateProbability"] for item in body["items"]]
    assert probabilities == sorted(probabilities, reverse=True)
    assert all(0 <= p <= 1 for p in probabilities)
    assert body["engine"] == "baseline" and "synthetic" in body["trainedOn"]


def test_a_customer_that_always_pays_late_scores_higher(client):
    def history(delay):
        paid = [
            {"id": f"P{n}", "type": "Invoice", "issued": "2026-01-01", "due": "2026-01-31", "paidOn": f"2026-02-{(delay % 28) + 1:02d}" if delay > 0 else "2026-01-25", "grossEur": 100000, "status": "Paid", "description": "SAP Analytics Cloud, annual in advance"}
            for n in range(4)
        ]
        open_one = {"id": "O1", "type": "Invoice", "issued": "2026-10-01", "due": "2026-10-31", "grossEur": 100000, "status": "Open", "description": "SAP Analytics Cloud, annual in advance"}
        return paid + [open_one]

    slow = client.post("/predict/late-payment", json={"as_of": "2026-10-29", "invoices": history(25)}).json()["items"][0]["lateProbability"]
    fast = client.post("/predict/late-payment", json={"as_of": "2026-10-29", "invoices": history(0)}).json()["items"][0]["lateProbability"]
    assert slow > fast


def test_rejects_bad_input(client):
    assert client.post("/predict/late-payment", json={"as_of": "29.10.2026", "invoices": []}).status_code == 422
    assert client.post("/predict/late-payment", json={"customer": "../x", "invoices": []}).status_code == 422
    assert client.post("/predict/late-payment", json={"invoices": [{"id": "x" * 41}]}).status_code == 422


def test_no_open_invoices_gives_an_empty_list(client):
    paid_only = [i for i in invoices() if i["status"] == "Paid"]
    body = client.post("/predict/late-payment", json={"invoices": paid_only}).json()
    assert body["count"] == 0 and body["items"] == []


def test_bearer_token_is_enforced_when_set(client, monkeypatch):
    monkeypatch.setenv("TABPFN_SERVICE_TOKEN", "s3cret")
    assert client.post("/predict/late-payment", json={"invoices": []}).status_code == 401
    assert client.post("/predict/late-payment", json={"invoices": []}, headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_an_invoice_more_than_14_days_past_due_is_reported_as_already_late(client):
    body = client.post("/predict/late-payment", json={"as_of": "2026-10-18", "invoices": invoices()}).json()
    item = next(i for i in body["items"] if i["id"] == "INV-2026-10621")
    assert item["alreadyLate"] is True and item["lateProbability"] == 1.0 and item["risk"] == "high" and item["drivers"] == []


GROUPS = [
    {"name": "Engineering", "budgetK": 6566, "mtdK": 7026, "historyK": [5600, 5800, 6000, 6250, 6400, 6500]},
    {"name": "Sales", "budgetK": 3335, "mtdK": 2935, "historyK": [2900, 3000, 3050, 3100, 3150, 3200]},
    {"name": "Data", "budgetK": 3587, "mtdK": 680, "historyK": [600, 650, 700, 720, 760, 800]},
]


def test_budget_forecast_has_a_band_and_overrun_probability(client):
    body = client.post("/forecast/budget", json={"day": 28, "daysInMonth": 31, "groups": GROUPS}).json()
    assert body["engine"] == "baseline" and "synthetic" in body["trainedOn"]
    items = {i["name"]: i for i in body["items"]}
    for i in items.values():
        assert i["p10K"] <= i["p50K"] <= i["p90K"]
        assert i["p10K"] >= i["spentK"], "month-end cannot be below what is booked"
        assert 0 <= i["overrunProbability"] <= 1
    assert items["Engineering"]["overrunProbability"] > 0.9
    assert items["Data"]["overrunProbability"] < 0.05
    assert items["Engineering"]["overrunProbability"] >= items["Sales"]["overrunProbability"] >= items["Data"]["overrunProbability"]
    assert [i["overrunProbability"] for i in body["items"]] == sorted((i["overrunProbability"] for i in body["items"]), reverse=True)


def test_budget_forecast_rejects_bad_input(client):
    assert client.post("/forecast/budget", json={"day": 40, "daysInMonth": 31, "groups": GROUPS}).status_code == 422
    assert client.post("/forecast/budget", json={"day": 10, "daysInMonth": 31, "groups": [{"name": "x", "budgetK": 0, "mtdK": 1}]}).status_code == 422


ACCRUALS = [
    {"id": "AC-01", "entity": "UK10", "line": "hosting", "amountK": 75, "confidence": "high", "fromWd": 16},
    {"id": "AC-10", "entity": "US10", "line": "legal", "amountK": 48, "confidence": "low", "fromWd": 19},
    {"id": "AC-03", "entity": "DE10", "line": "personnel", "amountK": 420, "confidence": "medium", "fromWd": 18},
]


def test_accrual_estimate_flags_the_uncertain_ones(client):
    body = client.post("/estimate/accruals", json={"asOfWd": 19, "accruals": ACCRUALS}).json()
    assert body["engine"] == "baseline" and body["tolerancePct"] == 10
    items = {i["id"]: i for i in body["items"]}
    for i in items.values():
        assert i["p10K"] <= i["p50K"] <= i["p90K"]
        assert 0 <= i["correctionProbability"] <= 1
    assert items["AC-10"]["correctionProbability"] > items["AC-01"]["correctionProbability"], "low-confidence legal vs high-confidence hosting"
    assert body["items"][0]["id"] == "AC-10"


def test_accrual_estimate_handles_empty_and_unknown_lines(client):
    assert client.post("/estimate/accruals", json={"asOfWd": 19, "accruals": []}).json()["count"] == 0
    odd = [{"id": "X", "entity": "ZZ99", "line": "unheard-of", "amountK": 10, "confidence": "weird", "fromWd": 3}]
    assert client.post("/estimate/accruals", json={"asOfWd": 19, "accruals": odd}).json()["count"] == 1
