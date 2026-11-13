# Konzept: mehr Daten für den Renewal-Prozess von Lindenau Pharma AG

Stand 14.11.2026. Nur ein Konzept, nichts davon ist gebaut. Entschieden (Hans-Peter): Blöcke 1 bis 3 (Tickets, Rechnungen, Angebote), **vollständig fiktiv**. Die Blöcke 4 und 5 (Mails je Vertrag, Nutzungsverlauf) bleiben für später.

## Warum die Karte dünn ist

Lindenau hat sechs Verträge in den Renewals. Drei stammen aus den Sub4Me-Beispieldaten (`examples/sub4me/portfolio.json`, `otherCustomers`): Ariba Procurement (abgelaufen), AI units und SAP Advanced Track and Trace. Drei sind **ausgedachte Zusatzverträge** (`ADDONS` in `scripts/sync-renewals.mjs`): SuccessFactors e-signature, Integration Suite connectors, BTP extra storage. Die Zusatzverträge haben im Generator `tickets: []`, keinen Angebotseintrag und nur eine Rechnung, wenn `overdue` gesetzt ist.

| Vertrag | Entscheidung | Tickets | Rechnungen | Angebot |
|---|---|---|---|---|
| C-2023-0344 Ariba (abgelaufen) | 2025-11-02 | 0 | 0 | ja (OFF-2026-0510) |
| C-2026-0051 AI units | 2026-11-01 | 1 | 1 | **keins** |
| C-2026-0922 Integration Suite | 2026-12-01 | **0** | 1 (überfällig) | **keins** |
| C-2026-0921 SuccessFactors e-signature | 2026-12-30 | **0** | **0** | **keins** |
| C-2026-0923 BTP extra storage | 2027-03-01 | **0** | **0** | keins (Entscheidung noch weit) |
| C-2025-0833 Track and Trace | 2027-09-02 | **0, obwohl eins offen ist** | 1 | keins (weit) |

**Ein Fehler in der Zuordnung:** Das offene Sub4Me-Ticket **TKT-48188** (High, "Waiting for customer", Produkt `SAP Advanced Track and Trace`) erscheint nicht beim Vertrag Track and Trace. Der Generator vergleicht `t.product === k.product`, der Vertrag heißt aber `SAP Advanced Track and Trace (serialization)`. Das ist keine fehlende Datei, sondern ein Vergleich, der nicht trifft.

## Vorschlag

Grundsatz: **Zusatzverträge sind erfunden, also bekommen sie erfundene Tickets, Rechnungen und Angebote im Generator** (wie die vorhandenen `EXTRA_OFFERS`), **nicht in Sub4Me**. Sub4Me kennt diese Verträge nicht; Tickets zu ihnen dort wären ein Widerspruch. So ändern sich Sub4Me, Customer 360, E-Mail und Collections nicht. Das gilt nur für die Renewals und ist im Dokument und in den Daten (`addon: true`) kenntlich.

### Block 1: Tickets (Ids `TKT-48231` bis `TKT-48237`, im Repo ungenutzt)

| Vertrag | Ticket | Priorität | Status |
|---|---|---|---|
| C-2026-0922 Integration Suite | TKT-48231: Connector zum Laborsystem (LIMS) verliert Nachrichten über 2 MB | High | In processing |
| C-2026-0922 Integration Suite | TKT-48233: Zertifikat des LIMS-Endpunkts läuft am 2026-11-09 ab | Medium | Waiting for customer |
| C-2026-0921 e-signature | TKT-48235: Bedeutung der Signatur fehlt im Export des Audit-Trails (21 CFR Part 11) | Medium | In processing |
| C-2026-0923 BTP storage | TKT-48237: Aufbewahrungsregel für Chargenakten von Quality Assurance noch nicht bestätigt | Low | Waiting for customer |
| C-2025-0833 Track and Trace | vorhandenes TKT-48188 wird sichtbar (Zuordnung korrigiert, kein neues Ticket) | High | Waiting for customer |

Priorität gemischt (2 High, 2 Medium, 1 Low), kein Ticket "Solution provided" oder "Closed", weil der Generator nur offene zeigt.

### Block 2: Rechnungen (Ids `INV-2026-40910` bis `INV-2026-40912`, ungenutzt; vorhanden ist `INV-2026-40890`)

Brutto mit 19 % MwSt., wie in den Sub4Me-Daten (14.400 € netto gibt 17.136 € brutto).

| Vertrag | Rechnung | Status | Brutto | Fällig |
|---|---|---|---|---|
| C-2026-0921 e-signature | INV-2026-40910, Jahresgebühr 18.600 € netto | Open | 22.134 € | 2026-11-15 |
| C-2026-0923 BTP storage | INV-2026-40911, Jahresgebühr 26.400 € netto | Open | 31.416 € | 2026-12-01 |
| C-2026-0922 Integration Suite | INV-2026-40912, Gebühr für das 6. Anschlussrecht, 2.400 € netto | Overdue | 2.856 € | 2026-10-05 |

