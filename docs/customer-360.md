# Customer 360: Nordlicht als Wissensgraph in 3D

**Botschaft in einem Satz:** Ein Konzern mit sieben Gesellschaften wird nicht aus Tabellen zusammengesucht, sondern aus Dokumenten gelesen: jede Frage der Geschichte geht an die Wissensschicht, und die Antwort leuchtet im Graphen auf.

**Dauer:** 6 bis 8 Minuten. **Space:** `customer-360` (`npm run install:customer-360`, App neu laden). Alle Daten sind erfunden (Nordlicht Gruppe, passt zum Kunden `nordlicht` in Sub4Me).

## Was der Space zeigt
- **Daten:** `examples/customer-360/data.json`: Holding plus fünf Töchter und ein Shared-Service-Center (8.820 Personen), neun Ansprechpartner, sieben Verträge, sieben Chancen, fünf Aufträge, 60 Rechnungen, fünf Tickets, sieben Freitexte (E-Mails, Gespräche, Chat). Vertrieb, Verlängerung, Prognose und Order-to-Cash sind in einem Bild zusammengeführt.
- **Wissen:** Jeder Knoten ist ein kurzes Textdokument mit seiner Kennung in Klammern (`(opportunity:O-7103)`). Gemeinsame Logik in `connectors/_lib/server/customer-360.mjs` (Seite, Cognee-Korpus und Tests nutzen dieselbe Quelle; `npm run sync:mockups` kopiert sie in die Seite).
- **Abruf:** Jeder Schritt der Geschichte stellt eine Frage an die Dokumente. Lokal ist das eine Stichwortsuche (BM25 plus Hinweise auf die Art des Knotens); die Treffer und ihre Nachbarn werden hervorgehoben, mit den passenden Zeilen als Beleg.
- **Darstellung:** 3D-Graph auf Canvas ohne Bibliothek (eigene Perspektive, 3D-Kräftelayout, leuchtende Kugeln, Kurven, Partikel auf hervorgehobenen Kanten, Kamerafahrt). Ziehen dreht, Rad zoomt, Klick wählt, Pfeiltasten gehen durch die Geschichte. Bei reduzierter Bewegung gibt es keine Fahrt und keine Eigendrehung.
- **Geschichte:** Cover, vier Akte, zehn Schritte: (1) Wer ist Nordlicht, wer entscheidet; (2) Verträge und Produkte, Verlängerungen, Chancen; (3) wer zahlt spät, was Menschen schrieben (als **Inference** markiert), geliefert aber nicht fakturiert; (4) die Prioritäten, eine Person entscheidet. Danach "Explore everything" mit allen Knoten.

## Cognee (live)
```
npm run cognee:corpus      # schreibt auch dist/cognee-corpus-customer-360.json
.venv-cognee/bin/python scripts/cognee-seed.py --corpus dist/cognee-corpus-customer-360.json --dataset customer-360
```
Dann im Space "Ask Cognee live" ankreuzen. Die Seite sendet nur `c360:ask-request` (Frage bis 300 Zeichen); die App (`src/customer360-bridge.ts`) lässt den Agenten **nur** das Cognee-Werkzeug `recall` benutzen, verlangt JSON (`answer`, `ids`) und prüft die Form der Kennungen; die Seite verwirft unbekannte. Schlägt das fehl, zeigt die Seite den Grund und bleibt bei der lokalen Suche.

## Regeln, keine Modelle
- **Heat** je Gesellschaft (0 bis 100): Zahlungsbild, Verlängerungstermin, Tickets, Auftragslücken (Gewichte in `data.rules.heat`).
- **Reihenfolge der Vorschläge:** Betrag × Dringlichkeit (nah ≤ 30 Tage 1,5, bald ≤ 60 Tage 1,2, später 1). Sie ordnet nur die Liste, sie sagt nichts voraus.
- **Dealdesk** ab 15 % Rabatt; Limits der Sachbearbeitung stehen in den Daten.

## Ehrlich
- Die Seite schreibt nichts in ein System; "Draft with Joule" schickt nur einen Entwurfs-Auftrag in den Chat.
- Der lokale Abruf ist **nicht** Cognee. Die `about`-Verknüpfungen der Freitexte sind in den Daten von Hand gesetzt; ein Live-System müsste sie selbst finden.
- **Nicht getestet:** Electron-App, echtes Cognee (Lauf in der Cloud-Sandbox nicht möglich), Brücke mit dem echten Agenten (ob er `recall` nutzt und gültiges JSON liefert), Ruckelfreiheit der Animation auf schwacher Hardware, andere Skins als Violet. Im Headless-Browser gesehen: Hell und Dunkel, alle Schritte, Explore, Klick auf Knoten, simulierte Live-Antwort, schmales Fenster ohne seitliches Scrollen, ohne Seitenfehler.
- **Später:** Daten aus der SAP-Sandbox (siehe `examples/sap-sandbox/README.md`) als weitere Dokumente einspielen; die Struktur (Dokument je Knoten, Kennung im Text) ist dafür vorbereitet.
