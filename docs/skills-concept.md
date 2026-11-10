# Skills in der Werkbank – Konzept, Schwächen, Marktvergleich

Stand 10.11.2026. Grundlage: Durchsicht des Codes auf Branch `feat/connect-your-tools` (Dateien in Klammern) und Websuche zu den Vergleichsplattformen. Die Einzelnotizen zum Bau stehen in `docs/status/skills-and-database.md`; dieses Dokument ist die Gesamtsicht. **Nicht getestet** wurde hier nichts neu: alles ist Lesen des Codes, kein Lauf in der Electron-App und keiner gegen das echte Supabase.

## 1. Was ein Skill hier ist

Ein Skill ist ein Ordner mit einer `SKILL.md` (Front Matter `name`, `description`, optional `metadata:` mit `domain`, `process`, `data-class`, `scope`, `team`, `lob`, `board-area`, `tools`, `language`) plus Anweisungstext, optional Skriptdateien. Das ist das offene Agent-Skills-Format; Goose liest es selbst. Ein Skill ist **Text, dem der Agent folgt**, kein Code der Plattform. Er bringt keine Werkzeuge mit, sondern nennt Connector-Werkzeuge (`tools:`), die schon verbunden sein müssen.

## 2. Wo Skills vorkommen (Speicherorte)

| Ort | Was | Quelle |
|---|---|---|
| `goose-home/.agents/skills/<name>/` | **die eine Wahrheit zur Laufzeit**: was dort liegt, sieht der Agent | `electron/main.mjs` (`SKILLS_DIR`, `readSkills`) |
| `examples/skills/` | 27 mitgelieferte Beispiel-Skills | `scripts/install-example-skills.mjs` (`npm run install:skills`) |
| `examples/databricks-demo/skills/` | Databricks-Skills (monday-close …) | `scripts/install-databricks-demo.mjs` |
| `.synced.json` im Skill-Ordner | Marke "kommt aus der Datenbank" (Version, Prüfsumme, Auslauf, Ersatz) | `scripts/skills-registry.mjs` |
| Supabase Schema `skills.*` | Register: Versionen, Reifegrad, Anträge, Lebenszyklus-Protokoll, Nutzungsereignisse, Dateien | Migrationen 007–013, 019–024 |
| `localStorage` im Fenster | Ebene je Skill (`werkbank.skillGovernance`), Katalog für Skill Health, Nutzung im Chat, Favoriten | `src/skill-governance.ts`, `src/skill-health.ts`, `src/chat-tabs.ts` |
| Work Items (Migration 021) | Skills als Teil von Agent-Projekten (`SKILL.md` im Bau-Schritt) | `src/develop.ts`, `electron/work-store.mjs` |

## 3. Wie Skills erstellt werden (fünf Wege)

1. **Aus einer Unterhaltung:** Chat-Kontext → "Make skill" (`/make-skill`, `src/chat-context.ts`). Der Agent liefert einen `SKILL.md`-Block; **nichts wird gespeichert**, die Person installiert selbst.
2. **Entwicklung nach Absicht:** Agent Studio / Develop (`src/flow.ts`, `src/develop.ts`): Intent → Requirements → Spezifikation → **Build** (Agent schreibt die `SKILL.md`, "traceable to REQ IDs") → Test & go live. Prüfung der Form mit `checkSkillMd` (`shared/skill-check.mjs`).
3. **Von Hand / Duplizieren:** Skills-Ansicht → "Duplicate" (lokale Kopie unter freiem Namen, `shared/duplicate.mjs`).
4. **Importieren:** ZIP (`Import skill…`) oder Deep Link `werkbank://install-skill` (führt `npx skills add` aus, nach Bestätigung).
5. **Beispiele / Skripte:** `install:skills`, `install:databricks-demo`.

Hilfs-Skills im Bestand: `skill-finder` ("erst suchen, dann bauen", nutzt `search_skills`), `skill-search`, `rate-skill`.

## 4. Wie Skills aufgerufen werden

