# 017 Diagramme im Chat als Mermaid, zuerst ohne Figma

- **Status:** entschieden
- **Datum:** 13.11.2026
- **Entscheider:** Hans-Peter

**Frage:** Wie bekommt die Werkbank Diagramme aus Konversationen (Anlass: Beschreibung der Figma-App für FigJam-Diagramme), und darf sie dafür in Figma schreiben?

**Entscheidung:** Der Chat zeichnet Code-Blöcke mit der Sprache `mermaid` (Flowchart, Gantt, Sequenz, Zustand). Es wird nichts nach Figma geschrieben; Entscheidung 008 (Figma-Connector nur lesend) bleibt unverändert. Ein Weg nach FigJam (Figmas eigener Dienst) ist ein möglicher späterer Schritt und bräuchte einen neuen Eintrag, der 008 teilweise ablöst.

**Grund:** Die öffentliche Figma-REST-Schnittstelle bietet nach unserem Kenntnisstand keinen Aufruf zum Anlegen von FigJam-Dateien (nicht gegen die aktuelle Figma-Doku geprüft). Mermaid braucht keine Figma-Rechte, kein Konto und lässt sich ohne Netz testen; der Text lässt sich später in FigJam einfügen.

**Folgen:** Neue Abhängigkeit `mermaid` (wird erst beim ersten Diagramm geladen). Gezeichnet wird mit `securityLevel: strict`; Diagramme mit einer `init`-Anweisung werden nicht gezeichnet. Bei einem Fehler bleibt der Quelltext sichtbar. Der Agent schreibt einen Mermaid-Block, wenn man ein Diagramm verlangt; ein eigenes Werkzeug oder ein Hinweis im System-Prompt gibt es noch nicht.

**Quellen:** `docs/status/app-and-chat.md` (Diagramme im Chat); `src/mermaid-diagram.ts`; `test/mermaid-diagram.test.mjs`; Entscheidung 008.
