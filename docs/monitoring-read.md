# Monitoring lesend (Phase 1 der Autonomous-Operations-Roadmap, Stand 12.11.2026)

Der Alerts-Space (`it-operations`) kann echte Alarme eines Monitoring-Systems **nur lesen**. Gebaut ist das **neutrale Gerüst** und ein Adapter für **Zabbix** (Abschnitt unten); weitere Systeme gibt es erst, wenn sie gebraucht werden. Alles ist nur mit aufgezeichneten Fake-Antworten getestet, **nie gegen ein echtes Monitoring**.

## Weg
Alerts-Space → feste Nachricht `mon:alerts-request` (`src/monitoring-bridge.ts`) → Hauptprozess (IPC `monitoring-alerts`, `shared/monitoring-read.mjs`) → Monitoring. Der Agent hat **kein Werkzeug** dafür, es ist kein Connector. Zugang und Token bleiben im Hauptprozess: nie im Space, im Chat oder beim Agenten, nie in einer Fehlermeldung oder im Protokoll.

## Was nicht möglich ist (im Code, nicht nur im Vorsatz)
- Ein Adapter hat nur `name` und `listAlerts`. Alles andere wird abgelehnt, bevor es benutzt wird (`assertReadOnly`).
- Der eine vorhandene Adapter (`http-json`) sendet **nur GET**, mit dem Token im Header (nie in der Adresse), **ohne Weiterleitungen** (das Token würde mitwandern), nur über https (http nur für localhost), ohne Zugangsdaten in der Adresse, mit Zeitlimit (10 s) und Größenlimit (1 MB).
- Es gibt keine Methode, die etwas bestätigt, stumm schaltet oder ändert.

## Datenminimierung
Pro Alarm nur: Id, Host, Dienst, Schwere, Zeit (UTC auf die Minute), Text (höchstens 300 Zeichen, eine Zeile, ohne Steuerzeichen und spitze Klammern). Alles andere, was ein Monitoring schickt, wird verworfen. Höchstens 200 Alarme, jede Id einmal. **Kundennamen kommen nicht aus dem Monitoring**, sondern aus einer lokalen Zuordnung. Keine Messreihen, keine Kennwerte (entschieden: "minimal"); deshalb speist Phase 1 nur den Alerts-Space, nicht den Orchestrator (der braucht Kennwerte, das wäre eine spätere Erweiterung).

## Einrichten
1. **Zugang im Einstellungsdialog:** Einstellungen, Reiter **Monitoring**: Adresse (https) und ein Token, das **nur lesen** darf; *Save*, *Test the connection* (zeigt nur, wie viele Alarme die letzte Stunde hat), *Remove*. Das Token wird eingegeben, im Hauptprozess verschlüsselt im Schlüsselbund-Speicher abgelegt und **nie wieder angezeigt**: das Feld ist ein Passwortfeld, der Dialog erfährt nur, *dass* eines gespeichert ist. Eine neue Adresse ohne neues Token behält das gespeicherte Token. Das Token nie in den Chat schreiben.
   Alternativ (ohne Dialog) Umgebungsvariablen beim Start der App: `MONITORING_BASE_URL`, `MONITORING_READ_TOKEN`, optional `MONITORING_ADAPTER` (`http-json` oder `zabbix`). Der Hauptprozess liest sie beim Laden und **entfernt sie aus seiner Umgebung**, damit weder die Agenten-Laufzeit noch ein anderer Kindprozess sie erbt.
   **Berichtigung zu PR #365:** Dort stand, das Token gelange nie zum Agenten. Für den Weg über Umgebungsvariablen stimmte das nicht: die Agenten-Laufzeit (`goosed`) wurde mit der ganzen Umgebung des Hauptprozesses gestartet und hätte sie geerbt. Das ist behoben (Variablen werden beim Laden entnommen, der Eintrag `monitoring` im Geheimnis-Speicher geht nie in die Umgebung der Agenten-Laufzeit; Test `test/monitoring-config.test.mjs`). Betroffen wäre nur gewesen, wer die Variablen gesetzt hatte.
2. **Zuordnung** `goose-home/monitoring-map.json` (nicht im Repo), optional:
```json
{ "hosts": {
  "gw-01": { "customer": "Muster Industrie AG", "service": "Gateway", "impact": "high", "customerFacing": true, "dependsOn": ["gw-02"] },
  "gw-02": { "customer": "Muster Industrie AG", "impact": "high", "customerFacing": true }
} }
```
   `impact` (high, medium, low) und `customerFacing` steuern die Priorität, `dependsOn` die Zusammenführung zu Vorfällen. Unbekannte Hosts: Kunde leer, Wirkung medium.
