# SAP S/4HANA sandbox (SAP Business Accelerator Hub)

Real S/4HANA OData APIs with SAP sample data, read only. The connector `sap-sandbox` talks to
`https://sandbox.api.sap.com/s4hanacloud` with your personal API key. Nothing can be changed in the sandbox.

## Set up (once)

1. Log in at <https://api.sap.com>, open your profile (top right), **Show API Key**, copy it.
2. Build and install the connector: `npm run build:sap-sandbox-mcpb`, then install `dist/sap-sandbox.mcpb` in the app
   (Connectors, Install). Paste the key into **SAP API key** (stored as a secret). Restart the agent.
3. In the chat, ask: "Check the SAP sandbox connection." (`sap_sandbox_check_connection`).

The key is only ever sent to `sandbox.api.sap.com`; the connector refuses any other base URL.

## Tools

| Tool | What it does |
|------|--------------|
| `sap_sandbox_check_connection` | One small request, tells you if the key works |
| `sap_sandbox_list_apis`, `sap_sandbox_list_entity_sets` | Suggested APIs (local list) and the entity sets of one API |
| `sap_sandbox_query`, `sap_sandbox_get` | Generic OData reads: filter, select, orderby, expand, top (max 100), one entity by key |
| `sap_sandbox_o2c_scan` | Latest sales orders with delivery and billing status; which ones need attention |
| `sap_sandbox_order_to_cash` | One order through delivery, goods issue and invoice; where it is stuck and how much is not invoiced |
| `sap_sandbox_customer_360` | One customer from partner, orders and invoices: totals per currency, orders needing attention |

## Use cases

1. **Order-to-cash trace.** "Which sandbox orders are delivered but not invoiced? Trace order 5."
2. **Customer 360 in the knowledge graph.** The snapshot below becomes documents for Cognee: customers, orders, deliveries,
   invoices and materials as connected nodes.

## Snapshot and Cognee

The sandbox data is fixed. To keep a demo running without a live sandbox and to feed the knowledge graph, read it once:

```bash
SAP_API_KEY=... npm run sap-sandbox:snapshot -- --orders 10     # writes examples/sap-sandbox/snapshot.json (git-ignored)
npm run cognee:corpus                                           # also writes dist/cognee-corpus-sap.json
.venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-sap.json    # adds to the dataset, no --reset
```

The snapshot first probes which APIs the sandbox really offers and prints them. Run it before anything else: the entity
and field names in the code follow the SAP API Business Hub and are **not yet checked against the live sandbox**.

## Limits

- Order-to-cash relies on `ReferenceSDDocument` in delivery and billing items and on the status flags of the order header.
  A step the sandbox does not offer is listed in `notes`; the rest of the trace still works.
- Payment behaviour (late payments) is not in the sales and billing APIs. It needs open items or clearing dates.
- The sandbox has rate limits; the connector reports them and does not retry.
- Spaces have no network. A Space can only show sandbox data through a fixed bridge request handled by the app (like the
  late-payment forecast in the Sales Space); no Space talks to SAP directly.
