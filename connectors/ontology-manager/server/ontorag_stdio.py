"""Werkbank Ontology Manager: OntoRAG as one stdio MCP server.

OntoRAG (pip: ontorag, Apache-2.0) ships two MCP servers that only speak HTTP:
the ontology catalog (browse, search and compose baselines) and the knowledge
server (SPARQL and graph navigation over an ontology plus its instances). The
Werkbank starts connectors as stdio processes, so this launcher mounts both
into one server and runs it over stdio. Tool names are the OntoRAG names.

Environment:
  ONTORAG_FOLDER        Folder for the ontology catalog (required, created if missing).
  ONTORAG_ONTOLOGY_TTL  Ontology the knowledge tools read. Default: the bundled
                        Finance Pre-Close baseline.
  ONTORAG_INSTANCES_TTL Instances for it. Default: the bundled sample instances.

On the first start the bundled baseline is registered in the catalog as
"werkbank_fin" when the catalog does not have it yet. Nothing is ever deleted or
overwritten.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if value.startswith("${"):  # an optional setting the host left unresolved counts as empty
        value = ""
    return value or default


def build_app():
    from fastmcp import FastMCP
    from ontorag.mcp_backend import LocalRdfBackend
    from ontorag.mcp_server import create_mcp_app
    from ontorag.ontology_catalog import load_catalog, register_ontology
    from ontorag.ontology_mcp import create_ontology_mcp

    sys.path.insert(0, str(HERE))
    import doc_to_ontology as d2o

    folder = _env("ONTORAG_FOLDER")
    if not folder:
        raise SystemExit("ONTORAG_FOLDER is not set: choose a folder for the ontology catalog.")
    d2o.clean_llm_env()
    ws = d2o.Workspace(folder, _env("ONTORAG_DOCUMENTS_FOLDER"))
    catalog = ws.catalog

    onto = _env("ONTORAG_ONTOLOGY_TTL", str(DATA / "werkbank_fin.ttl"))
    inst = _env("ONTORAG_INSTANCES_TTL", str(DATA / "werkbank_fin_instances.ttl"))
    for label, path in (("ontology", onto), ("instances", inst)):
        if not Path(path).is_file():
            raise SystemExit(f"The {label} file does not exist: {path}")

    known = {o.get("slug") for o in load_catalog(str(catalog)).get("ontologies", [])}
    if "werkbank_fin" not in known:
        register_ontology(
            str(catalog),
            "werkbank_fin",
            str(DATA / "werkbank_fin.ttl"),
            label="Werkbank Finance Pre-Close",
            description="Company codes, certified metrics, documents and pre-close checks",
            tags=["finance", "preclose", "werkbank"],
        )

    app = FastMCP("werkbank-ontology-manager")
    app.mount(create_ontology_mcp(str(catalog)))
    app.mount(create_mcp_app(LocalRdfBackend(onto, inst)))
    register_document_tools(app, ws, d2o)
    register_impact_tool(app, onto, inst)
    return app


def register_impact_tool(app, onto: str, inst: str) -> None:
    """Read-only impact analysis over the same two files the knowledge tools read."""
    import asyncio

    import impact
    from fastmcp.exceptions import ToolError

    @app.tool()
    async def impact_of_term(term: str, depth: int = 3) -> dict:
        """Show what depends on a term before it is changed. Read-only.

        term is a full IRI, a local name such as DSO, or a label such as "Days Sales
        Outstanding". Returns what the term depends on, everything that points at it
        (up to depth hops: other metrics, pre-close checks, ...) with the links of each,
        counts by kind, and the owners (certifiedBy) to ask before a change. For a class
        it also lists subclasses, instances and properties. Only what is modelled in the
        ontology and its instances is counted; agents and skills that are not modelled
        there are not listed."""
        def run():
            return impact.impact_of_term(impact.load_graph(onto, inst), term, depth)
        try:
            return await asyncio.to_thread(run)
        except impact.ImpactError as e:
            raise ToolError(str(e)) from e


def register_document_tools(app, ws, d2o) -> None:
    """Tools that grow ontologies from documents: propose, review, apply."""
    import asyncio

    from fastmcp.exceptions import ToolError

    async def run(fn, *args, **kwargs):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except d2o.UserError as e:
            raise ToolError(str(e)) from e

    @app.tool()
    async def propose_ontology_from_documents(
        slug: str,
        mode: str = "new",
        documents: list[str] | None = None,
        texts: dict[str, str] | None = None,
        baselines: list[str] | None = None,
        namespace: str = "",
        label: str = "",
        description: str = "",
        max_chunks: int = d2o.DEFAULT_MAX_CHUNKS,
    ) -> dict:
        """Read documents and propose an ontology from them. Changes nothing in the catalog.

        mode "new": propose a new ontology called slug (optionally aligned with existing
        ones named in baselines). mode "extend": propose additions to the existing
        ontology slug; terms that already exist are reused, specialisations are marked.
        documents are file names or paths inside the connector's documents folder or inbox
        (.md .txt .html .epub .pdf); texts maps a name to pasted text. Every chunk of text
        is one call to the configured language model, and the text is sent to that model
        endpoint. Returns a review report: new, extending and reused terms with the quotes
        they come from, plus items that need a human look. Then call
        apply_ontology_proposal to adopt it."""
        return await run(
            d2o.propose, ws, slug=slug, mode=mode, documents=documents, texts=texts, baselines=baselines,
            namespace=namespace, label=label, description=description, max_chunks=max_chunks)

    @app.tool()
    async def list_ontology_proposals() -> dict:
        """List the ontology proposals made so far with their status (proposed, applied, failed)."""
        return {"proposals": await run(d2o.list_proposals, ws)}

    @app.tool()
    async def show_ontology_proposal(proposal_id: str) -> dict:
        """Show the review report of one proposal again."""
        return await run(d2o.show_proposal, ws, proposal_id)

    @app.tool()
    async def apply_ontology_proposal(proposal_id: str, confirmed: bool = False) -> dict:
        """Adopt a reviewed proposal. Without confirmed=true it only says what would happen.

        With confirmed=true a "new" proposal is registered as a new ontology; an "extend"
        proposal is merged into the existing one after the previous version has been saved
        in the catalog's _history folder. Only ask for confirmed=true after the person has
        seen the review report and agreed."""
        return await run(d2o.apply_proposal, ws, proposal_id, confirmed)

    @app.tool()
    async def discard_ontology_proposal(proposal_id: str, confirmed: bool = False) -> dict:
        """Delete one proposal's working files (confirmed=true). The catalog is not touched."""
        return await run(d2o.discard_proposal, ws, proposal_id, confirmed)

    @app.tool()
    async def document_ontology_settings() -> dict:
        """Say whether a language model is configured and which folders documents may come from."""
        return {
            "model": d2o.llm_settings(),
            "documents_folders": [str(p) for p in ws.allowed_roots()],
            "supported_types": sorted(d2o.ALLOWED_SUFFIXES),
            "limits": {"documents": d2o.MAX_FILES, "default_max_chunks": d2o.DEFAULT_MAX_CHUNKS},
        }


if __name__ == "__main__":
    # stdout belongs to the MCP protocol: every message for a human goes to stderr.
    print("werkbank-ontology-manager: starting (stdio)", file=sys.stderr)
    build_app().run(transport="stdio", show_banner=False)
