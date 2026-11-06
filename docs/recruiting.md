# Recruiting in der Datenbank (Supabase)

Stand 06.11.2026. Gehört zum Space **Recruiting Workbench** (`examples/recruiting-workbench/`). Joule bereitet vor, ein Mensch entscheidet.

## Was gebaut ist
- **Migration** `supabase/migrations/20261106_028_recruiting.sql`, Schema `recruiting`:
  - `requisition` (Stelle, Hiring Manager als E-Mail, Ziel in Tagen, offen/besetzt/abgebrochen, Angebote)
  - `criterion` (Muss/Kann, Text oder Jahre, Suchbegriffe); ein Kriterium, das ein geschütztes Merkmal nennt (Alter, Geschlecht, Herkunft …), wird abgelehnt
  - `candidate` (nur Pseudonym `C-4101`, Stufe, Datum, CV-Zeilen). **Keine Personenspalten.** CV-Zeilen mit E-Mail, Link, Telefonnummer oder 9+ Ziffern werden abgelehnt
  - `proposal` (Vorschlag: move/remind/ask; Wortlaut ohne Ablehnungswörter; ein offener Vorschlag je Kandidat und Art; nach der Entscheidung endgültig) und `proposal_event` (nur anhängen)
- **Funktionen** (nur `service_role`, wie bei den anderen Connectoren): `recruiting_snapshot`, `recruiting_proposal_create`, `recruiting_proposals_list`, `recruiting_proposal_decide`.
- **Sichtbarkeit:** der Hiring Manager der Stelle und die Gruppe "Governance board". Entscheiden darf **nur** der Hiring Manager der Stelle (auch das Board nicht).
- **Connector** `werkbank-workspace` 1.3.0 (`connectors/_lib/server/recruiting.mjs`, 102 Tools in den sieben Connectoren): `recruiting_get_pipeline`, `recruiting_get_shortlist`, `recruiting_list_proposals` (lesend) und `recruiting_create_proposal` (schreibt nur einen Vorschlag; Wortlaut und Begründung kommen aus dem Code, nicht vom Agenten; für Kandidaten, die die Kriterien nicht erfüllen, gibt es keinen Vorschlag). Es gibt **kein** Werkzeug zum Entscheiden oder Ablehnen. `decideProposal` ist eine Funktion für den Hauptprozess.
- **Eine Logik:** `connectors/_lib/server/recruiting-logic.mjs` rechnet Status, Gruppen und Reihenfolge. Die Seite trägt eine eingebettete Kopie (`npm run sync:mockups`), ein Test hält beide gleich. Joule im Chat und der Space können sich deshalb nicht widersprechen.

## Einrichten
1. Migration 028 **von Hand** im Supabase-SQL-Editor ausführen (nichts davon ist auf dem echten Supabase angewendet).
2. Beispieldaten für die eigene E-Mail erzeugen und im SQL-Editor ausführen: `npm run recruiting:seed -- --manager du@beispiel.de --out /tmp/seed.sql`. Sie sind erfunden. Wiederholen ist harmlos.
3. Connector `werkbank-workspace` neu installieren (die Werkzeugliste wird bei der Installation gespeichert).
4. Im Chat fragen, z. B. "Which requisitions are late?" oder "Show the shortlist for REQ-2204".

## Grenzen
- **Kein Import aus SmartRecruiters** (die API ist nicht geprüft); die Daten kommen aus dem Seed. Freigeben ändert in keinem Recruiting-System etwas.
- **Keine Oberfläche und kein IPC** zum Freigeben oder Ablehnen. Der Vorschlag wartet in der Datenbank; `decideProposal` ist da, aber nirgends angebunden. Der Space zeigt eine Simulation.
- Identität nur die E-Mail (kein SSO), wie bei den anderen Tabellen.
- Kriterienprüfung ist Textsuche ohne Synonyme. Die Schutzlisten (Merkmale, Telefonformate) sind Wortlisten und Muster, keine Garantie.
- EU AI Act (Einstellung gilt als Hochrisiko), Betriebsrat und Datenschutz vor echter Nutzung klären.

## Nicht getestet
Echtes Supabase, Electron-App, echter Agent mit den Werkzeugen. Getestet: Migration und alle Regeln gegen Postgres 16 (`test/skill-lifecycle-sql.test.mjs`, SQL-Teil "recruiting"), Connector mit Fake-Datenbank (`test/recruiting-connector.test.mjs`), Space (`test/recruiting-workbench.test.mjs`).
