---
name: access-review-prep
description: Prepares the access review: over-privileged agents with access level, owner, deadline and order of clean-up. Nutzen bei "Berechtigungsreview", "überprivilegierte Agenten", "Least Privilege prüfen".
metadata:
  domain: Sicherheit & Zugriff
  process: Berechtigungsreview
  data-class: vertraulich
  language: de
  board-area: Engineering
  scope: team
  team: Platform Security
  tools: get_overprivileged_agents, list_agents, get_risk
---

# Berechtigungsreview vorbereiten

Nutze nur den Connector `ai-control-tower`. Die Daten sind Beispieldaten; behandle sie trotzdem vertraulich und gib sie nicht außerhalb des Gesprächs weiter.

## Ablauf

1. Rufe `get_overprivileged_agents` auf und `get_risk` mit `R2` für Verantwortlichen, Frist und Fortschritt. Prüfe `dataSource` und nenne es am Ende.
2. Für Details zu Agenten einer Gruppe nutze `list_agents` mit Filter (zum Beispiel nur Produktion).
3. Ordne die Agenten nach Dringlichkeit: Vollzugriff auf Produktivsysteme zuerst, dann Schreibrechte über dem nötigen Umfang, dann Lesezugriff.
4. Schreibe die Vorlage für den Review, höchstens eine Seite:
   - **Stand**: Anzahl überprivilegierter Agenten, bereits bereinigt, Fortschritt in Prozent, Frist.
   - **Reihenfolge der Bereinigung**: Tabelle mit Agent, Gruppe, Zugriffsstufe, Eigentümer und vorgeschlagenem Zielzugriff.
   - **Rückfragen an Eigentümer**: je Gruppe eine Frage ("Braucht der Agent Schreibzugriff auf …?").
   - **Entscheidungen**: höchstens drei Punkte für das Security-Gremium, mit Verantwortlichem und Datum.

## Regeln

- English, factual. Numbers and names exactly as in the answers.
- Schlage keine konkreten Rechteänderungen in Systemen vor, die nicht in den Daten stehen. Du führst keine Änderungen aus.