- **Automatisch:** Goose zeigt dem Agenten Name und Beschreibung aller Skills im Ordner; der Agent wählt anhand der `description`. Die Beschreibung ist damit der einzige Auslöser. (Goose-Verhalten, im Code der Werkbank nicht abgebildet.)
- **Explizit im Composer:** `/` oder Blitz-Knopf listet installierte Skills; die Auswahl schreibt nur den Satz "Use the X skill to " ins Eingabefeld (`Composer.tsx`, `pickSkill`). Es gibt keinen echten Befehl, nur Text.
- **Chat-Reiter:** Favorites (`favoriteSkills` → Prompt "Nutze den Skill X"), Suggested (installiert, unbenutzt), Popular (lokale Nutzung + `skills_ranking`).
- **Harness-Profil:** "Prefer these skills when one fits: …" als Textzeile im Systemauftrag (`src/harness.ts`); das ist ein Hinweis, keine Beschränkung.
- **Scheduler:** Ein Job kann einen installierten Skill als Ziel haben (`App.tsx`, `Target` type `skill`); er wird als Chat-Aufruf gestartet.
- **Recipes (Databricks-Demo):** referenzieren Skills in YAML.

## 5. Wie Skills weitergegeben werden

| Weg | Wirkung |
|---|---|
| **ZIP Export/Import** | Ein Skill-Ordner als `<name>.zip`; Export abgelehnt bei Zugangsdaten, Import bei jedem roten Befund; Limits (100 Dateien, 2 MB/8 MB), Prüfsummen, keine Pfade nach außen; Ersetzen nur nach Häkchen, Backup in `.skill-backups/`. Import wird zusätzlich **immer als Individual** in der Datenbank angelegt. |
| **Deep Link / `npx skills add`** | Installation aus einem GitHub-Repo, immer erst nach Bestätigung. |
| **Register-Sync** | Täglich (und 30 s nach Start) zieht `syncSkills` die für die E-Mail sichtbaren Skills (`skills_visible`: Company, eigene Abteilung, eigene) nach `.agents/skills`, mit Prüfsummenvergleich und `validateSkill`. Entfernt nur Ordner mit `.synced.json`. |
| **Freigabe nach oben** | Individual → Department → Company per Antrag (`request_skill_promotion`), fünf automatische Prüfungen, danach Entscheidung durch Abteilungs-Admin bzw. Gruppe "Governance board"; Antragsteller darf nicht selbst genehmigen. |
| **Connector `skill-marketplace`** | Suche, Profil, Empfehlungen, Bewertungen, Lebenszyklus, Dateien (rund 25 Werkzeuge in sechs Modulen). |

## 6. Governance und Lebenszyklus

- **Prüfungen** (Secrets, Skripte, Rechte, Harness, Datenklasse): `src/skill-review.ts` und SQL `skills.run_checks`, zwei Kopien. Fail blockiert, Warn geht an den Prüfer.
- **Lebenszyklus:** draft → department → in_review → published → deprecated (Auslauf mit Ersatz) → retired; Änderungsprotokoll nur anhängend; Zuständigkeiten in der Datenbank.
- **Skill Health** (Admin → Skill management): Gesundheit, Dubletten (tf-idf), Aktionen, Katalog, Richtlinie.
- **Reifegrad:** pilot / empfohlen / approved (nur per CLI mit `--by`).

## 7. Schwächen (nach Gewicht)

**Grundsätzlich (blockiert Produktivbetrieb)**
1. **Keine echte Identität.** Alles hängt an einer E-Mail als Etikett (`p_actor`). Wer die E-Mail ändert, ist jemand anderes; Rechte, Eigentümer und "darf genehmigen" sind damit nicht belastbar. Das Zielbild braucht SSO/Entra.
2. **Ebenen (entschieden 10.11.2026: drei).** Individual, Department (`team`), Company. `lob` und `board-area` sind keine Geltungsbereiche mehr, nur noch Klassifikation. Umgesetzt in `SCOPES` (Registry-Skript), den Connector-Schemas, Migration `20261110_043_skill_three_levels.sql` (bestehende Skills mit diesen Scopes werden zu `team` und damit enger sichtbar) und im Marketplace-Space. Die Datenbank hatte dabei `requires:` beim Veröffentlichen verworfen; `normalize_meta` behält es jetzt. Offen bleibt, dass die App die Ebene je Skill noch lokal führt (Punkt 3).
3. **Ebene je Skill: Datenbank ist Wahrheit (umgesetzt 10.11.2026).** `applyDbLevels` (`src/skill-db.ts`) ersetzt die lokale Ebenenkarte durch die Geltungsbereiche aus `skills_health_overview`; ein nicht gelistetes Skill gilt als Individual, eine leere Antwort ändert nichts. Wirkt beim Öffnen von Skills & Connectors und Skill Health. Ist die Datenbank erreichbar, entfällt "Move down" (die Datenbank kennt kein Zurückstufen, nur Auslaufen/Stilllegen). Ohne Datenbank bleibt die lokale Simulation. Offen: Ebene der Agenten (`AGENT_GOV_KEY`) und Memory (`MEMORY_GOV_KEY`) sind weiter lokal, und die Ebenennamen sind eine lokale Einstellung.
4. **Kein Herkunftsnachweis.** Keine Signatur; Prüfsumme sichert nur Übertragung, nicht Urheber. ZIP-Import und Deep Link vertrauen auf die automatische Prüfung, die reine Regex-Heuristik ist (leicht zu umgehen: Befehl in anderer Schreibung, Anweisung in Prosa).
5. **Prüfregeln doppelt** (TS und SQL) und die Registerprüfungen `description`/`duplicate` nur in SQL: Abweichung ist vorprogrammiert. Zudem gelten **drei verschiedene Validierungen** mit unterschiedlichen Grenzen: `checkSkillMd` (300 Zeichen Beschreibung als Warnung, 100 KB), `validateSkill` (240 Zeichen als Fehler, 20 000 Zeichen), Paketprüfung (2 MB).

