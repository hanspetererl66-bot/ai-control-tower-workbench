# Konzept: Ontology Manager als Kunden-Demo (drei Wow-Momente)

**Stand:** 12.11.2026, **Entwurf zur Abstimmung**, noch nichts gebaut. Zielgruppe: Kunden in einer Demo (Entscheider und Fachbereich, keine Datenmodellierer). Ausgangsfrage: Was beeindruckt einen Kunden am Ontology Manager, ohne dass wir einen Editor nachbauen?

## 1. Botschaft in einem Satz
Unsere Ontologie ist keine Ablage für Begriffe, sondern der gemeinsame Wortschatz, nach dem Menschen, Agenten und Spaces arbeiten: Wir sehen, wo er steht, was eine Änderung kostet und woher jeder Begriff kommt.

## 2. Ausgangslage (ehrlich, aus `docs/status/ontology.md` und dem Code)
- **Da:** Katalog mit Lebenszyklus, Synonymen und Mapping; Vorschläge aus Dokumenten mit Quellzitaten und Prüfbericht (nie ohne Bestätigung); Auswirkung (`impact_of_term`); Karte; Kompetenzfragen; Qualität; Verlauf; Export; Eigentümer und Freigeber in `governance.json`. Im Beispielmodus 7 Ontologien, 64+ Begriffe, 120 Knoten.
- **Grundlücke:** Die Nutzer eines Begriffs (Agent, Skill, Bericht) sind **von Hand erklärt** (`OntologyUse.tsx`: "the app cannot look inside an agent"). Die Auswirkung zählt nur, was jemand eingetragen hat.
- **Nicht gebaut:** Versionsvergleich (bewusst abgewählt), SHACL-artige Prüfung von Daten, Anbindung an die Registry oder an die Spaces.
- **Hilfreich vorhanden:** Registry (`src/registry.ts`, Karten mit Typ agent, workflow, feature, code), Space-Skripte, die die Werkbank in jeden Space einspielt (`applySpaceTools` in `SpaceViewer.tsx`), das Dokument-zu-Ontologie-Werkzeug des Connectors, der SAP-Wissens-Feeder (`docs/knowledge-feeder.md`).

## 3. Die drei Wow-Momente

### Akt A: "Was geht kaputt, wenn ich das freigebe?" (Auswirkung vor Freigabe)
**Geschichte:** Die Finanzleitung will den Begriff *Deferred revenue* durch *Contract liability* (IFRS 15) ersetzen. Bevor jemand freigibt, färbt sich die Karte rot: diese Spaces, Agenten, Skills und Berichte hängen daran.
**Bildschirm (Reiter Proposals, Änderung gewählt):**
1. Karte mit dem Begriff in der Mitte, betroffene Knoten rot, darunter die Liste *Betroffen* nach Art (Space, Agent, Skill, Bericht) mit Eigentümer und "Ask first" (wer vorher zu fragen ist).
2. Ein Freigabe-Block: Zusammenfassung ("5 Nutzer, 2 Eigentümer zu fragen, 1 Kompetenzfrage fällt weg"), Schalter *Freigeben* nur für den eingetragenen Freigeber, Protokolleintrag mit der Auswirkungsliste.
3. Danach: veraltet markiert, Ersatz gesetzt, die betroffenen Eigentümer bekommen den Hinweis (Entwurf, nicht gesendet).
**Was daran echt wird (Kern der Arbeit):** Die Nutzer kommen nicht mehr von Hand, sondern aus
- der **Registry** (Agenten, Workflows) und den **Skills**: eine Zeile je Karte "benutzt Begriffe" (Feld, aus dem Text der Karte und des Skills gelesen und vom Eigentümer bestätigt),
- den **Spaces** im Workspace: Begriff kommt im Text oder in den Daten vor (Vorschläge, nicht Fakten, mit Fundstelle),
- den **Kompetenzfragen**, die den Begriff brauchen (gibt es schon).
**Regeln (im Code, getestet):** Die Auswirkung hat zwei Stufen, *bestätigt* (Eigentümer hat zugestimmt) und *vermutet* (gefunden, nicht bestätigt), und die Seite zeigt beides getrennt. Freigabe nur durch den Freigeber, nie durch Agenten. Die App schreibt weiter nie den Katalog selbst.
**Wow:** Der Kunde sieht zum ersten Mal vor einer Änderung, was sie berührt, mit Namen und Verantwortlichen statt einer Zahl.
**Grenzen:** "Vermutet" ist heuristisch (Textsuche mit Synonymen, kann falsch sein). Agenten, die Begriffe nur zur Laufzeit holen, sehen wir nicht. Aufwand: **mittel** (Registry-Anbindung, Fundstellen-Suche, Freigabe-Block, Tests).

