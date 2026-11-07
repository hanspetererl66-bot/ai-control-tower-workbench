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
1. Migrationen 028 und 029 sind auf dem Supabase-Projekt angewendet (06.11.2026); 030 (Kriterien) **noch nicht**, sie wird nach 028 ausgeführt.
2. Beispieldaten für die eigene E-Mail erzeugen und im SQL-Editor ausführen: `npm run recruiting:seed -- --manager du@beispiel.de --out /tmp/seed.sql`. Sie sind erfunden. Wiederholen ist harmlos.
3. Connector `werkbank-workspace` neu installieren (die Werkzeugliste wird bei der Installation gespeichert).
4. Im Chat fragen, z. B. "Which requisitions are late?" oder "Show the shortlist for REQ-2204".

## SmartRecruiters (Mock)
Es gibt **keine echte Verbindung**; Hans-Peter hat keinen Zugang und wollte keinen anfragen. Gebaut ist der ganze Weg gegen einen Mock:
- `connectors/_lib/server/smartrecruiters.mjs`: Mock-Client (liest `smartrecruiters-mock.json`, erzeugt mit `npm run smartrecruiters:mock`; Form wie Antworten der Customer API, **erfundene** Namen, E-Mails und Telefonnummern), `mapToRecruiting` (kopiert nur erlaubte Felder, Statusabbildung NEW→Applied, IN_REVIEW/PHONE_SCREEN→Screening, INTERVIEW→Interview, OFFER→Offer; HIRED, REJECTED, WITHDRAWN werden nicht importiert; CV-Zeilen mit E-Mail, Link oder Telefon werden gestrichen und gezählt) und `importFromSmartRecruiters`.
- Migration `20261106_029_recruiting_import.sql` (angewendet, nach 028): `source_ref` an Stellen und Kandidaten, Funktion `recruiting_import` (nur service_role; neue Kandidaten bekommen das Pseudonym C-5001 ff.; ein zweiter Lauf aktualisiert statt zu doppeln; `stage_since` ändert sich nur bei neuer Stufe; fremde Stellen anderer Hiring Manager werden abgelehnt). `seed.sql` markiert die Beispielzeilen als schon importiert, ein erster Mock-Import ändert sie also nur, statt Dubletten anzulegen.
- App: Knopf **Import from the mock** in Hiring approvals (IPC `recruiting-import`, nur der Mock, nie das Netz).
- `createHttpClient` ist die Vorlage für später (Header `X-SmartToken`, Basis `api.smartrecruiters.com`, Key geht nur an smartrecruiters.com). **Pfade und Feldnamen sind nicht gegen die echte API geprüft**, nur mit Fake-`fetch` getestet, und sie ist nirgends angeschlossen.
- **Offen für eine echte Anbindung:** Der Mock liefert CV-Text (`resumeLines`), die echte API liefert Anhänge; dafür bräuchte es eine Textextraktion samt Datenschutzklärung. Kriterien der Hiring Manager kommen nicht aus SmartRecruiters, sondern müssen bei uns gesetzt werden (eine Oberfläche dafür gibt es noch nicht, importierte neue Stellen haben deshalb keine Kriterien und keine Shortlist).

## Grenzen
- **Kein echter Import aus SmartRecruiters**, nur der Mock (siehe oben); die Daten kommen aus dem Seed oder dem Mock. Freigeben ändert in keinem Recruiting-System etwas.
- **Freigabe-Oberfläche:** Admin → Kachel "Hiring approvals" (`src/ui/HiringApprovals.tsx`, Logik `src/hiring.ts`). Reiter Waiting/Decided, Release oder Decline mit Notiz; Weg: IPC `recruiting-proposals` / `recruiting-decide` → `work-store.mjs` (feste Filter, E-Mail erzwungen) → `decideProposal`. Entscheiden klappt nur mit der E-Mail, die als Hiring Manager im Seed steht (die Datenbank sagt sonst "only the hiring manager"). Die Kachel liegt im Admin-Bereich, ist aber nicht an eine Admin-Rolle gebunden. Der Space zeigt weiter eine Simulation.
- Identität nur die E-Mail (kein SSO), wie bei den anderen Tabellen.
- Kriterienprüfung ist Textsuche ohne Synonyme. Die Schutzlisten (Merkmale, Telefonformate) sind Wortlisten und Muster, keine Garantie.
- EU AI Act (Einstellung gilt als Hochrisiko), Betriebsrat und Datenschutz vor echter Nutzung klären.

