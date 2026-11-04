"""Impact of a term: what hangs on it, before anyone changes it.

Read-only. Loads the ontology and its instances (the same two Turtle files the
knowledge tools read) into one graph and follows the links that point at a term.
It only knows what is modelled in the graph; agents, skills or reports that are
not in the ontology do not show up, and the result says so.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import OWL, RDF, RDFS

MAX_DEPTH = 5
MAX_ITEMS = 200
_SKIP_OBJECTS = {OWL.Class, OWL.ObjectProperty, OWL.DatatypeProperty, OWL.Ontology, RDFS.Class, RDF.Property}


class ImpactError(ValueError):
    """A problem the person can fix (unknown term, bad depth)."""


def load_graph(*paths: str | Path) -> Graph:
    g = Graph()
    for p in paths:
        g.parse(str(p), format="turtle")
    return g


def _short(g: Graph, node) -> str:
    """Local name (DSO, certifiedBy): the part after the last # or /."""
    return str(node).rsplit("#", 1)[-1].rsplit("/", 1)[-1] if isinstance(node, URIRef) else str(node)


def _label(g: Graph, node) -> str:
    labels = [l for l in g.objects(node, RDFS.label) if isinstance(l, Literal)]
    for lang in ("en", "de"):
        for l in labels:
            if getattr(l, "language", None) == lang:
                return str(l)
    return str(labels[0]) if labels else _short(g, node)


def _types(g: Graph, node) -> list[URIRef]:
    return [t for t in g.objects(node, RDF.type) if isinstance(t, URIRef) and t not in _SKIP_OBJECTS]


def resolve(g: Graph, term: str) -> URIRef:
    """Find a term by full IRI, local name (DSO) or label (Days Sales Outstanding)."""
    term = (term or "").strip()
    if not term:
        raise ImpactError("Give a term: an IRI, a local name such as DSO, or a label.")
    if "://" in term or term.startswith("urn:"):
        ref = URIRef(term)
        if (ref, None, None) in g or (None, None, ref) in g:
            return ref
        raise ImpactError(f"No term with the IRI {term} in the ontology or its instances.")
    low = term.lower()
    hits: dict[URIRef, str] = {}
    for s in set(g.subjects()):
        if not isinstance(s, URIRef):
            continue
        local = str(s).rsplit("#", 1)[-1].rsplit("/", 1)[-1]
        if local.lower() == low:
            hits[s] = "name"
            continue
        for l in g.objects(s, RDFS.label):
            if str(l).lower() == low:
                hits.setdefault(s, "label")
    if not hits:
        raise ImpactError(f"No term '{term}' in the ontology or its instances. Try a local name such as DSO, or use search_classes.")
    by_name = [s for s, how in hits.items() if how == "name"]
    pool = by_name or list(hits)
    if len(pool) > 1:
        raise ImpactError(f"'{term}' is ambiguous: " + ", ".join(sorted(str(s) for s in pool)) + ". Use the full IRI.")
    return pool[0]


def _links(g: Graph, node) -> list[dict]:
    """Outgoing links to other resources (literals are not links)."""
    out = []
    for p, o in g.predicate_objects(node):
        if isinstance(o, URIRef) and p not in (RDF.type,) and o not in _SKIP_OBJECTS:
            out.append({"property": _label(g, p), "to": _short(g, o), "to_label": _label(g, o)})
    return sorted(out, key=lambda d: (d["property"], d["to"]))


def _facts(g: Graph, node) -> dict:
    facts = {}
    for p, o in g.predicate_objects(node):
        if isinstance(o, Literal) and p != RDFS.label:
            facts[_short(g, p)] = str(o)
    return facts


def impact_of_term(g: Graph, term: str, depth: int = 3) -> dict:
    if not 1 <= depth <= MAX_DEPTH:
        raise ImpactError(f"depth must be between 1 and {MAX_DEPTH}.")
    node = resolve(g, term)
    is_class = (node, RDF.type, OWL.Class) in g

    # who points at the term, hop by hop (breadth first, each resource once)
    seen = {node: 0}
    via: dict[URIRef, list[dict]] = {}
    queue = deque([(node, 0)])
    while queue:
        cur, d = queue.popleft()
        if d >= depth:
            continue
        for s, p in g.subject_predicates(cur):
            if not isinstance(s, URIRef) or p in (RDF.type, RDFS.subClassOf, RDFS.domain, RDFS.range):
                continue
            via.setdefault(s, []).append({"property": _label(g, p), "target": _short(g, cur)})
            if s not in seen:
                seen[s] = d + 1
                queue.append((s, d + 1))
    dependents = []
    for s, hop in sorted(seen.items(), key=lambda kv: (kv[1], str(kv[0]))):
        if s == node:
            continue
        dependents.append({
            "id": _short(g, s), "iri": str(s), "label": _label(g, s), "hop": hop,
            "types": [_label(g, t) for t in _types(g, s)],
            "via": via.get(s, []),
            "links": _links(g, s),
            "facts": {k: v for k, v in _facts(g, s).items() if k in ("certifiedBy", "owner", "code")},
        })
    truncated = len(dependents) > MAX_ITEMS
    dependents = dependents[:MAX_ITEMS]

    by_type: dict[str, int] = {}
    for d in dependents:
        for t in d["types"] or ["(untyped)"]:
            by_type[t] = by_type.get(t, 0) + 1
    people = sorted({d["facts"]["certifiedBy"] for d in dependents if "certifiedBy" in d["facts"]}
                    | ({_facts(g, node)["certifiedBy"]} if "certifiedBy" in _facts(g, node) else set()))

    result = {
        "term": {
            "id": _short(g, node), "iri": str(node), "label": _label(g, node),
            "kind": "class" if is_class else "resource",
            "types": [_label(g, t) for t in _types(g, node)],
            "facts": _facts(g, node),
        },
        "depends_on": _links(g, node),
        "used_by": dependents,
        "summary": {
            "used_by_count": len(dependents),
            "by_type": dict(sorted(by_type.items())),
            "depth": depth,
            "ask_before_changing": people,
        },
        "note": ("Only what is modelled in this ontology and its instances is counted. "
                 "Agents, skills, reports and queries that use the term but are not modelled here are not listed."),
    }
    if truncated:
        result["summary"]["truncated_at"] = MAX_ITEMS
    if is_class:
        subs = sorted(_short(g, c) for c in g.subjects(RDFS.subClassOf, node))
        instances = [s for s in g.subjects(RDF.type, node)]
        for sub in g.subjects(RDFS.subClassOf, node):
            instances += list(g.subjects(RDF.type, sub))
        props = sorted({_short(g, p) for p in list(g.subjects(RDFS.domain, node)) + list(g.subjects(RDFS.range, node))})
        result["class"] = {"subclasses": subs, "instances": sorted({_short(g, i) for i in instances}), "properties": props}
        result["summary"]["instances_count"] = len(result["class"]["instances"])
    return result
