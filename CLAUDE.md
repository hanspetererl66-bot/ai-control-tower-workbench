# Werkbank / Joule Work X – Next Gen (Projektkontext für Claude)

Privater Prototyp von Hans-Peter (Accenture S&P EMEA). Electron + Vite + React/TS-App "Werkbank" mit Goose als Agent-Runtime (bleibt so). Sprache mit dem Nutzer: Deutsch, UI-Texte: Englisch. Hans-Peter entwickelt auf einem Linux-Rechner; die README nennt noch macOS als Ziel.

Repo: `hanspetererl66-bot/ai-control-tower-workbench`. Stand dieser Datei: 09.11.2026.

**Diese Datei ist bewusst kurz.** Verlauf (PRs, Branches, Merges) steht in `git log`. Die ausführlichen Statusnotizen je Thema (was gebaut ist, Grenzen, "Nicht getestet") liegen in `docs/status/` und werden nur gelesen, wenn das Thema dran ist.

## Arbeitsweise
- Alles liegt auf `main`. Vor jeder Arbeit `git fetch --all` und Abstand zu `main` prüfen. Mergen nur auf Hans-Peters Wunsch.
- Nach frischem Checkout zuerst `npm install` (sonst fehlen `n3` und `jsdom`, vier Testdateien schlagen fehl). SQL-Tests laufen nur mit `SKILL_SQL_TEST_DSN` (Wegwerf-Datenbank `*_test`), sonst werden sie übersprungen.
- Parallele Claude-Fenster: Stand der Datei und Statusnotizen nach größeren Etappen nachführen, nur das Betroffene in `docs/status/`.
- Parallele Fenster teilen sich das Verzeichnis und schalten Branches um (`git branch --show-current` vor jeder Arbeit). Für eigene Änderungen ein separates `git worktree` nehmen, nicht im geteilten Checkout umschalten.

## Befehle
- `npm test` (node --test), `npx tsc --noEmit -p .`, `npm run check` (alles zusammen) – vor jedem Push grün.
- `npm run smoke:electron`: startet die echte Electron-App (öffnet ein Fenster, braucht Display; Vite startet es selbst, falls es nicht läuft), prüft Titel, Goose-Port, Chat und Cover, speichert Screenshots (`--out <Ordner>`) und beendet die App. Kein Ersatz für einen Agenten-Lauf mit Live-Diensten.
- `npm run smoke:governance`: wie `smoke:electron`, prüft die Einstiegsseite AI Governance: Subspaces in der Seitenleiste, vier Kacheln, Öffnen von Registry, Compliance, Observability und Agent Studio, Zurück-Button, keine Skriptfehler. Setzt die vier Spaces voraus (`node scripts/install-example-space.mjs control-tower agent-registry agent-compliance agent-observability`); klappt die Domain Governance in der Seitenleiste auf.
- Beispiel-Spaces: `examples/<name>/index.html`, installieren mit `npm run install:examples` (siehe Skill `space-change`).
- Connector-Bundles: `npm run build:connectors` (alle) oder `node scripts/build-control-tower-mcpb.mjs <id>`. Die älteren Connectoren `gmail`, `databricks`, `jira`, `slack`, `notion` haben eigene Bundle-Flags (`--gmail` usw.).
- Cognee: `npm run cognee:corpus`, danach `.venv-cognee/bin/python scripts/cognee-seed.py [--reset]` (nicht `npm run cognee:seed`, das nimmt das System-Python).

## Regeln für Änderungen
- Neue Migration: vorher die höchste Nummer auf `main` prüfen (parallele Fenster haben sich schon überschnitten) und die SQL-Tests mit Wegwerf-Datenbank laufen lassen.
- Daten ändern, nicht Tests (Zahlen müssen tabellenübergreifend stimmen).
- Farben nur als Tokens (`var(--surface)` …), Spaces ohne Netzwerk und ohne localStorage.
- Ehrlich dokumentieren, was nicht getestet wurde (Electron-App, echtes Supabase, echter Agent, Live-Dienste). Standardhinweis: vieles lief nur mit Fake-Daten, Typecheck und Headless-Browser, nicht in der Electron-App.
- Identität ist überall nur die E-Mail (keine Anmeldung); das ist kein Schutz, nur ein Etikett.

