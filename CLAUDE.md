# Werkbank / Joule Work X – Next Gen (Projektkontext für Claude)

Privater Prototyp von Hans-Peter (Accenture S&P EMEA). Electron + Vite + React/TS-App "Werkbank" mit Goose als Agent-Runtime (bleibt so). Sprache mit dem Nutzer: Deutsch, UI-Texte: Englisch.

Repo: `hanspetererl66-bot/ai-control-tower-workbench`, aktueller Arbeitsbranch `feat/chat-features`.

## Befehle
- `npm test` (node --test), `npx tsc --noEmit -p .`, `npm run check` (alles zusammen) – vor jedem Push grün.
- Beispiel-Spaces: `examples/<name>/index.html`, installieren mit `npm run install:examples` (siehe Skill `space-change`).
- Connector-Bundles: `npm run build:connectors` (oder `node scripts/build-control-tower-mcpb.mjs <id>`).
- Cognee: `npm run cognee:corpus`, danach `.venv-cognee/bin/python scripts/cognee-seed.py [--reset]`.

## Architektur in Kürze
- `src/App.tsx`: Hauptfenster. Angedockter Joule-Chat rechts (`src/ui/JouleDock.tsx`, `src/dock.ts`) in den Ansichten Studio und Skills. Dokumentänderungen kommen als ```markdown-Block, "Apply to document" übernimmt sie; "ja/passt" bestätigt das Dokument.
- Skills: drei Ebenen Individual → Department → Organization (`src/ui/SkillGovernance.tsx`, `src/skill-approval.ts`). Automatische Prüfung `src/skill-review.ts` (Secrets, Skripte, Rechte, Harness, Daten; fail blockiert, warn geht an den Prüfer). Governance-Stand liegt in der App noch **lokal (localStorage)**.
- Zentrale Datenbank: Supabase-Projekt "Joule-AI-control-tower" (Ref `iguatwcsgjewpyejlgdk`, eu-west-1). Migration `supabase/migrations/20261030_019_skill_promotion.sql` (Tabellen `skills.promotion*`, Funktionen `skills_promotion_*`, `skills_visible`). Tabellen sind für anon/authenticated gesperrt, Funktionen nur für service_role (Connector-Muster). Identität ist nur die E-Mail (`p_actor`), für Produktion SSO/Supabase Auth nötig. Die Prüfregeln existieren zweimal (TS und SQL) und müssen gemeinsam geändert werden.
- Connectoren (`connectors/`): gemeinsame MCP-Laufzeit `connectors/_lib/server/runtime.mjs`; sieben Bibliotheks-Connectoren (ai-control-tower, sub4me, n8n-automation, skill-marketplace, knowledge-graph, web-sources, werkbank-workspace, zusammen 73 Tools, ohne Überschneidung) plus der reine Manifest-Connector `cognee-memory`. Bundles baut `stageConnector` in `connectors/_lib/bundle.mjs` (Zip-Builder und Electron-Installation nutzen dasselbe).

## Cognee Memory (Stand)
- Echter Open-Source-Wissensgraph (Apache-2.0, `cognee-mcp`, Tools remember/recall/forget), Start über `uvx`. Braucht LLM-Key und Embeddings. Mit OpenRouter: `LLM_PROVIDER=custom`, `LLM_MODEL=openrouter/<modell>`, `LLM_ENDPOINT=https://openrouter.ai/api/v1`, Embeddings lokal mit `EMBEDDING_PROVIDER=fastembed`. Variablennamen sind **nicht** gegen die installierte Version geprüft.
- In der Cloud-Sandbox nicht lauffähig (HuggingFace 403). Test läuft auf Hans-Peters Rechner (Linux, venv `.venv-cognee`, wegen PEP 668).
- Schritt 1 ist fertig (eigener Connector + 233 Beispiel-Dokumente). **Schritt 2 erst nach seinem Test:** `knowledge-graph`-Connector fragt Cognee (Fallback: statischer Graph), der Space zeichnet Cognees Knoten und Kanten.

## Offen
- Skill-Governance an die Supabase-Promotion-Funktionen anbinden (braucht Entscheidung zur Anmeldung), Skill-Sync nach `goose-home/.agents/skills`.
- Supabase-URL/Key pro Connector einmal eintragen; Idee "Einstellungen von anderem Connector kopieren".
- Skills & Connectors Katalog-Redesign, MP4-Demofilme (3, Accenture-Stil), optionale LLM-Agentendokumente, Registry-KPIs mit Studio-Agenten.

## Regeln für Änderungen
- Daten ändern, nicht Tests (Zahlen müssen tabellenübergreifend stimmen).
- Farben nur als Tokens (`var(--surface)` …), Spaces ohne Netzwerk und ohne localStorage.
- Ehrlich dokumentieren, was nicht getestet wurde.
