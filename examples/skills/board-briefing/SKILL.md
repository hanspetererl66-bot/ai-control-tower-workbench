---
name: board-briefing
description: Erstellt ein einseitiges Board-Briefing auf Deutsch aus den AI-Control-Tower-Daten (Risiken, Agenten, Budget, EU-AI-Act-Audit). Nutzen bei "Board-Briefing", "Management Summary", "Lagebild AI Control Tower".
metadata:
  domain: Governance & Risiko
  process: Board-Reporting
  data-class: intern
  language: de
  team: AI Programme Office
  tools: get_risks, get_agent_overview, get_overprivileged_agents, get_budget, list_agents
---

# Board-Briefing aus dem AI Control Tower

Nutze nur den Connector `ai-control-tower`. Erfinde keine Zahlen.

## Ablauf

1. Rufe `get_risks` (alle), `get_agent_overview`, `get_overprivileged_agents` und `get_budget` auf. Bei Fragen zu einzelnen Agenten zusätzlich `list_agents`.
2. Prüfe in jeder Antwort das Feld `dataSource`. Steht dort nicht `supabase`, sage das im Briefing ausdrücklich ("Beispieldaten aus data.json").
3. Prüfe bei `get_budget` das Feld `reconciliation.reconciles`. Ist es `false`, nenne die Abweichung statt sie zu glätten.
4. Schreibe das Briefing, maximal eine Seite, in dieser Reihenfolge:
   - **Lage in drei Sätzen**: Gesamtbild aus Risiken, Agenten und Budget.
   - **Die drei kritischsten Risiken**: Titel, Verantwortlicher, ETA, Fortschritt in Prozent. Risiken unter der Schwelle (`belowThreshold`) zuerst.
   - **Agenten**: Registrierte und produktive Agenten, nicht registrierte Assets, überprivilegierte Agenten mit der kritischsten Gruppe.
   - **Budget**: Teams über Plan (`status: over budget`), Spielraum bis zur Obergrenze.
   - **EU AI Act**: Stand der Konformitätsprüfungen und Tage bis zum externen Audit am 12.12.2026 (rechne ab dem heutigen Datum).
   - **Entscheidungen für das Board**: höchstens drei konkrete Punkte mit Verantwortlichem.
5. Schließe mit einer Zeile: Datenquelle, Hinweis "Beispieldaten, keine Live-Messung" falls zutreffend, und dem Tab im Control Tower, der die Details zeigt (`view.tab` aus der Antwort).

## Regeln

- Deutsch, sachlich, kurze Sätze. Zahlen exakt aus den Werkzeugantworten, Prozent und Euro mit Einheit.
- Keine Empfehlungen ohne Verantwortlichen und Datum.
- Wenn ein Werkzeug fehlt oder einen Fehler liefert, brich nicht ab: schreibe das Briefing mit den vorhandenen Daten und benenne die Lücke.
