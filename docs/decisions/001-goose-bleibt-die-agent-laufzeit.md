# 001 Goose bleibt die Agent-Laufzeit

- **Status:** entschieden
- **Datum:** nicht belegt (steht seit dem Projektstand in CLAUDE.md)
- **Entscheider:** Hans-Peter

**Frage:** Welche Laufzeit führt die Agenten der Werkbank aus?

**Entscheidung:** Goose bleibt die Agent-Laufzeit; die Werkbank bringt Oberfläche, Connectoren und Spaces mit.

**Grund:** Im Projektkontext ausdrücklich so festgehalten ("bleibt so").

**Folgen:** Connectoren sind MCP-Server, die Goose über die lokale Konfiguration kennt (`npm run connect:connectors`); die Konfiguration ist lokaler Zustand und steht nicht im Repo.

**Quellen:** `CLAUDE.md` (Kopf und Architektur).
