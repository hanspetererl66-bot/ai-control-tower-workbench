# Renewal-Prozess: Review und Agenten-Bewertung

Stand 12.11.2026. Ergebnis des Prompts `docs/prompts/renewals-review-prompt.md`. Es wurde nichts gebaut. Alle Zahlen im Space stammen aus erfundenen Beispieldaten; die Zahlen der Renditerechnung sind **Annahmen**, mit einer Ausnahme: **N und t hat Hans-Peter am 12.11.2026 genannt** (1200 Renewals im Jahr, 1,5 Stunden Vorbereitung je Renewal). Sie sind nicht im CRM oder in einer Zeiterfassung geprüft. Die Rechnung dazu steht in Abschnitt 6 unter "Aktualisierung".

## Kurzfazit

1. Die Auswertung (Gesundheit, Phasen, Preis gegen Cap, Angebotsalternativen) ist solide und getestet. Was fehlt, ist der **Weg von der Einsicht zur Handlung**: Freigeben, Senden und Signieren sind Knöpfe ohne Wirkung, die Joule-Knöpfe schicken nur einen Prompt in den Chat und erfahren nie das Ergebnis.
2. Für den **Account Executive** ist der Space eine gute Landkarte, aber drei Listen mit denselben Verträgen. Für den **Sales Manager** gibt es seit PR #325 ein Dashboard, aber keinen Weg vom Dashboard zum Eingreifen.
3. Mit **1200 Renewals im Jahr und 1,5 Stunden Vorbereitung je Renewal** (genannt von Hans-Peter, nicht geprüft) **trägt sich ein Assistent allein durch gesparte Zeit**, auch im vorsichtigen Fall: Nutzen 48.000 EUR im Jahr gegen 5.200 EUR Fixkosten, Break-even bei etwa 130 Renewals. Die Haltequote braucht es für diese Aussage nicht (sie bleibt die am schlechtesten belegte Annahme). Die ursprüngliche Rechnung mit der Beispielgröße 21 Renewals ist damit überholt, sie steht in Abschnitt 6 weiter als Ausgangsrechnung.
4. **Empfehlung:** zuerst die Verbesserungen ohne Agent (Abschnitt 4, größtenteils umgesetzt). **Ein** Assistent mit festen Aufgaben (Option B) ist nach der Rechnung gerechtfertigt, nicht mehrere Agenten. Vorher mit einem kleinen Test absichern, was die Rechnung am stärksten trägt: den Anteil der gesparten Zeit (s) und die echten Aufbaukosten (B). Eine agentische Lösung mit eigenen Aktionen (Option C): **noch nicht**.

## 1. Methode und Grenzen

- Gelesen: `examples/renewals/index.html`, `logic.js`, `scripts/sync-renewals.mjs`, `examples/renewals-analytics/`, die Konzepte, die Tests, die Connectoren und Skills.
- Angesehen: alle fünf Reiter des Renewals-Space und das Dashboard als Screenshot (hell und dunkel, ohne Seitenfehler).
- **Nicht gemacht:** keine Klickpfade mit echten Personen, keine Zeitmessung, kein Gespräch mit einem Account Executive oder Sales Manager. "Reibung" unten ist aus Code und Bildern abgeleitet, nicht gemessen.
- Beim Screenshot der Aktionsliste erscheinen die letzten Zeilen blass. Das ist die Einblend-Animation (`--i * 55ms`), nicht abgeschnittene Daten; die Liste zeigt alle offenen Renewals (`nextBest()`, `index.html:1824`).

## 2. Der Prozess nach Rolle: was ist wirklich was

Stufen: **berechnet** = Regel auf der Seite, **halb** = Chat-Prompt, Ergebnis bleibt im Chat, **simuliert** = Knopf ohne Wirkung außerhalb der Seite, **fehlt**.

