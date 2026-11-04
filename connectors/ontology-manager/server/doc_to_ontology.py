"""Documents -> ontology proposals, for the Werkbank Ontology Manager.

Principle (OntoRAG's own): the model proposes, code decides, a human governs.

  propose   documents (+ optional baselines) -> staging ontology and a review report.
            Nothing in the catalog changes.
  apply     only with confirmed=True: register the proposal as a new ontology, or
            merge it into an existing one. The old version is saved first.
  discard   delete one proposal's own working files (confirmed=True).

Pipeline per proposal: ingest -> extract schema (model) -> aggregate (code)
-> align with the baselines (model, only when there are baselines)
-> export Turtle (code). Every proposed term keeps the quotes it came from.

The text of the documents is sent to the configured model endpoint. That is the
only network use; baselines are never fetched from a remote catalog.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALLOWED_SUFFIXES = {".md", ".markdown", ".txt", ".html", ".htm", ".epub", ".pdf"}
MAX_FILES = 25
MAX_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_CHUNKS = 120
REPORT_ITEMS = 40  # items per category in the chat answer; the full report is in report.json
SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
LLM_ENV = ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_BASE_URL")


class UserError(Exception):
    """A problem the caller can fix; the message is written for the person."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp() -> str:
    return _now().strftime("%Y%m%dT%H%M%SZ")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_llm_env() -> None:
    """An empty or unresolved ${user_config...} value must not mask OntoRAG's defaults."""
    for name in LLM_ENV:
        value = os.environ.get(name, "").strip()
        if not value or value.startswith("${"):
            os.environ.pop(name, None)


def llm_settings() -> dict[str, Any]:
    """What the model endpoint looks like, without the key."""
    from ontorag import llm_config

    return {
        "configured": bool(llm_config.api_key()),
        "model": llm_config.model(),
        "base_url": llm_config.base_url(),
    }


class Workspace:
    """Folder layout under the user's ontology folder."""

    def __init__(self, folder: str | Path, documents_folder: str = "") -> None:
        self.root = Path(folder).expanduser().resolve()
        self.catalog = self.root / "ontologies"
        self.history = self.catalog / "_history"
        self.inbox = self.root / "inbox"
        self.proposals = self.root / "proposals"
        self.documents_root = Path(documents_folder).expanduser().resolve() if documents_folder else None
        for p in (self.catalog, self.history, self.inbox, self.proposals):
            p.mkdir(parents=True, exist_ok=True)

    def allowed_roots(self) -> list[Path]:
        return [self.inbox] + ([self.documents_root] if self.documents_root else [])

    def proposal_dir(self, proposal_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_\-]{6,80}", proposal_id):
            raise UserError(f"Not a proposal id: {proposal_id!r}")
        path = (self.proposals / proposal_id).resolve()
        if path.parent != self.proposals.resolve() or not path.is_dir():
            raise UserError(f"No proposal with id {proposal_id!r}. List them with list_ontology_proposals.")
        return path


# ---------------------------------------------------------------- documents

