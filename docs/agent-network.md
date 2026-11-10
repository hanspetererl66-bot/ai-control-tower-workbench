# Agenten testen, betreiben und vernetzen (Stand 09.11.2026)

Was nach dem Bau eines Agenten im Agent Studio kommt, und wie mehrere Agenten sich gegenseitig fragen. Alles läuft **in der App** (Goose); ein eigener Dienst für den Betrieb ohne offene App ist nicht gebaut.

## 1. Prüfstand (Agent Studio, Schritt 5)
- **Starter-Fälle** aus dem Briefing: jede erlaubte Quelle wird gelesen, eine nicht angekreuzte Quelle wird nicht gelesen, das Schrittlimit hält, ein reiner Leseagent ändert nichts, eine fehlende Quelle wird gemeldet, eine in einer Quelle versteckte Anweisung wird nicht befolgt (die drei letzten nur live).
- **pass^3:** jeder Fall läuft dreimal, er zählt nur, wenn alle drei Läufe bestehen. "Run bench (simulation)" nutzt die Simulation des Studios (Beispieldaten, ohne Modell), "Run bench (live)" schickt jeden Fall dreimal durch den Assistenten (langsam, braucht das Modell).
- Der Bericht gilt nur für die **Version** (Fingerabdruck aus Anweisung, Quellen, Rechten, Schrittlimit, Ausgabe, Vertrag). Ändert sich etwas, ist er veraltet. Der Hinweis steht neben "Move up"; er **sperrt nichts**.
- **Grenze:** die Prüfungen sind Regeln (Text, Quellen, Schritte), kein Urteil über Qualität. Der Live-Lauf sieht nicht, welche Werkzeuge der Assistent benutzt hat, nur den Antworttext.

## 2. Lauf-Protokoll und Stoppschalter (Schritt 8 im Studio)
- Jeder Lauf über `/agent <id>`, den Zeitplan, "Run in chat (real)" oder eine Frage eines anderen Agenten wird festgehalten (Agent, Version, Auslöser, Ergebnis, Dauer, Lauf-Id). Nur im Browser-Speicher dieses Rechners (`werkbank.agentRuns`, höchstens 500), **nicht** in der gemeinsamen Observability-Datenbank (die hat weiter keinen Schreiber).
- **Stop this agent:** der Zeitplan startet ihn nicht mehr, `/agent` lehnt ihn ab, andere Agenten können ihn nicht fragen und er kann nicht fragen. "Resume" hebt das auf.

## 3. Agent-Netz
- **Vertrag je Agent** (Schritt 6): ob andere Agenten ihn fragen dürfen, was er sagen kann, was eine gute Frage enthält, wie die Antwort aussieht, **wie er jede Datenklasse behandelt** (antworten, mit verdeckten Beträgen antworten, erst Person fragen, ablehnen) und **wen er selbst fragen darf**.
- **Der Umschlag:** Wer fragt wen, wozu, welche Datenklassen, zu welchem Lauf (Trace). **Das Tor** (`shared/agent-network-rules.mjs`, gleiche Regeln in App und Space) prüft in dieser Reihenfolge: Lauf-Id bekannt und gehört dem fragenden Agenten, beide Agenten existieren und sind nicht gestoppt, beide sind veröffentlicht, der Vertrag des Fragenden nennt den Gefragten, der Gefragte nimmt Fragen an, Sprunglimit 3 und Budget 6 Fragen je Lauf, zuletzt die Freigabe der Datenklasse. Die erste Prüfung, die scheitert, lehnt mit Begründung ab.
- **Ablauf:** Der fragende Agent ruft `ask_agent` des Connectors `agent-network` auf. Der Connector legt die Frage in ein Postfach (Ordner) und wartet. Die App holt die Frage (`poll_requests`), prüft sie, startet den gefragten Agenten in einer **eigenen Sitzung** (nur seine angekreuzten Connectoren, `developer`/`shell` entfernt, jede Berechtigungsanfrage abgelehnt, Frage als unvertrauenswürdiger Text) und gibt die Antwort zurück (`submit_response`). Bei "Antwort mit verdeckten Beträgen" ersetzt die App Beträge, Adressen und Kennungen selbst (`redact`), egal was das Modell schreibt.
- **Einschalten:** `npm run connect:connectors` (nimmt `agent-network` mit), App neu starten, im Studio "Agent network" einschalten (**standardmäßig aus**). Nur ein Lauf, den die App gestartet hat, bekommt eine Lauf-Id und den Netz-Text im Briefing; ein Agent, der niemanden fragen darf, bekommt keinen.

## 4. Demo: Renewal network
- **Space "Agent Network"** (`npm run install:agent-network`): ein Renewal watcher bereitet das Briefing für einen Kunden vor und fragt Finance facts (Rechnungen) und Support facts (Tickets). Animierte Karte mit Tor, Umschlag, Prüfliste, Zeitachse und dem fertigen Briefing. Schalter zum Ausprobieren: Datenklasse der Frage (intern, vertraulich, personenbezogen), Freigabe von Finance facts für vertrauliche Daten, Finance stoppen, Lauf-Id fälschen, Support aus "darf fragen" entfernen. Daten aus den Renewals-Beispieldaten, **Simulation auf der Seite**.
- **Echt:** Agent Studio, "Demo: renewal network" legt die drei Agenten als Entwürfe mit Verträgen an. Testen, veröffentlichen (Move up), Netz einschalten, dann `/agent <id des Renewal watcher>` mit dem Kunden.

## Ehrlich
- **Nicht getestet:** Electron-App, echter Goose-Lauf mit zwei Sitzungen, der Connector mit echtem Goose (nur der Connector über stdio und der Broker gegen die echten Connector-Funktionen mit einem Attrappe-Modell), der Live-Prüfstand mit Modell, parallele Sitzungen im selben goosed.
- **"Erst Person fragen"** wird entschieden, aber es gibt **keinen Freigabeeingang**: es wird nichts herausgegeben. Der Space zeigt den Klick nur als Simulation.
- Die Identität des fragenden Agenten ist die Lauf-Id (ein Etikett, kein Beweis). Die drei Werkzeuge für die App (`sync_agents`, `poll_requests`, `submit_response`) stehen auch dem Modell offen (keine Anmeldung zwischen App und Connector); jeder Aufruf wird protokolliert, die App akzeptiert Fragen nur zu Lauf-Ids, die sie selbst ausgegeben hat. Das Policy-Manifest erzwingt weiter nichts.
- Jede Frage öffnet eine neue Verbindung zum Assistenten, die nicht geschlossen werden kann (der Client hat keine `close`-Methode); begrenzt durch Sprunglimit und Budget.
- Läufe und Berichte liegen im Browser-Speicher, nicht in der Datenbank; ein Dauerbetrieb ohne offene App fehlt.