**Laufzeit und Messung**
6. **Skills werden zur Laufzeit nicht erzwungen.** `tools:` ist nur Dokumentation: Der Agent kann jedes verbundene Werkzeug aufrufen; `data-class` und `scope` begrenzen nichts bei der Ausführung. Die Prüfung "Rechte" liest Namen (`send|create|…`), keine echte Berechtigung.
7. **Aufruf nicht messbar.** Die Datenbank bekommt nur `install` und `view`. Es gibt kein Ereignis "Skill wurde im Lauf geladen/benutzt", keine Erfolgsquote, keine Kosten je Skill. Skill Health zeigt deshalb Läufe/Nutzer aus anonymen Geräte-Hashes; Popular zählt lokale Klicks. Die Dublettenquote und "ungenutzt" sind damit schwache Signale.
8. **Auslösung nur über die Beschreibung (Trigger-Tests umgesetzt 10.11.2026).** Jeder Beispiel-Skill hat `triggers.json` (`should`, `shouldNot`, optional `shouldNotLive`). `npm run test:triggers` prüft offline per Wortvergleich auf Name und Beschreibung (`shared/skill-triggers.mjs`, läuft auch in `npm test`), `npm run test:triggers:live` fragt ein Claude-Modell (`ANTHROPIC_API_KEY`, Standard `claude-haiku-5-5`). Der Offline-Lauf fängt überlappende Beschreibungen und fehlende Wörter, versteht aber keine Bedeutung und keine Verneinung (dafür `shouldNotLive`). Erster Lauf fand eine echte Schwäche: `abap-code-documentation` sprang auch bei "neuen Report schreiben" an, die Beschreibung sagt jetzt "Writes no new code." Offen: Lauf bei jeder neuen Version beim Veröffentlichen, Prüfung gegen die Skills der anderen Ebenen.
9. **Keine Abhängigkeiten.** Welche Connectoren (und Versionen) ein Skill braucht, ist nicht gespeichert; "kaputt" aus Datenbankdaten ist deshalb nie erkennbar. Fehlt ein Connector, merkt es der Agent erst im Lauf.
10. **Keine Versionswahl.** Sync zieht immer die neueste sichtbare Fassung; kein Pinnen, kein Rollback auf Anwenderseite, keine Staffelung (Pilotgruppe), kein Vergleich "was hat sich geändert" im Antrag.
11. **Geteilter Ordner, kein Schutz vor Überschreiben:** ein lokaler Skill mit gleichem Namen blockiert den Sync (wird nur gemeldet); Neustart des Agenten nötig, damit Änderungen wirken, und die Oberfläche erinnert nur im Text daran.

**Erlebnis und Prozess**
12. **Aufruf per Slash ist Text, kein Befehl.** Keine Argumente, keine Vorschau, welche Werkzeuge der Skill nutzt, keine Rückmeldung welcher Skill tatsächlich lief.
13. **Erstellung ohne Test.** "Make skill" und Build-Schritt erzeugen Text; ein Probelauf mit Beispieldaten ist eine Checkbox im Governance-Dialog, kein ausgeführter Test.
14. **Dubletten nur lexikalisch** (tf-idf mit kleiner Synonymliste); Fehltreffer bekannt, inhaltlich gleiche Skills mit anderen Wörtern bleiben unerkannt.
15. **Skills ohne Mandantentrennung:** ein Supabase-Projekt, Schema `skills`, keine Organisationen/Tenants.
16. **Beispieldaten vermischt mit echten:** Skill Health ergänzt Beispiel-Skills ("Example"), Kennzahlen aus Beispielen sind erfunden; leicht zu überlesen.
17. **Governance-Rollen sind Mockup:** `APPROVER`-SLAs (3 Arbeitstage, Board) sind Text; keine Erinnerung, keine Eskalation, keine Stellvertretung.