Damit hat jeder Zusatzvertrag mindestens eine Rechnung, und es gibt zwei überfällige Posten (neben `INV-2026-40890`), eine offene Spitze und einen Posten, der bald fällig wird. Einen Status "bestritten" gibt es in den Daten nicht; ich erfinde keinen.

### Block 3: Angebote (Ids `OFF-2026-0540` bis `OFF-2026-0542`, ungenutzt)

Als `EXTRA_OFFERS` im Generator, gleiche Felder wie die vorhandenen. Preisanstieg höchstens die Obergrenze von 3 % aus dem Vertrag.

| Vertrag | Angebot | Jetzt | Neu | Stufe | Wahrscheinlichkeit | Gültig bis | Nächster Schritt |
|---|---|---|---|---|---|---|---|
| C-2026-0051 AI units (Entscheidung 2026-11-01 ist schon ausgelöst) | OFF-2026-0540 | 180.000 € | 185.400 € (+3,0 %) | Negotiation | 55 % | 2026-11-30 | Validierungskonzept von Quality Assurance bis 2026-11-06 (Voraussetzung für die Aufstockung) |
| C-2026-0922 Integration Suite | OFF-2026-0541 | 14.400 € | 14.832 € (+3,0 %) | Proposal sent | 65 % | 2026-11-20 | Offene Tickets zum LIMS-Connector vor der Frist klären |
| C-2026-0921 e-signature | OFF-2026-0542 | 18.600 € | 19.158 € (+3,0 %) | Proposal sent | 70 % | 2026-12-15 | Bestätigung der Signatur-Bedeutung im Audit-Trail |

Für BTP storage und Track and Trace gibt es noch kein Angebot, weil die Entscheidung erst 2027 fällt. Das ist richtig so und zeigt der Karte den Unterschied zwischen "Angebot fehlt, obwohl es fällig ist" und "noch nicht fällig".

## Technik

1. **`scripts/sync-renewals.mjs`:**
   - Neue Felder an `ADDONS` (`tickets`, `invoices`), die der Generator statt `tickets: []` und `overdue` nutzt (`overdue` bleibt für Hanse).
   - Drei Einträge in `EXTRA_OFFERS`.
   - Der Ticket-Vergleich nimmt das Produkt als Präfix des Vertragsnamens (`k.product.startsWith(t.product)` oder umgekehrt), damit TKT-48188 beim Vertrag Track and Trace erscheint. Prüfen, dass dadurch bei Muster und Hanse kein Ticket neu auftaucht.
2. **`npm run sync:renewals`** schreibt `examples/renewals/renewals.json` und bettet die Daten in `examples/renewals/index.html` und `examples/renewals-analytics/index.html` ein. Danach `npm run install:examples`, die Seite neu laden.
3. **Zahlen, die sich ändern können:** Gesundheit, Rot- und Gelbzahlen, "Needs me now", die Summen im Dashboard und Gesundheitssignale (offene Tickets, überfällige Rechnungen, fehlendes Angebot). Nach Deiner Regel (Daten ändern, nicht Tests) prüfe ich beim Bauen jeden Test, der daran bricht, und passe die Daten an, wenn eine Zahl nicht stimmt, nicht den Test.
4. **Nicht anfassen:** Sub4Me, Customer 360, E-Mail-Space, Collections, Sales. Sie behalten ihre Zahlen.

## Entscheidungen, die ich von dir brauche

1. **Fix der Zuordnung** (TKT-48188): einverstanden, dass er im selben PR kommt? (Es ist ein Fehler, nicht neue Daten.)
2. **Werte:** Passen die Beträge, Termine und Stufen oben, oder willst du eine andere Verteilung (zum Beispiel ein Angebot über der Obergrenze, damit die Deal-Desk-Hürde sichtbar wird)?
3. **Sichtbarkeit:** Die neuen Daten erscheinen in der Renewal-Karte (Speichen), im Detail eines Vertrags, in den Gesundheitssignalen und im Briefing. Reicht das, oder soll das Briefing sie ausdrücklich nennen?

## Nicht geprüft

- Nichts davon ist gebaut. Die Tabelle "Warum die Karte dünn ist" stammt aus `renewals.json` und dem Generator (Stand 14.11.2026), nicht aus der App.
- Die Auswirkung auf Gesundheit, Rot- und Gelbzahlen, die Dashboardsummen und die Tests ist nicht berechnet. Sie wird beim Bauen gemessen und im PR genannt.
- Ob die Ids `INV-2026-40910` bis `40912`, `TKT-48231` bis `48237` und `OFF-2026-0540` bis `0542` im Repo und in den Daten wirklich frei sind, ist nur an den Präfixen geprüft; beim Bauen läuft eine genaue Suche.
