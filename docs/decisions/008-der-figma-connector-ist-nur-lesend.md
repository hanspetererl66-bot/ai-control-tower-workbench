# 008 Der Figma-Connector ist nur lesend

- **Status:** entschieden
- **Datum:** laut PR #314
- **Entscheider:** Hans-Peter

**Frage:** Darf der Agent in Figma schreiben?

**Entscheidung:** Nein. Der Connector nutzt nur GET-Aufrufe der Figma-REST-Schnittstelle, kann nichts kommentieren, ändern oder löschen und schickt das Token nur an `api.figma.com`. Der Agent bekommt nur Text, keine Bilder.

**Grund:** Figma dient als Quelle für Anforderungen, nicht als Ziel für Änderungen; kleinste nötige Rechte.

**Folgen:** Das Token braucht nur Leserechte (Dateiinhalt, Kommentare, Projekte). Aussagen über das Aussehen eines Screens sind dem Agenten untersagt.

**Quellen:** `docs/figma.md`; `connectors/figma`.
