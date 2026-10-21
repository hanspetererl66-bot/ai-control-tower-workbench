---
name: pipeline-review
description: Fasst die Pipeline für die Wochenrunde zusammen: Phasen, Werte, überfällige Schritte, Risiken und Forecast aus Angeboten und Verträgen. Nutzen bei "Pipeline-Review", "Forecast", "Wochenrunde Vertrieb".
metadata:
  domain: Vertrieb
  process: Pipeline besprechen
  data-class: vertraulich
  language: de
  board-area: Sales
  scope: team
  team: Sales Operations
  tools: list_offers, list_contracts, get_customer_overview
---

# Pipeline-Review

Quer über alle Phasen. Es gibt kein CRM: Verlässliche Zahlen kommen aus den Sub4Me-Angeboten und -Verträgen. Interest, Lead und Opportunity kennt nur der Mockup-Space Sales oder die Angaben der Person.

## Ablauf

1. Hole mit `list_offers` alle offenen Angebote und mit `list_contracts` die Verträge, die in der Verlängerung oder bald auslaufen. Nutze `get_customer_overview` für die Summe.
2. Gruppiere die Angebote nach Phase (Proposal sent, Negotiation, ...) mit Anzahl und Jahreswert.
3. Berechne den **gewichteten Forecast** nur aus den Feldern `annualEur` und `probabilityPct`, wenn beide vorhanden sind. Zeige die Rechnung.
4. Liste **Aufmerksamkeitspunkte**: überfällige oder in der Vergangenheit liegende nächste Schritte, Angebote mit Freigabe offen, Gültigkeit unter 30 Tagen, Wettbewerber aktiv, Verträge mit Kündigungsfrist unter 90 Tagen.
5. Schließe mit höchstens **drei Entscheidungen** für die Runde.

## Regeln

- Eine Seite, Zahlen mit Einheit, Quelle am Ende (`dataSource`).
- Keine Phasen oder Werte erfinden. Fehlt etwas, schreibe "nicht in den Daten".