| Schritt | Rolle | Stand | Reibung |
|---|---|---|---|
| Überblick, was heute dran ist | AE | berechnet (Overview, Next best action, Liste) | Drei überlappende Listen (6, 18 und 21 Zeilen) |
| Kunden verstehen (Tickets, Rechnungen, Nutzung, Mail) | AE | berechnet aus Beispieldaten | Gut. Zufriedenheit fehlt noch |
| Gespräch vorbereiten | AE | halb: `send()` schickt Prompt per `wb:ask` (`index.html:1768`) | Antwort kommt nicht in den Space zurück |
| Stufe "Prepared" | AE | simuliert: `prep` setzt die Stufe sofort (`:1960`) | Stufe stimmt auch, wenn nichts passiert ist |
| Angebotsoptionen (Cap, 3 Jahre, Right-size, Wachstum) | AE | berechnet mit Retention und CLV | Gut. Wahl liegt beim Menschen |
| Preis prüfen | AE | berechnet (Cap) plus halb (Skill `pricing-guard` per Chat) | Tiefe Prüfung nur im Chat |
| Freigabe Deal desk | AE | simuliert: Knopf setzt Stufe 2 | Keine Trennung der Rollen, keine echte Freigabe |
| Senden an den Kunden | AE | simuliert, Auto-Pfad unter 30.000 EUR ebenfalls | Ohne Wirkung |
| Signatur, Bestellung | AE | simuliert; Übergang zu Order-to-Cash nur als Text | Fehlt |
| Nachverfolgung (Mails, Zahlungen) | AE | berechnet: Mail-Chips aus Daten | Keine Rückmeldung in den Prozess |
| Pipeline und Prognose | SM | berechnet (Dashboard, seit #325) | Annahmen für Retention und CLV |
| Teamlast | SM | berechnet, Namen standardmäßig aus | Gut |
| Eingreifen (zuweisen, nachfragen) | SM | **fehlt** | Dashboard ist rein lesend, ohne Verweis auf den Renewal-Space |

Ehrlich getrennt: **echt automatisiert** ist nur die Berechnung auf der Seite. Alles danach ist Demonstration. Die Stufen liegen nur im Seitenspeicher und gehen beim Neuladen verloren (Spaces dürfen kein localStorage nutzen).

## 3. Beobachtungen mit Beleg

1. **Kopfzeile und Seite widersprechen sich.** Die Reisezeile nennt "Lindenau: renewals at stake €653,400, 1 of 5", die Seite zeigt "All customers, 18 renewals, €3,319,950". Zwei Kundenkontexte in einem Bild.
2. **Drei überlappende Listen:** "Next 6 weeks" (Overview, 6 Zeilen), "Action queue" (Next best action, 18 offene) und "By decision date" (21 inklusive der drei abgelaufenen). Der Unterschied liegt nur in Sortierung und Ausschnitt.
3. **Die ersten Aktionen sind schwach unterscheidbar.** In der Aktionsliste steht dreimal "Clear the overdue invoice with finance before the renewal talk" und dreimal "Fix the signing date with the customer this week". Das sind Sammelaufgaben, keine einzelnen.
4. **Der Preis über dem Cap ist nicht die erste Aktion.** Hanse AI units hat die Signale Termin, Preis 5 % über 3 % Cap und Wettbewerber. Die erste Aktion lautet trotzdem "Fix the signing date" (Regelreihenfolge: Termin zuerst). Das kann gewollt sein, die Zeile zeigt den Preisgrund aber nicht.
5. **Der Kundenlebenswert (12.740.000 EUR) steht als Kennzahl in der Kopfzeile.** Er beruht auf Annahmen (70 % Marge, Haltewahrscheinlichkeit nach Gesundheit). Ein Account Executive handelt nicht danach; ein Sales Manager könnte ihn falsch als Prognose lesen.
6. **Text vor Zahlen.** Zwei Karten ("What is this page?", "Demo flow") stehen vor den Kennzahlen, nach PR #321 zumindest zugeklappt bzw. kürzer.
7. **Das Dashboard ist von der Renewal-Seite aus nicht erreichbar** (kein Verweis in der Reisezeile oder im Space; nur Skripte kennen es). Umgekehrt führt kein Eintrag im Dashboard zum Renewal.
8. **Kundenmails sind unvertrauenswürdige Eingaben.** Die Mails des E-Mail-Space (`examples/customer-emails`) tragen je Nachricht ein Feld `untrusted`; die Mails des Renewals-Space stammen teils aus denselben Verläufen. Ein Agent, der Mails liest und handelt, muss das ernst nehmen.

## 4. Verbesserungen ohne Agent (nach Nutzen und Aufwand)

| # | Maßnahme | Rolle | Aufwand |
|---|---|---|---|
| 1 | Stufe "Prepared" ehrlich: nur nach Bestätigung durch den Menschen, Beschriftung "simuliert" überall, wo nichts passiert | AE | klein |
| 2 | Einen Kundenkontext: Kopfzeile und Seite nutzen dieselbe Auswahl | AE, SM | klein |
| 3 | Drei Listen zu **einer Startansicht für den AE** ("Heute") zusammenführen, die Liste bleibt als Nachschlagewerk | AE | mittel |
| 4 | Aktionsliste gruppieren (Sammelaufgabe "3 Rechnungen mit Finance klären"), und je Zeile die zwei stärksten Gründe zeigen | AE | mittel |
| 5 | Verweise zwischen Renewal-Space und Dashboard, Zeilen im Dashboard öffnen den Vertrag | SM | klein bis mittel (Space-übergreifende Navigation prüfen) |
| 6 | Eingreifen für den SM: "Rückfrage an Owner" als vorbereiteter Chat-Prompt, noch ohne Zuweisung | SM | klein |
| 7 | Kundenlebenswert aus der Kopfzeile nehmen oder klar als Annahme beschriften | SM | klein |
| 8 | Liste nach Kunde gruppierbar, Leerraum unter den Kundenkarten füllen, Mobilbreite prüfen | AE | mittel |

Punkte 1, 2, 5, 6 und 7 sind klein und beseitigen die irreführendsten Stellen. Sie sind ohne Entscheidung zur Agentenfrage sinnvoll.

## 5. Kandidaten für Agenten

Vorhandene Bausteine: Skills `customer-call-prep`, `pricing-guard`, `deal-risk-check`, `contract-checker` (`examples/skills/`); Sub4Me-Connector mit Werkzeugen für Verträge, Angebote, Rechnungen, Tickets und Verbrauch (`connectors/sub4me`); `wb:ask` als Weg vom Space in den Chat; Agent-Netz und Observability (`docs/agent-network.md`, `docs/agent-observability.md`).

| Kandidat | Eingaben | Ausgabe | Mensch gibt frei | Nie automatisch | Hauptrisiko |
|---|---|---|---|---|---|
| A. Gesprächsvorbereitung | Kundenübersicht, Tickets, Rechnungen, Nutzung | Briefing | liest | nichts | gering |
| B. Angebotsentwurf mit Preisprüfung | Angebotsoptionen, Cap, Deal-desk-Regeln | Entwurf, Begründung | Account Executive, Deal desk | Preis festlegen, senden | falsche Zusage |
| C. Antwortentwurf auf Kundenmail | Mailverlauf, Vertrag | Entwurf | Account Executive | senden | Prompt-Injection über Mailtext |
| D. Frühwarnung | Signale über alle Verträge | Hinweis an AE und SM | liest | Aktionen auslösen | Fehlalarme |
| E. Wochenbericht SM | Dashboard-Daten | Text | liest | nichts | gering, Zahlen sind Annahmen |

Heute existieren A und B im Kern schon als Chat-Prompts hinter Knöpfen ("Prepare with Joule", "Check the price", "Draft the cover note"). Für C, D und E gibt es nichts. Neu wäre vor allem, dass das **Ergebnis in den Space zurückkommt** (heute einseitig) und dass die Stufe daran hängt.

## 6. Rendite: Modell und Annahmen

**Formel je Jahr:**

`Nutzen = N × ( t × s × k  +  Δp × W × m )`  
`Kosten = B / J + P + N × a`  
`Break-even N = (B / J + P) / ( t × s × k + Δp × W × m − a )`

| Größe | Bedeutung | Vorsichtig | Erwartet | Optimistisch | Herkunft |
|---|---|---|---|---|---|
| N | Renewals je Jahr im Bereich | Beispiel: 21 | 21 | 21 | Beispieldaten, **zu erheben bei: Vertrieb, CRM** |
| t | Stunden manuelle Arbeit je Renewal in den Aufgaben des Agenten | 2 | 4 | 6 | **Annahme, zu erheben: Zeiterfassung oder Befragung** |
| s | Anteil, den der Agent nach Prüfung spart | 0,3 | 0,5 | 0,7 | **Annahme** |
| k | Vollkosten je Stunde (EUR) | 100 | 100 | 100 | **Platzhalter, zu erheben: Controlling** |
| Δp | Besserung der Haltequote (Prozentpunkte) | 0 | 0,5 | 1,5 | **Annahme, kaum belegt** |
| W | mittlerer Jahreswert je Renewal (EUR) | 175.000 | 175.000 | 175.000 | Beispieldaten: 3.677.150 / 21, erfunden |
| m | Marge | 0,7 | 0,7 | 0,7 | `rules.marginPct` der Beispieldaten |
| a | Modell- und Laufkosten je Renewal (EUR) | 5 | 5 | 5 | **Platzhalter** |
| B | Aufbau einmalig (EUR) | 12.000 | 12.000 | 12.000 | **Platzhalter:** 15 Personentage × 800 |
| J | Abschreibung in Jahren | 3 | 3 | 3 | Annahme |
| P | Betrieb und Pflege je Jahr (EUR) | 1.200 | 1.200 | 1.200 | **Platzhalter:** 10 % von B |

**Ergebnis je Renewal und Break-even** (Jahreskosten fix: 12.000 / 3 + 1.200 = 5.200 EUR):

| Szenario | Zeitnutzen je Renewal | Haltequote-Nutzen je Renewal | Netto je Renewal (nach a) | Break-even N | Bei N = 21 |
|---|---|---|---|---|---|
| Vorsichtig | 60 | 0 | 55 | ca. 95 | trägt sich nicht |
| Erwartet | 200 | 613 | 808 | ca. 7 | trägt sich |
| Erwartet, **ohne** Haltequote | 200 | 0 | 195 | ca. 27 | trägt sich nicht |
| Optimistisch | 420 | 1.838 | 2.253 | ca. 3 | trägt sich |

**Lesart der Ausgangsrechnung (überholt durch die Aktualisierung unten):**
- Die Rechnung kippte an **zwei** Größen: N (Anzahl) und Δp (Wirkung auf die Haltequote). Beide waren nicht erhoben, deshalb war die Entscheidung "lohnt sich der Agent" nicht entscheidbar, nur eingrenzbar.
- Reine Zeitersparnis trägt die Kosten bei Beispielgröße nicht. In einer größeren Organisation (viele Renewals) ändert sich das schnell: Break-even 27 Renewals ist dort kein Hindernis.
- Fehlerkosten (falsche Zusage, fehlerhafter Preis) sind **nicht eingerechnet**. Sie sprechen für Freigabe durch Menschen und gegen automatisches Senden.
- Alle Platzhalter in Euro sind frei gewählt, um die Rechnung zu zeigen. Keiner ist ein Befund.

### Aktualisierung am 12.11.2026: N = 1200 und t = 1,5 Stunden

Hans-Peter nannte **1200 Renewals** und **1,5 Stunden je Renewal**. Gelesen als: 1200 Renewals im Jahr in der ganzen Organisation, 1,5 Stunden Vorbereitung je Renewal (nur diese Aufgabe wird gerechnet). Das sind **1.800 Stunden Vorbereitung im Jahr**. Alle anderen Größen bleiben wie in der Tabelle oben (s, k, a, B, J, P, Δp, W, m); t ist jetzt 1,5 in allen Szenarien.

| Szenario | Anteil gespart | Gesparte Stunden im Jahr | Zeitnutzen je Renewal | Haltequote-Nutzen je Renewal | Netto je Renewal (nach a) | Nutzen im Jahr (N × Netto) | Nach Fixkosten (5.200) | Break-even N |
|---|---|---|---|---|---|---|---|---|
| Vorsichtig, nur Zeit | 30 % | 540 | 45 | 0 | 40 | 48.000 | 42.800 | ca. 130 |
| Erwartet, nur Zeit | 50 % | 900 | 75 | 0 | 70 | 84.000 | 78.800 | ca. 75 |
| Erwartet, mit Haltequote | 50 % und Δp 0,5 | 900 | 75 | 613 | 683 | 819.000 | 813.800 | ca. 8 |
| Optimistisch | 70 % und Δp 1,5 | 1.260 | 105 | 1.838 | 1.938 | 2.325.000 | 2.319.800 | ca. 3 |

(Rechnung: `t × s × k` mit k = 100 EUR je Stunde; Haltequote-Nutzen `Δp × W × m` mit W = 175.000 EUR, m = 0,7; Netto = Zeitnutzen + Haltequote-Nutzen − a mit a = 5 EUR.)

**Lesart:**
- **Die Zeitersparnis allein trägt die Kosten** in allen Fällen, auch im vorsichtigen: Break-even bei 130 Renewals, vorhanden sind 1200. Δp wird für die Entscheidung nicht gebraucht und bleibt außerhalb der Begründung.
- **Stundensatz:** Die Fixkosten sind gedeckt, sobald die gesparte Stunde mindestens etwa **6,22 EUR** wert ist (`(Fixkosten / N + a) / t`, also Anteil × Stundensatz). Mein Platzhalter von 100 EUR liegt weit darüber.
- **Aufbaukosten:** B = 12.000 EUR ist wahrscheinlich zu niedrig für eine echte Einführung mit Anbindung, Sicherheit und Betrieb. Bei P = 10 % von B und J = 3 trägt sich der vorsichtige Fall noch bis **etwa 110.000 EUR** Aufbaukosten, der erwartete Fall (nur Zeit) bis **etwa 194.000 EUR**. Das ist nachzurechnen, sobald es einen Kostenvoranschlag gibt.
- **Am stärksten wirkt jetzt `s`**, der gesparte Anteil der 1,5 Stunden (30, 50 oder 70 % sind Annahmen). Er ist mit einem kleinen Test zu messen: Briefing mit und ohne Assistent, gleiche Renewals.
- **Nicht eingerechnet:** Fehlerkosten (falsche Zusage, falscher Preis), die Zeit der Prüfung durch die Account Executives (im Anteil enthalten, nicht gemessen), ob der Assistent tatsächlich genutzt wird, und Einführungsaufwand für Schulung. Nur die Vorbereitung wird gerechnet, andere Schritte (Angebotsentwurf, Mails) kämen dazu.
- **N und t sind Aussagen im Chat**, nicht aus CRM oder Zeiterfassung. Ob 1,5 Stunden ein Mittelwert oder eine Schätzung ist, ist offen.

## 7. Drei Optionen und Empfehlung

| Option | Inhalt | Aufwand | Nutzen | Risiko |
|---|---|---|---|---|
| A. Kein Agent | Nur Abschnitt 4 | klein | beseitigt irreführende Stellen, spart Klicks | keins |
| B. Ein Assistent | Feste Aufgaben (Briefing, Angebotsentwurf mit Preisprüfung, Wochenbericht), Ergebnis kommt in den Space zurück, Freigabe durch Menschen | mittel, viele Bausteine vorhanden | Zeit je Renewal, evtl. bessere Haltequote | gering bis mittel |
| C. Mehrere Agenten oder agentischer Ablauf | Frühwarnung, Mailtriage, Entwürfe ohne Anstoß | hoch | unbelegt | hoch (Prompt-Injection, Fehlalarme, Zuständigkeit) |

**Empfehlung (aktualisiert 12.11.2026):** A sofort (größtenteils umgesetzt), **B ist nach der aktualisierten Rechnung gerechtfertigt**, C noch nicht. B ist vorher mit einem kleinen Test abzusichern: gesparter Anteil `s` und echte Aufbaukosten `B` (Abschnitt 6). Begründung der Reihenfolge: Der Prozess ist heute eine Demonstration; ein Agent auf einer Stufenlogik, die nichts auslöst, würde das Problem verschleiern. Zuerst muss der Weg von der Einsicht zur Handlung stehen.

## 8. Erster Schritt für Option B

- **Umfang:** Aus "Prepare with Joule" wird ein Briefing, das im Space angezeigt wird, nicht nur im Chat. Ob die Brücke zwischen Space und App eine Antwort an die Seite zurückgeben kann, ist **nicht geprüft** (`wb:ask` ist heute einseitig, gelesen in `index.html:1768`; die App-Seite wurde nicht untersucht).
- **Messgröße:** Minuten bis zum fertigen Briefing und Anteil der Briefings, die der Account Executive ohne große Änderung nutzt.
- **Abbruchkriterium:** gemessener Anteil `s` unter etwa 6 % (Break-even bei N = 1200, t = 1,5, k = 100 EUR, a = 5 EUR und Fixkosten 5.200 EUR: `(5.200 / 1.200 + 5) / (1,5 × 100) = 0,062`; höhere Aufbaukosten oder ein niedrigerer Stundensatz heben die Schwelle), Aufbaukosten über der Grenze aus Abschnitt 6, oder weniger als die Hälfte der Briefings genutzt.

## 9. Offene Fragen

1. **Beantwortet im Chat, zu bestätigen:** 1200 Renewals und 1,5 Stunden Vorbereitung je Renewal. Ist das 1200 im Jahr in der ganzen Organisation (so gerechnet) oder je Account Executive, und ist 1,5 Stunden gemessen oder geschätzt?
   - **Neu:** Wie hoch ist der Anteil `s`, den der Assistent spart, und was kostet die Einführung wirklich (Aufbau, Betrieb)?
2. Gibt es Evidenz, dass bessere Vorbereitung die Haltequote hebt? Die Recherche in `docs/renewals-konzept.md` stützt sich überwiegend auf Herstellerblogs.
3. Kann ein Space eine Antwort der App erhalten, oder nur senden?
4. Soll der Sales Manager aus dem Dashboard heraus zuweisen können? Das berührt die Leistungsbewertung einzelner Personen, daher bleibt die Namensanzeige standardmäßig aus.
5. Wie weit darf der Auto-Pfad unter 30.000 EUR später echt werden (Senden ohne Mensch)?

## Nicht geprüft

- Keine Messung, keine Befragung, keine echten Nutzer. Reibung ist Annahme. **N und t stammen aus einer Aussage von Hans-Peter im Chat**, nicht aus CRM oder Zeiterfassung; alle anderen Größen der Rendite (s, k, a, B, J, P, Δp, W) sind weiter Annahmen oder Platzhalter, die Beispieldaten sind erfunden.
- Qualität der Joule-Antworten hinter den Knöpfen nicht bewertet.
- Mobilbreite, Electron-App, Live-Systeme nicht getestet.
- Ob Space und App eine Rückantwort austauschen können, nicht untersucht.
- Alle Eurobeträge der Rendite sind Platzhalter; die Beispieldaten sind erfunden.
