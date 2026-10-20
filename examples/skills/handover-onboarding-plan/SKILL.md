---
name: handover-onboarding-plan
description: Erstellt nach dem Abschluss einen Übergabe- und Onboarding-Plan an Service und Customer Success: Ansprechpartner, Meilensteine, Verbrauch, erste 90 Tage. Nutzen bei "Übergabe", "Onboarding", "Kickoff".
metadata:
  domain: Vertrieb
  process: Übergabe und Onboarding
  data-class: intern
  language: de
  board-area: Sales
  scope: team
  team: Sales Operations
  tools: get_contract, get_product_overview, get_ai_consumption, create_ticket
---

# Übergabe und Onboarding

Phase **Contract** und danach. Der Vertrag ist unterschrieben, jetzt geht es um den Start beim Kunden.

## Ablauf

1. Hole den Vertrag mit `get_contract`, das Produkt mit `get_product_overview` und bei AI-Produkten den Verbrauch mit `get_ai_consumption`.
2. Schreibe den Plan auf einer Seite:
   - **Übergabe**: Vertrag, Laufzeit, Service-Level, Ansprechpartner beider Seiten (aus den Daten), Besonderheiten aus den Verhandlungen (nur was die Person nennt).
   - **Kickoff**: Ziel, Teilnehmer, Agenda, Termin (Vorschlag).
   - **Erste 90 Tage**: Meilensteine bei 30, 60 und 90 Tagen mit Erfolgskriterium. Bei Verbrauchsverträgen: erwarteter Verbrauch gegen Plan.
   - **Risiken**: höchstens drei, mit Gegenmaßnahme.
   - **Fristen**: Ende der Laufzeit, letzter Kündigungstag, automatische Verlängerung.
3. Biete an, die Übergabe als **Ticket** für den Service anzulegen. Lege es erst nach ausdrücklicher Bestätigung mit `create_ticket` an (Titel, Produkt, Priorität, Beschreibung). Frage vorher, wenn etwas fehlt.

## Regeln

- Keine Meilensteine oder Zahlen erfinden, die nicht aus den Daten oder von der Person stammen.
- Das Ticket ist die einzige schreibende Handlung. Alles andere bleibt Entwurf.
