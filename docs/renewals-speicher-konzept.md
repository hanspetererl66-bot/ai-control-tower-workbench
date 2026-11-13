# Konzept: Autopilot- und Win-back-Fälle in Supabase speichern

Stand: 13.11.2026. Konzept, noch nichts gebaut. Ergänzt `docs/renewals-prozesslandkarte.md` (dort steht unter "Was fehlt": dauerhafter Speicher). Alle Kunden und Zahlen im Space sind erfunden.

## Entscheidungen (13.11.2026)

1. **Was gespeichert wird:** die **Fälle von Autopilot und Win-back mit ihrem Protokoll**. Nicht gespeichert werden die Stufen von Hand und die Briefings.
2. **Wer was sieht:** **jeder Verantwortliche nur seine Fälle.** Dazu sehen **Board-Admins** (bestehende Gruppe) und **Vertriebsleiter alle** Fälle.
3. **Testadressen:** vier Testadressen für die vier Verantwortlichen der Beispieldaten, dazu das eigene Konto als Admin.
4. **Reset:** **archivieren**, nicht löschen. Die Geschichte bleibt.

**Entschieden (13.11.2026):** Vertriebsleiter **lesen** alle Fälle, **ändern** sie aber nicht. Ändern (Tore, Kundenantwort, Reset) dürfen der Besitzer und Board-Admins.

## Ziel

Fälle, Protokolle und Stufen der Fälle gehen heute mit dem Schließen der App verloren. Sie sollen in Supabase liegen, so dass jeder Verantwortliche beim nächsten Start seine Fälle wiederfindet, und Vertriebsleiter alle sehen können.

## Faktenbasis (so speichern Onboarding und Recruiting schon)

- Der Space spricht über eine **Brücke mit festen Anfragen** mit der App. Der **Hauptprozess** ruft Supabase auf (`electron/work-store.mjs`), mit der E-Mail aus den Einstellungen. Der Schlüssel bleibt dort.
- In der Datenbank: **gesperrte Tabellen** (Row Level Security an, alle Rechte für `anon` und `authenticated` entzogen) und **Funktionen mit `security definer`**, die nur `service_role` aufrufen darf. Der Handelnde ist `p_actor`, die E-Mail. Änderungen stehen in einem **nur anhängenden Protokoll**.
- Wer was sieht, regelt eine Funktion wie `recruiting.onboarding_involved`. **Board-Admins** sehen alles (`skills.is_board_admin`).
- Die Renewal-Daten kennen **nur Namen** der Verantwortlichen: Mira Hoffmann (10 Verträge), Sven Albrecht (4), Clara Neumann (4), Katrin Lindner (3). Es gibt keine E-Mails. "Nur seine" braucht eine **Zuordnung Name zu E-Mail**.
- Höchste Migration auf `main`: `049`. Die neue wird **`050`**. Im Repo gibt es **keinen Postgres-Parser**, SQL-Tests laufen nur mit einer Wegwerf-Datenbank (`SKILL_SQL_TEST_DSN`), die es nicht gibt.

## Datenmodell (Schema `renewals`)

| Tabelle | Inhalt |
|---|---|
| `owner_email` | Name des Verantwortlichen zu E-Mail. Mit den **vier Testadressen** vorbefüllt (siehe unten). |
| `manager` | E-Mails der Vertriebsleiter. Mit **einer Testadresse** vorbefüllt. |
| `cases` | ein Fall je Renewal und Art (`renewal` oder `winback`): Fall-Kennung, Besitzer (Name und E-Mail), Kunde, Status, der Zustand als `jsonb`, Revisionsnummer, wer und wann zuletzt geändert, `archived_at` |
| `case_events` | jede Zeile des Protokolls, **nur anhängend** (ein Trigger verhindert Ändern und Löschen, wie bei `onboarding_event`) |

Die Tabellen heißen `cases` und `case_events` (`case` ist in SQL ein reserviertes Wort). Einen aktiven Fall je (Fall-Kennung, Art) erzwingt ein Teilindex (`cases_one_active`, nur nicht archivierte Zeilen); archivierte Fälle bleiben mit eigener Zeile. Eine Renewal kann zuerst einen Autopilot-Fall haben und nach einer Absage einen Win-back-Fall.

