"""Smoke test for the Ontology Manager connector, over stdio like the Werkbank starts it.

Run it with the same Python that has OntoRAG installed:

  uv run --python 3.12 --with ontorag connectors/ontology-manager/server/smoke_test.py

It starts ontorag_stdio.py with a throw-away catalog folder, lists the tools and
calls the main ones. Exit code 1 if anything fails.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import PythonStdioTransport

SERVER = Path(__file__).resolve().parent / "ontorag_stdio.py"
NS = "https://werkbank.example/ns/fin#"
EXPECTED_TOOLS = {
    "propose_ontology_from_documents", "list_ontology_proposals", "show_ontology_proposal",
    "apply_ontology_proposal", "discard_ontology_proposal", "document_ontology_settings",
    "list_ontologies", "inspect_ontology", "search_classes", "search_properties", "compose", "add_ontology",
    "describe", "list_by_class", "outgoing", "incoming", "mentions", "sparql_select", "sparql_construct",
    "impact_of_term",
}

failures = 0


def text_of(result):
    return "\n".join(getattr(c, "text", str(c)) for c in (getattr(result, "content", None) or []))


async def call(client, name, args, expect):
    global failures
    try:
        out = text_of(await client.call_tool(name, args))
    except Exception as e:  # noqa: BLE001
        failures += 1
        print(f"FAIL {name}: {type(e).__name__}: {e}")
        return
    ok = expect in out
    failures += 0 if ok else 1
    print(("OK   " if ok else "FAIL ") + f"{name} {json.dumps(args, ensure_ascii=False)[:90]}")
    if not ok:
        print(f"     expected {expect!r} in: {out[:300]}")


async def main():
    with tempfile.TemporaryDirectory() as folder:
        transport = PythonStdioTransport(str(SERVER), env={"ONTORAG_FOLDER": folder}, python_cmd=sys.executable)
        async with Client(transport) as c:
            tools = {t.name for t in await c.list_tools()}
            missing = EXPECTED_TOOLS - tools
            print("OK   tools" if not missing else f"FAIL tools missing: {sorted(missing)}")
            failures_tools = 1 if missing else 0
            await call(c, "list_ontologies", {}, "werkbank_fin")
            await call(c, "inspect_ontology", {"slug": "werkbank_fin"}, "Metric")
            await call(c, "search_classes", {"query": "Kennzahl"}, "Metric")
            await call(c, "list_by_class", {"class_iri": NS + "CompanyCode"}, "UK10")
            await call(c, "describe", {"iri": NS + "DSO"}, "Days Sales Outstanding")
            q = (f"PREFIX : <{NS}> SELECT ?m WHERE {{ ?m a :Metric ; :certifiedBy \"Group Treasury\" }}")
            await call(c, "sparql_select", {"query": q}, "DSO")
            # relations, construct, mentions
            await call(c, "outgoing", {"iri": NS + "DSO"}, "ds_invoices")
            await call(c, "incoming", {"iri": NS + "DSO"}, "chk_dso")
            await call(c, "sparql_construct",
                       {"query": f"PREFIX : <{NS}> CONSTRUCT {{ ?m :certifiedBy ?who }} WHERE {{ ?m a :Metric ; :certifiedBy ?who }}"},
                       "Group Controlling")
            await call(c, "mentions", {"iris": [NS + "DSO"]}, "")
            # impact of a term: who hangs on it, who to ask
            await call(c, "impact_of_term", {"term": "DSO"}, "chk_dso")
            await call(c, "impact_of_term", {"term": "Margin", "depth": 2}, "MarginAfterAccruals")
            await call(c, "impact_of_term", {"term": "Margin"}, "Group Controlling")
            await call(c, "impact_of_term", {"term": "Metric"}, "MarginAfterAccruals")
            # catalog management: add a second baseline, then compose both
            extra = (
                "@prefix : <https://werkbank.example/ns/proc#> .\n"
                "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n"
                "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
                ":Supplier a owl:Class ; rdfs:label \"Supplier\"@en ; rdfs:comment \"Vendor of goods or services.\"@en .\n"
            )
            await call(c, "add_ontology", {"slug": "werkbank_proc", "ttl_content": extra, "label": "Procurement"}, "werkbank_proc")
            await call(c, "list_ontologies", {}, "werkbank_proc")
            await call(c, "search_classes", {"query": "Supplier"}, "werkbank_proc")
            await call(c, "compose", {"slugs": ["werkbank_fin", "werkbank_proc"]}, "Supplier")
            await call(c, "compose", {"slugs": ["werkbank_fin", "werkbank_proc"]}, "CompanyCode")
    total = failures + failures_tools
    print("\nFailures:", total)
    sys.exit(1 if total else 0)


asyncio.run(main())