## 8. Vergleich mit Databricks, ServiceNow, Snowflake, Microsoft

Quellen sind Herstellerdokumentation und Meldungen aus der Websuche vom 10.11.2026; die Stände (GA/Preview) habe ich **nicht** einzeln geprüft. Wo ich nur eine Hersteller-Ankündigung fand, steht das dabei.

| Aspekt | Werkbank | Databricks | ServiceNow | Snowflake | Microsoft |
|---|---|---|---|---|---|
| **Skill-Begriff** | `SKILL.md`-Ordner (offenes Format) | **ebenfalls SKILL.md**, als Unity-Catalog-Objekt "Unity Gateway Skills" | "Now Assist Skills" (konfigurierte Fähigkeiten, nicht Textordner), dazu AI Agent Studio | Tools des Cortex-Agenten (Cortex Analyst/Search, SQL, UDF); "Skills" als Begriff in Native Apps erwähnt, Definition nicht gefunden | Copilot Studio: Agents-SDK-Skills (als Entra-App registriert); daneben SKILL.md in Repos (z. B. `agent365-skills`, für Claude Code/GitHub Copilot) |
| **Ablage** | Ordner + Supabase | Unity Catalog (`catalog.schema.skill`), Registry-MCP (`create/update/delete/list/load_skill`) | AI-Plattform-Tabellen, Instanzen | Snowflake-Objekte, MCP-Server je Schema | Dataverse/Power Platform, Agent-Register in M365-Admin |
| **Rechte** | E-Mail, nicht erzwungen | **UC-Berechtigungen, Tags, Audit** wie für Tabellen | ACLs je Agent/Workflow, Modellfreigabe je Skill | **Rollen/Grants/Audit** auch für Tools; Nutzer muss Snowflake-Nutzer sein | **Entra Agent ID** je Agent, API-Rechte pro Connector |
| **Freigabeprozess** | Antrag + 5 Prüfungen + Mensch (stark) | über UC-Rechte, kein Antragsworkflow gefunden | **AI Skills Approvals**, Blockieren bis Freigabe, AI-Steward-Rolle | über Rollenvergabe | Admin-Center, Richtlinien |
| **Laufzeitkontrolle** | keine (Agent-Entscheidung) | Gateway für Modelle/MCP/Agenten/Skills (angekündigt) | Echtzeit-Abbruch bei Rechteüberschreitung (Herstellerangabe) | RBAC je Tool-Aufruf | Identität und Richtlinien je Agent |
| **Lebenszyklus** | Auslauf/Ersatz/Stilllegung, Protokoll (stark) | Versionierung über UC | Lebenszyklus der Assets in AI Control Tower | Objektversionen | Registerstatus |
| **Beobachtung** | Läufe nur über Agent Observability (Beispieldaten) | System-Tabellen, Lineage | Nutzung/Wert je Agent | Query-/Audit-Logs | Agent 365 Observability |
| **Fremde Agenten** | Agent-Netz (Konzept) | externe Modelle/MCP im Gateway | Governance auch für Dritt-Agenten, Integration mit Microsoft Agent 365 (Preview, Mai 2026) | MCP von außen | Register für Copilot Studio, Pro-Code, Dritte |

### Was die anderen besser machen
- **Identität und Rechte als Plattformeigenschaft** (UC, Snowflake-Rollen, Entra Agent ID). Die Werkbank hat ein Etikett.
- **Durchsetzung zur Laufzeit** (Gateway, Tool-RBAC, Echtzeit-Abbruch). Die Werkbank prüft nur vor der Veröffentlichung.
- **Skill als gesichertes Objekt neben den Daten** (Databricks): gleiche Rechte und Audit-Sicht wie Tabellen, im selben Katalog.
- **Messung im Betrieb** (Nutzung, Wert, Kosten je Agent) aus der Plattform statt aus Installationsereignissen.
- **Skalierung**: Mandanten, Multi-Instanz-Abgleich (ServiceNow Dev → Prod).

