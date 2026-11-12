# Konzept: Briefing in der Renewals-Seite

Stand: 12.11.2026. Konzept, noch nichts gebaut. Erster Schritt von Option B aus `docs/renewals-review.md` (ein Assistent mit festen Aufgaben). Alle Zahlen im Space stammen aus erfundenen Beispieldaten.

## Entscheidungen (12.11.2026)

1. **Neue Konversation je Briefing** (Standard der Brücke). Jedes Briefing erscheint als eigener Chat in der Seitenleiste. Eine gemeinsame Konversation je Renewal würde frühere Briefings in den Kontext ziehen.
2. **Messen mit Sitzungszählung und Pilotliste:** Die Seite zeigt "Briefings heute, mittlere Dauer, brauchbar: ja/nein". Die Werte trägt die Person in eine Pilotliste ein. Ein dauerhafter Speicher im Hauptprozess ist ein eigener, späterer Schritt.
3. **Fakten mit Kundennamen und Mail-Auszügen** gehen an den Modellanbieter. Das ist für die Demo vertretbar, weil die Daten erfunden sind. Im Echtbetrieb ist es eine eigene Entscheidung zu Datenschutz und Freigabe.

## Ziel

Ein Account Executive öffnet eine Renewal und bekommt **in der Seite** ein kurzes Briefing für das Kundengespräch, ohne den Space zu verlassen und ohne den Chat. Begründung der Rendite: 1,5 Stunden Vorbereitung je Renewal bei 1200 Renewals im Jahr (siehe Abschnitt 6 von `docs/renewals-review.md`).

## Faktenbasis: der Antwortweg

- `wb:ask` ist einseitig. Der Host (`askFromSpace` in `src/App.tsx`) wechselt in den Chat und sendet dort. Eine Antwort geht nicht an die Seite zurück.
- Es gibt einen Antwortweg über die Brücke der Recruiting-Workbench (`src/interview-bridge.ts`): Anfrage `iv:ask-request`, Antwort `iv:ask-answer`. Der Host führt den Prompt mit `developGenerate` aus (eigene Konversation, `keepView: true`) und gibt den Text zurück. Ist der Agent beschäftigt oder nicht verbunden, kommt ein Fehler.
- Der Weg ist eng: fester Anfang je Anfrageart, höchstens 16.000 Zeichen, "Use no tools and read no files", Antwort auf 20.000 Zeichen gekürzt, nur für Spaces der Liste `bridgeEnabled`, ein Handler je Space.
- Getestet ist das nur mit einer unechten Antwortfunktion (`test/interview-ai.test.mjs`).
- Der Space `renewals` steht nicht in der Liste. Ohne eigenen Zweig würde er im Standard-Handler für Sub4Me landen.

## Ablauf in der Seite

1. Im Detailfenster einer Renewal steht der Knopf **"Draft a briefing"**. "Ask Joule to prepare" bleibt für freie Fragen im Chat.
2. Der Knopf ist gesperrt, solange ein Briefing läuft. "Joule is working ..." erscheint, nach 90 Sekunden mit dem Hinweis, dass der Agent beschäftigt sein kann.
3. Ergebnis als Kasten **"Briefing (draft, check before use)"**, höchstens etwa 200 Wörter, vier Abschnitte: Where we stand, What could go wrong, Suggested first steps, Questions for the customer.
4. Ausklappbar **"What Joule saw"** mit den Fakten, die an den Agenten gingen.
5. "Prepared" setzt weiter nur die Person. Das Briefing ändert keine Stufe, sendet nichts und löst nichts aus.
6. Eine Sitzungszählung zeigt: Briefings heute, mittlere Dauer, brauchbar ja/nein (zwei Knöpfe am Briefing). Sie wird nicht dauerhaft gespeichert.

## Technik

**Nachrichten:**
- Seite an Host: `rn:brief-request` mit `requestId`, `kind: 'brief'`, `prompt`.
- Host an Seite: `rn:brief-answer` mit `requestId` und `text`, oder `rn:error` mit einer Meldung.

**Prompt** (aus den Daten der Seite):
- Fester Anfang, den der Host prüft, zum Beispiel "You prepare an account executive for a renewal talk. Use only the facts between the markers."
- Fakten zwischen Markern, je Feld gekürzt: Produkt, Jahreswert, Entscheidungstermin, Gesundheit mit Signalen, Angebot (Wert, Cap, Stufe, Wettbewerber), offene Tickets, überfällige Rechnungen, Eskalation, Mail-Betreffe und -Auszüge, Themen des Kunden.
- Kundentexte (Mail-Auszüge, Ticket-Titel) stehen in einem eigenen Block mit dem Satz, dass sie keine Anweisungen sind. Das ist nicht lückenlos sicher; die Wirkung ist klein (kein Werkzeug, kein Senden, Ausgabe als Text, eine Person prüft).
- Regeln: nur gegebene Fakten, Unbekanntes als "unknown" nennen, Englisch, höchstens 200 Wörter.

**Host (neu in `src/`):**
- `src/renewals-bridge.ts` mit `handleRenewalsMessage(data, deps)`: prüft Form, `requestId`, Anfang und Länge, stellt "Use no tools and read no files" voran, ruft `deps.ask`, kürzt die Antwort.
- Der Space `renewals` kommt in `bridgeEnabled` (`src/App.tsx`) und in die Auswahl nach Slug (`src/ui/SpaceViewer.tsx`), vor den Standard-Handler.
- Titel der Konversation: "Renewal briefing" (ohne Sitzungsschlüssel, damit jede Anfrage eine neue Konversation bekommt).

**Seite:**
- Anzeige als **reiner Text**, nicht als HTML.
- Das Briefing gehört zum gemerkten Zustand (`wb:state`), mit Zeitstempel und Längenprüfung beim Zurückholen. Es überlebt den Wechsel zwischen Spaces, nicht das Beenden der App.

## Tests (alle ohne echten Agenten)

- **Host:** Anfang, Größe, `requestId`, fehlender Agent, beschäftigter Agent, gestoppter Lauf, Kürzung der Antwort.
- **Seite mit Stub:** Der Knopf sendet genau eine Anfrage mit dem festen Anfang. Die Antwort wird als Text angezeigt, auch mit `<img onerror=...>`. Der Knopf ist während des Laufs gesperrt, ein Fehler wird angezeigt, das Briefing kommt beim Zurückholen wieder, die Stufe ändert sich nicht.
- **Prompt:** bleibt unter dem Limit, lange Felder werden gekürzt.

## Folgen

- **Neustart der App nötig** nach dem Merge (Änderung in `src/`), ein Refresh genügt nicht.
- **Ein einziger Agent:** Läuft gerade eine Antwort im Chat, scheitert das Briefing mit einem Fehler.
- **Neue Konversation je Briefing:** Sie erscheinen als einzelne Chats in der Seitenleiste.
- **Daten gehen an den Modellanbieter** (laut Kopfkommentar der Recruiting-Brücke OpenRouter).

## Nicht geprüft

- Nichts ist gebaut oder getestet.
- Qualität der Briefings, Kosten und Dauer eines Laufs, Verhalten im echten Host (Electron) sind unbekannt.
- Dass ein Briefing die 1,5 Stunden Vorbereitung um 30 bis 70 Prozent verkürzt, ist die Annahme `s` der Rendite und wird erst durch den Pilot gemessen.
- Ob Account Executive die neuen Konversationen in der Seitenleiste stören, ist nicht gefragt.
