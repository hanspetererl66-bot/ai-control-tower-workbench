# Konzept Akt B: Die Ontologie ist überall sichtbar

**Stand:** 13.11.2026, **Entwurf zur Abstimmung**, noch nichts gebaut. Gehört zu `docs/ontology-demo-concept.md` (Akt B der Kunden-Demo). Dieses Dokument legt fest, **woher** Spaces und Chat das Vokabular bekommen, **wann** ein Begriff markiert wird, **was** man beim Überfahren sieht, **wie** die Rückfrage bei Mehrdeutigkeit funktioniert und **wie** wir es testen.

## 1. Ziel in einem Satz
Die freigegebenen Begriffe der Ontologie sind dort sichtbar, wo gearbeitet wird: In Spaces und im Chat sind sie dezent markiert, ein Überfahren zeigt Definition, Eigentümer, Status und Mapping, und bei einem Begriff, der in zwei Ontologien etwas Verschiedenes bedeutet, fragt die Werkbank nach, bevor der Agent rät.

## 2. Ausgangslage (aus dem Code)
- **Begriffe sind da:** Katalog mit Bezeichnung, Definition, Eigentümer; je Begriff Lebenszyklus (Entwurf, freigegeben, veraltet mit Ersatz), Synonyme und Mapping (`termMeta` in `governance.json`).
- **Spaces** sind abgeschottete Seiten (`srcDoc`, kein Zugriff von außen). Die Werkbank spielt ein Skript in jede Seite ein (`applySpaceTools`, `src/space-tools.ts`) und spricht mit ihm per `postMessage`; beide Seiten prüfen die Herkunft. Das Skript markiert schon Treffer (`mark.wb-hit`), beobachtet Änderungen der Seite und hat ein Budget für Markierungen. Genau dieses Muster tragen wir.
- **Chat:** Nachrichten laufen durch `ChatMarkdown` (React-Markdown); es gibt schon eine Nachbearbeitung des fertigen DOM (`alignNumericColumns`).
- **Ontologien werden heute nur geladen, wenn die Ontology-Ansicht öffnet** (`view === 'ontology'`). Spaces und Chat haben kein Vokabular.
- **Antworten über Begriffe** gibt der Skill `ontology-term-answer` mit den Connector-Werkzeugen (`search_classes`, `describe`, `impact_of_term`); das ist eine Anfrage an den Agenten, keine Markierung.
- **Akt A** liefert schon die Textsuche mit ganzen Wörtern, Synonymen und Mehrdeutigkeit zwischen Ontologien (`src/ontology-usage.ts`: `norm`, Wortgrenzen, Eigentümer je Phrase). Wir nutzen sie wieder.

## 3. Das Vokabular (der Glossar-Feed)
Eine reine Funktion `buildGlossary(ontologies, gov)` (neu: `src/ontology-glossary.ts`) macht aus dem Katalog eine kleine, begrenzte Liste:

```
GlossaryEntry {
  key         // "<slug>|<term>"
  label, phrases[]   // Bezeichnung und Synonyme (und Mappingnamen), ganze Phrasen
  definition  // höchstens 240 Zeichen
  owner, status      // 'approved' | 'draft' | 'deprecated'
  replacedBy         // nur bei veraltet
  mappings[]         // { system, ref }
  ontology           // Titel der Ontologie
  alsoIn[]           // Schlüssel anderer Begriffe mit derselben Phrase (Mehrdeutigkeit)
}
```
- **Nur freigegebene Begriffe** werden markiert; veraltete nur mit Hinweis auf den Ersatz ("veraltet, jetzt: *Contract liability*"); Entwürfe nie.
- **Grenzen:** höchstens 400 Begriffe, 12 Phrasen je Begriff; Definition gekürzt. Alles im Feed ist Text, kein Skript.
- **Laden:** einmal und träge (beim ersten Space mit eingeschaltetem "Terms" oder beim ersten Chat-Entwurf), zwischengespeichert, nach Änderung im Ontology Manager neu gebaut. Ist der Katalog nicht lesbar, ist die Funktion still aus und sagt "Vocabulary not available" statt zu raten.
- **Nichts verlässt den Rechner**, außer was der Nutzer ohnehin sendet (siehe Chat, Abschnitt 5).

