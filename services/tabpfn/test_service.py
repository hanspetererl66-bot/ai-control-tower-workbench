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
