"""End-to-end test of the document -> ontology tools, over stdio, against a mock model.

  uv run --no-project --python 3.12 --with "ontorag[pdf]" connectors/ontology-manager/test/e2e_documents.py

Proves the plumbing (ingest, extraction, alignment, review report, confirmation,
new and extend, backup, refusals). It does not prove the quality of a real model.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import PythonStdioTransport

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mock_llm  # noqa: E402

SERVER = Path(__file__).resolve().parent.parent / "server" / "ontorag_stdio.py"
failures = 0

DOC_PROC = """# Supplier management

Every supplier is onboarded with agreed payment terms. A supplier receives a purchase order for each delivery.

Each purchase order names the supplier it is placed with and the delivery date.
"""
DOC_FIN = """# Month-end close

Intercompany differences are cleared before close. An intercompany difference arises when two group companies
book the same delivery with different amounts. The supplier invoice and the purchase order must match.
"""


def check(ok: bool, label: str, detail: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(("OK   " if ok else "FAIL ") + label + ("" if ok else f"  -> {detail[:300]}"))


async def call(c, name, args):
    res = await c.call_tool(name, args)
    text = "\n".join(getattr(x, "text", str(x)) for x in res.content)
    return json.loads(text)


async def call_error(c, name, args) -> str:
    try:
        await c.call_tool(name, args)
    except Exception as e:  # noqa: BLE001
        return str(e)
    return ""


def transport(folder, env=None, docs=""):
    base = {"ONTORAG_FOLDER": folder}
    if docs:
        base["ONTORAG_DOCUMENTS_FOLDER"] = docs
    base.update(env or {})
    return PythonStdioTransport(str(SERVER), env=base, python_cmd=sys.executable)


async def main():
    server, url = mock_llm.start()
    llm = {"OPENROUTER_API_KEY": "test-key", "OPENROUTER_BASE_URL": url, "OPENROUTER_MODEL": "mock"}
    with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as docs:
        Path(docs, "suppliers.md").write_text(DOC_PROC, encoding="utf-8")
        Path(docs, "close.md").write_text(DOC_FIN, encoding="utf-8")
        outside = Path(folder).parent / "outside-secret.md"
        outside.write_text("Supplier secret", encoding="utf-8")

        # --- refusals first: no key, bad paths
        async with Client(transport(folder, docs=docs)) as c:
            check((await call(c, "document_ontology_settings", {}))["model"]["configured"] is False, "settings: no key reported")
            msg = await call_error(c, "propose_ontology_from_documents", {"slug": "procurement_docs", "documents": ["suppliers.md"]})
            check("No model key" in msg, "no key -> clear message", msg)

        async with Client(transport(folder, llm, docs)) as c:
            check((await call(c, "document_ontology_settings", {}))["model"]["configured"] is True, "settings: key reported")
            for bad in (str(outside), "../outside-secret.md", "/etc/passwd"):
                msg = await call_error(c, "propose_ontology_from_documents", {"slug": "procurement_docs", "documents": [bad]})
                check("not found or not in an allowed folder" in msg, f"refuses path {bad}", msg)
            msg = await call_error(c, "propose_ontology_from_documents", {"slug": "Bad Slug", "texts": {"a": "x"}})
            check("slug must be" in msg, "refuses bad slug", msg)
            msg = await call_error(c, "propose_ontology_from_documents", {"slug": "nope", "mode": "extend", "texts": {"a": "x"}})
            check("no ontology" in msg.lower(), "extend of unknown ontology refused", msg)
            msg = await call_error(c, "propose_ontology_from_documents",
                                   {"slug": "procurement_docs", "documents": ["suppliers.md"], "max_chunks": 1, "texts": {"b": DOC_FIN, "c": DOC_PROC}})
            check("max_chunks" in msg, "chunk limit stops before any model call", msg)
            check(mock_llm.CALLS == [], "no model call was made so far", str(mock_llm.CALLS))

            # --- A: new ontology from a document
            rep = await call(c, "propose_ontology_from_documents",
                             {"slug": "procurement_docs", "documents": ["suppliers.md"], "label": "Procurement (from documents)"})
            names = {i["name"] for i in rep["classes"]}
            check({"Supplier", "PurchaseOrder"} <= names, "A: classes proposed", str(names))
            check(any(p["name"] == "orderedFrom" for p in rep["object_properties"]), "A: object property proposed")
            check(all(i["action"] == "new" for i in rep["classes"]), "A: all new without baselines")
            check(all(i["evidence"] for i in rep["classes"]), "A: every class carries a source quote")
            pid = rep["proposal_id"]
            before = await call(c, "list_ontologies", {})
            check(all(o["slug"] != "procurement_docs" for o in before["ontologies"]), "A: catalog unchanged after proposing")
            pending = await call(c, "apply_ontology_proposal", {"proposal_id": pid})
            check(pending["status"] == "needs_confirmation", "A: apply without confirmation only previews")
            after_preview = await call(c, "list_ontologies", {})
            check(len(after_preview["ontologies"]) == len(before["ontologies"]), "A: still unchanged after preview")
            done = await call(c, "apply_ontology_proposal", {"proposal_id": pid, "confirmed": True})
            check(done["status"] == "applied" and done["mode"] == "new", "A: confirmed apply registers it", str(done))
            found = await call(c, "search_classes", {"query": "PurchaseOrder"})
            check(found["count"] >= 1 and found["results"][0]["ontology"] == "procurement_docs", "A: new classes searchable")
            again = await call_error(c, "apply_ontology_proposal", {"proposal_id": pid, "confirmed": True})
            check("status" in again.lower(), "A: a proposal cannot be applied twice", again)

            # --- B: extend an existing ontology, aligned with another
            cls_before = (await call(c, "inspect_ontology", {"slug": "werkbank_fin"}))["classes_count"]
            rep2 = await call(c, "propose_ontology_from_documents",
                              {"slug": "werkbank_fin", "mode": "extend", "baselines": ["procurement_docs"],
                               "documents": ["close.md"]})
            acts = {i["name"]: i["action"] for i in rep2["classes"]}
            check(acts.get("IntercompanyDifference") == "extend", "B: specialisation marked as extend", str(acts))
            check(acts.get("Supplier") == "reuse" and acts.get("PurchaseOrder") == "reuse", "B: known concepts marked as reuse", str(acts))
            check("calls" not in rep2 and rep2["chunks_skipped"] == 0, "B: no chunk skipped")
            check("align" in mock_llm.CALLS, "B: alignment ran", str(mock_llm.CALLS))
            done2 = await call(c, "apply_ontology_proposal", {"proposal_id": rep2["proposal_id"], "confirmed": True})
            check(done2["status"] == "applied" and "IntercompanyDifference" in done2["new_terms"], "B: merged, new term reported", str(done2))
            check(Path(done2["previous_version"]).is_file(), "B: previous version saved first")
            cls_after = (await call(c, "inspect_ontology", {"slug": "werkbank_fin"}))["classes_count"]
            check(cls_after == cls_before + 1, "B: exactly one class added, none lost", f"{cls_before} -> {cls_after}")
            old = await call(c, "search_classes", {"query": "Kennzahl"})
            check(old["count"] >= 1, "B: existing terms still there")

            # --- C: list, show, discard
            lst = await call(c, "list_ontology_proposals", {})
            check({p["status"] for p in lst["proposals"]} == {"applied"}, "C: both proposals listed as applied")
            shown = await call(c, "show_ontology_proposal", {"proposal_id": pid})
            check(shown["proposal_id"] == pid, "C: show returns the report")
            prev = await call(c, "discard_ontology_proposal", {"proposal_id": pid})
            check(prev["status"] == "needs_confirmation", "C: discard needs confirmation")
            gone = await call(c, "discard_ontology_proposal", {"proposal_id": pid, "confirmed": True})
            check(gone["status"] == "discarded" and not Path(folder, "proposals", pid).exists(), "C: proposal files deleted")
            still = await call(c, "list_ontologies", {})
            check(any(o["slug"] == "procurement_docs" for o in still["ontologies"]), "C: the applied ontology stays in the catalog")
            bad_id = await call_error(c, "show_ontology_proposal", {"proposal_id": "../ontologies"})
            check("Not a proposal id" in bad_id or "No proposal" in bad_id, "C: proposal id cannot point elsewhere", bad_id)

            # --- D: a PDF is read as well (PyMuPDF comes with ontorag[pdf])
            import fitz
            pdf = Path(docs, "policy.pdf")
            pdoc = fitz.open()
            pdoc.new_page().insert_text((72, 72), "The supplier must accept the agreed payment terms. Each purchase order names the supplier.")
            pdoc.save(str(pdf))
            rep3 = await call(c, "propose_ontology_from_documents", {"slug": "pdf_docs", "documents": ["policy.pdf"]})
            check("Supplier" in {i["name"] for i in rep3["classes"]}, "D: classes proposed from a PDF")

    server.shutdown()
    print("\nFailures:", failures)
    sys.exit(1 if failures else 0)


asyncio.run(main())