def resolve_documents(ws: Workspace, documents: list[str] | None, texts: dict[str, str] | None) -> list[Path]:
    """Turn file paths and pasted texts into files below the allowed folders."""
    files: list[Path] = []
    for name, body in (texts or {}).items():
        safe = re.sub(r"[^A-Za-z0-9_\-]+", "-", Path(name).stem).strip("-")[:60] or "text"
        if not isinstance(body, str) or not body.strip():
            raise UserError(f"The text {name!r} is empty.")
        target = ws.inbox / f"{safe}.md"
        target.write_text(body, encoding="utf-8")
        files.append(target)
    for entry in documents or []:
        candidate = Path(entry).expanduser()
        options = [candidate] if candidate.is_absolute() else [r / candidate for r in ws.allowed_roots()]
        found = None
        for option in options:
            real = option.resolve()
            if real.is_file() and any(real.is_relative_to(root) for root in ws.allowed_roots()):
                found = real
                break
        if found is None:
            roots = ", ".join(str(r) for r in ws.allowed_roots())
            raise UserError(
                f"Document not found or not in an allowed folder: {entry}. "
                f"Put it in one of: {roots} (set a documents folder in the connector settings).")
        files.append(found)
    if not files:
        raise UserError("Give at least one document (path) or text.")
    if len(files) > MAX_FILES:
        raise UserError(f"At most {MAX_FILES} documents per proposal; got {len(files)}.")
    for f in files:
        if f.suffix.lower() not in ALLOWED_SUFFIXES:
            raise UserError(f"{f.name}: type not supported. Use {', '.join(sorted(ALLOWED_SUFFIXES))}.")
        if f.stat().st_size > MAX_FILE_BYTES:
            raise UserError(f"{f.name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    return files


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()


# ------------------------------------------------------------------ propose

def _norm(name: str) -> str:
    return (name or "").strip().lower()


def _quotes(item: dict, limit: int = 2) -> list[str]:
    out = []
    for ev in item.get("evidence") or []:
        q = ev.get("quote") if isinstance(ev, dict) else str(ev)
        if q:
            out.append(q)
        if len(out) >= limit:
            break
    return out


def _action_index(alignment: dict | None, key: str) -> dict[str, dict]:
    if not alignment:
        return {}
    return {_norm(a.get("induced_name", "")): a for a in alignment.get(key, []) if isinstance(a, dict)}


def build_report(agg: dict, alignment: dict | None) -> dict[str, Any]:
    """The review view: what is new, what extends or reuses a baseline, what needs a look."""
    report: dict[str, Any] = {"counts": {}, "needs_attention": []}
    for key in ("classes", "datatype_properties", "object_properties"):
        actions = _action_index(alignment, key)
        items, counts = [], {"new": 0, "extend": 0, "reuse": 0}
        for it in agg.get(key, []):
            name = it.get("name", "")
            al = actions.get(_norm(name), {})
            action = al.get("action", "new") if al.get("action") in counts else "new"
            counts[action] += 1
            entry = {
                "name": name,
                "action": action,
                "description": it.get("description", ""),
                "evidence": _quotes(it),
            }
            if key != "classes":
                entry["domain"], entry["range"] = it.get("domain", ""), it.get("range", "")
            if action != "new":
                entry["baseline"] = f'{al.get("baseline_name", "")} [{al.get("baseline_origin", "")}]'
            if al:
                entry["confidence"] = al.get("confidence", "")
                entry["rationale"] = al.get("rationale", "")
            if not entry["evidence"] or al.get("confidence") == "low":
                report["needs_attention"].append(
                    {"kind": key, "name": name,
                     "why": "no evidence quote" if not entry["evidence"] else "low alignment confidence"})
            items.append(entry)
        report[key] = items
        report["counts"][key] = counts
    report["warnings"] = [str(w) for w in (agg.get("warnings") or [])][:10]
    return report


def _trim(report: dict) -> dict:
    """The version returned to the chat: capped lists, full text stays in report.json."""
    out = dict(report)
    for key in ("classes", "datatype_properties", "object_properties"):
        items = report.get(key, [])
        out[key] = items[:REPORT_ITEMS]
        if len(items) > REPORT_ITEMS:
            out[f"{key}_more"] = len(items) - REPORT_ITEMS
    return out


def propose(ws: Workspace, *, slug: str, mode: str, documents: list[str] | None, texts: dict[str, str] | None,
            baselines: list[str] | None, namespace: str, label: str, description: str,
            max_chunks: int) -> dict[str, Any]:
    from ontorag import llm_config
    from ontorag import ontology_extractor_openrouter as extractor
    from ontorag.extractor_ingest import extract_document
    from ontorag.ontology_catalog import catalog_prefixes, compose_baselines, load_catalog
    from ontorag.proposal_aggregator import aggregate_chunk_proposals
    from ontorag.proposal_to_ttl import proposal_to_ttl
    from ontorag.schema_alignment import align_schema
    from ontorag.schema_card import _ensure_schema_card_defaults
    from ontorag.storage_jsonl import store_document_jsonl

    if not SLUG_RE.match(slug or ""):
        raise UserError("slug must be lower case letters, digits and underscores, starting with a letter (2-41 characters).")
    if mode not in ("new", "extend"):
        raise UserError('mode must be "new" (a new ontology) or "extend" (add to the ontology named by slug).')
    if not 1 <= max_chunks <= 500:
        raise UserError("max_chunks must be between 1 and 500.")

    entries = {e["slug"]: e for e in load_catalog(str(ws.catalog)).get("ontologies", [])}
    bases = list(dict.fromkeys(baselines or []))
    if mode == "extend":
        if slug not in entries:
            raise UserError(f'There is no ontology "{slug}" to extend. Registered: {", ".join(entries) or "none"}.')
        bases = list(dict.fromkeys([slug] + bases))
        namespace = namespace or entries[slug].get("namespace", "")
    else:
        if slug in entries:
            raise UserError(f'The ontology "{slug}" already exists. Use mode="extend" to add to it, or pick another slug.')
        namespace = namespace or f"https://werkbank.example/ns/{slug}#"
    unknown = [b for b in bases if b not in entries]
    if unknown:  # also keeps OntoRAG from looking the slug up in a remote catalog
        raise UserError(f'Baseline(s) not in the local catalog: {", ".join(unknown)}. Registered: {", ".join(entries) or "none"}.')
    if not namespace.endswith(("#", "/")):
        raise UserError("namespace must end with # or /.")

    if not llm_settings()["configured"]:
        raise UserError(
            "No model key is configured. Documents are turned into ontology proposals by a language model: "
            "enter an LLM API key (and, for a local server, an endpoint) in the connector settings.")

    files = resolve_documents(ws, documents, texts)

    proposal_id = f"{slug}-{_stamp()}-{uuid.uuid4().hex[:4]}"
    pdir = ws.proposals / proposal_id
    pdir.mkdir(parents=True)
    meta: dict[str, Any] = {
        "id": proposal_id, "slug": slug, "mode": mode, "namespace": namespace, "baselines": bases,
        "label": label or entries.get(slug, {}).get("label", "") or slug,
        "description": description or entries.get(slug, {}).get("description", ""),
        "created_at": _now().isoformat(), "status": "running", "model": llm_config.model(),
    }
    _write_json(pdir / "meta.json", meta)

    model_called = False
    try:
        chunks: list[dict] = []
        docs_meta = []
        for f in files:
            doc = extract_document(str(f), engine="builtin")
            store_document_jsonl(doc, str(pdir / "dto"))
            chunks += [c.model_dump() for c in doc.chunks]
            docs_meta.append({"file": f.name, "sha256": _sha256(f), "chunks": len(doc.chunks)})
        meta["documents"] = docs_meta
        if not chunks:
            raise UserError("No text could be read from the documents.")
        if len(chunks) > max_chunks:
            raise UserError(
                f"The documents make {len(chunks)} text chunks, more than max_chunks={max_chunks}. "
                "Every chunk is one model call: split the documents, or raise max_chunks on purpose.")

        if bases:
            card = compose_baselines(str(ws.catalog), bases, target_namespace=namespace)
        else:
            card = _ensure_schema_card_defaults({})
            card["namespace"] = namespace

        model_called = True
        proposals = extractor.extract_schema_chunk_proposals(chunks, card)
        skipped = list(extractor.LAST_SKIPPED)
        if not proposals:
            raise UserError(
                "The model returned nothing usable for any chunk. Check the API key, the model name and the endpoint.")
        agg = aggregate_chunk_proposals(proposals)
        alignment = align_schema(agg, card) if bases else None

        graph = proposal_to_ttl(
            alignment or agg, biz_ns=namespace, original_proposal=agg if alignment else None,
            prefixes=catalog_prefixes(str(ws.catalog)), local_prefix=slug, baseline_card=card if bases else None)
        graph.serialize(destination=str(pdir / "staging.ttl"), format="turtle")

        report = build_report(agg, alignment)
        report.update({
            "proposal_id": proposal_id, "slug": slug, "mode": mode, "namespace": namespace,
            "baselines": bases, "documents": docs_meta, "chunks": len(chunks),
            "chunks_skipped": len(skipped), "model": llm_config.model(),
            "status": "proposed",
            "next": "Review the terms below. To adopt the proposal call apply_ontology_proposal with confirmed=true; "
                    "nothing has been changed in the catalog yet.",
        })
        _write_json(pdir / "proposal.json", agg)
        if alignment is not None:
            _write_json(pdir / "alignment.json", alignment)
        _write_json(pdir / "report.json", report)
        meta["status"] = "proposed"
        meta["counts"] = report["counts"]
        _write_json(pdir / "meta.json", meta)
        return _trim(report)
    except Exception as e:
        if not model_called and isinstance(e, UserError):
            shutil.rmtree(pdir)  # nothing was paid for and nothing was produced: leave no empty proposal behind
        else:  # a failure after model calls stays on record, with its reason
            meta["status"], meta["error"] = "failed", str(e)
            _write_json(pdir / "meta.json", meta)
        raise


# -------------------------------------------------------- list / show / apply

def list_proposals(ws: Workspace) -> list[dict[str, Any]]:
    out = []
    for d in sorted(ws.proposals.iterdir(), reverse=True):
        meta = d / "meta.json"
        if d.is_dir() and meta.is_file():
            m = _read_json(meta)
            out.append({k: m.get(k) for k in ("id", "slug", "mode", "status", "created_at", "counts", "error")})
    return out


def show_proposal(ws: Workspace, proposal_id: str) -> dict[str, Any]:
    pdir = ws.proposal_dir(proposal_id)
    report = pdir / "report.json"
    if not report.is_file():
        return {"proposal": _read_json(pdir / "meta.json")}
    return _trim(_read_json(report))


def _terms_in(graph) -> set[str]:
    from rdflib.namespace import OWL, RDF, RDFS
    kinds = (OWL.Class, RDFS.Class, OWL.ObjectProperty, OWL.DatatypeProperty, RDF.Property)
    return {str(s) for k in kinds for s in graph.subjects(RDF.type, k)}


def apply_proposal(ws: Workspace, proposal_id: str, confirmed: bool) -> dict[str, Any]:
    from rdflib import Graph
    from rdflib.namespace import OWL, RDF
    from ontorag.ontology_catalog import load_catalog, register_ontology

    pdir = ws.proposal_dir(proposal_id)
    meta = _read_json(pdir / "meta.json")
    if meta.get("status") != "proposed":
        raise UserError(f'Proposal {proposal_id} has status "{meta.get("status")}"; only a proposed one can be applied.')
    staging = pdir / "staging.ttl"
    if not staging.is_file():
        raise UserError("The proposal has no staging ontology.")
    slug, mode = meta["slug"], meta["mode"]
    new_graph = Graph().parse(str(staging), format="turtle")

    if not confirmed:
        return {
            "status": "needs_confirmation", "proposal_id": proposal_id, "slug": slug, "mode": mode,
            "counts": meta.get("counts"),
            "message": f'Nothing was changed. Call again with confirmed=true to {"register the new ontology" if mode == "new" else "merge into the existing ontology (the old version is saved first)"}.'}

    entries = {e["slug"]: e for e in load_catalog(str(ws.catalog)).get("ontologies", [])}
    if mode == "new":
        if slug in entries:
            raise UserError(f'The ontology "{slug}" now exists. Create a proposal with mode="extend" instead.')
        entry = register_ontology(
            str(ws.catalog), slug, str(staging), label=meta["label"], description=meta["description"],
            namespace=meta["namespace"], tags=["generated"])
        result = {"status": "applied", "mode": "new", "slug": slug, "triples": len(new_graph), "entry": entry}
    else:
        if slug not in entries:
            raise UserError(f'The ontology "{slug}" is no longer in the catalog.')
        current = ws.catalog / entries[slug]["path"]
        backup = ws.history / f"{slug}-{_stamp()}.ttl"
        shutil.copy2(current, backup)  # the old version is kept before anything is replaced
        merged = Graph().parse(str(current), format="turtle")
        before, terms_before = len(merged), _terms_in(merged)
        for s in list(new_graph.subjects(RDF.type, OWL.Ontology)):  # the base ontology header stays the only one
            new_graph.remove((s, None, None))
        for triple in new_graph:
            merged.add(triple)
        merged_path = pdir / "merged.ttl"
        merged.serialize(destination=str(merged_path), format="turtle")
        old = entries[slug]
        entry = register_ontology(
            str(ws.catalog), slug, str(merged_path), label=old.get("label", slug),
            description=old.get("description", ""), namespace=old.get("namespace"), tags=old.get("tags"))
        result = {
            "status": "applied", "mode": "extend", "slug": slug, "entry": entry,
            "triples_added": len(merged) - before,
            "new_terms": sorted(t.rsplit("#", 1)[-1].rsplit("/", 1)[-1] for t in _terms_in(merged) - terms_before),
            "previous_version": str(backup),
        }
    meta.update({"status": "applied", "applied_at": _now().isoformat()})
    _write_json(pdir / "meta.json", meta)
    return result


def discard_proposal(ws: Workspace, proposal_id: str, confirmed: bool) -> dict[str, Any]:
    pdir = ws.proposal_dir(proposal_id)
    if not confirmed:
        return {"status": "needs_confirmation", "proposal_id": proposal_id,
                "message": "Nothing was deleted. Call again with confirmed=true to delete this proposal's working files."}
    shutil.rmtree(pdir)  # only this proposal's own folder; the catalog is not touched
    return {"status": "discarded", "proposal_id": proposal_id}
