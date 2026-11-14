# Konzept: Sales Knowledge Graph mit mehr Daten und leichten Animationen

Stand 14.11.2026. Nur ein Konzept, nichts davon ist gebaut. Die Zahlen stammen aus dem Code und den Beispieldaten (`loadGraph()`, `renewals.json`), nicht aus einem Blick in die App.

## Ausgangslage

- **Umfang:** 265 Knoten und 630 Kanten. Der Graph wird aus Sub4Me, Skill Marketplace, Control Tower, n8n, den Call- und Mail-Mockups und kuratierten Links (`examples/knowledge-graph/links.json`) abgeleitet (`buildGraph` in `connectors/_lib/server/graph.mjs`) und von `npm run sync:knowledge-graph` in `examples/knowledge-graph/index.html` eingebettet. Dieselben Daten beantworten die Chat-Werkzeuge `get_graph_overview`, `search_graph` und die anderen.
- **Verkaufsteil ist klein:** 5 Kunden, 10 Verträge, 9 Angebote, 9 Deals, 5 Tickets, 5 Calls, 8 Mail-Verläufe. Die großen Gruppen sind Tools (50), Skills (38), Personen (47) und Agenten (23).
- **Renewals fehlen als Quelle.** Der Graph kennt 10 Verträge (Muster 6, Hanse 2, Lindenau 2), die Renewals führen 21 Fälle (Muster 8, Hanse 7, Lindenau 6). Es fehlen mindestens die neun ausgedachten Zusatzverträge und der abgelaufene Ariba-Vertrag von Lindenau. Rechnungen, Eskalationen, Gesundheit und Entscheidungstermine kommen im Graph gar nicht vor.
- **Bewegung heute:** Ein Kräfte-Layout auf dem Canvas (`frame`, `tick`, `draw`), das im Leerlauf leicht weiterläuft, ein 3D-Modus (`draw3d`) und eine Minikarte. `prefers-reduced-motion` wird für das Layout schon beachtet (`reduced`). Sonst gibt es keine Animation. **Korrektur (14.11.2026, beim Bauen von PR 2):** Das stimmt nicht. Die Seite hat schon ein Einblenden (1,7 Sekunden, Knoten wachsen, Kanten blenden nach), kleine Kometen entlang der Kanten der Auswahl (`inF`), eine Welle um den Ausgangsknoten im Auswirkungsmodus, einen pulsierenden Ring um den gewählten Knoten, weiches Ein- und Ausblenden bei Hover und Auswahl und eine zeitbasierte Kamerafahrt (`flyTo`, alles mit `reduced` abgesichert). Das hatte ich beim Lesen übersehen.
- **Tests, die Zahlen festhalten:** Calls (5), Mail-Verläufe (8) und Deals müssen gleich bleiben (`test/knowledge-graph.test.mjs`). Gesamtzahlen sind nur als Untergrenze geprüft (über 120 Knoten, über 200 Kanten).

## Vorschlag: mehr Daten (Stufe 1)

Neue Quelle `renewals` in `buildGraph`, gelesen aus `examples/renewals/renewals.json`. Das ist die Quelle der Renewals-Seite, also bleiben die Zahlen tabellenübergreifend gleich.

| Baustein | Inhalt | Ungefähr |
|---|---|---|
| **Fehlende Verträge** | die neun Zusatzverträge und die abgelaufenen als Knoten `contract`, Kante `HAS_CONTRACT` vom Kunden, Kennzeichen `addon` oder `lapsed` | +10 Knoten |
| **Renewal-Angaben am Vertrag** | Entscheidungstermin, Tage bis dahin, Status, Gesundheit (rot, gelb, grün) und Angebotsstufe als Eigenschaften der Vertragsknoten (ohne neuen Typ) | 0 neue Knoten |
| **Rechnungen** | offene und überfällige Rechnungen als neuer Typ `invoice`, Kante `INVOICE_FOR` zum Vertrag (Betrag, Fälligkeit, Status) | +14 Knoten, +14 Kanten |
| **Tickets** | offene Tickets der drei Kunden, soweit noch nicht im Graph (Abgleich nach Id), Kante `ABOUT` zum Vertrag | wenige |
| **Eskalationen** | als Eigenschaft am Kundenknoten (Stufe, seit, Thema, Verantwortlicher), sichtbar als Markierung; kein neuer Typ | 0 neue Knoten |

Zusammen etwa +25 bis +30 Knoten und +50 Kanten, also gut 10 % mehr. **Gemessen beim Bauen (PR 1):** +29 Knoten (12 Verträge, 14 Rechnungen, 3 Tickets) und +34 Kanten (265 auf 294 Knoten, 630 auf 664 Kanten). Die Gesundheit berechnet das Skript mit der geteilten Logik der Renewals-Seite (`examples/renewals/logic.js`), sodass der Graph nie eine andere Farbe zeigt als die Seite. Ob das Skript sie ohne Umbau aufrufen kann, prüfe ich beim Bauen.

