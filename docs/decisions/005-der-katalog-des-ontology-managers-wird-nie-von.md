# 005 Der Katalog des Ontology Managers wird nie von der App geschrieben

- **Status:** entschieden
- **Datum:** 04. bis 05.11.2026 (PR #177, PR #190)
- **Entscheider:** Hans-Peter

**Frage:** Wer ändert den Ontologie-Katalog?

**Entscheidung:** Nur der Connector, und nur nach ausdrücklicher Bestätigung (`confirmed=true`); die vorige Fassung wandert vorher in `_history`. Was die App zusätzlich pflegt (Eigentümer, Freigeber, Lebenszyklus, Synonyme, Mapping, Fragen), liegt in einer eigenen Datei `governance.json`.

**Grund:** Der Katalog ist die Quelle der Wahrheit; ein Fehler der Oberfläche darf ihn nicht beschädigen.

**Folgen:** Auch die geplante Nutzer-Suche (Akt A) schreibt nie in den Katalog; sie speichert nur Entscheidungen in `governance.json`.

**Quellen:** `docs/status/ontology.md`.
