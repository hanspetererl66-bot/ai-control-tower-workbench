# Pilot: Briefing im Renewals-Space

Stand: 13.11.2026. Plan, noch nichts durchgeführt. Er misst den Anteil `s` aus der Rendite in `docs/renewals-review.md`: wie viel der Vorbereitungszeit das Briefing (`docs/renewals-briefing-konzept.md`) spart, ohne dass die Qualität sinkt. Alle Kundendaten im Space sind erfunden.

## Frage

Spart das Briefing mindestens den Anteil der Vorbereitungszeit, ab dem sich ein Assistent trägt (**etwa 6 %**), besser **30 % oder mehr**, und ist das Ergebnis dabei nicht schlechter und nicht erfunden?

## Warum ein Vergleich, und was er nicht kann

- Der Renewals-Space enthält nur **erfundene Beispieldaten**. Mit echten Account Executives lässt sich damit **nicht die echte Vorbereitungszeit** messen, sondern nur eine **Vergleichsaufgabe**: dieselbe Art Aufgabe einmal ohne und einmal mit Briefing.
- Gemessen wird deshalb der **relative** Unterschied. Er ist ein Hinweis auf `s`, kein Beweis. Auf die 1,5 Stunden je Renewal (Angabe von Hans-Peter) wird er nur mit Vorsicht übertragen.
- Ein Pilot mit echten Renewals braucht eigene Entscheidungen (Datenschutz, Anbindung echter Daten) und ist nicht Teil dieses Plans.

## Entscheidungsgrenzen aus der Rendite

Bei 1200 Renewals im Jahr, 1,5 Stunden Vorbereitung, 100 EUR je Stunde (Platzhalter), 5 EUR Laufkosten je Renewal und 5.200 EUR Fixkosten im Jahr gilt:

`Nutzen im Jahr nach Kosten = 1200 × (150 × s − 5) − 5.200`

| Gemessenes `s` | Nutzen im Jahr nach Fixkosten | Aussage |
|---|---|---|
| 6,2 % | 0 EUR | Break-even |
| 15 % | etwa 15.800 EUR | trägt sich knapp |
| 30 % | etwa 42.800 EUR | vorsichtiger Fall der Rendite |
| 50 % | etwa 78.800 EUR | erwarteter Fall |

Die Fixkosten beruhen auf Platzhaltern (Aufbau 12.000 EUR); mit echten Aufbaukosten verschiebt sich die Schwelle nach oben (siehe Abschnitt 6 von `docs/renewals-review.md`).

## Aufbau

**Teilnehmer:** 8 Account Executives oder Kollegen aus dem Vertrieb (mindestens 4). Auswahl und Einladung entscheidet Hans-Peter.

**Renewals** (aus den Beispieldaten, je zwei vergleichbare aus verschiedenen Kunden, damit Wissen über einen Kunden nicht in die zweite Aufgabe wandert):

| Paar | Renewal 1 | Renewal 2 | Gemeinsam |
|---|---|---|---|
| 1 | Muster, Ariba Procurement (`R-C-2023-0390`) | Hanse, SAP Commerce Cloud (`R-C-2024-0611`) | rot, Angebot über dem Cap, Wettbewerber, Mail wartet |
| 2 | Muster, AI units (`R-C-2026-0012`) | Hanse, AI units (`R-C-2026-0044`) | gelb, mehrere Tickets, Nutzung unter Lizenz |

Zum Einüben (nicht gewertet) dient ein dritter Fall, zum Beispiel Lindenau, AI units (`R-C-2026-0051`).

**Zuordnung:** Jeder Teilnehmer bearbeitet **zwei** Renewals eines Paars, eines **ohne** Briefing (A) und eines **mit** (B). Reihenfolge, Bedingung und Renewal wechseln, damit Lerneffekte sich ausgleichen. Vier Teilnehmer je Paar:

| Teilnehmer | Erste Aufgabe | Zweite Aufgabe |
|---|---|---|
| a | Renewal 1, mit Briefing (B) | Renewal 2, ohne (A) |
| b | Renewal 2, mit (B) | Renewal 1, ohne (A) |
| c | Renewal 1, ohne (A) | Renewal 2, mit (B) |
| d | Renewal 2, ohne (A) | Renewal 1, mit (B) |

