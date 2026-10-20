---
name: customer-call-prep
description: Bereitet ein Kundengespräch vor: Verträge, Fristen, offene Angebote, Verbrauch, Tickets, offene Rechnungen und Forecast-Änderungen auf einer Seite, mit Quellen. Nutzen bei "Kundengespräch vorbereiten", "Kundentermin", "Account-Briefing".
metadata:
  domain: Vertrieb
  process: Kundengespräch vorbereiten
  data-class: intern
  language: de
  board-area: Sales
  scope: team
  team: Account Management
  tools: get_customer_overview, get_product_overview, get_contract, get_offer, search_sub4me, list_customers, list_tickets, list_invoices
---

# Kundengespräch vorbereiten

Nutze nur den Connector `ai-control-tower` (Sub4Me-Werkzeuge). Alle Sub4Me-Werkzeuge nehmen `customer` (`muster`, `hanse`); frage mit `list_customers` nach, wenn der Kunde unklar ist. Die Daten sind Beispieldaten; erfinde nichts dazu.

## Ablauf

1. Rufe `get_customer_overview` auf. Frage nur nach, wenn nicht klar ist, um welchen Kunden oder welches Produkt es im Gespräch geht.
2. Geht es um ein Produkt, hole `get_product_overview`. Geht es um einen Vertrag oder ein Angebot mit Nummer, hole `get_contract` oder `get_offer`. Ist unklar, was gemeint ist, nutze `search_sub4me`.
3. Hole `list_tickets` (Status offen) und `list_invoices` (Status Open oder Overdue) für den Kunden. Ordne Tickets dem Produkt des Gesprächs zu, nenne überfällige Rechnungen mit Vertrag, Betrag und Fälligkeit.
4. Hat die Person die Änderungen der Pipeline seit der Vorwoche genannt oder liegt der Sales Space vor, nimm Kategorie-, Wahrscheinlichkeits-, Wert- und Termin-Änderungen mit ihrem Grund auf. Gibt es sie nicht, schreibe "Forecast-Änderungen: nicht geprüft".
5. Prüfe in jeder Antwort das Feld `dataSource` und nenne es am Ende ("Beispieldaten" oder "Supabase").
6. Schreibe das Briefing, höchstens eine Seite, in dieser Reihenfolge:
   - **Kunde in drei Sätzen**: Stammdaten, Verträge nach Status, Jahreswert.
   - **Kontext aus allen Daten**: offene Tickets (Nummer, Priorität, Status), überfällige oder strittige Rechnungen, Forecast-Änderungen. Ein Satz, was das für das Gespräch heißt (zum Beispiel keinen Fixtermin zusagen, solange ein Very-high-Ticket offen ist, oder vorab bei Finance klären, ob eine überfällige Rechnung strittig ist).
   - **Was heute zählt**: Fristen (letzter Kündigungstag, Gültigkeit von Angeboten), Verbrauch über Plan, offene Tickets mit hoher Priorität. Nur Punkte aus `highlights` und den Werkzeugantworten.
   - **Offene Angebote**: Produkt, Jahreswert, Veränderung zu heute, Phase, Rabatt, nächster Schritt, Wettbewerber, Ansprechpartner bei SAP.
   - **Vertragsdetails, falls gefragt**: Zahlungsbedingungen, Service-Level, Preissteigerungsgrenze, automatische Verlängerung.
   - **Gesprächsziele**: höchstens drei Vorschläge, jeweils mit Begründung aus den Daten.
   - **Fragen an den Kunden**: zwei bis drei offene Punkte.

## Regeln

- Jede Aussage nennt ihre Quelle in Klammern (Ticket-, Rechnungs-, Vertrags- oder Angebotsnummer, Mail oder Call). Was keine Quelle hat, steht nicht im Briefing.
- Deutsch, sachlich, kurze Sätze. Zahlen exakt aus den Werkzeugantworten, Euro und Prozent mit Einheit.
- Keine Zusagen, keine Rabatte und keine Preise, die nicht in den Daten stehen.
- Ein fehlendes Werkzeug oder ein Fehler ist kein Abbruchgrund: Briefing mit den vorhandenen Daten schreiben und die Lücke nennen.
