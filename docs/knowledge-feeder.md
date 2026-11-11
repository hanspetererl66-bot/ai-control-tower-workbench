# Wissens-Feeder: SAP-Quellen mit Lizenz-Gate für den Cognee-Wissensgraphen

Stand 11.11.2026. Der Feeder füllt den Werkbank-Wissensgraphen (Cognee, Connector `cognee-memory`/`knowledge-graph`) mit offiziellen SAP-Quellen, damit der Agent Fragen zu SAP-Produkten mit Beleg beantworten kann. Kernidee: ein **Quellenregister mit Lizenz-Gate**. Nur was Software laut Lizenz holen und speichern darf, kommt im Volltext hinein. Der Rest ist höchstens ein Verweis (Titel, URL, Datum) oder gesperrt. Das Register erzwingt der Code, nicht nur diese Anleitung. **Das ist keine Rechtsberatung.**

## Das Register (`sources/registry.json`, Schema `sources/registry.schema.json`)

| Quelle | Status | Grund |
|---|---|---|
| `sap-docs-github` (GitHub-Organisation SAP-docs) | **allowed** je Repo | Markdown-Quellen der SAP-Produktdokumentation. Gelesen wird ein Repo nur, wenn GitHub die Lizenz `CC-BY-4.0`, `Apache-2.0` oder `MIT` erkennt. Share-Alike, unbekannt, fehlend: `needs_review`, übersprungen. |
| `sap-samples-github` (SAP-samples) | **allowed** je Repo | Gleiche Regel, aber nur eine ausdrückliche Liste in `sources/scope.json` (derzeit leer). |
| `sap-architecture-center` | needs_review | Repo-Lizenz und Geltung für die gerenderte Seite ungeprüft. |
| `sap-tutorials-github` | needs_review | Lizenz ungeprüft (developers.sap.com zeigt ein Lizenz-Tag). |
| `sap-news-feed` | **metadata_only** | Nur Titel, URL, Datum, Kategorien, Sprache. Kein Artikeltext. **Aktuell sperrt `news.sap.com/robots.txt` unseren User-Agent** (siehe unten). |
| `sap-community-feeds` | **metadata_only** | Gleiche Regel; Feeds trägst du in `sources/community-feeds.json` ein (derzeit leer). |
| `sap-help-portal` | blocked | `robots.txt` verbietet den automatischen Abruf; Nutzungsbedingungen verbieten Crawler und KI-Nutzung. |
| `sap-community-pages` | blocked | Scraping von Seiten und undokumentierte APIs. |
| `sap-news-article-pages` | blocked | Nur die Feed-Metadaten werden genutzt. |
| `sap-notes-kba`, `sap-support-launchpad` | blocked | Anmeldung nötig. |
| `sap-business-accelerator-hub` | needs_review | API-Spezifikationen laden, aber Bedingungen und API Policy ungeprüft. |
| `sap-learning`, `sap-roadmap-explorer`, `sap-discovery-center` | needs_review | Bedingungen ungeprüft. |

Pflichtfelder je Quelle: `id`, `title`, `owner`, `url`, `kind` (`git-org`, `git-repo`, `feed`, `page`), `license`, `terms_url`, `status`, `reason`, `attribution_text`, `dataset`, `checked_on`; dazu `id_prefix` (Kennung der Dokumente) und bei Feeds `feeds` oder `feeds_file`. `npm run knowledge:list` zeigt alle Quellen mit Status und Grund.

## Was der Code erzwingt

- **Gate:** `assertCollectable` (`scripts/knowledge/registry.mjs`) lässt nur `allowed` (Volltext, nur Git-Quellen) und `metadata_only` (nur Feeds) durch. `blocked` und `needs_review` werfen einen `SourceBlockedError` mit dem Grund aus dem Register. Kein Schalter, keine Umgebungsvariable und kein Kommandozeilen-Flag ändert einen Status; wer eine Quelle erweitern will, ändert das Register und muss die Lizenz prüfen.
- **Kein Text bei Metadaten:** Der Feed-Parser liest `description`, `summary` und `content` gar nicht; `metadataDocument` akzeptiert nur Titel, URL, Datum, Kategorien, Sprache und lehnt jedes weitere Feld ab.
- **Höflichkeit:** `robots.txt` wird je Host vor dem ersten Abruf geholt und zwischengespeichert; ist sie nicht lesbar (5xx), wird nichts geholt (bei 404 gilt: erlaubt). User-Agent `werkbank-knowledge-feeder (contact: <KNOWLEDGE_FEEDER_CONTACT>)`, höchstens eine Anfrage pro Sekunde und Host, nur https, keine Tarnung, kein Umgehen von Anmeldungen.
- **Git:** Inhalte kommen per `git clone --depth 1` und `git fetch`, nie aus GitHub-HTML. Die REST-API listet nur Repos und Lizenzen (optional `GITHUB_TOKEN`, nur an `api.github.com`, nie in Logs oder Dateien). Ein Repo, das die Lizenzprüfung nicht besteht oder nicht in `scope.json` steht, wird nicht einmal geklont.

