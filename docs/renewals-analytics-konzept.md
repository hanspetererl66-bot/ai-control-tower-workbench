# Konzept: Renewal Analytics für den Vertriebsleiter

Stand: 11.11.2026. Konzept, noch nichts gebaut. Ergänzt `docs/renewals-konzept.md`. Alle Zahlen stammen aus erfundenen Beispieldaten (`examples/renewals/renewals.json`, Stichtag 2026-10-19).

## Entscheidungen

- **Eigener Space** `examples/renewals-analytics`, kein Reiter im Renewals-Space.
- **Namen standardmäßig aus.** Die Teamansicht zeigt „Owner 1 bis 4“; ein Schalter blendet die Namen ein. Grund: Die Ansicht berührt die Leistungsbewertung einzelner Personen.

## Was die Daten hergeben (21 Verträge, 3.677.150 EUR im Jahr)

| Dimension | Stand | Folge |
|---|---|---|
| Entscheidungsquartal | 13 von 21 in Q4 2026, sonst je 1 bis 2 pro Quartal | Nach Monat der nächsten sechs Monate darstellen, nicht nach Quartal |
| Angebote | 5 mit Angebot (alle „Proposal sent“, alle vom Deal desk freigegeben), 16 ohne | Ein Funnel hätte nur eine Stufe. Aussagekräftig ist „ohne Angebot“ mit Verzug |
| Wettbewerber | 2 genannt (Shopify Plus, Coupa) | Liste statt Diagramm |
| Renewal-Owner | 4 (10, 4, 4, 3 Verträge); CSMs 3 | Auslastung je Person möglich |
| Abgeleitet auf der Seite | Gesundheit, Retention, CLV, Phase, im Verzug, Preis gegen Cap | Kommt aus der geteilten Logik |

## Aufbau

**Kopfzeile, sechs Zahlen:** Wert im Jahr offen, erwartet gehalten (Retention-gewichtet), gefährdet (rot und lapsed), Anzahl im Verzug, Verträge ohne Angebot, Auslastung der größten Person.

1. **Wert nach Entscheidungsmonat:** gestapelte Balken nach Gesundheit, Linie für heute.
2. **Gefährdet gegen erwartet:** je Kunde und Produkt Jahreswert, Retentionsanteil, erwarteter Verlust; daneben die fünf größten Risiken mit dem Signal, das sie rot macht.
3. **Prozess-Durchsatz:** die sieben Phasen mit Anzahl, Wert und „im Verzug“; darunter die Verträge ohne Angebot nach Tagen Verzug.
4. **Team:** je Renewal-Owner Anzahl, Wert, rot, im Verzug. Namen aus (Standard), Schalter blendet sie ein.
5. **Fußzeile:** Preis gegen Cap, Wettbewerber, Teil- gegen Gesamt-Churn je Kunde mit mehreren Produkten.

Hinweis in der Kopfzeile: Retention und CLV sind Annahmen aus `rules.retention`, keine Prognose.

## Technik

- `scripts/sync-renewals.mjs` schreibt Daten und Logikblock (`renewal-logic`) in beide Spaces. Dafür muss die Logik aus `examples/renewals/index.html` in eine gemeinsame Quelldatei. Das berührt die Tests, die den Block ausführen.
- Das Dashboard liest nur. Kein Demo-Zustand, keine Stufen, kein Auto-Schalter (die Stufen „Signed“ im Renewals-Space liegen nur im Seitenspeicher).
- Farben nur als Tokens, kein Netzwerk, kein localStorage. Diagramme als SVG, Zahlen direkt beschriftet.

## Offen

1. **Mehr Beispieldaten:** Mit 5 Angeboten und 2 Wettbewerbern wirkt das Dashboard dünn. Vorschlag: einige Angebote in weiteren Stufen ergänzen. Das ist eine eigene Datenänderung, bei der die Zahlen tabellenübergreifend stimmen müssen.
2. **Gemeinsame Logik:** auslagern (empfohlen) oder zunächst kopieren. Auslagern nach dem Merge von PR #321, weil beide Änderungen dieselbe Datei betreffen.

## Nicht geprüft

Nichts davon ist gebaut oder getestet. Die Zahlen oben sind aus der JSON-Datei gezählt, nicht auf der Seite geprüft.
