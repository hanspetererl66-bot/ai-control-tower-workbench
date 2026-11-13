# 004 Spaces sind Einzeldateien: kein Netzwerk, kein localStorage, Farben nur als Tokens

- **Status:** entschieden
- **Datum:** nicht belegt (steht seit dem Projektstand in CLAUDE.md)
- **Entscheider:** Hans-Peter

**Frage:** Was dürfen Spaces tun?

**Entscheidung:** Ein Space ist eine einzelne Seite (`index.html` mit eingebetteten Daten) ohne Netzwerkzugriff und ohne `localStorage`; Farben stehen nur als Tokens (`var(--surface)` …). Alles Weitere läuft über Nachrichten an die Werkbank.

**Grund:** Spaces laufen in einer abgeschotteten Fläche und werden zum Teil vom Agenten geschrieben; so bleiben sie überall gleich darstellbar (hell, dunkel) und prüfbar.

**Folgen:** Tests prüfen Einbettung, Farben und fehlende Netzwerkaufrufe; Daten ändern sich in `data.json` und werden mit `npm run sync:mockups` eingebettet.

**Quellen:** `CLAUDE.md` (Regeln für Änderungen); `test/example-spaces.test.mjs`.