### Was die Werkbank besser oder anders macht
- **Offenes, portables Format**: Der Skill ist ein Ordner; er läuft in Goose, Claude Code und anderen. Databricks geht jetzt denselben Weg (SKILL.md), die anderen binden Fähigkeiten an die Plattform.
- **Sichtbarer Prüf- und Freigabeweg** mit fünf erklärten Prüfungen, Viewer vor dem Antrag und Vier-Augen-Regel in der Datenbank.
- **Lebenszyklus mit Auslauf/Ersatz** bis in den lokalen Ordner (Hinweis in der Liste).
- **Dublettenschutz vor dem Veröffentlichen** und "erst suchen, dann bauen".
- **Entwicklung aus Prozessinterview und Anforderungen** (REQ-Rückverfolgung) statt leerem Editor.

### Einordnung
Die Werkbank ist ein **Prozess- und Oberflächenprototyp für Skill-Governance**, die Plattformen sind **Durchsetzungsebenen**. Für Accenture/SAP-Gespräche sinnvoller Zuschnitt: nicht die Plattformen nachbauen, sondern (a) das offene Skill-Format und den Freigabe-/Lebenszyklus-Prozess als plattformunabhängige Schicht zeigen und (b) benennen, **welche Plattform die Durchsetzung übernimmt** (z. B. Skills als UC-Objekte bei Databricks, Registerabgleich mit ServiceNow AI Control Tower oder Agent 365). Namensüberschneidung beachten: ServiceNow vermarktet "AI Control Tower" selbst als Governance-Produkt.

## 9. Empfehlungen (Reihenfolge)

1. ~~Datenbank als Wahrheit für die Ebene~~ (Skills erledigt; Agenten und Memory noch lokal).
2. **Nutzungsereignis "run"** (`skills_track`) aus Agent-Lauf und Scheduler, mit Erfolg/Fehler; damit werden Skill Health und Popular belastbar (7).
3. **Abhängigkeiten im Front Matter** (`requires: connector@version`) prüfen beim Install und Sync (9).
4. **Eine Validierung** statt drei; Regeln einmal in einer Datei, SQL daraus erzeugt oder per Test gegen dieselben Fälle geprüft (5).
5. ~~Trigger-Tests je Skill~~ (umgesetzt, siehe 8). Noch offen: bei jeder neuen Version automatisch laufen lassen (13).
6. **Identität**: SSO (Entra) und Gruppenrollen aus dem Verzeichnis (1); erst dann Governance als Schutz bezeichnen.
7. **Export als Plattform-Brücke**: Skill-Paket nach Databricks UC Skills (SKILL.md ist schon kompatibel) und Register-Abgleich zu ServiceNow/Agent 365 als Demo.
8. **Pinnen und Staffeln** von Versionen, Diff im Antrag (10).

## Quellen (Websuche, 10.11.2026)
- Databricks: [Skills support in Unity Gateway](https://docs.databricks.com/aws/en/agents/uc-skills/), [Create and share Unity Gateway Skills](https://docs.databricks.com/aws/en/agents/uc-skills/create-share-uc-skills), [AI Gateway (StartupHub)](https://www.startuphub.ai/ai-news/technology/2026/databricks-unveils-ai-gateway)
- ServiceNow: [AI Control Tower release notes](https://www.servicenow.com/docs/r/yokohama/release-notes/ai-governance-rn.html), [Governance mit Microsoft (Pressemeldung)](https://investor.servicenow.com/news/news-details/2026/ServiceNow-expands-AI-agent-governance-through-deeper-integration-with-Microsoft/)
- Snowflake: [Cortex Agents Blog](https://snowflake.com/en/blog/enterprise-ai-agent-platform/), [Managed MCP vs. Agents REST API](https://docs.snowflake.com/developer-guide/cortex-ai-cookbook/mcp-or-agent-rest-api), [Native Apps GA](https://docs.snowflake.com/en/release-notes/2026/other/2026-08-07-native-apps-agents-mcp-ga)
- Microsoft: [Agent registry](https://learn.microsoft.com/en-us/microsoft-agent-365/builder/agent-registry), [Entra Agent IDs für Copilot Studio](https://learn.microsoft.com/microsoft-copilot-studio/admin-use-entra-agent-identities), [agent365-skills](https://cdn.jsdelivr.net/gh/microsoft/agent365-skills@main/README.md)
