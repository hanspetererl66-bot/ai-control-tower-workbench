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
1. Migrationen 028 und 029 sind auf dem Supabase-Projekt angewendet (06.11.2026); 030 (Kriterien) ist angewendet; 031 (Gesprächsrunden als Stufen) siehe unten.
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

## Space-Umbau: Dashboard, Pipeline, Match-Agent (06.11.2026)

- **Dashboard:** Prozessleiste (Posting, Kanäle, Bewerbungen, Bewertung, Online-Interview, Gespräch vor Ort, Abschlussgespräch mit Angebot; je Schritt "Not built", "Sample data", "Joule prepares" oder "Person decides"), Stufen New / In review / Online interview / In-person interview / Final conversation / Offered / Hired, Filter Active / Not active / All / Withdrawn / Rejected, Jobtabelle mit Zählern je Stufe. Geschlossene Fälle (hired, withdrawn, rejected) und Kanäle sind nur **Zähler je Stelle** in `data.json` (`outcomes`, `channels`), keine Personen. Die drei Gesprächsrunden sind **eigene Stufen** (Migration 031), kein Tag mehr.
- **Pipeline:** Spalten je Stufe, Kandidatenansicht mit Kopf (Pseudonym, aktuelle Position aus dem CV-Text, Einwilligungsstatus; Name und Kontakt bewusst nicht gespeichert), Reiter Profile (Experience, Education, Languages, Anhang als Text), Reviews (Kriterienergebnis mit Belegzeile, **keine Sterne**), Communication, Activity. Kein Reject, kein Withdraw: das entscheiden Menschen im Recruiting-System.
- **Match-Agent:** Regler für die gewünschte Anzahl, Filter "nur neue" und "nur wer alle Muss-Kriterien erfüllt"; Ausgabe in Zahlen (gewünscht, gezeigt, erfüllt alles, braucht einen Blick, nicht wie geschrieben). Reihenfolge nur nach der bekannten Regel (`topMatches` in `recruiting-logic.mjs`, getestet), keine Punktzahl, Gruppe C wird nie aufgefüllt. "Send these n to the hiring manager" legt einen Vorschlag der Art `ask` in Approvals an.
- **Layout und Farben:** angelehnt an das, was öffentlich über SmartRecruiters beschrieben ist (Stufen, Kandidatenansicht), in Werkbank-Farben, Violett und Blau statt Grün. Die Screenshots der Oberfläche konnte ich nicht auswerten; es ist eine Annäherung, keine Kopie. **Nicht getestet:** Electron-App und andere Skins als Violet (Headless-Browser, hell und dunkel).

## Gesprächsrunden als Stufen (Migration 031, Stand 06.11.2026)
- Stufen jetzt: Applied, Screening, Online interview (7 Tage Ziel), In-person interview (7), Final conversation (5), Offer (4). Migration `20261106_031_recruiting_stages.sql` ist idempotent: sie lässt die neuen Namen zu, legt die Stufen an, setzt Kandidaten aus der alten Stufe "Interview" um (Beispiel: C-4101 → Final conversation, C-4303/C-4304 → In-person interview, alle übrigen → Online interview), löscht die alte Stufe und zieht die Prüfregel wieder zu.
- **Achtung bei echten Daten:** Die Zuordnung der Runde pro Person kennt nur die Beispielkandidaten. Gäbe es echte Kandidaten in "Interview", kämen sie alle in die erste Runde; das wäre dann von Hand zu korrigieren.
- Mock-Connector: `INTERVIEW` → Online interview, `INTERVIEW_2` → In-person interview, `FINAL` → Final conversation. Die beiden letzten Status gibt es **nur im Mock**; die echte SmartRecruiters-API kennt einen Status INTERVIEW (Unterstatus unbestätigt).
- Space: sieben Spalten in der Pipeline (seitlich scrollbar, wenn die Kandidatenansicht offen ist), Dashboard-Kacheln und Jobtabelle je Stufe. `rounds`/`roundLabels` sind aus `data.json` entfernt. Test in `test/recruiting-workbench.test.mjs`, SQL-Test (inkl. Umsetzung der alten Stufe und zweiter Lauf) in `test/skill-lifecycle-sql.test.mjs` gegen Postgres 16.
- **Nicht getestet:** Migration 031 gegen das echte Supabase (bis zur Bestätigung dort nicht angewendet), Electron-App. Danach `npm run recruiting:seed -- --manager <E-Mail>` neu laufen lassen und den Space mit `npm run install:recruiting-workbench` neu installieren.