**Aufgabe (beide Bedingungen):** "Du hast in 30 Minuten ein Gespräch mit dem Kunden über die Verlängerung. Bereite es vor und gib eine Seite ab mit genau diesen vier Überschriften: Where we stand, What could go wrong, Suggested first steps, Questions for the customer. Höchstens 200 Wörter." Das sind dieselben vier Abschnitte wie im Briefing.

**Bedingung A (ohne):** Der Teilnehmer nutzt den Renewals-Space (Detailfenster, Mails, Tickets, Signale), aber **nicht** den Knopf "Draft a briefing" und nicht den Chat.

**Bedingung B (mit):** Der Teilnehmer darf "Draft a briefing" nutzen und das Ergebnis ändern, ergänzen oder verwerfen. Zeit, die er mit dem Prüfen und Ändern verbringt, zählt mit.

**Ablauf je Sitzung (etwa 60 Minuten):** Einführung und Einüben 10 Minuten, Aufgabe 1 (höchstens 20), Pause 5, Aufgabe 2 (höchstens 20), kurzer Fragebogen 5.

## Messgrößen

| Größe | Wie | Wer |
|---|---|---|
| **Zeit** je Aufgabe (Minuten) | Stoppuhr von "Renewal öffnen" bis "Seite abgegeben" | Pilotleitung |
| **Qualität** (1 bis 5) in vier Punkten: Situation, Risiken, nächste Schritte, Fragen | Prüfliste im Anhang A, **ohne zu wissen, welche Bedingung** (die Seiten werden ohne Kennzeichen abgegeben) | zweite Person |
| **Erfundene Fakten** (Anzahl je Seite) | Alles, was nicht in den Fakten des Renewals steht | zweite Person |
| **Wartezeit** des Briefings (Sekunden) | die Sitzungszählung der Seite ("on average … s") | Pilotleitung |
| **Brauchbarkeit** | "Useful as it is" oder "Needed changes" an der Seite | Teilnehmer |
| **Eindruck** | Fragebogen: hilfreich, vertrauenswürdig, würde ich nutzen (je 1 bis 5), Freitext | Teilnehmer |

Die Antworten stehen im Erfassungsbogen (`docs/pilot/renewals-briefing-pilot-sheet.csv`).

## Auswertung

1. **Anteil je Person:** `s_i = 1 − Zeit_B / Zeit_A` über die beiden Aufgaben derselben Person.
2. **Gesamt:** Median und Spanne von `s_i`; zusätzlich der Mittelwert der Zeiten je Bedingung. Bei 8 Teilnehmern ist das ein **Hinweis, keine statistische Sicherheit**.
3. **Qualität:** Mittelwert der Bewertungen mit und ohne Briefing, und die Anzahl erfundener Fakten.

| Ergebnis | Folge |
|---|---|
| `s` unter 6 % **oder** Qualität mit Briefing um mehr als 0,3 Punkte schlechter **oder** erfundene Fakten in mehr als einem von acht Briefings | Nicht weiter. Prompt und Fakten überarbeiten, Pilot später wiederholen. |
| `s` zwischen 6 % und 30 % bei gleicher Qualität | Noch nicht entschieden. Rendite mit echten Aufbaukosten neu rechnen, Prompt verbessern, erneut messen. |
| `s` ab 30 % bei gleicher Qualität und höchstens einem erfundenen Fakt | Nächster Schritt: ein kleiner Pilot mit echten Daten (eigene Entscheidung zu Datenschutz und Anbindung). |

## Vorbereitung (vor dem ersten Termin)