## Dokumente

Kurzer Text, am Ende die Kennung in Klammern, wie beim Customer-360-Korpus: `(sap-docs:btp-cloud-logging/docs/x.md#chunk-2)`. Zeilen: Quelle, Titel, URL (mit Commit), Lizenz, Revision, Attribution. Bei CC-BY steht die Attribution in **jedem** Dokument (Urheberzeile aus der `REUSE.toml` des Repos, sonst nur die Lizenzangabe). Markdown wird bereinigt (Front Matter, `<!-- loio… -->`, Anker, Bilder, Kramdown-Attribute, HTML-Tabellen werden zu `a | b`, Links behalten ihren Text) und nach Überschriften in Stücke von etwa 800 bis 1.500 Zeichen mit Überschriftenpfad geteilt. `ATTRIBUTION.md` entsteht aus dem Register für die tatsächlich eingespielten Quellen (`data/knowledge/ATTRIBUTION.md`).

## Aufruf

```
export KNOWLEDGE_FEEDER_CONTACT=<Adresse, die SAP oder GitHub anschreiben kann>
npm run knowledge:list                       # Register mit Status
node scripts/knowledge-feeder.mjs --estimate # nur zählen: Dokumente, Zeichen, grobe Tokens (kein Modellaufruf)
npm run knowledge:git                        # Trockenlauf: schreibt dist/cognee-corpus-sap-docs-github.json
npm run knowledge:feeds                      # Trockenlauf für die Feeds
node scripts/knowledge-feeder.mjs --source sap-docs-github --limit 100 --seed
```

- Standard ist ein **Trockenlauf**: sammeln, `dist/cognee-corpus-<quelle>.json` schreiben, Größe ausgeben. Eingespielt wird nur mit `--seed` (ruft `scripts/cognee-seed.py` mit dem Datensatz der Quelle auf: `sap-docs-github`, `sap-samples`, `sap-news-index`, `sap-community-index`; `.venv-cognee/bin/python`, falls vorhanden). `--reset` wird durchgereicht. Cognee **cognify** schickt Text an das Sprachmodell und kostet Geld.
- `--estimate` schreibt nichts; `--limit N` begrenzt die Zahl der Dokumente (der Rest bleibt für den nächsten Lauf); `--full` liest alles neu; `--source <id>` nennt eine Quelle (eine gesperrte wird mit Grund abgelehnt, Exit-Code 2); `--kind git|feed`.
- **Inkrementell:** `data/knowledge/state.json` merkt je Repo den Blob-Hash jeder verarbeiteten Datei und je Feed die gesehenen Einträge. Ein zweiter Lauf liefert nur Neues oder Geändertes. Der Stand wird **erst nach erfolgreichem Seed** gespeichert; ein Trockenlauf ändert ihn nicht. Gelöschte Dateien bleiben im Graphen (Cognee-Dokumente werden nicht einzeln entfernt).
- **Umfang:** `sources/scope.json` ist eine Positivliste. Gemessen am 11.11.2026 (Trockenlauf): `btp-cloud-logging`, `btp-job-scheduling-service`, `btp-credential-store` ergeben rund 700 Stücke, 1,1 Mio. Zeichen, etwa 275.000 Tokens. `btp-integration-suite`, `sap-artificial-intelligence` und `cloud-alm-setup-admin-guide` zusammen wären rund 27.700 Stücke und 10 Mio. Tokens, also erst nach `--estimate` und mit Bedacht aufnehmen.
- Der Agent behält die Regel: Zugriff auf Cognee nur über `recall`.

## Scheduler

Zwei Beispiel-Jobs (Typ Workflow, `example: true`, wie die anderen Beispiele in `src/jobs.ts`): "SAP knowledge feeds (daily)" 05:00 und "SAP knowledge repos (weekly)" Sonntag 03:00. Es sind Einträge zum Zeigen; sie starten den Feeder nicht selbst. Ein echter Lauf wäre `npm run knowledge:feeds` bzw. `knowledge:git`, mit `--seed` erst nach `--estimate`.

## Rechtliche Quellen (Recherche vom 11.11.2026, aus Zusammenfassungen, nicht aus Volltexten geprüft)

- Terms of Use for SAP Websites: https://www.sap.com/about/legal/terms-of-use.html (nicht kommerzielle Nutzung; Bots, Scraper, Crawler, MCP und Agenten-Frameworks verboten, auch für KI-Training; automatisches Kopieren und Indexieren braucht ausdrückliche Erlaubnis; Speichern oder Weitergeben an Dritte, "auch KI-Anbieter", verboten; robots.txt beachten).
- SAP API Policy (April 2026): https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf und Einordnung https://www.hunton.com/insights/legal/saps-new-api-policy-raises-new-compliance-and-continuity-risks (26.05.2026).
- GitHub-Organisation SAP-docs: https://github.com/sap-docs (38 Repos; am 11.11.2026 über die API gelesen: fast alle `CC-BY-4.0`, `preview.developer.concur.com` `Apache-2.0`, `.github` ohne Lizenz).
- Vorbild zum Finden von Repos, kein Rechtsnachweis: https://github.com/marianfoo/mcp-sap-docs (Apache-2.0).

