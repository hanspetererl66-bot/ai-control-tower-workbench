# Konzept: Startansicht "Today" für den Account Executive

Stand: 12.11.2026. Konzept, noch nichts gebaut. Folgt aus `docs/renewals-review.md` (Punkte 3 und 4). Alle Zahlen stammen aus den erfundenen Beispieldaten (`examples/renewals/renewals.json`, Stichtag 2026-10-19).

## Entscheidung

- **Phase 1 zuerst** (gruppierte Aktionsliste im Reiter "Next best action"). Phase 2 wird erst nach Ansicht von Phase 1 entschieden.

## Ausgangslage

18 offene Renewals haben nur **7 verschiedene erste Aktionen**:

| Erste Aktion | Anzahl | Jahreswert | Besonderheit |
|---|---|---|---|
| Create the renewal offer now and send it to the deal desk | 5 | 114.600 EUR | kleine Add-ons, 3 Owner, gelb |
| Fix the signing date with the customer this week | 4 | 1.620.000 EUR | 2 Owner, rot und gelb |
| Clear the overdue invoice with finance before the renewal talk | 3 | 325.400 EUR | 3 Owner, rot |
| Right-size the offer to real usage instead of losing the renewal | 2 | 206.400 EUR | gelb |
| Keep on track: confirm the renewal date at the next customer meeting | 2 | 229.550 EUR | grün |
| Agree a written extension and the signing date with the customer | 1 | 410.000 EUR | rot, überfällig |
| Offer more volume in the renewal: usage is close to the limit | 1 | 414.000 EUR | grün |

Die drei größten Gruppen decken 12 von 18 Renewals ab. Heute gibt es drei überlappende Listen: "Next 6 weeks" (Overview, 6 Zeilen), "Action queue" (Next best action, 18 Zeilen) und "By decision date" (21 Zeilen mit den abgelaufenen).

## Ziel

Der Account Executive sieht in zehn Sekunden, **was heute zu tun ist, in welcher Reihenfolge und womit er anfängt**. Das ist der Schritt "Today" der Reisezeile ("What needs me now?").

## Phase 1: gruppierte Aktionsliste (Reiter "Next best action")

- Je erste Aktion **eine Karte**: Satz, Anzahl, Summe, betroffene Kunden, frühester Entscheidungstermin, Gesundheits-Balken (rot, gelb, grün).
- Reihenfolge wie heute: rot vor gelb, früherer Termin, höherer Wert.
- **Aufklappen** zeigt die Zeilen der Gruppe. Je Zeile die **zwei stärksten Gründe** (Signale), nicht nur die erste Aktion.
- Je Gruppe ein Knopf **"Ask Joule to prepare all N"** mit einem Prompt für die ganze Gruppe. Der Prompt ist auf 600 Zeichen begrenzt (`wb:ask`), daher nur Kunde und Produkt je Renewal.
- Der Reiter behält Name und Kennung `nba`. Die Kennung steckt in der gemeinsamen Journey (`renewal-actions`) in Sales, Customer 360, E-Mail und Renewals sowie in `test/journey.test.mjs`.
- Der Knopf bereitet nur vor. Senden, Preise und Freigaben bleiben beim Menschen.

## Phase 2: Overview wird "Today" (erst nach Phase 1)

- Oben **drei Zahlen** statt sieben: "Needs me today", "Due in 14 days (EUR)", "Red (EUR)". Haltequote und Kundenlebenswert wandern in die Liste, "Handled automatically" und "Signed in this demo" in die Demo.
- Darunter die gruppierten Karten. Die Liste "Next 6 weeks" entfällt, das Zeitband bleibt als Bild.
- Die Planeten-Landschaft rutscht unter die Karten.
- Optional: Filter "Ich" (Owner-Auswahl). Es gibt keine Anmeldung, nur ein Etikett; Standard bleibt "All".

## Bewusst nicht vorgeschlagen

- Den Reiter "Next best action" löschen: das berührt die gemeinsame Journey in vier Spaces.
- Eine automatische Aktion auf einer Gruppe auslösen.

## Nebenbefund: Zustand beim Wechsel zwischen den Spaces

Weder `examples/renewals/index.html` noch `examples/renewals-analytics/index.html` melden `wb:state`. Wer über "Manager view" ins Dashboard wechselt und zurückkehrt, **verliert die Stufen** ("Prepared (by you)" usw.) und den gewählten Kunden. Der Host kann den Zustand halten (`src/space-handoff.ts`: `wb:state`, `wb:restore`), die Seite muss ihn nur melden. Das ist **nicht getestet**; offen ist, was der Host beim Zurückkehren genau liefert.

## Offene Entscheidungen (Empfehlung in Klammern)

1. **Stabile Kennung je Aktion** in `logic.js` ergänzen (ja). Heute liefert `actions()` nur Sätze; Gruppieren über den Text funktioniert für die 7 Sätze, bricht aber bei dynamischem Text. Berührt `logic.js` und die Tests.
2. **Zustand sichern (`wb:state`):** als eigener kleiner PR vorab (ja) oder in Phase 1.
3. **Filter "Ich"** in Phase 2: ja oder lassen (offen).

## Nicht geprüft

- Nichts ist gebaut oder getestet. Die Zahlen sind aus der JSON-Datei gezählt, nicht auf der Seite geprüft.
- Ob Gruppen für den Account Executive nützlich sind, ist eine Annahme. Es wurden keine Nutzer gefragt.
- Die 5 Angebotsaufgaben gehören 3 verschiedenen Ownern; ob eine Gruppe über Owner hinweg sinnvoll ist, ist offen.
- Bei eingeschaltetem "Automatic renewal" fallen die 5 kleinen Angebote aus der Liste, die Gruppe verschwindet dann.