1. **Datenfehler beheben (Voraussetzung):** Die Mail `H-202` ("AW: Ariba renewal …") gehört laut Daten zu `C-2025-0458`, hängt aber am Angebot der Commerce Cloud von Hanse, und Hanse hat keinen Ariba-Vertrag. Der Text nennt zudem einen Cap von 3 %, der Vertrag hat 4 %. Das Briefing zu `R-C-2024-0611` würde das übernehmen. Entweder die Daten korrigieren oder Paar 1 durch ein anderes Paar ersetzen.
2. **App neu starten** (nötig nach Änderungen in `src/`), Renewals-Space aktualisieren (`npm run install:examples`).
3. **Ein Agent, ein Lauf:** Der Agent bearbeitet nur eine Antwort zugleich. Während der Sitzung darf niemand im Chat arbeiten, sonst kommt "The agent is still busy". Die Sitzungen laufen nacheinander.
4. **Sitzungszählung zurücksetzen** ("Reset demo") vor jeder Person, damit Durchschnitt und Anzahl zu ihr gehören.
5. **Chats aufräumen:** Jedes Briefing legt einen eigenen Chat "Renewal briefing" an. Nach dem Pilot löschen.
6. **Material:** Stoppuhr, Erfassungsbogen, Aufgabenblatt (Abschnitt "Aufgabe"), Prüfliste (Anhang A), Fragebogen.
7. **Keine echten Kundendaten** und keine echten Mails im Pilot.
8. **Kosten:** Die Modellkosten je Briefing stehen nicht in der Seite. Sie lassen sich aus der Nutzungsanzeige der Chats "Renewal briefing" ablesen (zu prüfen, ob die Anzeige sie liefert).

## Risiken und Grenzen

- **Beispieldaten:** Die Vergleichsaufgabe ist kürzer und klarer als echte Vorbereitung. `s` kann dort größer oder kleiner sein.
- **Kleine Zahl:** 8 Teilnehmer, 16 gewertete Aufgaben. Die Spanne wird groß sein.
- **Nicht verblindet bei den Teilnehmern:** Sie wissen, ob sie das Briefing nutzen. Erwartungen können die Zeit und den Eindruck färben. Die Qualität wird verblindet bewertet.
- **Lern- und Reihenfolgeeffekte:** durch die Zuordnung ausgeglichen, nicht beseitigt.
- **Wartezeit des Agenten:** Sie zählt zur Zeit in Bedingung B. Schwankt sie stark (Modellanbieter, Last), schwankt auch `s`.
- **Qualität ist eine Einschätzung:** Eine zweite Person bewertet nach Prüfliste; eine zweite Bewertung derselben Seiten durch eine dritte Person würde die Streuung zeigen.
- **Der Modellanbieter** erhält die erfundenen Fakten der Beispieldaten. Das ist in der Demo unkritisch.

## Offene Entscheidungen

1. **Teilnehmer:** wer, wie viele (Vorschlag 8), und wer bewertet die Seiten.
2. **Datenfehler H-202:** korrigieren (Vorschlag) oder Paar 1 ersetzen.
3. **Grenzen der Entscheidung:** 6 % und 30 % und die Qualitätsgrenze von 0,3 Punkten sind Vorschläge.
4. **Termine** und Ort.

## Nicht geprüft

- Nichts ist durchgeführt. Die Vergleichsaufgabe, die Prüfliste und die Grenzen wurden nicht mit Nutzern erprobt.
- Ob die Nutzungsanzeige der Chats die Kosten je Briefing liefert, ist nicht geprüft.
- Die Prüfliste (Anhang A) ist aus den Beispieldaten erzeugt; ob die Liste für eine Bewertung genügt, zeigt sich erst im Probelauf.

## Anhang A: Prüfliste je Renewal (Stand der Beispieldaten 2026-10-19)

Die Fakten sind die, die das Briefing bekommt. **Alles, was auf der abgegebenen Seite steht und hier nicht vorkommt, ist ein erfundener Fakt.** Bewertet wird, ob die **roten und gelben Signale**, das **Angebot gegen den Cap** und die **wartende Mail** genannt sind.

#### Hanse - SAP Commerce Cloud (R-C-2024-0611, 380.000 EUR, red)
- Entscheidungstermin 2026-11-01 (in 13 Tagen)
- Signal (red): Decision date 2026-11-01 is in 13 days
- Signal (yellow): Price rise of 6.6 % is above the contract cap of 4 %
- Signal (yellow): Competitor in play: Shopify Plus (evaluation)
- Signal (yellow): High ticket TKT-48166 is open (in processing)
- Angebot OFF-2026-0402: 405.000 EUR statt 380.000 EUR (6.6 % bei Cap 4 %), Stufe Proposal sent, Wettbewerber: Shopify Plus (evaluation)
- Ticket (High): SAP Commerce Cloud: storefront search returns no results after catalog import
- Mail 2026-10-15 (waiting-us, Ton mixed): Commerce Cloud renewal: bundle with the Analytics add-on?
- Mail 2026-10-08 (waiting-customer, Ton negative): AW: Ariba renewal, price rise above the cap **(Achtung: gehört nach den Daten nicht zu Commerce Cloud, siehe Vorbereitung, Punkt 1)**