## Nicht getestet
Echtes Supabase, die Freigabe-Ansicht in der Electron-App (nur Typecheck und Logik-Test), echter Agent mit den Werkzeugen. Getestet: Migration und alle Regeln gegen Postgres 16 (`test/skill-lifecycle-sql.test.mjs`, SQL-Teil "recruiting"), Connector mit Fake-Datenbank (`test/recruiting-connector.test.mjs`), Space (`test/recruiting-workbench.test.mjs`).

## Kriterien-Editor (Migration 030)

- Reiter **Criteria** in *Hiring approvals*: Der Hiring Manager legt Muss- und Kann-Kriterien seiner **offenen** Stelle selbst an, ändert und löscht sie. Typ "Wörter im Lebenslauf" (Suchbegriffe, optional "teilweise erfüllt durch") oder "Mindestjahre". Neue Stellen aus dem Import haben keine Kriterien, hier entstehen sie.
- Datenbank: `recruiting_criterion_set` / `recruiting_criterion_delete` (nur service_role) erlauben nur den Hiring Manager der offenen Stelle, nicht einmal das Governance board. Ids werden vergeben (M1, N1 …), höchstens 12 je Stelle, Muss/Kann lässt sich beim Ändern nicht wechseln (löschen und neu anlegen), geschützte Merkmale und Zugangsdaten werden abgelehnt. Jede Änderung steht im nur anhängbaren Protokoll `recruiting.criterion_event` (vorher/nachher). `recruiting_criteria_mine` liefert die eigenen offenen Stellen mit Kriterien.
- Die Oberfläche prüft vorab dieselbe Wortliste (`validateCriterion`), die Datenbank bleibt maßgeblich. Frühere Vorschläge behalten die Kriterien, auf denen sie beruhten.
- **Nicht getestet:** Oberfläche in der Electron-App (nur Typecheck und Logik-Tests), echtes Supabase (SQL gegen Postgres 16).

## Hiring Approvals (Migration 031, eigener Space)

Der letzte Schritt nach dem Recruiting: die Freigabe, einen Kandidaten einzustellen, der den Prozess erfolgreich durchlaufen hat (Stufe *Offer*).

- **Ablauf:** Hiring Manager der Stelle → HR → Finance → optional Abteilungsleitung. Vier-Augen: niemand hält zwei Schritte. Nur wer an der Reihe ist, entscheidet. *Return* und *Decline* brauchen eine Begründung und beenden die Anfrage (eine geänderte Anfrage ist eine neue). Die letzte Freigabe ist endgültig. Das Protokoll (`recruiting.hire_event`) wird nur angehängt.
- **Inhalt einer Anfrage:** ein Kandidat (Pseudonym), Stufe, Level, Bandname, Starttermin, Vertragsart, kurze Notiz, Belegzeile aus dem Recruiting (vom System gebaut, nicht vom Modell). Keine Gehaltsbeträge, keine Personendaten.
- **Datenbank:** `supabase/migrations/20261107_031_hire_approvals.sql` (**noch von Hand anzuwenden**): Tabellen `recruiting.hire_request/_step/_event`, Funktionen `recruiting_hire_request_create`, `recruiting_hire_requests_list`, `recruiting_hire_decide`, nur service_role. SQL-Tests in `test/skill-lifecycle-sql.test.mjs` (gegen Postgres 16 gelaufen).
- **Connector `werkbank-workspace` 1.4.0 (104 Tools in den sieben Connectoren; neu installieren):** `recruiting_list_hire_requests` (lesen) und `recruiting_create_hire_request` (schreiben, nur Hiring Manager). **Es gibt kein Werkzeug zum Freigeben, Zurückgeben oder Ablehnen.** Entscheiden läuft nur im Hauptprozess (`decideHire`, IPC `recruiting-hire-decide`), ausgelöst per Klick im Space.
- **Space `hiring-approvals`** (`npm run install:hiring-approvals`): Reiter *Waiting for me*, *In progress*, *Decided*, *How it works*; Detail mit Konditionen, Beleg, Kette, Entscheidungsfeld und Protokoll. In der Desktop-App holt er über die feste Brücke (`src/hiring-bridge.ts`: `ha:list-request`, `ha:decide-request`, `ha:open-tools`) die echten Anfragen der gespeicherten E-Mail; sonst läuft er mit erfundenen Beispieldaten und simuliert Entscheidungen im Seiteninhalt (deutlich gekennzeichnet, nichts wird gespeichert). Anfragen stellt der Hiring Manager im Chat ("Prepare a hiring request for C-4204").
- **Grenzen:** Identität ist nur die E-Mail (keine Anmeldung, keine Rollenprüfung außer den genannten Freigebern); es wird nichts in ein Recruiting-System geschrieben; keine Erinnerungen bei liegen gebliebenen Anfragen; EU AI Act, Betriebsrat, Datenschutz vor echter Nutzung klären.
- **Nicht getestet:** Electron-App, echtes Supabase, echter Agent beim Anlegen der Anfrage. Space im Headless-Browser (Beispiel- und simulierter Live-Modus, hell und dunkel) gesehen.