**Auswirkungen:** Die Legende und die Farben der Typen bekommen den Eintrag `invoice`. Die Chat-Werkzeuge kennen neue Typen aus `NODE_TYPES`; die Typlisten in ihren Beschreibungen werden mitgezogen.

**Später (Stufe 2, nicht in diesem Konzept):** Aufträge aus Order-to-Cash (Übergabe der Renewals) und Zahlungsverhalten aus Collections. Die neuen Lindenau-Daten aus `docs/renewals-lindenau-daten-konzept.md` kommen automatisch mit, sobald sie in `renewals.json` stehen und das Skript neu läuft. **Der Graph kann also zuerst gebaut werden.**

## Vorschlag: leichte Animationen

**Stand beim Bauen:** Die Punkte 1, 2, 4 und 5 unten gibt es in der Seite schon (siehe die Korrektur oben). Neu in PR 2 ist nur Punkt 3, der Gesundheitsring und das leise Atmen für Rot und Eskalation, dazu die Legende.

Alles im vorhandenen Zeichenschritt (`draw`, später `draw3d`), keine neue Bibliothek.

1. **Einblenden:** Beim ersten Laden und bei einem Wechsel des Kunden blenden die Knoten gestaffelt ein (Kunden zuerst, dann Verträge, dann der Rest), etwa 0,7 Sekunden.
2. **Fluss auf der Auswahl:** Für den gewählten Knoten, den Auswirkungsmodus und den Pfad wandern kleine helle Punkte langsam entlang der betroffenen Kanten (Schleife 3 bis 5 Sekunden). Nur für diese Kanten, nie für alle 630.
3. **Risiko atmet:** Verträge mit roter Gesundheit und Kunden mit Eskalation bekommen einen Ring, der langsam pulsiert (etwa 2,4 Sekunden, kleine Amplitude). Höchstens etwa 15 Knoten gleichzeitig.
4. **Hover:** Ein weicher Schein um den Knoten unter der Maus, die Nachbarn werden etwas heller, mit kurzem Übergang (150 ms).
5. **Kamera:** Sprünge zu einem Knoten (Suche, Liste, Pfad) laufen als sanfte Bewegung statt als Sprung.

**Regeln:**
- `prefers-reduced-motion`: Es gibt dann keine dieser Bewegungen. Der Ring bleibt als stehende Markierung.
- Farben kommen wie im Rest der Seite aus Theme-Werten, nicht als feste Hex-Werte. Wie genau der Canvas sie liest, prüfe ich beim Bauen.
- Bildrate: Die Animationen laufen nur für die kleine Auswahl. Wenn der Tab verdeckt ist oder `S.paused` gilt, ruht alles.
- Zuerst nur die 2D-Ansicht. Der 3D-Modus folgt, wenn es dort gefällt.

## Technik und Reihenfolge der PRs

1. **PR 1: Daten.** `buildGraph` mit Quelle `renewals`, `NODE_TYPES` und `EDGE_TYPES` (`invoice`, `INVOICE_FOR`), Lauf von `npm run sync:knowledge-graph`, Legende, Tests.
   - Neue Tests: eindeutige Ids, jede Kante löst auf, jeder Vertrag der Renewals ist ein Knoten, die Farbe stimmt mit der Renewals-Logik überein.
   - Bestehende Zahlen (Calls, Mail-Verläufe, Deals) bleiben.
2. **PR 2: Animation** (nur die Seite). Ein Test prüft, dass bei `reduced` nichts animiert wird. Ansichten in hell und dunkel mit Screenshots.
3. **PR 3 (optional):** Feinschliff und 3D.

Nach jedem PR: `npm run install:examples`, Space neu laden.

## Entscheidungen, die ich von dir brauche

1. **Daten:** Stufe 1 wie oben (Verträge, Rechnungen, Tickets, Eskalationen und Gesundheit)? Oder weniger, zum Beispiel ohne Rechnungen?
2. **Stärke der Animation:** "dezent" (Einblenden, Fluss auf der Auswahl, Risiko atmet, Hover, Kamera) wie vorgeschlagen, oder "lebendiger" mit einem ständigen leisen Schimmern der ganzen Karte? Ich empfehle dezent.
3. **3D:** erst nur 2D (Empfehlung) oder gleich beides?

## Nicht geprüft

- Nichts davon ist gebaut oder in der App gesehen.
- Die Zahl "ungefähr +25 bis +30 Knoten" ist geschätzt, nicht gerechnet. Der Abgleich der Tickets nach Id ist nicht gelaufen.
- Wie die Animationen auf dem Rechner wirken (Bildrate bei 290 bis 300 Knoten, Canvas im Electron-Fenster) ist offen und wird beim Bauen gemessen.
- Ob die Legende und die Chat-Werkzeuge mit den neuen Typen ohne weitere Anpassung zurechtkommen, ist nur aus dem Code vermutet.
