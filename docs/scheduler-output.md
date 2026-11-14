# Scheduler: wohin das Ergebnis geht

Jeder Job hat ein Ziel für sein Ergebnis (Formular "Write the result to"). Geschrieben wird **nach dem Lauf von der App** mit den gespeicherten Einstellungen des Jobs, nicht vom Agenten. Schlägt das Schreiben fehl, steht der Lauf als Failed in der Historie, die Notiz nennt den Grund (der Jobzustand "Failing" greift dann).

| Ziel | Was passiert | Braucht |
|---|---|---|
| Chat only | Antwort bleibt im Chat (wie bisher) | nichts |
| Email draft | Entwurf in Gmail, wird nie gesendet | Connector `gmail` |
| File on this computer | neue Datei `workspace/job-results/<Ordner>/<job>-<datum>.md` oder `.txt`, bestehende Dateien werden nie überschrieben | Desktop-App |
| Slack channel | Nachricht in den Kanal (`#name` oder Id) | Connector `slack`, Bot im Kanal |
| Notion page | neue Seite unter einer Seite oder in einer Datenbank | Connector `notion` (seit PR #472 mit Schreiben), Seite mit der Integration geteilt |
| Databricks table | eine Zeile je Lauf in eine bestehende Tabelle | Connector `databricks` (neues Werkzeug `databricks_append_result`), SQL-Warehouse |

## Databricks-Tabelle anlegen (einmalig, von Hand)
```sql
CREATE TABLE main.ops.job_results (
  job_id   STRING,
  job_name STRING,
  run_at   TIMESTAMP,
  result   STRING
);
```
Der Connector legt nichts an und führt nur das feste `INSERT INTO <Tabelle> (job_id, job_name, run_at, result) VALUES (:job_id, :job_name, :run_at, :result)` mit gebundenen Werten aus. `databricks_run_sql` bleibt rein lesend. Der Token braucht dafür Schreibrecht auf genau diese Tabelle.

## Grenzen
- Läuft nur, solange die App offen ist (wie der ganze Scheduler); Beispiel-Jobs schreiben nirgends hin.
- Das Ziel gilt für Agenten, Workflows und Skills; als Ergebnis zählt der Antworttext aus dem Chat.
- Slack kürzt auf 3500 Zeichen, Notion auf 100 Zeilen, Databricks auf 20000 Zeichen.
- Keine Wiederholung bei Fehlern, keine zweiten Ziele je Job.
