# Monitoring lesend (Phase 1 der Autonomous-Operations-Roadmap, Stand 12.11.2026)

Der Alerts-Space (`it-operations`) kann echte Alarme eines Monitoring-Systems **nur lesen**. Gebaut ist das **neutrale Gerüst**; ein Adapter für ein bestimmtes System (Prometheus, Dynatrace, Zabbix …) fehlt bewusst, bis du das System nennst. Alles ist nur mit aufgezeichneten Fake-Antworten getestet, **nie gegen ein echtes Monitoring**.

## Weg
Alerts-Space → feste Nachricht `mon:alerts-request` (`src/monitoring-bridge.ts`) → Hauptprozess (IPC `monitoring-alerts`, `shared/monitoring-read.mjs`) → Monitoring. Der Agent hat **kein Werkzeug** dafür, es ist kein Connector. Zugang und Token bleiben im Hauptprozess: nie im Space, im Chat oder beim Agenten, nie in einer Fehlermeldung oder im Protokoll.

## Was nicht möglich ist (im Code, nicht nur im Vorsatz)
- Ein Adapter hat nur `name` und `listAlerts`. Alles andere wird abgelehnt, bevor es benutzt wird (`assertReadOnly`).
- Der eine vorhandene Adapter (`http-json`) sendet **nur GET**, mit dem Token im Header (nie in der Adresse), **ohne Weiterleitungen** (das Token würde mitwandern), nur über https (http nur für localhost), ohne Zugangsdaten in der Adresse, mit Zeitlimit (10 s) und Größenlimit (1 MB).
- Es gibt keine Methode, die etwas bestätigt, stumm schaltet oder ändert.

## Datenminimierung
Pro Alarm nur: Id, Host, Dienst, Schwere, Zeit (UTC auf die Minute), Text (höchstens 300 Zeichen, eine Zeile, ohne Steuerzeichen und spitze Klammern). Alles andere, was ein Monitoring schickt, wird verworfen. Höchstens 200 Alarme, jede Id einmal. **Kundennamen kommen nicht aus dem Monitoring**, sondern aus einer lokalen Zuordnung. Keine Messreihen, keine Kennwerte (entschieden: "minimal"); deshalb speist Phase 1 nur den Alerts-Space, nicht den Orchestrator (der braucht Kennwerte, das wäre eine spätere Erweiterung).

## Einrichten
1. **Zugang** als Einstellungen der App (Schlüsselbund-Speicher) oder als Umgebungsvariablen beim Start: `MONITORING_BASE_URL` (https), `MONITORING_READ_TOKEN` (ein Token, das **nur lesen** darf), optional `MONITORING_ADAPTER` (nur `http-json`). Ein Eingabedialog existiert noch nicht. Das Token nie in den Chat schreiben.
2. **Zuordnung** `goose-home/monitoring-map.json` (nicht im Repo), optional:
```json
{ "hosts": {
  "gw-01": { "customer": "Muster Industrie AG", "service": "Gateway", "impact": "high", "customerFacing": true, "dependsOn": ["gw-02"] },
  "gw-02": { "customer": "Muster Industrie AG", "impact": "high", "customerFacing": true }
} }
```
   `impact` (high, medium, low) und `customerFacing` steuern die Priorität, `dependsOn` die Zusammenführung zu Vorfällen. Unbekannte Hosts: Kunde leer, Wirkung medium.
3. **Neutrales Format** des Monitorings (oder eines kleinen Vorsatzes davor): `GET <MONITORING_BASE_URL>/alerts?since=<ISO-Zeit>&limit=<n>` mit `Authorization: Bearer <Token>`, Antwort `{ "alerts": [ { "id", "host", "service", "severity", "at", "text" } ] }`. Schwere: critical, high, medium, low (auch fatal, disaster, major, error, average, warning, minor, info).

## Im Space
Knopf **Load live alerts** (nur in der App). Danach steht "live data" mit Adapter, Abrufzeit und Zeitraum da, die Alarme ersetzen die Demo-Daten und werden wie bisher bewertet und zu Vorfällen zusammengeführt (Abhängigkeiten aus der Zuordnung). **Reset to sample** bringt die Demo-Daten zurück; bei einem Fehler bleiben sie, mit dem Grund. Der Text wird weiter auf Anweisungen an KI-Assistenten geprüft (Quarantäne). **"Run in n8n" und "Ask Joule" sind aus, solange Live-Alarme da sind**: sie gehen nicht an den Chat.

## Nicht getestet
Gegen ein echtes Monitoring, mit echtem Token, in der Electron-App (der Brückenweg ist nur mit Fakes und im Browser mit einem Host-Mock geprüft). Der Eingabedialog für Zugang und Token fehlt. Last und Seitenwechsel bei mehr als 200 Alarmen sind nicht behandelt.

Tests: `test/monitoring-read.test.mjs`, `test/monitoring-bridge.test.mjs`, `test/it-operations-live.test.mjs`.