**Testadressen** (reservierte Domain, kein echtes Postfach): `mira.hoffmann@renewals.example`, `sven.albrecht@renewals.example`, `clara.neumann@renewals.example`, `katrin.lindner@renewals.example`; Vertriebsleiter-Test: `vertrieb@renewals.example`. Das eigene Konto sieht alles, **wenn es in der Admin-Gruppe steht** (nicht geprüft).

## Wer was darf

| Rolle | Sehen | Ändern (Tore, Kunde, Reset) |
|---|---|---|
| Verantwortlicher | nur Fälle, deren Besitzer seine E-Mail hat | dieselben |
| Vertriebsleiter (`manager`) | alle | nein (entschieden) |
| Board-Admin | alle | ja |
| E-Mail ohne Zuordnung | nichts | nein |

Fehlt für den Besitzer eines Falls die Zuordnung, wird der Fall mit leerer Besitzer-E-Mail gespeichert und ist nur für Board-Admins und Vertriebsleiter sichtbar. Die Seite weist darauf hin.

## Funktionen (öffentlich, nur `service_role`)

- **`renewals_cases_list(p_actor)`**: liefert die sichtbaren Fälle (nicht archiviert) und `me` (E-Mail, Name des Verantwortlichen, Vertriebsleiter oder Admin ja oder nein).
- **`renewals_case_save(p_actor, p_case, p_kind, p_owner, p_state, p_expected_rev)`**: prüft die Berechtigung, die Form (Status aus einer festen Liste, höchstens 60 Protokollzeilen, höchstens 64 KB, Muster der Fall-Kennung) und die **Revision**. Bei Konflikt gibt es einen Fehler statt eines stillen Überschreibens. Neue Protokollzeilen werden als Ereignisse geschrieben.
- **`renewals_case_reset(p_actor, p_case, p_kind)`**: **archiviert** den Fall (`archived_at`), die Ereignisse bleiben.

## Ablauf in der App

- **Start:** Die Seite fragt die Fälle ab (neue Anfragen der vorhandenen Brücke `src/renewals-bridge.ts`). Die zurückgegebenen Fälle kommen in `state.ap` und `state.wb`, die Stufen leiten sich daraus ab (`apSync`, `prevStage`).
- **Nach jeder Aktion** (Start, Tor, Antwort des Kunden, Reset) speichert die Seite **den einen geänderten Fall** mit seiner Revision. Bei einem Fehler oder ohne Datenbank arbeitet sie wie heute im Speicher weiter und zeigt "Not saved: <Grund>".
- **Bedienen:** Mit Datenbank startet und bedient die Seite nur Fälle, die der angemeldete Mensch ändern darf. "Run autopilot" startet dann nur diese. Alle anderen werden angezeigt, aber nicht bedient. Vertriebsleiter sehen die Fälle aller und können nichts ändern.
- **Zweites Fenster:** Ändert dort jemand denselben Fall, kommt der Revisionsfehler, und die Seite lädt neu.
- **Im Hauptprozess:** neue Funktionen in `electron/work-store.mjs`, ein neuer Modul-Teil in `connectors/_lib/server/` für die Aufrufe, `ipcMain`-Anmeldung in `electron/main.mjs`, `electron/preload.cjs` und der Typ von `window.host` in `src/main.tsx`.

## Reihenfolge in drei PRs

1. **Migration 050** (Tabellen, Trigger, Funktionen, Testadressen) mit einer **Leseabfrage** zur Kontrolle, wie bei 042 bis 047. Du spielst sie **von Hand** im SQL-Editor ein.
2. **Host:** Anbindung im Hauptprozess, Brücke, `preload`, Tests mit einer Ersatz-Datenbank. Läuft auch ohne Datenbank.
3. **Seite:** Laden, Speichern, Reset, Hinweise, Tests mit Ersatz-Host.

PR 2 und 3 laufen auch ohne eingespielte Migration (die Seite fällt auf den Speicher zurück). Nach 2 und 3 braucht die App einen **Neustart** (Änderungen in `src/` und `electron/`).

## Tests

- **Ohne echte Datenbank:** Der Hostteil und die Seite werden mit Ersatzobjekten getestet (Form der Anfragen, Revisionskonflikt, "Not saved", nur eigene Fälle bedienbar, Vertriebsleiter nur lesend, Wiederherstellen beim Start).
- **SQL:** wird sorgfältig geschrieben, aber **nicht gegen Postgres ausgeführt** (kein Parser, keine Wegwerf-Datenbank). Ein SQL-Test nach dem Muster von `test/skill-lifecycle-sql.test.mjs` wird mitgeliefert und läuft nur mit `SKILL_SQL_TEST_DSN`.
- **Kontrolle nach dem Einspielen:** eine Leseabfrage mit festen Prüfungen (Tabellen, Sperren, Funktionen, Testadressen), die du im SQL-Editor ausführst.