### Nachrichten und Erinnerungen über n8n (Migration 032, Workflow 11)

Ein n8n-Workflow (`examples/n8n-workflows/11-hiring-approval-notices.json`) liefert die Nachrichten zu. **Die Datenbank entscheidet, was fällig ist; n8n sendet und meldet zurück.** So kann n8n keinen Schritt überspringen, keine Person anschreiben, die nicht in der Kette steht, und nichts freigeben, zurückgeben oder ablehnen.

- **Regeln** (`recruiting_hire_due`, nur service_role): *notify* (der Freigeber, der dran ist, wurde noch nicht benachrichtigt), *remind* (keine Entscheidung nach 2 Tagen seit der letzten Nachricht, höchstens 3 Erinnerungen), *escalate* (Schritt seit 5 Tagen offen: der Antragsteller wird einmal informiert; entfällt, wenn der Antragsteller selbst der Freigeber ist), *inform* (Anfrage beendet: Antragsteller, nach einer Freigabe auch HR, je einmal, bis 14 Tage danach). Tage sind Parameter (`HIRING_REMIND_DAYS`, `HIRING_ESCALATE_DAYS`).
- **Vermerk** (`recruiting_hire_notice_record`): hängt dem Protokoll einen Eintrag an (`notified`, `reminded`, `escalated`, `informed`, Empfänger als Akteur, Kanal als Notiz, Zugangsdaten werden ersetzt). Wiederholung ist harmlos (`created: false`). Der Space zeigt die Einträge im Protokoll ("Asked to decide", "Reminded", …).
- **Ablauf im Workflow:** alle 15 Minuten (oder "Run now") → was ist fällig? → Nachricht formulieren (nur Pseudonym, Stelle, Schritt) → an den Webhook (Teams/Slack) senden → Vermerk. Eine nicht gesendete Nachricht wird **nicht** vermerkt und beim nächsten Lauf erneut versucht.
- **Einrichten:** Migration 032 nach 031 anwenden; in n8n `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `HIRING_NOTIFY_WEBHOOK_URL` setzen (n8n muss `$env` in Ausdrücken erlauben: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`); Workflow importieren, aktivieren.
- **Grenzen:** Wird nach dem Senden der Vermerk nicht gespeichert (Absturz zwischen den zwei Schritten), geht die Nachricht beim nächsten Lauf noch einmal hinaus. Empfänger sind E-Mail-Adressen; der Webhook bekommt sie als Feld `to` und muss die Zustellung (Erwähnung, Direktnachricht) selbst übernehmen. Kein Link auf die Anfrage (die App hat keinen). Keine Anmeldung. **Nicht getestet:** echtes n8n (Code-Knoten per Test ausgeführt, Struktur und Verbindungen geprüft, Import in n8n nicht ausprobiert), echtes Teams/Slack, echtes Supabase (SQL gegen Postgres 16).
