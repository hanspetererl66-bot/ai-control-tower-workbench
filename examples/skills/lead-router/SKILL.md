---
name: lead-router
description: Assigns a qualified lead to an account manager by region, industry and size and explains the choice. Nutzen bei "Lead zuweisen", "wer bekommt den Lead", "Routing".
metadata:
  domain: Vertrieb
  process: Leads zuweisen
  data-class: intern
  language: de
  board-area: Sales
  scope: team
  team: Sales Development
  tools: get_customer_overview, list_offers
---

# Lead zuweisen

Phase **Lead**. Es gibt kein Zuordnungssystem: Die Regeln unten sind die Beispielregeln der Werkbank. Die Person kann eigene Regeln in den Chat geben, dann gelten diese.

## Beispielregeln (fiktiv)

| Bedingung | Zuständig |
|---|---|
| Bestandskunde | Der Owner des letzten Angebots (aus `list_offers`) |
| Region DACH, Fertigung, Handel | Mara Weber, Account Manager |
| Region DACH, Logistik, Energie | Dev Patel, Account Executive |
| Joule-, KI- oder BTP-Thema | zusätzlich Lukas Fischer, Joule Specialist |
| Außerhalb DACH | Rückfrage an die Vertriebsleitung |

## Ablauf

1. Hole bei Bestandskunden `get_customer_overview` oder `list_offers`, um den bisherigen Owner zu finden.
2. Wende die Regeln von oben nach unten an. Die erste passende Zeile gewinnt, eine Zusatzzeile (Joule) kommt dazu.
3. Antworte mit: Zuständig, Regel, die gepasst hat, und eine Alternative, falls die Person ausgelastet ist.
4. Passt keine Regel, sage das und frage nach, statt zu raten.

## Regeln

- Keine Namen erfinden, die nicht in den Regeln oder Daten stehen.
- Die Zuweisung ist ein Vorschlag. Nichts wird versendet oder im System geändert.
