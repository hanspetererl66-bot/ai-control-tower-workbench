# Ontology Manager (OntoRAG)

Ontologien für die Werkbank verwalten und abfragen, mit [OntoRAG](https://pypi.org/project/ontorag/) (Apache-2.0).
OntoRAG bringt zwei MCP-Server mit, die nur HTTP sprechen (Ontologie-Katalog, Port 9020; Wissensserver mit SPARQL, Port 9010).
Die Werkbank startet Konnektoren über stdio. `server/ontorag_stdio.py` hängt beide in einen Server und läuft über stdio.
Es sind die 13 OntoRAG-Tools mit ihren Original-Namen.

## Einrichten

1. `uv` installieren (https://docs.astral.sh/uv/). Der erste Start lädt die OntoRAG-Pakete.
2. In der Werkbank den Konnektor "Ontology Manager (OntoRAG)" installieren und einen **Ontology folder** angeben.
   Beim ersten Start wird dort die mitgelieferte Baseline `werkbank_fin` (Finance Pre-Close) registriert.
3. Optional: eigene Ontologie und Instanzen als `.ttl` angeben (beide oder keine). Sonst lesen `describe`, `list_by_class` und die SPARQL-Tools die mitgelieferten Beispieldaten.

Kein Schlüssel nötig. Ein Schlüssel (OpenRouter oder ein lokaler OpenAI-kompatibler Endpunkt) wird erst gebraucht, wenn man mit der OntoRAG-Kommandozeile Ontologien aus Dokumenten erzeugt (`ontorag extract-schema`); das macht dieser Konnektor nicht.

## Beispieldaten

`server/data/werkbank_fin.ttl` (Klassen und Eigenschaften) und `werkbank_fin_instances.ttl`:
Gesellschaften DE10, FR10, UK10 (wie im Pre-Close-Space und in der Databricks-Demo), zertifizierte Kennzahlen Margin, DSO, offenes Bestellobligo und Marge nach Rückstellungen mit Definition, Formel und Herkunft (Tabellen im Katalog `werkbank_demo`), Pre-Close-Prüfungen.

## Prüfen

```
npm test                       # Manifest, Bündelung, Beispieldaten
uv run --no-project --python 3.12 --with ontorag connectors/ontology-manager/server/smoke_test.py
```

Der Smoke-Test startet den Launcher wie die Werkbank (stdio, leerer Katalogordner) und ruft die wichtigsten Tools auf.

## Nicht getestet

- Installation und Lauf in der Electron-App (nur Manifest-Test und Smoke-Test außerhalb der App).
- Ob die App `${user_config.…}` bei leeren optionalen Feldern als leeren Text einsetzt (der Launcher behandelt einen unaufgelösten Platzhalter als leer).
- Ontologien aus Dokumenten erzeugen (`extract-schema`, `extract-instances`): braucht ein Modell, nicht ausprobiert.
- OntoRAG ist jung (0.1.x, Stand 03.11.2026); Tool-Namen und Verhalten können sich ändern. `add_ontology` schreibt in den Katalogordner.
- Die Beispiel-Definitionen der Kennzahlen sind Platzhalter, keine abgestimmten Konzerndefinitionen, und stimmen nicht automatisch mit den Berechnungen im Pre-Close-Space überein.