## 4. In Spaces
**Das Skript** (neu: `src/space-terms.ts`, eingespielt wie `applySpaceTools`, vom Host nach dem Muster der Nachrichten `sp:*` gesteuert):
- Host zu Seite: `{ type: 'ot:glossary', entries }`, `{ type: 'ot:enable', on }`. Seite zu Host: `{ type: 'ot:state', count, enabled }`, `{ type: 'ot:open', key }`. Beide Seiten prüfen die Herkunft; der Host nimmt aus `ot:open` nur einen Schlüssel an, der in seinem eigenen Glossar vorkommt, nie eine Adresse oder ein Kommando der Seite.
- **Was markiert wird:** Text in Absätzen, Listen, Zellen und Karten. **Nicht:** `script`, `style`, `input`, `textarea`, `select`, `button`, `code`, `pre`, `svg`, `canvas`, Tabellenköpfe, schon markierte Treffer der Suche (`mark`), Elemente mit `data-wb-noterms`.
- **Wann ein Begriff markiert wird (Regeln im Code, getestet):**
  1. Phrasen aus **zwei oder mehr Wörtern** immer (Contract asset, Days Sales Outstanding).
  2. **Abkürzungen** (alles Großbuchstaben, 2 bis 6 Zeichen, DSO, VAT) nur in genau dieser Schreibweise.
  3. **Einzelne Alltagswörter** (Customer, Offer, Source) **nicht**; sie erzeugten in der Probe von Akt A fast nur falsche Treffer. Wer sie doch will, markiert den Begriff im Katalog (offene Frage 4).
  4. Höchstens **zwei Markierungen je Begriff und Seite** und 200 je Seite; die erste Fundstelle zuerst.
  5. Ganze Wörter, Groß- und Kleinschreibung egal (außer Abkürzungen), Umlaute und ß gefaltet; deutsche Beugungen nur, wo ein Synonym sie nennt.
- **Aussehen:** gepunktete Unterstreichung, kein Hintergrund (stört Tabellen und die Suche nicht). **Keine festen Farben**: Variablen mit Systemfarben als Rückfall (`var(--accent, LinkText)`, `var(--surface, Canvas)`), damit auch agent-geschriebene Spaces ohne unsere Tokens lesbar bleiben, hell wie dunkel.
- **Die Karte** (im Seiteninnern gezeichnet): Bezeichnung, Status-Etikett (*approved*, bei veraltet "replaced by …"), Definition, Eigentümer, Synonyme, Mapping-Etiketten, Ontologie. Bei Mehrdeutigkeit beide Bedeutungen untereinander ("Customer: Sales, Billing"). Knopf **"Open in the catalog"** sendet `ot:open`; der Host öffnet die Ontologie-Ansicht und springt zum Begriff.
- **Bedienung:** Maus (Überfahren) und Tastatur (Fokus mit Tab, Enter oder Leertaste öffnet, Escape schließt); Rolle `button` mit `aria-describedby` auf die Karte; nicht nur Farbe; `prefers-reduced-motion` ohne Einblenden.
- **Schalter:** In der Kopfzeile des Spaces (neben Suche und Zoom) "Terms". **Standard aus**; Opt-in je Space und je Domain, gespeichert in den Einstellungen (`prefs`, gleiche Ablage wie Pinnen und Domain), nicht im Space.
- **Verträglichkeit:** läuft nach dem Such-Skript, überspringt dessen Treffer; Änderungen der Seite werden entprellt neu geprüft (Beobachter wie dort); Textgröße und Theme betreffen die Karte mit.

## 5. Im Chat
**a) Markieren.** Antworten (und die eigenen Nachrichten) bekommen dieselben Markierungen. Umsetzung wie `alignNumericColumns`: Nachbearbeitung des fertigen DOM von `.msg-text`, dieselben Regeln, die Karte im Host-DOM (nicht im Iframe). Nicht in Codeblöcken.
**b) Rückfrage bei Mehrdeutigkeit.** Bevor eine Nachricht gesendet wird, prüft die Werkbank den Entwurf **ohne Modell**: Kommt eine Phrase vor, die zu Begriffen **zweier Ontologien** gehört (`alsoIn` nicht leer), erscheint unter dem Eingabefeld eine kleine Auswahl: *"Customer: Sales (…) oder Billing (…)?"* mit zwei Knöpfen und "Weder noch". Die Wahl wird für die Sitzung gemerkt (nicht erneut gefragt) und als **sichtbares Etikett** an der Nachricht gezeigt ("Customer = Sales ontology"). Eine automatische Wahl gibt es nicht, und Senden bleibt jederzeit möglich ("Ohne Auswahl senden").
**c) Kontext für Joule.** Zur Nachricht kommt, wenn Begriffe darin vorkommen, eine kurze Zeile je Begriff (höchstens 5, je 240 Zeichen): Bezeichnung, Ontologie, Definition, Status und die gewählte Bedeutung. Sie ist als Etikett sichtbar ("Vocabulary: 3 terms") und abschaltbar. **Hinweis:** Dieser Text geht wie die Nachricht selbst an den Modellanbieter; deshalb nur Definitionen freigegebener Begriffe, keine Eigentümer.

