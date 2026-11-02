# Late-payment forecast service (TabPFN demo)

Small FastAPI service behind the **Late payments** tab of the Sales Space (one customer at a time) and the chat
tool `predict_late_payments`. It scores open invoices: *will this one be paid more than 14 days after the due date?*

- **Model:** [TabPFN](https://github.com/PriorLabs/TabPFN) (tabular foundation model, no tuning). If TabPFN or its
  weights are not available, the service falls back to a gradient-boosting baseline and says so in every answer
  (`engine`, `engineNote`), in `/health` and in the card footer.
- **Data:** trained on **synthetic** invoice history (`synthetic.py`). The customer's own paid invoices only feed two
  features (usual delay, share of late payments). Nothing is stored; the service keeps no state between calls.
- **Not a credit assessment.** It demonstrates the method.

## Run

```bash
./services/tabpfn/start.sh
curl http://127.0.0.1:8808/health
```

`start.sh` works from any folder and any terminal. On the first run it creates `.venv` and installs the requirements
(torch is large, a few minutes). It reads `services/tabpfn/.env` on every start, so nothing has to be activated or
exported by hand. Copy `.env.example` to `.env` and fill in what you need; `.env` is git-ignored.

### Getting the real TabPFN engine

The weights are gated on Hugging Face. Once, per machine:

1. Open the model page of the installed `tabpfn` version (the error message in `/health` names it, for example
   `Prior-Labs/tabpfn_3_5`) and accept the terms of use.
2. Give the service your token, once and permanently, in one of two ways: `hf auth login` (older versions:
   `huggingface-cli login`), which stores it on your machine, or `HF_TOKEN=hf_...` in `services/tabpfn/.env`.
3. Restart the service. `/health` should now say `"engine": "tabpfn"`.

Licence: check the TabPFN licence for your use. Newer generations are released for research and internal evaluation;
public demos or customer use may need a commercial licence from Prior Labs.

Environment: `TABPFN_ENGINE=auto|tabpfn|baseline` (default `auto`; `tabpfn` fails instead of falling back),
`TABPFN_DEVICE=cpu|cuda` (default `cpu`; fine for a few hundred rows), `TABPFN_SERVICE_TOKEN` (optional bearer token).

## Connect it to the workbench

Set the **Sub4Me** connector's **Late-payment forecast service** to `http://127.0.0.1:8808` (or `TABPFN_SERVICE_URL` when running
the connector from a checkout), and the same token if you set one. Plain http is accepted for localhost only.

Then ask in the chat *"Welche offenen Rechnungen werden voraussichtlich zu spät bezahlt?"*, or press **Run forecast**
on the **Late payments** tab of the Sales Space (pick the customer first). The tool lives in the Sub4Me connector, so that connector must be active.

## Two Controlling forecasts (same service)

Both use the TabPFN **regressor** with quantile output and share the engine switch (`TABPFN_ENGINE`) with the late-payment model.
Without weights a labelled gradient-boosting quantile baseline answers instead (`engine: baseline` in every answer and in the card footer).
The models are trained lazily on the first request, on synthetic history.

| Where | Tool (connector `ai-control-tower`) | What you get |
|---|---|---|
| Control Tower, tab Model Governance, card "Month-end forecast per team group" | `forecast_budget` | month-end spend per cost group with an 80 % band and the chance of exceeding the budget |
| Finance Pre-Close, table "Accrual proposals", button "Estimate with TabPFN" | `estimate_accruals` | interval for the final amount of each accrual proposal and the chance that it differs by more than 10 % |

Connect it like the late-payment forecast: set **Forecast service** in the **AI Control Tower** connector (reinstall or
re-import the connector once so the new tools and fields appear).

`POST /forecast/budget` with `{ "day": 28, "daysInMonth": 31, "groups": [ { "name", "budgetK", "mtdK", "historyK": [six earlier month-end spends] } ] }`.
`POST /estimate/accruals` with `{ "asOfWd": 17, "accruals": [ { "id", "entity", "line", "amountK", "confidence", "fromWd" } ] }`.
The overrun and correction probabilities are read off the predicted quantiles by interpolation, so they are approximate
(held between 2.5 % and 97.5 %).

**Not verified against real weights:** the call `TabPFNRegressor.predict(X, output_type="quantiles", quantiles=[...])` follows the
tabpfn 2.x documentation. If it fails when the model is set up, the baseline is used and `engineNote` says why.

## API

`POST /predict/late-payment` with `{ "customer": "muster", "as_of": "2026-10-18", "invoices": [ ...Sub4Me invoices... ] }`

Returns the open invoices, highest late probability first, each with `risk` (`high` ≥ 60 %, `medium` ≥ 35 %),
the three strongest `drivers` (how far the score drops when that feature is set to the typical value) and
`alreadyLate` for invoices already more than 14 days past due (probability fixed to 1, nothing left to predict).

## Test

```bash
TABPFN_ENGINE=baseline python -m pytest -q   # tests never depend on downloaded weights
```