### Akt B: Die Ontologie ist überall sichtbar (Begriffe im Space und im Chat)
**Geschichte:** Im Space *Revenue Recognition* sind Fachbegriffe dezent unterstrichen. Fährt man darüber, erscheint eine Karte: Definition, Eigentümer, Status, Synonyme, Mapping (z. B. IFRS 15) und der Link in den Katalog. Im Chat fragt Joule bei einem mehrdeutigen Begriff nach ("Kunde: Debitor oder Interessent?") und merkt sich die Antwort für die Sitzung.
**Umsetzung:**
- **Spaces:** wie das Such- und Filterskript (`applySpaceTools`) spielt die Werkbank ein kleines Skript ein. Es bekommt die **freigegebenen** Begriffe samt Synonymen per Nachricht, markiert Treffer im Text (nicht in Eingabefeldern, Code, Tabellenköpfen) und zeigt die Karte beim Überfahren oder mit der Tastatur. Standardmäßig aus, per Opt-in je Space oder Domain, ein Schalter in der Kopfzeile ("Terms").
- **Chat:** Antworten von Joule tragen dieselben Markierungen (`ChatMarkdown`); die Rückfrage bei Mehrdeutigkeit kommt aus den Synonymen und den Begriffen mit gleichem Namen in zwei Ontologien (die Karte zeigt beide).
**Regeln:** Nur freigegebene Begriffe, veraltete gestrichelt mit Ersatz. Keine Inhalte verlassen den Rechner. Zugänglich: Unterstreichung nicht nur als Farbe, Karte per Tastatur, `prefers-reduced-motion` respektiert. Farben nur als Tokens.
**Wow:** Der Kunde erlebt die Ontologie an *seinen* Seiten und nicht in einem Fachwerkzeug: das System "versteht" die eigene Sprache.
**Grenzen:** Erkennung ist Textabgleich, keine Sprachverarbeitung (Mehrdeutigkeit wird nur bei bekannten Konflikten erkannt, Beugungen im Deutschen teils nicht). Bei Spaces mit Canvas-Zeichnung gibt es nichts zu markieren. Eine Karte pro Treffer kann bei vielen Treffern stören, daher Grenze je Seite. Aufwand: **mittel bis hoch** (Skript, Nachrichten, Karte, Chat, Opt-in, Tests, drei Beispiel-Spaces prüfen).