#### Muster - Ariba Procurement (R-C-2023-0390, 290.000 EUR, red)
- Entscheidungstermin 2026-11-02 (in 14 Tagen)
- Signal (red): Decision date 2026-11-02 is in 14 days
- Signal (red): Invoice INV-2026-10621 is overdue (€86,275, due 2026-08-31)
- Signal (yellow): Price rise of 5.2 % is above the contract cap of 3.5 %
- Signal (yellow): Competitor in play: Coupa (customer evaluating)
- Angebot OFF-2026-0318: 305.000 EUR statt 290.000 EUR (5.2 % bei Cap 3.5 %), Stufe Proposal sent, Wettbewerber: Coupa (customer evaluating)
- Überfällige Rechnung 86.275 EUR, fällig 2026-08-31
- Mail 2026-10-17 (waiting-us, Ton mixed): AW: Ariba renewal: revised quote and price benchmark
- Eskalation (Management seit 2026-10-14): The AI Core quota blocks the go-live of the purchase-order skill. The CIO asked for a call this week.

#### Muster - AI units (R-C-2026-0012, 360.000 EUR, yellow)
- Entscheidungstermin 2026-11-01 (in 13 Tagen)
- Signal (yellow): Decision date 2026-11-01 is in 13 days (renews automatically unless changed)
- Signal (yellow): 78 % of the AI units are used: be ready to right-size
- Signal (yellow): High ticket TKT-48213 is open (in processing)
- Signal (yellow): Very high ticket TKT-48107 is open (waiting for customer)
- Angebot OFF-2026-0530: 360.000 EUR statt 360.000 EUR (0 % bei Cap 0 %), Stufe Proposal sent, Wettbewerber: None
- Ticket (High): Joule skill returns empty result for open purchase orders
- Ticket (Very high): BTP AI Core deployment quota exceeded in eu10
- Ticket (Medium): Ariba approval workflow not triggering for cost centre 4711
- Mail 2026-10-09 (waiting-customer, Ton negative): URGENT: AI Core quota eu10: alert and RCA
- Eskalation (Management seit 2026-10-14): The AI Core quota blocks the go-live of the purchase-order skill. The CIO asked for a call this week.

#### Hanse - AI units (R-C-2026-0044, 240.000 EUR, yellow)
- Entscheidungstermin 2026-11-01 (in 13 Tagen)
- Signal (yellow): Decision date 2026-11-01 is in 13 days (renews automatically unless changed)
- Signal (yellow): Price rise of 5 % is above the contract cap of 3 %
- Signal (yellow): Competitor in play: Microsoft Copilot (evaluation)
- Signal (yellow): 66 % of the AI units are used: be ready to right-size
- Signal (yellow): High ticket TKT-47932 is open (in processing)
- Angebot OFF-2026-0532: 252.000 EUR statt 240.000 EUR (5 % bei Cap 3 %), Stufe Negotiation, Wettbewerber: Microsoft Copilot (evaluation)
- Ticket (High): Document AI: VAT ID not extracted from scanned invoices of two suppliers

## Anhang B: Erfassungsbogen

Als Tabelle zum Kopieren: `docs/pilot/renewals-briefing-pilot-sheet.csv`. Eine Zeile je Aufgabe (zwei je Teilnehmer).

| Spalte | Inhalt |
|---|---|
| `participant` | Kürzel, zum Beispiel P1 |
| `date` | Datum der Sitzung |
| `renewal_id` | zum Beispiel `R-C-2023-0390` |
| `condition` | `A` (ohne Briefing) oder `B` (mit) |
| `order` | `1` oder `2` |
| `minutes` | Zeit von "Renewal öffnen" bis "Seite abgegeben" |
| `q_situation`, `q_risks`, `q_steps`, `q_questions` | Bewertung 1 bis 5, durch die zweite Person ohne Kenntnis der Bedingung |
| `invented_facts` | Anzahl erfundener Fakten |
| `briefing_wait_s` | Wartezeit des Briefings in Sekunden (nur Bedingung B) |
| `rating` | `useful` oder `changes` (nur Bedingung B) |
| `edit_notes` | was geändert wurde |
| `comments` | Beobachtungen der Pilotleitung |
