# 011 Downtime-Fenster: "größer als 2 h" oder "ab 2 h"?

- **Status:** vorgeschlagen
- **Datum:** 12.11.2026 (Workshop)
- **Entscheider:** Kunde (Infrastruktur-Betrieb)

**Frage:** Ab wann muss der Kunde ein Downtime-Fenster vorab vereinbaren?

**Entscheidung:** Offen. Die Notizen nennen "größer wie zwei Stunden" und "größer gleich zwei Stunden". Stand im Code: **größer als** (`req.hours > t.hours`, Customer Hotline).

**Grund:** Beim Kunden klären.

**Folgen:** Falls "ab 2 h": kleine Änderung in Code, Texten und Test der Customer Hotline; `infra-rca` und `infra-orchestrator` führen eine Kopie der Regel und müssen mitgezogen werden.

**Quellen:** `examples/infra-hotline/index.html`; `docs/infra-ops-story.md`.
