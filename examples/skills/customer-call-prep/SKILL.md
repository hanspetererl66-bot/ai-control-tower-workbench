---
name: customer-call-prep
description: Bereitet ein Kundengespräch mit dem Sub4Me-Testkunden vor: Verträge, Fristen, offene Angebote, AI-Unit-Verbrauch und Tickets auf einer Seite. Nutzen bei "Kundengespräch vorbereiten", "Kundentermin", "Account-Briefing".
metadata:
  domain: Vertrieb
  process: Kundengespräch vorbereiten
  data-class: intern
  language: de
  board-area: Sales
  scope: team
  team: Account Management
  tools: get_customer_overview, get_product_overview, get_contract, get_offer, search_sub4me
---

# Kundengespräch vorbereiten

Nutze nur den Connector `ai-control-tower` (Sub4Me-Werkzeuge). Die Daten sind Beispieldaten des Testkunden; erfinde nichts dazu.

## Ablauf

1. Rufe `get_customer_overview` auf. Frage nur nach, wenn nicht klar ist, um welchen Kunden oder welches Produkt es im Gespräch geht.
2. Geht es um ein Produkt, hole `get_product_overview`. Geht es um einen Vertrag oder ein Angebot mit Nummer, hole `get_contract` oder `get_offer`. Ist unklar, was gemeint ist, nutze `search_sub4me`.
3. Prüfe in jeder Antwort das Feld `dataSource` und nenne es am Ende ("Beispieldaten" oder "Supabase").
4. Schreibe das Briefing, höchstens eine Seite, in dieser Reihenfolge:
   - **Kunde in drei Sätzen**: Stammdaten, Verträge nach Status, Jahreswert.
   - **Was heute zählt**: Fristen (letzter Kündigungstag, Gültigkeit von Angeboten), Verbrauch über Plan, offene Tickets mit hoher Priorität. Nur Punkte aus `highlights` und den Werkzeugantworten.
   - **Offene Angebote**: Produkt, Jahreswert, Veränderung zu heute, Phase, Rabatt, nächster Schritt, Wettbewerber, Ansprechpartner bei SAP.
   - **Vertragsdetails, falls gefragt**: Zahlungsbedingungen, Service-Level, Preissteigerungsgrenze, automatische Verlängerung.
   - **Gesprächsziele**: höchstens drei Vorschläge, jeweils mit Begründung aus den Daten.
   - **Fragen an den Kunden**: zwei bis drei offene Punkte.

## Regeln

- Deutsch, sachlich, kurze Sätze. Zahlen exakt aus den Werkzeugantworten, Euro und Prozent mit Einheit.
- Keine Zusagen, keine Rabatte und keine Preise, die nicht in den Daten stehen.
- Ein fehlendes Werkzeug oder ein Fehler ist kein Abbruchgrund: Briefing mit den vorhandenen Daten schreiben und die Lücke nennen.
