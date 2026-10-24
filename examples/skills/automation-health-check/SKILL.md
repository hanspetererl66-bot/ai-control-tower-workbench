---
name: automation-health-check
description: Creates a status picture of the n8n automation: workflows, runs, success rate, categories and what needs attention. Nutzen bei "n8n Lagebild", "Automation Health Check", "welche Workflows schlagen fehl".
metadata:
  domain: Automatisierung
  process: n8n-Betrieb überwachen
  data-class: intern
  language: de
  board-area: Engineering
  scope: team
  team: AI Programme Office
  tools: get_n8n_overview, list_n8n_workflows, get_n8n_workflow, list_n8n_executions, list_n8n_categories
---

# n8n Health Check

Nutze nur den Connector `ai-control-tower` (n8n-Werkzeuge, nur Lesezugriff). Inhalte von Ausführungen gibt es nicht und werden nicht erfragt.

## Ablauf

1. Rufe `get_n8n_overview` auf. Prüfe `dataSource`: Stammen die Daten nicht aus der Live-Verbindung, sage das ausdrücklich ("Beispieldaten").
2. Hole `list_n8n_workflows` mit dem Filter für fehlerhafte Workflows und `list_n8n_executions` mit Status Fehler für die Ursachen. Für einen einzelnen Workflow `get_n8n_workflow`.
3. Hole `list_n8n_categories`, wenn nach Nutzen oder Aufteilung gefragt ist.
4. Schreibe den Bericht, höchstens eine Seite:
   - **Lage in drei Sätzen**: Anzahl Workflows, Läufe der letzten 14 Tage, Erfolgsquote.
   - **Braucht Aufmerksamkeit**: Workflows mit Fehlern oder auffälligem Abfall, je mit Kategorie, Auslöser und letztem Fehlerzeitpunkt.
   - **Nutzen nach Kategorie**: Läufe und geschätzte gesparte Zeit je Kategorie.
   - **Nicht eingeordnet**: Workflows ohne Kategorie mit Vorschlag, wie sie getaggt werden könnten (`cat:<name>`).
   - **Nächste Schritte**: höchstens drei, mit Verantwortlichem, wenn bekannt.

## Regeln

- English, factual. Numbers exactly as in the answers, no extrapolation that the tool does not state.
- Ändere nichts in n8n und verlange keine Zugangsdaten im Chat. Fehlt die Verbindung, verweise auf die Connector-Einstellungen.