## Wie man die Trennung ausprobiert

Du trägst in den Einstellungen der App eine der Testadressen als deine E-Mail ein: Mit `mira.hoffmann@renewals.example` siehst du nur die zehn Fälle von Mira Hoffmann, mit `vertrieb@renewals.example` alle, aber nur lesend, mit deinem eigenen Konto (Admin) alle und kannst sie bedienen.

## Was das nicht ist

**Kein echter Zugriffsschutz.** Die Identität ist nur die E-Mail als Etikett: Wer die E-Mail eines anderen einträgt, sieht dessen Fälle, wie überall in der Werkbank. Die Tabellen sind für `anon` und `authenticated` gesperrt, der Schlüssel liegt im Hauptprozess.

## Folgen

- **Migration von Hand:** Ich kann Supabase nicht selbst beschreiben, du spielst `050` im SQL-Editor ein.
- **Neustart der App** nach PR 2 und 3.
- **Daten:** Fälle enthalten Kundennamen, Beträge und Protokolltexte (in der Demo erfunden). Bei echten Daten wäre eine eigene Entscheidung zu Datenschutz und Aufbewahrung nötig.
- Die Briefings und die Stufen von Hand bleiben im Speicher und sind nach einem Neustart weg. Die Stufen gespeicherter Fälle kommen aus dem Fall.
- Das Dashboard "Renewal Analytics" liest die gespeicherten Fälle **nicht**; das wäre ein späterer Schritt.

## Offen

1. ~~Vertriebsleiter lesen nur~~ entschieden: nur lesen.
2. **Aufbewahrung:** Wie lange bleiben archivierte Fälle und Ereignisse?
3. **Wer pflegt** die Zuordnung Name zu E-Mail und die Vertriebsleiter bei echten Daten? Heute von Hand im SQL-Editor.

## Stand (13.11.2026)

- Schritt 1 (Migration 050): angewendet, Kontrollabfrage ohne Beanstandung (PR #420).
- Schritt 2 (Hostteil): PR #424, gemergt.
- Schritt 3 (Seite): `examples/renewals/index.html`. Beim Start fragt die Seite die Fälle ab (`rn:cases-request`, Aktion `list`); danach speichert sie **nach jedem Zeichnen** jeden geänderten Fall einzeln mit der Revision (`save`), ein verschwundener Fall wird archiviert (`reset`). Pro Fall läuft immer nur eine Anfrage; ein abgelehnter Stand wird nicht in einer Schleife wiederholt. Bei einem Revisionskonflikt lädt die Seite neu (die Datenbank gewinnt). Ohne Datenbank oder ohne App arbeitet sie wie bisher im Speicher; mit Datenbank steht über dem Autopilot ein Hinweis (wer du bist, was du siehst) und bei einem Fehler "Not saved: <Grund>". Fälle, die der Mensch nicht ändern darf, sind sichtbar, aber gesperrt (Schaltflächen aus); "Run autopilot" startet nur eigene Fälle; "Reset" nur eigene.
- Nach dem Merge braucht die App einen **Neustart**, und das Renewals-Space muss neu installiert werden (`npm run install:examples`).

## Nicht geprüft

- Die Seite ist nur mit einem Ersatz-Host im Headless-Browser (jsdom) getestet; nicht in der Electron-App und nicht gegen echtes Supabase.
- Die SQL-Tests zu Migration 050 sind nie gegen Postgres gelaufen.
- Ob das eigene Konto in der Admin-Gruppe steht, ist nicht geprüft.
- Ein Fall mit Protokoll ist im Test unter 20 KB (Grenze der Datenbank: 64 KB); mit sehr vielen Aktionen nicht gemessen.
- Ein Fall, den die Seite im Speicher hat und der beim Neuladen in der Datenbank älter ist, wird von der Datenbank überschrieben, wenn ein Speichern vorher nicht gelang ("Not saved").
- Der Besitzer eines Win-back-Falls ist in der Datenbank der Besitzer des Vertrags; ein später im Win-back gewählter Besitzer ändert die Zuordnung nicht.
