"""Late-payment prediction service for the Sub4Me demo.

POST /predict/late-payment   body: { customer, as_of?, invoices: [ ...Sub4Me invoice objects... ] }
POST /forecast/budget        body: { day, daysInMonth, groups: [ { name, budgetK, mtdK, historyK } ] }
POST /estimate/accruals      body: { asOfWd, accruals: [ { id, entity, line, amountK, confidence, fromWd } ] }
GET  /health                 which engine is loaded, and why

The service only sees invoices the caller sends. It keeps nothing, writes nothing, and trains on synthetic history.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import accruals as accrual_model
import budget as budget_model
from features import build_features, customer_habit
from model import LateModel, train
from synthetic import LATE_DAYS

STATE: dict[str, LateModel] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    STATE["model"] = train()
    yield
    STATE.clear()


app = FastAPI(title="Late-payment prediction (TabPFN demo)", version="0.1.0", lifespan=lifespan)


class Invoice(BaseModel):
    id: str = Field(max_length=40)
    type: str = "Invoice"
    contractId: str | None = None
    period: str | None = None
    issued: str | None = None
    due: str | None = None
    grossEur: float | None = None
    netEur: float | None = None
    status: str = "Open"
    paidOn: str | None = None
    description: str | None = None

    model_config = {"extra": "ignore"}


class Request(BaseModel):
    customer: str = Field(default="muster", pattern=r"^[a-z0-9-]{1,30}$")
    as_of: str | None = None
    invoices: list[Invoice] = Field(max_length=500)


def _check_token(authorization: str | None) -> None:
    token = os.environ.get("TABPFN_SERVICE_TOKEN", "").strip()
    if token and authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="missing or wrong bearer token")


@app.get("/health")
def health():
    model = STATE["model"]
    return {"ok": True, "engine": model.engine, "engineNote": model.note, "trainingRows": model.training_rows, "data": "synthetic"}


@app.post("/predict/late-payment")
def predict(request: Request, authorization: str | None = Header(default=None)):
    _check_token(authorization)
    try:
        as_of = date.fromisoformat(request.as_of) if request.as_of else date.today()
    except ValueError:
        raise HTTPException(status_code=422, detail="as_of must be YYYY-MM-DD") from None
    model = STATE["model"]
    invoices = [i.model_dump() for i in request.invoices]
    todo, frame = build_features(invoices, as_of)
    scored = model.predict(frame)
    avg_delay, late_rate = customer_habit(invoices)

    items = []
    for invoice, prediction in zip(todo, scored):
        due = date.fromisoformat(invoice["due"][:10]) if invoice.get("due") else None
        days_to_due = (due - as_of).days if due else None
        p = prediction.probability
        # Already more than LATE_DAYS past due: the outcome is known, the model has nothing left to predict.
        already_late = days_to_due is not None and days_to_due < -LATE_DAYS
        if already_late:
            p = 1.0
        items.append(
            {
                "id": invoice["id"],
                "contractId": invoice.get("contractId"),
                "grossEur": invoice.get("grossEur"),
                "due": invoice.get("due"),
                "daysToDue": days_to_due,
                "alreadyOverdue": days_to_due is not None and days_to_due < 0,
                "alreadyLate": already_late,
                "lateProbability": round(p, 3),
                "risk": "high" if p >= 0.6 else "medium" if p >= 0.35 else "low",
                "drivers": [] if already_late else prediction.drivers,
            }
        )
    items.sort(key=lambda item: -item["lateProbability"])
    return {
        "customer": request.customer,
        "asOf": as_of.isoformat(),
        "lateMeansDaysAfterDue": LATE_DAYS,
        "engine": model.engine,
        "engineNote": model.note,
        "trainedOn": f"{model.training_rows} synthetic invoices",
        "customerHabit": {"avgDelayDays": round(avg_delay, 1), "lateShare": round(late_rate, 2), "paidInvoicesSeen": sum(1 for i in invoices if i.get("paidOn"))},
        "count": len(items),
        "items": items,
    }


class BudgetGroup(BaseModel):
    name: str = Field(max_length=60)
    budgetK: float = Field(gt=0, le=1e7)
    mtdK: float = Field(ge=0, le=1e8)
    historyK: list[float] = Field(default_factory=list, max_length=12)


class BudgetRequest(BaseModel):
    day: int = Field(ge=1, le=31)
    daysInMonth: int = Field(ge=28, le=31)
    groups: list[BudgetGroup] = Field(max_length=50)


@app.post("/forecast/budget")
def forecast_budget(request: BudgetRequest, authorization: str | None = Header(default=None)):
    _check_token(authorization)
    if request.day > request.daysInMonth:
        raise HTTPException(status_code=422, detail="day is after the end of the month")
    return budget_model.forecast([g.model_dump() for g in request.groups], request.day, request.daysInMonth)


class Accrual(BaseModel):
    id: str = Field(max_length=40)
    entity: str = Field(max_length=10)
    line: str = Field(max_length=30)
    amountK: float = Field(gt=0, le=1e7)
    confidence: str = "medium"
    fromWd: int = Field(default=0, ge=0, le=31)

    model_config = {"extra": "ignore"}


class AccrualRequest(BaseModel):
    asOfWd: int = Field(ge=1, le=31)
    accruals: list[Accrual] = Field(max_length=200)


@app.post("/estimate/accruals")
def estimate_accruals(request: AccrualRequest, authorization: str | None = Header(default=None)):
    _check_token(authorization)
    return accrual_model.estimate([a.model_dump() for a in request.accruals], request.asOfWd)
