# Ontology Manager (OntoRAG)

Ontologien für die Werkbank verwalten, abfragen und aus Dokumenten wachsen lassen, mit [OntoRAG](https://pypi.org/project/ontorag/) (Apache-2.0).
OntoRAG bringt zwei MCP-Server mit, die nur HTTP sprechen (Ontologie-Katalog, Port 9020; Wissensserver mit SPARQL, Port 9010).
Die Werkbank startet Konnektoren über stdio. `server/ontorag_stdio.py` hängt beide in einen Server und läuft über stdio.
Dazu kommen sechs eigene Tools für Dokument → Ontologie (`server/doc_to_ontology.py`) und `impact_of_term` (`server/impact.py`). Zusammen 20 Tools.

## Einrichten

1. `uv` installieren (https://docs.astral.sh/uv/). Der erste Start lädt die OntoRAG-Pakete.
2. In der Werkbank den Konnektor "Ontology Manager (OntoRAG)" installieren und einen **Ontology folder** angeben.
   Beim ersten Start wird dort die mitgelieferte Baseline `werkbank_fin` (Finance Pre-Close) registriert.
3. Optional: eigene Ontologie und Instanzen als `.ttl` angeben (beide oder keine). Sonst lesen `describe`, `list_by_class` und die SPARQL-Tools die mitgelieferten Beispieldaten.
4. Für Dokument → Ontologie: **Documents folder** (Ordner mit den Dokumenten) und **Model API key** eintragen, optional Modellname und Endpunkt (OpenRouter ist Standard; ein lokaler OpenAI-kompatibler Server geht auch).

Lesen und Abfragen brauchen keinen Schlüssel.

## Dokument → Ontologie (Vorschlag, Prüfung, Übernahme)

Leitgedanke von OntoRAG: das Modell schlägt vor, Code entscheidet, der Mensch verantwortet.

1. `propose_ontology_from_documents`: liest Dokumente (`.md .txt .html .epub .pdf`, nur aus dem Documents folder oder der Inbox) oder eingefügten Text und erzeugt einen Vorschlag.
   - `mode: "new"`: neue Ontologie `slug`, optional abgeglichen mit vorhandenen (`baselines`).
   - `mode: "extend"`: Ergänzungen zur vorhandenen Ontologie `slug`. Bekanntes wird wiederverwendet (reuse), Spezialisierungen werden markiert (extend), neues bleibt neu.
   - Ergebnis ist ein Prüfbericht: je Begriff Aktion, Beschreibung, Zitate aus dem Dokument, bei Abgleich Konfidenz und Begründung, dazu "needs_attention" (ohne Zitat oder geringe Konfidenz). **Am Katalog ändert sich nichts.**
2. `show_ontology_proposal` / `list_ontology_proposals`: Bericht erneut ansehen. Der volle Bericht liegt in `<Ontology folder>/proposals/<id>/report.json`, die Turtle-Fassung in `staging.ttl`.
3. `apply_ontology_proposal` mit `confirmed=true`: ohne den Haken zeigt es nur, was passieren würde (wie `draft_*` und `submit_draft` im Mock-SAP).
   Neu: wird als Ontologie registriert. Ergänzung: wird mit der vorhandenen zusammengeführt, die alte Fassung liegt vorher in `ontologies/_history/`. Es wird nichts entfernt.
4. `discard_ontology_proposal` (`confirmed=true`) löscht nur die Arbeitsdateien eines Vorschlags.

Schutz: Pfade außerhalb der erlaubten Ordner werden abgelehnt, höchstens 25 Dokumente je Vorschlag und 120 Textabschnitte (jeder Abschnitt ist ein Modellaufruf, Grenze über `max_chunks` bewusst anhebbar), vorhandene Slugs werden bei `mode: "new"` nicht überschrieben, Baselines werden nie aus einem entfernten Katalog geholt.

**Datenschutz:** Der Text der Dokumente geht an den eingestellten Modell-Endpunkt. Für vertrauliche Dokumente einen Endpunkt wählen, dem man sie anvertrauen darf, oder ein lokales Modell.

## Auswirkung einer Änderung: `impact_of_term`

Nur lesend. `impact_of_term` nimmt einen Begriff (IRI, Kurzname wie `DSO` oder Bezeichnung) und zeigt, wovon er abhängt, was auf ihn zeigt (bis `depth` Schritte, Standard 3), die Verknüpfungen jedes Betroffenen, Zähler je Art und die Verantwortlichen (`certifiedBy`), die man vor einer Änderung fragen sollte.
Beispiel mit den Beispieldaten: `Margin` → betroffen sind `MarginAfterAccruals` und die Prüfung `chk_margin`, zu fragen ist Group Controlling. Bei einer Klasse kommen Unterklassen, Instanzen und Eigenschaften dazu.
Gezählt wird nur, was in der Ontologie und ihren Instanzen steht (die beiden Dateien, die auch `describe` und SPARQL lesen, nicht der Katalog). Agenten, Skills und Berichte, die den Begriff nutzen, aber nicht modelliert sind, fehlen.

## Demo-Dokument

`examples/procurement-handbook.md` ist ein zweites, erfundenes Handbuch (Lieferanten, Bestellungen, Wareneingang, Terminverfolgung) zur zweiten Beispiel-Ontologie `werkbank_scm` (wird beim ersten Start zusätzlich im Katalog angelegt, nie überschrieben); Demo: `propose_ontology_from_documents` im Modus `extend` auf `werkbank_scm` mit diesem Dokument, dann in der Werkbank unter Admin → Ontologies → Proposals prüfen und bestätigen.

`examples/finance-closing-handbook.md` ist ein erfundenes Closing-Handbuch (Rückstellungen, GR/IR, Intercompany-Differenzen, offene Bestellungen, DSO mit DE10/FR10/UK10). Es gehört nicht zum Bündel. Für die Demo den **Documents folder** auf `examples/` zeigen lassen und `propose_ontology_from_documents` im Modus `extend` auf `werkbank_fin` anwenden. Danach `impact_of_term` auf einen bestehenden Begriff.

## Beispieldaten

`server/data/werkbank_fin.ttl` (Klassen und Eigenschaften) und `werkbank_fin_instances.ttl`:
Gesellschaften DE10, FR10, UK10 (wie im Pre-Close-Space und in der Databricks-Demo), zertifizierte Kennzahlen Margin, DSO, offenes Bestellobligo und Marge nach Rückstellungen mit Definition, Formel und Herkunft (Tabellen im Katalog `werkbank_demo`), Pre-Close-Prüfungen.

## Prüfen

```
npm test                                   # Manifest, Bündelung, Beispieldaten, Schutzregeln
uv run --no-project --python 3.12 --with "ontorag[pdf]" connectors/ontology-manager/server/smoke_test.py
uv run --no-project --python 3.12 --with "ontorag[pdf]" connectors/ontology-manager/test/e2e_documents.py
```

- `smoke_test.py` startet den Launcher wie die Werkbank (stdio, leerer Ordner) und ruft alle OntoRAG-Tools auf.
- `e2e_documents.py` prüft Dokument → Ontologie Ende zu Ende gegen ein **Mock-Modell** (`test/mock_llm.py`, feste Stichwortregeln): neu, ergänzen mit Abgleich, Bestätigung, Sicherung der alten Fassung, PDF, Ablehnungen.

## Nicht getestet

- `impact_of_term` kennt nur Verknüpfungen in den Beispieldaten; Begriffe aus übernommenen Dokumenten stehen im Katalog, nicht in den Dateien für die Abfrage, und werden deshalb noch nicht ausgewertet. Es gibt keine Anbindung an Agenten und Skills der Werkbank.
- Mit einem **echten Sprachmodell**: der Ablauf ist nur gegen das Mock-Modell geprüft. Wie gut echte Modelle Klassen und Eigenschaften vorschlagen, ob sie das JSON zuverlässig liefern und wie sich Kosten verhalten, ist offen. Die Berichte sind eine Entscheidungshilfe, kein Ersatz für fachliche Prüfung.
- Installation und Lauf in der Electron-App (nur Manifest-Test, Smoke-Test und End-to-End-Test außerhalb der App).
- Ob die App `${user_config.…}` bei leeren optionalen Feldern als leeren Text einsetzt (Launcher und Modul behandeln einen unaufgelösten Platzhalter als leer).
- Lange Läufe: ein Vorschlag aus vielen Abschnitten kann Minuten dauern; ob die Chat-Oberfläche das Warten sauber darstellt, ist nicht geprüft.
- Instanzen aus Dokumenten (`extract-instances`, Quellenangaben für `mentions`) sind noch nicht eingebaut. DOCX und PPTX werden nicht gelesen (nur die oben genannten Formate).
- OntoRAG ist jung (0.1.x, Stand 03.11.2026); Tool-Namen und Verhalten können sich ändern.
- Die Beispiel-Definitionen der Kennzahlen sind Platzhalter, keine abgestimmten Konzerndefinitionen.