### Akt C: Begriffe aus echten Quellen, mit Beleg (Vorschläge und Mapping auf SAP)
**Geschichte:** Der Kunde nennt ein Thema ("Vertragsabgrenzung in S/4HANA"). Die Werkbank liest die freigegebenen Quellen und schlägt Begriffe vor, jeder mit Quellzitat, Prüfbericht (*wiederverwenden, erweitern oder neu*) und einem **Mapping auf S/4** (Objekt oder Tabelle), ebenfalls mit Beleg. Der Kunde sieht: nichts ist erfunden, alles hat eine Fundstelle.
**Quellen (in dieser Reihenfolge):**
1. **SAP-Dokumentation aus dem Feeder** (`sap-docs-github`, CC-BY-4.0): geschützt durch das Lizenz-Gate, Attribution wird mit ausgegeben. Der Feeder ist gebaut, aber **noch nicht mit `--seed` gelaufen**.
2. Eigene Quellen über vorhandene Connectoren: Wiki, Jira, Meeting-Notizen (Dokument-zu-Ontologie-Werkzeug des Connectors, heute für Dokumente).
**Bildschirm (Reiter Proposals):** Vorschlagsliste je Quelle, Begriffskarte mit Zitat und Link zur Quelle, Mapping-Spalte, Prüfbericht, *Übernehmen* nur nach Häkchen.
**Regeln:** Quellen mit `metadata_only` oder `needs_review` werden nie in Volltext ausgeweitet; Zitate nur aus erlaubten Quellen; jeder Begriff trägt Lizenz und Quelle; die Übernahme bleibt Sache einer Person.
**Wow:** "Das hat sich die KI nicht ausgedacht": jeder Vorschlag lässt sich zur Zeile in der Dokumentation zurückverfolgen.
**Grenzen:** Qualität hängt am Modell und an den Quellen; der Seed kostet Geld (cognify). Die S/4-Mappings sind Vorschläge, keine geprüften Zuordnungen. Rechtlich offen (siehe `docs/knowledge-feeder.md`): Nutzung kommerziell, Weitergabe an Modellanbieter. Aufwand: **mittel** (Ausrichtung des Werkzeugs auf Feeder-Quellen, Mapping-Spalte, Beleg-Anzeige, Tests), **plus** der echte Seed-Lauf.

## 4. Dramaturgie der Demo (10 Minuten)
| Min | Akt | Satz |
|---|---|---|
| 0 bis 1 | Einstieg | "Heute zeigen wir, wie aus Quellen ein Wortschatz wird, der überall gilt." |
| 1 bis 4 | **C** Quelle zu Vorschlag | "Jeder Begriff hat seine Fundstelle. Nichts ist erfunden." |
| 4 bis 7 | **B** Begriffe im Space und im Chat | "Der Wortschatz steht dort, wo Sie arbeiten." |
| 7 bis 10 | **A** Auswirkung vor Freigabe | "Bevor Sie ändern, sehen Sie, was es berührt. Nur der Freigeber entscheidet." |

**Reihenfolge der Umsetzung:** A zuerst (nutzt am meisten Vorhandenes und schließt die Grundlücke), dann B (größte sichtbare Wirkung), zuletzt C (hängt am Seed-Lauf und an Lizenzfragen).

## 5. Demo-Daten (erfundener Fall)
Der Begriff *Deferred revenue* wird durch *Contract liability* ersetzt. Betroffen sind die Spaces Revenue Recognition und Order-to-Cash Software, ein Pre-Close-Agent, ein Skill und ein Bericht. Die Namen werden gegen die Beispieldaten und die Registry geprüft; erfundene Zahlen bleiben beschriftet.

## 6. Ehrlich benannt
- Alles in diesem Konzept ist **ungebaut**. Akt A und B sind zunächst Mockups auf Beispieldaten, bis Registry und Space-Skript angebunden sind.
- "Vermutete" Nutzer sind Textabgleich und können falsch sein; die Seite muss das sagen.
- Kein Versionsvergleich und keine Prüfung von Instanzdaten (SHACL): bewusst nicht Teil dieser Demo.
- Der Beleg in Akt C setzt voraus, dass der Feeder wirklich läuft; ohne Seed zeigt die Demo nur vorbereitete Beispiele (beschriftet).

## 7. Offene Fragen an Gruppe und Kunde
1. Welche Ontologien und Standards zählen für den Kunden (IFRS 15, SAP-Begriffe, eigene Glossare)? In welcher Sprache?
2. Wer gibt Begriffe frei, und darf eine Änderung ohne Rückfrage bei den Eigentümern erfolgen?
3. Dürfen Inhalte des Kunden an einen Modellanbieter (Vorschläge in Akt C) oder bleibt alles lokal?
4. Soll Akt B für alle Spaces gelten oder per Opt-in je Domain?
5. Welche echten Quellen des Kunden stehen für Akt C zur Verfügung (Wiki, Jira, SAP-Dokumentation)?
