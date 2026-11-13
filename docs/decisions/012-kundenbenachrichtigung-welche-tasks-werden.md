# 012 Kundenbenachrichtigung: welche Tasks werden gemeldet?

- **Status:** vorgeschlagen
- **Datum:** 12.11.2026 (PR #350)
- **Entscheider:** Kunde (Infrastruktur-Betrieb)

**Frage:** Bei welchen Operationen wird der Kunde immer informiert, solange die Aktionen laufen?

**Entscheidung:** Annahme im Code: ja bei *Patch and restart a VM* und *Move a VM*, nein bei Zertifikatserneuerung und DNS-Änderung, GxP-Kunde bei allen. Die Notizen sagen nur "für bestimmte Operationen".

**Grund:** Mit dem Kunden bestätigen, welche Operationen gemeint sind.

**Folgen:** Die Regel steht als Daten in `policy.notify` und lässt sich ohne Codeänderung anpassen. Der tatsächliche Versand der Mitteilung ist nicht gebaut.

**Quellen:** `docs/infra-ops-story.md` (Akt 6); PR #350.
