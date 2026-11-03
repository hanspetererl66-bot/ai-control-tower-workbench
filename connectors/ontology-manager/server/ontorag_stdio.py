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

    folder = _env("ONTORAG_FOLDER")
    if not folder:
        raise SystemExit("ONTORAG_FOLDER is not set: choose a folder for the ontology catalog.")
    catalog = Path(folder).expanduser() / "ontologies"
    catalog.mkdir(parents=True, exist_ok=True)

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
    return app


if __name__ == "__main__":
    # stdout belongs to the MCP protocol: every message for a human goes to stderr.
    print("werkbank-ontology-manager: starting (stdio)", file=sys.stderr)
    build_app().run(transport="stdio", show_banner=False)
