# Konzept: Journey-Stops für Act und Follow up

Stand 13.11.2026. Nur ein Konzept, nichts davon ist gebaut. Grundlage ist der Code (`shared/journey.mjs`, die Seiten der Spaces), nicht ein Lauf in der App.

## Ausgangslage

Die Sales Journey ist eine Schrittleiste mit fünf Schritten und 13 Stops, die Sales, Customer 360, E-Mail und Renewals zeigen (je eine kopierte Fassung zwischen `@journey-start` und `@journey-end`; Renewal Analytics hat sie nicht). Ein Klick in einem anderen Space geht über die vorhandene Übergabe `wb:handoff` mit `{ journey: { customer, step, tab?, deal?, thread?, focus? } }`.

| Schritt | Stops heute |
|---|---|
| 1 Today | Inbox, Meetings (Sales), Renewals due (Renewals) |
| 2 Understand | Customer 360, E-mails, Deal graph (Sales), Renewal map (Renewals) |
| 3 Decide | Pipeline, Forecast (Sales), Renewal actions (Renewals) |
| 4 Act | Skills, Approvals (zwei Einstellungsreiter von Sales) |
| 5 Follow up | Late payments (Sales) |

**Lücke:** Act und Follow up sind dünn. Was später gebaut wurde, steht nicht in der Leiste: der **Autopilot** mit seinen Toren und der **Win-back** (Renewals, Reiter `autopilot`), die **Übergabe an Order-to-Cash (Software)** (Reiter `ren`) und das **Collections**-Space (Reiter `list` und weitere).

## Vorschlag

Drei neue Stops, kein bestehender fällt weg.

| Schritt | Neuer Stop | Space und Reiter | Offen für |
|---|---|---|---|
| 4 Act | **Autopilot** (mit Win-back) | `renewals`, Reiter `autopilot` | alle Kunden mit Renewals (Lindenau, Muster, Hanse) |
| 5 Follow up | **Renewal orders** | `order-to-cash-software`, Reiter `ren` | dieselben drei |
| 5 Follow up | **Collections** | `collections`, Reiter `list` | Lindenau, Muster, Hanse (alle drei kommen in den Beispieldaten vor) |

Der Win-back hat keinen eigenen Stop, weil er im Reiter Autopilot lebt. Ein zweiter Stop auf denselben Reiter wäre doppelt.

**Nordlicht:** In der Journey heißt der Kunde "Nordlicht Gruppe" (nur Customer 360). Collections kennt "Nordlicht Maschinenbau GmbH". Ob das derselbe Kunde ist, ist nicht festgelegt; deshalb bleiben die neuen Stops für Nordlicht gesperrt.

## Technik

1. **`shared/journey.mjs`:** drei Einträge in `STOPS`, zwei neue Merkmale in `CUSTOMERS` (`collections`, `o2c`), `available()` fragt sie über `needs` ab. `npm run sync:mockups` kopiert die Leiste in die Seiten, der vorhandene Test hält sie gleich.
2. **Empfangende Seite:** Renewals nimmt Reiter und Kunde bereits an (`jrApply`). Collections und Order-to-Cash (Software) lesen noch keine Journey-Übergabe. Beide bekommen eine kleine Annahme: `parse()` prüft die Werte, dann wird der Reiter gewählt (`list`, `ren`) und der Kunde als Filter oder Markierung gesetzt.
3. **Reihenfolge der Schritte in der Leiste:** Die Leiste wird breiter (Act 3 Stops, Follow up 3). Das Layout muss bei schmalem Fenster geprüft werden (Umbruch, Textgröße).

## Entscheidungen, die ich von dir brauche

1. **Stops und Namen:** Passen "Autopilot", "Renewal orders" und "Collections", oder lieber andere Namen oder Stops?
2. **Leiste in den Zielspaces:** (A) Collections und Order-to-Cash zeigen die Leiste **nicht**, der Klick öffnet nur den richtigen Reiter. Das ist klein, aber man kommt nicht über die Leiste zurück. (B) Beide zeigen die Leiste auch, mit Kunde und aktuellem Stop. Das ist mehr Umbau in zwei großen Seiten. **Empfehlung:** erst A, B als eigener Schritt, wenn A gefällt.
3. **Order-to-Cash nach Kunde:** Der Reiter `ren` listet heute alle übergebenen Renewal-Aufträge. Mit Journey-Kontext soll er auf den Kunden filtern oder dessen Aufträge markieren? **Empfehlung:** markieren und nach oben stellen, nicht ausblenden.
4. **Nordlicht:** gesperrt lassen (Vorschlag) oder die Namen angleichen?

## Reihenfolge der PRs

1. `journey.mjs` mit den drei Stops, Sync der Seiten, Tests (Stops zeigen auf vorhandene Spaces und Reiter, Verfügbarkeit je Kunde, Seiten sind synchron).
2. Collections nimmt die Übergabe an (Reiter, Kunde), mit Test im Headless-Browser.
3. Order-to-Cash (Software) nimmt die Übergabe an (Reiter `ren`, Kunde markieren), mit Test.
4. Optional (B): Leiste in Collections und Order-to-Cash.

Nach jedem PR: `npm run install:examples`; die App muss nur neu geladen werden, nicht neu gestartet, solange `src/` und `electron/` unverändert bleiben.

## Stand (14.11.2026)

Gebaut mit den Standardwerten (Namen wie vorgeschlagen, Variante A, Aufträge markieren und nach oben stellen, Nordlicht gesperrt) im Branch `feat/journey-stops`. Details und Grenzen in `docs/status/customer-360.md`.

## Nicht geprüft

- Nichts davon ist gebaut oder in der App gesehen. Die Tabelle oben stammt aus `shared/journey.mjs` und den Daten der Spaces.
- Ob Collections die Kunden Lindenau, Muster und Hanse mit genug Daten für jeden Reiter führt, ist nur an den Namen in `data.json` gesehen, nicht an den Reitern.
- Ob die längere Leiste in der echten App sauber umbricht, ist offen.