## 6. Daten und Ablage
- Neu: nur der Glossar-Feed (berechnet, nicht gespeichert) und der Opt-in je Space oder Domain in den Einstellungen. **`governance.json` und Katalog bleiben unverändert**; die Werkbank schreibt den Katalog weiter nie.
- Schreibende Aktionen gibt es nicht: Markieren und Anzeigen lesen nur.

## 7. Tests (vorher festgelegt)
- **Glossar:** nur freigegebene, veraltete mit Ersatz, Entwürfe fehlen; Grenzen (400 Begriffe, 12 Phrasen, 240 Zeichen); `alsoIn` bei gleicher Phrase in zwei Ontologien; Synonyme und Mapping als Phrasen; ein leerer Katalog ergibt einen leeren Feed.
- **Erkennung (reine Funktion, wie in Akt A):** Mehrwortphrasen, Abkürzungen nur in Großschreibung, Alltagswörter nie, ganze Wörter, höchstens 2 je Begriff und 200 je Seite, Reihenfolge der Fundstellen.
- **Skript im Iframe (jsdom, wie `space-tools`):** markiert in Absätzen und Zellen, nicht in Tabellenköpfen, Eingaben, Code und `mark`; Karte per Tastatur und Escape; `ot:open` sendet nur den Schlüssel; der Host nimmt unbekannte Schlüssel nicht an; ohne `ot:glossary` passiert nichts.
- **Host:** Schalter und Opt-in (Space und Domain) bleiben über Neustart erhalten; ohne lesbaren Katalog "Vocabulary not available".
- **Chat:** die Rückfrage nur bei echter Mehrdeutigkeit; Wahl wird gemerkt; Etikett sichtbar; Senden ohne Wahl geht; Kontextzeilen begrenzt und ohne Eigentümer.
- **Aussehen:** keine festen Farben im eingespielten Stil (Test auf `#` und `rgb(`), hell und dunkel im Headless-Browser, bei 400 Pixel Breite.

## 8. Lieferung in drei Schritten
1. **Logik und Tests:** `ontology-glossary.ts` (Feed, Erkennung, Mehrdeutigkeit, Grenzen). Klein bis mittel.
2. **Spaces:** `space-terms.ts`, Host-Verdrahtung, Schalter und Opt-in, Karte, Sprung in den Katalog. Mittel bis hoch.
3. **Chat:** Markierungen, Rückfrage, Kontextzeile mit Etikett. Mittel.

## 9. Ehrlich benannt (Grenzen)
- **Textabgleich, kein Sprachverstehen.** Mehrdeutigkeit erkennen wir nur, wo derselbe Name in zwei Ontologien steht; deutsche Beugungen nur über Synonyme; falsche Treffer bleiben möglich. Deshalb konservative Regeln, Standard aus und je Begriff höchstens zwei Markierungen.
- **Seiten ohne Text** (Canvas, Knowledge Graph) haben nichts zu markieren.
- **Große Seiten:** Das Budget (200 Markierungen) und das Entprellen schützen die Leistung; gemessen ist sie noch nicht.
- **Spaces von Agenten** ohne unsere Tokens sehen mit Systemfarben schlichter aus.
- **Datenschutz:** Die Kontextzeile im Chat geht an den Modellanbieter (siehe 5c). In Spaces bleibt alles lokal.
- **Nicht getestet** (weil nicht gebaut): alles in diesem Dokument. Messbar wird die Trefferqualität erst an echten Spaces; Ziel ist ein Probelauf auf den installierten Spaces mit gezählten Markierungen und Stichproben falscher Treffer.

## 10. Offene Fragen
1. **Standard:** aus mit Opt-in (mein Vorschlag) oder für ausgewählte Domains an?
2. **Wie oft markieren:** zwei je Begriff und Seite (Vorschlag) oder alle?
3. **Veraltete Begriffe:** mit Ersatzhinweis zeigen (Vorschlag) oder weglassen?
4. **Einzelne Alltagswörter:** nie (Vorschlag) oder pro Begriff im Katalog zuschaltbar?
5. **Rückfrage im Chat:** immer bei Mehrdeutigkeit (Vorschlag) oder nur auf Wunsch?
6. **Kontextzeile:** darf eine Definition an den Modellanbieter gehen, oder bleibt der Chat ohne Vokabular?
7. **Sprache:** Begriffe auf Deutsch und Englisch: genügen Synonyme?
