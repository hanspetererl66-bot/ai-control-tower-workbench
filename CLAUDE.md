# Werkbank / Joule Work X – Next Gen (Projektkontext für Claude)

Privater Prototyp von Hans-Peter (Accenture S&P EMEA). Electron + Vite + React/TS-App "Werkbank" mit Goose als Agent-Runtime (bleibt so). Sprache mit dem Nutzer: Deutsch, UI-Texte: Englisch. Hans-Peter entwickelt auf einem Linux-Rechner; die README nennt noch macOS als Ziel.

Repo: `hanspetererl66-bot/ai-control-tower-workbench`. Stand dieser Datei: 30.10.2026, abends.

## Wichtig zuerst: Branch-Lage (nicht zusammengeführt)
- `main` und `feat/chat-features` sind **auseinandergelaufen**: `feat/chat-features` ist 9 Commits vor `main`, `main` 13 Commits vor `feat/chat-features`. Zuletzt geprüft per Probe-Merge: **15 Konflikte**, noch nicht gelöst.
- Nur auf `main` (aus den PRs #113 bis #116): Entwicklung nach Absicht im Develop-Hub (Create a Workflow with n8n / Create an Agent, bearbeitbare Dokumente, PRD und Spezifikation als Markdown, Export als Zip, `src/develop.ts`, `src/ui/DevelopWizard.tsx`, `src/ui/RichDoc.tsx`), die TabPFN-Zahlungsverzug-Prognose (`services/tabpfn/`, Connector-Tool in `connectors/control-tower/server/payment-risk.mjs`, Sub4Me-Karte, Chat-Starter), lokale Harness-Profile, PRD-Builder-Space, Jira-Demodaten.
- Nur auf `feat/chat-features`: angedockter Chat, Skill-Ebenen mit Freigabe und Prüfung, Aufteilung des Connectors, Cognee. Die Aufteilung hat `connectors/control-tower` nach `connectors/_lib` umbenannt. Deshalb muss `payment-risk.mjs` aus `main` beim Zusammenführen in `connectors/_lib/server/` landen und sein Tool einem der sieben Connectoren zugeordnet werden (Vorschlag: `sub4me` oder `ai-control-tower`; Tool-Liste ohne Überschneidung halten).
- Konfliktdateien: `src/App.tsx`, `src/theme.css`, `src/ui/Composer.tsx`, `src/ui/DevelopHub.tsx`, `src/ui/Rail.tsx`, `src/ui/SettingsDialog.tsx`, `index.html`, `vite.config.mts`, `examples/mcp-marketplace/index.html`, `test/control-tower-connector.test.mjs`, `test/develop-hub.test.mjs`, `test/product-surface.test.mjs` und die Connector-Dateien.
- Vor jeder Arbeit: `git fetch --all` und Abstand zu `main` prüfen. Das Zusammenführen ist Hans-Peters Entscheidung (Reihenfolge, PR oder direkt); nicht ungefragt mergen.

## Befehle
- `npm test` (node --test), `npx tsc --noEmit -p .`, `npm run check` (alles zusammen) – vor jedem Push grün.
- Beispiel-Spaces: `examples/<name>/index.html`, installieren mit `npm run install:examples` (siehe Skill `space-change`).
- Connector-Bundles: `npm run build:connectors` (alle) oder `node scripts/build-control-tower-mcpb.mjs <id>`. Die älteren Connectoren `gmail`, `databricks`, `jira`, `slack` haben eigene Bundle-Flags (`--gmail` usw.).
- Cognee: `npm run cognee:corpus`, danach `.venv-cognee/bin/python scripts/cognee-seed.py [--reset]` (nicht `npm run cognee:seed`, das nimmt das System-Python).

## Architektur in Kürze (Stand `feat/chat-features`)
- `src/App.tsx`: Hauptfenster. Angedockter Joule-Chat rechts (`src/ui/JouleDock.tsx`, `src/dock.ts`) in den Ansichten Studio und Skills. Dokumentänderungen kommen als ```markdown-Block, "Apply to document" übernimmt sie; "ja/passt" bestätigt das Dokument.
- Agent Studio (`src/ui/AgentStudio.tsx`, `src/agent-studio.ts`): Entwicklung nach Absicht Schritt für Schritt (Ziel, Fragen, PRD, TFD, Architektur, Risiko- und Testplan, Bau), jeder Schritt wird bestätigt.
- Chat: Personalisierung mit Prüfspur, Harness-Profile (Arbeitsregeln je Art der Arbeit), Massen-Upload bis 25 Dateien (CSV/Excel als Tabellen), wiederkehrende Briefings.
- Skills: drei Ebenen Individual → Department → Organization (`src/ui/SkillGovernance.tsx`, `src/skill-approval.ts`). Automatische Prüfung `src/skill-review.ts` (Secrets, Skripte, Rechte, Harness, Daten; fail blockiert, warn geht an den Prüfer). Governance-Stand liegt in der App noch **lokal (localStorage)**.
- Zentrale Datenbank: Supabase-Projekt "Joule-AI-control-tower" (Ref `iguatwcsgjewpyejlgdk`, eu-west-1). Migration `supabase/migrations/20261030_019_skill_promotion.sql` (Tabellen `skills.promotion*`, Funktionen `skills_promotion_*`, `skills_visible`). Tabellen sind für anon/authenticated gesperrt, Funktionen nur für service_role (Connector-Muster). Identität ist nur die E-Mail (`p_actor`), für Produktion SSO/Supabase Auth nötig. Die fünf Textprüfregeln existieren zweimal (TS und SQL) und müssen gemeinsam geändert werden; die beiden Registerprüfungen `description` und `duplicate` (Migration `20261031_020_skill_lifecycle.sql`) gibt es nur in SQL.
- Skill-Lifecycle (Stand 31.10.2026): Zustände abgeleitet (draft, department, in_review, blocked, published, deprecated, retired), Marketplace-Karte (Pflicht vor dem Teilen), Dublettenprüfung, Auslauf/Stilllegung/Wiederherstellung mit Zuständigkeiten, Änderungsprotokoll `skills.lifecycle_event` (Trigger, nur anhängen). Connector `skill-marketplace` 1.1.0, Modul `connectors/_lib/server/skill-lifecycle.mjs` (`actorOf` ist die eine Stelle für die Anmeldung). Tests: `test/skill-lifecycle.test.mjs` (immer) und `test/skill-lifecycle-sql.test.mjs` (echtes Postgres, nur mit `SKILL_SQL_TEST_DSN` auf eine Wegwerf-Datenbank `*_test`). Die Laufzeit gibt Regelmeldungen der Datenbank (SQLSTATE P0001) im Klartext weiter (`RuleError` in `runtime.mjs`).
- Arbeitsobjekte in der Datenbank (Stand 31.10.2026, Branch `feat/artifact-store`): Migration `20261031_021_work_items.sql` (Agenten, Workflows, Code als Revisionen; `skills.skill_file` für Skripte zu Skills), Tools in `werkbank-workspace` 1.1.0 und `skill-marketplace` 1.2.0 (95 Tools). **Noch nicht angebunden:** Develop-Hub und Agent Studio speichern weiter im `localStorage`. Migrationen 020, 021 und 022 sind auf Supabase angewendet (31.10.2026, 020/021 von Hand im SQL-Editor, in der Migrationsliste nachgetragen). 022 sperrt `skills_list/get/search/ranking/track` für anon/authenticated; die Skripte `skills:sync` und `sync:skill-marketplace --registry` brauchen jetzt `SUPABASE_SECRET_KEY`.
- Connectoren (`connectors/`): gemeinsame MCP-Laufzeit `connectors/_lib/server/runtime.mjs`; sieben Bibliotheks-Connectoren (ai-control-tower, sub4me, n8n-automation, skill-marketplace, knowledge-graph, web-sources, werkbank-workspace; zusammen 85 Tools, ohne Überschneidung), der reine Manifest-Connector `cognee-memory` und die älteren Einzel-Connectoren gmail, databricks, jira, slack. Bundles baut `stageConnector` in `connectors/_lib/bundle.mjs` (Zip-Builder und Electron-Installation nutzen dasselbe). Auf `main` heißt der Ordner noch `connectors/control-tower` (siehe Branch-Lage).

## Cognee Memory (Stand)
- Echter Open-Source-Wissensgraph (Apache-2.0, `cognee-mcp`, Tools remember/recall/forget), Start über `uvx`. Braucht LLM-Key und Embeddings. Mit OpenRouter: `LLM_PROVIDER=custom`, `LLM_MODEL=openrouter/<modell>`, `LLM_ENDPOINT=https://openrouter.ai/api/v1`, Embeddings lokal mit `EMBEDDING_PROVIDER=fastembed` (Modell `sentence-transformers/all-MiniLM-L6-v2`, 384 Dimensionen). Variablennamen sind **nicht** gegen die installierte Version geprüft.
- In der Cloud-Sandbox nicht lauffähig (HuggingFace 403). Test läuft auf Hans-Peters Linux-Rechner (venv `.venv-cognee`, wegen PEP 668). Ergebnis des Seed-Laufs: noch offen (erster Versuch scheiterte nur an einem Platzhalter-Key).
- Schritt 1 ist fertig (eigener Connector + 233 Beispiel-Dokumente). **Schritt 2 erst nach seinem Test:** `knowledge-graph`-Connector fragt Cognee (Fallback: statischer Graph), der Space zeichnet Cognees Knoten und Kanten.

## Offen
- Branches zusammenführen (siehe oben), danach `npm run check`.
- Skill-Governance in der App (`SkillGovernance.tsx`, noch localStorage) an die Funktionen anbinden (braucht Entscheidung zur Anmeldung); Skill-Sync nach `goose-home/.agents/skills` soll `sunsetAt`/`replacedBy` aus `skills_visible` anzeigen. Migration 020 ist auf dem Supabase-Projekt angewendet.
- Supabase-URL/Key pro Connector einmal eintragen; Idee "Einstellungen von anderem Connector kopieren".
- Skills & Connectors Katalog-Redesign, MP4-Demofilme (3, Accenture-Stil), optionale LLM-Agentendokumente, Registry-KPIs mit Studio-Agenten.

## Regeln für Änderungen
- Daten ändern, nicht Tests (Zahlen müssen tabellenübergreifend stimmen).
- Farben nur als Tokens (`var(--surface)` …), Spaces ohne Netzwerk und ohne localStorage.
- Ehrlich dokumentieren, was nicht getestet wurde (Cognee-Lauf, Variablennamen, Live-Dienste).
- Parallele Claude-Fenster: nach jeder größeren Etappe diese Datei, das Projekt-Dokument "Werkbank-Stand" und die Memory-Datei zum AI Control Tower aktualisieren.