## Architektur in Kürze
- `src/App.tsx`: Hauptfenster; `src/ui/` Oberflächen, `src/*.ts` reine, getestete Logik; `electron/` Hauptprozess (IPC, Speicher, Datenbankzugriff, der Key bleibt dort); `examples/<name>/` Spaces (`index.html` + `data.json` + `space.json`); `connectors/` MCP-Connectoren; `supabase/migrations/` Datenbank; `services/tabpfn/` Prognosedienst; `docs/` Anleitungen.
- Entwicklung nach Absicht: gemeinsamer Ablauf mit fünf Schritten (`src/flow.ts`): Intent, Requirements, Specification & Architecture, Build, Test & go live. Agent Studio (`src/agent-project.ts`), Workflow-Assistent (`src/develop.ts`).
- Zentrale Datenbank: Supabase-Projekt "Joule-AI-control-tower" (Ref `iguatwcsgjewpyejlgdk`, eu-west-1). Tabellen sind für anon/authenticated gesperrt, Funktionen nur für service_role (Connector-Muster). Migrationen 001 bis 038 sind angewendet (036/037 Agent Observability am 08.11.2026 mit Beispieldaten; 038 Hire contracts); auf Supabase steht außerdem `recruiting_analytics` (08.11.2026), zu der im Repo noch keine Datei liegt. Spätere Nummern prüfen mit `list_migrations`.
- Connectoren (`connectors/`): gemeinsame MCP-Laufzeit `connectors/_lib/server/runtime.mjs`; Bibliotheks-Connectoren (ai-control-tower, sub4me, n8n-automation, skill-marketplace, knowledge-graph, web-sources, werkbank-workspace), der Manifest-Connector `cognee-memory`, `ontology-manager` und Einzel-Connectoren (gmail, databricks, jira, slack, notion, teams, sap-sandbox). Nach Änderung der Werkzeugliste den Connector einmal neu installieren (die Liste wird bei der Installation gespeichert). Bundles baut `stageConnector` in `connectors/_lib/bundle.mjs`.
- Goose-Konfiguration: `goose-home/.config/goose/config.yaml` ist lokaler Zustand (Connector-Installationen tragen absolute Pfade und Hosts ein) und steht nicht im Repo (seit PR #245). Eingecheckt ist nur `config.example.yaml`; `ensureGooseConfig` (`shared/goose-config.mjs`) kopiert sie beim ersten Start (Electron, `install:databricks-demo`). Nicht getestet: Start der Electron-App mit der erzeugten Datei.
- Spaces werden aus `data.json` gespeist; nach Datenänderung `npm run sync:mockups`. Logik zwischen `@logic-start`/`@logic-end` wird vom Test mit dem echten Code ausgeführt.
- Skills: drei Ebenen Individual → Department → Organization, automatische Prüfung `src/skill-review.ts`; die fünf Textprüfregeln existieren in TS und SQL und müssen gemeinsam geändert werden.

## Statusnotizen je Thema (`docs/status/`)
| Datei | Inhalt |
|---|---|
| `app-and-chat.md` | Studio-Dock, Composer, Chat-Reiter, Diktat, Chat-Kontext |
| `process-interview.md` | Prozessinterview (Slots, Schritte, Zusammenführen, Datenschutz) |
| `skills-and-database.md` | Supabase-Stand, Skills (Export/Import, Lifecycle, Health), Work Items |
| `scheduler.md` | Scheduler, Gruppierungen, Activity |
| `look-and-spaces.md` | Skins, Layouts, Textgröße, Autofit, Sales-Ansichten, Duplicate, Spaces-Übersicht |
| `sources-and-registry.md` | Quellen (Jira/Slack/Notion/Teams), Solution register, Registerkarte |
| `ontology.md` | Ontology Manager, Governance, Karten |
| `customer-360.md` | Lindenau, Customer 360 |
| `cognee-tabpfn.md` | Cognee-Wissensgraph, TabPFN-Prognosen |
| `databricks-sap.md` | Databricks-Demo, SAP-Sandbox, ARC-1 |
| `design-study-and-demos.md` | Joule Design Study, Order-to-Cash (zwei Fälle) |
| `recruiting-status.md` | Recruiting Workbench, Hiring Approvals, Job Posting, Online-Interview |
| `policy-manifest.md` | Policy-Manifest (Rechte als Daten, erzwingt nichts) |
| `dashboards-observability.md` | n8n Performance Dashboard, Agent Observability, AI Governance (Einstieg und Subspaces) |
| `space-designer.md` | Space Designer |

Weitere Anleitungen: `docs/recruiting.md`, `docs/arc-1.md`, `docs/arc-1-demo.md`, `docs/teams.md`, `docs/customer-360.md`, `docs/agent-observability.md`, `docs/registry-leanix.md`, `docs/order-to-cash*.md`.

## Testbed für Quellen
`scripts/sources-testbed.mjs` + `examples/sources-testbed/dataset.json` spielen erfundene Anforderungen mit bekannter Lösung in ein Test-Jira und einen Test-Slack-Kanal (Dry-Run standardmäßig, `--expect` zeigt die Lösung); Anleitung `docs/sources-test.md`. Nicht getestet: echter Lauf gegen Jira Cloud/Slack (aus dem Sandkasten nicht erreichbar), nur Tests mit Fake-fetch.

## Offen
- Databricks-Zugang eintragen und Daten laden.
- Skill-Governance in der App (noch localStorage) an die Datenbankfunktionen anbinden (braucht Entscheidung zur Anmeldung).
- Supabase-URL/Key pro Connector einmal eintragen; Idee "Einstellungen von anderem Connector kopieren".
- Skills & Connectors Katalog-Redesign, MP4-Demofilme, Registry-KPIs mit Studio-Agenten, anklickbarer Link auf Registry-Einträge (`werkbank://`-Handler).
