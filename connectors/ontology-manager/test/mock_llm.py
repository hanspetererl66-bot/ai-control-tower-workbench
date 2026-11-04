"""A tiny OpenAI-compatible /chat/completions server for testing the document pipeline.

It is not a language model: it answers OntoRAG's two prompt types (schema induction and
alignment) from fixed keyword rules, so the plumbing can be tested without a key.
"""
from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

CALLS: list[str] = []


def _sentence_with(text: str, word: str) -> str:
    for s in re.split(r"(?<=[.!?])\s+", text):
        if word in s.lower():
            return " ".join(s.split()[:18])
    return ""


def _extraction(chunk: dict) -> dict:
    text = chunk.get("text", "")
    low = text.lower()
    classes, dprops, oprops = [], [], []

    def ev(word):
        return [{"chunk_id": chunk.get("chunk_id", ""), "quote": _sentence_with(text, word)}]

    if "supplier" in low:
        classes.append({"name": "Supplier", "description": "A company that delivers goods or services.", "evidence": ev("supplier")})
        if "payment terms" in low:
            dprops.append({"name": "paymentTerms", "domain": "Supplier", "range": "string",
                           "description": "Agreed payment terms.", "evidence": ev("payment terms")})
    if "purchase order" in low:
        classes.append({"name": "PurchaseOrder", "description": "An order placed with a supplier.", "evidence": ev("purchase order")})
        if "supplier" in low:
            oprops.append({"name": "orderedFrom", "domain": "PurchaseOrder", "range": "Supplier",
                           "description": "The supplier an order is placed with.", "evidence": ev("purchase order")})
    if "intercompany" in low:
        classes.append({"name": "IntercompanyDifference", "description": "A balance difference between two group companies.",
                        "evidence": ev("intercompany")})
    return {"chunk_id": chunk.get("chunk_id", ""),
            "proposed_additions": {"classes": classes, "datatype_properties": dprops, "object_properties": oprops, "events": []},
            "reuse_instead_of_create": [], "alias_or_merge_suggestions": [], "warnings": []}


def _alignment(prompt: str) -> dict:
    block = re.search(r"INDUCED [A-Z ]+ \(newly extracted from documents\):\n(.*?)\n\nBASELINE", prompt, re.S)
    induced = json.loads(block.group(1)) if block else []
    out = []
    for item in induced:
        name = item.get("name", "")
        a = {"induced_name": name, "action": "new", "baseline_name": "", "baseline_origin": "",
             "confidence": "high", "rationale": "No match in the baselines."}
        if name in ("Supplier", "PurchaseOrder", "orderedFrom", "paymentTerms") and "procurement_docs" in prompt:
            a.update(action="reuse", baseline_name=name, baseline_origin="procurement_docs", rationale="Same concept.")
        elif name == "IntercompanyDifference" and "FinancialDocument" in prompt:
            a.update(action="extend", baseline_name="FinancialDocument", baseline_origin="werkbank_fin",
                     confidence="medium", rationale="A kind of financial document.")
        if "induced_domain" in prompt or "baseline_domain" in prompt:
            a.update(induced_domain=item.get("domain", ""), induced_range=item.get("range", ""))
        out.append(a)
    return {"alignments": out}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output quiet
        pass

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        prompt = body["messages"][-1]["content"]
        if "ontology induction engine" in prompt:
            m = re.search(r"CHUNK DTO \(JSON\):\n(.*?)\n\nCURRENT SCHEMA CARD", prompt, re.S)
            reply = _extraction(json.loads(m.group(1)) if m else {})
            CALLS.append("extract")
        elif "ontology alignment engine" in prompt:
            reply = _alignment(prompt)
            CALLS.append("align")
        else:
            reply = {}
            CALLS.append("other")
        payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": json.dumps(reply)}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def start() -> tuple[HTTPServer, str]:
    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"