3. **Neutrales Format** des Monitorings (oder eines kleinen Vorsatzes davor): `GET <MONITORING_BASE_URL>/alerts?since=<ISO-Zeit>&limit=<n>` mit `Authorization: Bearer <Token>`, Antwort `{ "alerts": [ { "id", "host", "service", "severity", "at", "text" } ] }`. Schwere: critical, high, medium, low (auch fatal, disaster, major, error, average, warning, minor, info).

## Zabbix (Adapter `zabbix`, 12.11.2026)
Gewählt im Reiter *Monitoring* der Einstellungen (Feld *Monitoring system*) oder mit `MONITORING_ADAPTER=zabbix`. Der Adapter spricht die JSON-RPC-API von Zabbix, **ab Version 6.4**, mit einem **API-Token** im Header `Authorization: Bearer <Token>` (nicht im Feld `auth`, das neuere Versionen ablehnen). Adresse ist die Adresse der Zabbix-Oberfläche, zum Beispiel `https://zabbix.example/zabbix`; `/api_jsonrpc.php` hängt der Adapter an.
- **Nur zwei Leseaufrufe, im Code festgelegt:** `problem.get` (offene Probleme seit dem gewählten Zeitpunkt, höchstens 200) und `trigger.get` (der Host zu jedem Problem). Eine andere Methode kann der Adapter nicht senden; ein Test prüft, dass im Quelltext keine Schreib-, Bestätigungs- oder Anmeldemethode vorkommt.
- **JSON-RPC schickt jeden Aufruf als HTTP POST, auch einen lesenden.** Dass der Adapter "nur liest", heißt hier: nur diese zwei Methoden. **Die eigentliche Absicherung ist der Token:** Lege in Zabbix einen Benutzer mit einer reinen Leserolle an (Rolle *User*, Lesezugriff nur auf die gewünschten Hostgruppen, keine Rechte zum Bestätigen oder Ändern) und erzeuge dafür den API-Token.
- **Abbildung:** `eventid` → Id, Host des Triggers → Host, Name des Problems → Text, Schwere 0 bis 5 → info, info, warning, average, high, disaster (dann wie sonst: low, low, medium, medium, high, critical), Zeit `clock` → UTC auf die Minute. Probleme, deren Trigger keinen Host hat, entfallen. Kunde, Wirkung und Abhängigkeiten kommen aus der lokalen Zuordnung (Host-Name = technischer Name in Zabbix).
- **Nicht abgebildet:** gelöste Probleme (`recent: false`), unterdrückte oder bestätigte Probleme werden nicht unterschieden, keine Messwerte.
- **Wenn der Token abgelehnt wird:** häufig leitet der Webserver den Header nicht weiter (bei Apache braucht es eine `SetEnvIf`-Regel für `Authorization`). Der Fehlertext nennt die Antwort von Zabbix ohne das Token.
- **Belegt** (Dokumentation): Bearer-Header als Anmeldeweg ([Zabbix API 7.0](https://www.zabbix.com/documentation/7.0/en/manual/api)), `problem.get` mit `time_from` und `recent` ([Referenz](https://www.zabbix.com/documentation/current/en/manual/api/reference/problem/get)). **Nicht gegen die Dokumentation geprüft:** `trigger.get` mit `selectHosts` (aus der Kenntnis der API) und das genaue Verhalten in deiner Version. Nicht gegen ein echtes Zabbix getestet, nur mit Antworten, wie die API sie liefert (Zahlen als Zeichenketten).

## Im Space
Knopf **Load live alerts** (nur in der App). Danach steht "live data" mit Adapter, Abrufzeit und Zeitraum da, die Alarme ersetzen die Demo-Daten und werden wie bisher bewertet und zu Vorfällen zusammengeführt (Abhängigkeiten aus der Zuordnung). **Reset to sample** bringt die Demo-Daten zurück; bei einem Fehler bleiben sie, mit dem Grund. Der Text wird weiter auf Anweisungen an KI-Assistenten geprüft (Quarantäne). **"Run in n8n" und "Ask Joule" sind aus, solange Live-Alarme da sind**: sie gehen nicht an den Chat.

## Nicht getestet
Gegen ein echtes Monitoring, mit echtem Token, in der Electron-App (der Brückenweg ist nur mit Fakes und im Browser mit einem Host-Mock geprüft). Der Einstellungsdialog ist nur mit Fakes und Quelltext-Prüfungen getestet, nicht im laufenden Fenster gesehen. Last und Seitenwechsel bei mehr als 200 Alarmen sind nicht behandelt.

Tests: `test/monitoring-read.test.mjs`, `test/monitoring-bridge.test.mjs`, `test/it-operations-live.test.mjs`, `test/monitoring-config.test.mjs`.