## Befunde beim Bau (11.11.2026, echte Abrufe)

- `https://news.sap.com/robots.txt`: `User-agent: *` / `Disallow: /`; erlaubt sind nur die namentlich aufgeführten Agenten (Suchmaschinen, einige KI-Dienste). Unser User-Agent steht nicht darin, also **verweigert der Feeder den News-Feed**. Wir tarnen uns nicht als einer der genannten Agenten. Der News-Feed liefert deshalb solange nichts, bis SAP uns freigibt oder du eine andere, erlaubte Quelle nennst.
- `https://community.sap.com/robots.txt`: `User-agent: *`, Crawl-Delay 5, einzelne Pfade gesperrt (u. a. `/khhcw49343/rss`). Unsere Mindestpause ist 1 Sekunde; **der Crawl-Delay 5 wird noch nicht gelesen**. Vor dem ersten echten Community-Feed ergänzen (offene Aufgabe).
- `api.github.com/robots.txt` antwortet 404 (erlaubt).
- Die SAP-docs-Repos tragen eine `REUSE.toml` mit "SAP SE or an SAP affiliate company and SAP-docs/<repo> contributors"; daraus kommt die Urheberzeile.

## Nicht getestet

- **Kein echter Cognee-Lauf** und kein `--seed` (kostet Modellaufrufe; Kette Korpus, Seed-Skript, `recall` mit Beleg nicht belegt; ob `cognee.remember` doppelte Texte erkennt, ist offen, deshalb schreibt ein Lauf nur neue oder geänderte Dokumente).
- **Echte Abrufe (nur Trockenlauf, ohne Modell):** Auflistung der Organisation SAP-docs über die GitHub-API ohne Token (38 Repos) und das flache Klonen der drei Repos aus `scope.json` (702 Stücke, `--estimate`); `robots.txt` von news.sap.com (Feed verweigert). **Nie gegen die Praxis geprüft:** echte Feeds von SAP (der News-Feed ist gesperrt, `community-feeds.json` ist leer), `GITHUB_TOKEN`, ein Lauf von `--seed`, mehrere aufeinanderfolgende echte Läufe (Inkrementalität nur mit einem lokalen Fixture-Repo getestet), die Qualität der Antworten des Agenten.
- Die Tests (`test/knowledge-feeder.test.mjs`) laufen ohne Netz: Fake-`fetch`, ein temporäres lokales Git-Repo, Fixture-Feeds.
- Electron-App und Scheduler: die zwei Beispiel-Jobs sind nur Daten (Test `test/scheduler.test.mjs`), kein Lauf.
- Die Bereinigung des Markdowns wurde an Dateien von `btp-cloud-logging` und den Trockenläufen der drei Repos geprüft, nicht an allen 38 Repos; andere Repos können Konstrukte enthalten, die der Cleaner nicht kennt.

## Offene rechtliche Fragen

1. **Geltungsbereich der Terms of Use** für News Center und Community: Gelten sie für RSS-Feeds? Darf ein Verweis (Titel, URL, Datum) automatisch gespeichert werden? Heute sperrt die `robots.txt` den News-Feed ohnehin.
2. **Partnerkanäle:** Erlauben SAP-Partnerverträge oder SAP-Programme mehr (etwa eine offizielle API oder ein Datenfeed)? Ansprechpartner bei SAP klären.
3. **API Policy:** Umfasst sie die Nutzung der öffentlichen GitHub-Repos von SAP oder nur SAP-eigene APIs? Die Policy wurde nur aus einer Zusammenfassung gelesen.
4. **Kommerziell oder nicht:** Die Terms of Use nennen nicht kommerzielle Nutzung. Ein privater Prototyp bei Accenture, der später Kunden gezeigt wird, ist wohl anders zu bewerten als ein Heimversuch.
5. **Text an einen Modellanbieter senden:** `cognify` schickt die Texte an das konfigurierte Sprachmodell (OpenRouter und dahinter ein Anbieter). Bei CC-BY ist das lizenzrechtlich im Prinzip zulässig, die Attribution muss mitlaufen; ob die Weitergabe an einen KI-Anbieter den Bedingungen von SAP-eigenen Inhalten widerspricht, ist für Inhalte außerhalb von CC-BY offen.
6. **Namensnennung:** Reicht die Attribution im Dokumenttext, wenn der Agent Antworten aus mehreren Stücken mischt? Die Antwort muss die Quelle nennen (`recall` liefert die Kennung); ob das die CC-BY-Pflicht erfüllt, ist nicht geprüft.
7. **Share-Alike:** Falls ein Repo `CC-BY-SA-*` trägt, ist es `needs_review`; ob ein Wissensgraph ein "Derivat" im Sinn der Lizenz wäre, ist ungeklärt und wird bewusst nicht angenommen.
