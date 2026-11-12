# Konzept: Demo-Case "Zahlungsverzug früh erkennen" (Vertrieb und Account Owner)

**Stand:** 12.11.2026, **Entwurf zur Abstimmung**, noch nichts gebaut. Anlass: Ein Kunde hat gebeten, den Fall Zahlungsverzug mit dem TabPFN-Modell zu prüfen und die Bedienung für die Nutzer sorgfältig zu gestalten. Die Gruppe soll das Konzept bewerten, bevor ein Space entsteht.

## 1. Botschaft in einem Satz
Der Account Owner erfährt **vor** dem Fälligkeitstermin, welche Rechnung wahrscheinlich zu spät bezahlt wird und warum, entscheidet selbst über die Ansprache, und jeder Schritt bleibt nachvollziehbar.

Was die Demo **nicht** sagt: Das Modell bewertet keine Bonität und entscheidet nichts. Es priorisiert Gespräche.

## 2. Zielgruppe und ihre Frage
Vertrieb und Account Owner (Beispiel: Sven Albrecht, Account Executive SAP). Ihre Fragen am Morgen:
1. Bei welchen meiner Kunden ist Geld in Gefahr, und wie viel?
2. Warum glaubt das System das, und stimmt es?
3. Was soll ich tun, und was darf ich dem Kunden schreiben?
4. Habe ich selbst etwas falsch gemacht (falsche Rechnung, offener Streit), sodass eine Mahnung die Beziehung beschädigt?

Nicht die Zielgruppe: Controlling und CFO (Rückstellungen, Kennzahlen). Das wäre eine zweite Fassung.

## 3. Ausgangslage (was es schon gibt)
- Prognose als Dienst `services/tabpfn/`, Connector-Tool `predict_late_payments` im Connector `sub4me`, Tab "Late payments" im Sales-Space. Pro offener Rechnung die Wahrscheinlichkeit einer Zahlung mehr als 14 Tage nach Fälligkeit, dazu Haupttreiber.
- Beispielkunde **Nordlicht Maschinenbau GmbH** (erfunden, Migration `20261104_025`): Vertrag C-2024-0820, 336.000 EUR, zehn Quartalsrechnungen, acht davon 9 bis 35 Tage zu spät bezahlt (Schnitt 22,8 Tage), zwei offen mit 200.200 EUR. Muster und Hanse zahlen im Schnitt 3 Tage früher. Im Datensatz steht: Erinnerungen lösen meist innerhalb einer Woche die Zahlung aus.
- Lücken: Nordlicht fehlt im Sales-Tab (nur im Chat), der Tab endet bei der Zahl, der Mahnentwurf per Gmail ist als offen vermerkt, es gibt keine Rückkopplung "Prognose gegen Wirklichkeit".

## 4. Ablauf der Demo (8 bis 10 Minuten, vier Akte)

### Akt 1: Die Morgenliste (2 Minuten)
- Liste der offenen Rechnungen **aller** Kunden des Account Owners, sortiert nach *erwartetem Verlust an Liquidität* (Betrag mal Wahrscheinlichkeit), nicht nach Prozent. Kopf: drei Zahlen (offen gesamt, davon mit hohem Risiko, Fälligkeiten in den nächsten 14 Tagen).
- Nordlicht steht oben, 200.200 EUR offen.
- **Satz:** "Das Modell sagt nicht, wer ein schlechter Kunde ist, sondern mit wem ich heute sprechen sollte."

### Akt 2: Warum? (2 Minuten)
- Klick auf Nordlicht: Zeitleiste der zehn bisherigen Rechnungen (Fälligkeit gegen Zahlungseingang), Balken je Rechnung, die Verspätung sichtbar. Treiber in ganzen Sätzen: "zahlt im Schnitt 23 Tage nach Fälligkeit", "acht von zehn Rechnungen zu spät".
- Prognose als **Spanne** ("wahrscheinlich 15 bis 30 Tage zu spät"), mit Kennzeichnung der Engine (TabPFN oder Ersatzmodell) und "Demomodell, synthetische Daten, keine Bonitätsbewertung".
- **Satz:** "Ich sehe die Gründe und kann widersprechen."

### Akt 3: Stimmt auf meiner Seite alles? (2 Minuten)
- Prüfung vor der Ansprache: offene Reklamationen, strittige Rechnung, offene Tickets, Zustimmung zum Vertrag. Die Quellen kommen aus Customer 360 und Order-to-Cash (vorhandene Spaces).
- Zwei Varianten, beide in der Demo zeigbar:
  - **A (Nordlicht):** nichts strittig, Rechnung korrekt, also freundliche Erinnerung vor Fälligkeit.
  - **B (zweiter, erfundener Kunde):** Rechnung strittig, die Prognose "spät" ist hier **richtig, aber der Grund ist unser Fehler**. Empfehlung: erst klären, keine Mahnung.
- **Satz:** "Dasselbe Signal, zwei verschiedene richtige Antworten. Das ist der Wert gegenüber einer reinen Mahnliste."

### Akt 4: Vorschlag, Freigabe, Spur (2 bis 3 Minuten)
- Der Agent schlägt eine Maßnahme vor (Anruf, Erinnerung, Eskalation zum Teamleiter, nach Betrag und Beziehung gestaffelt) und schreibt einen **Entwurf** (Gmail-Entwurf, nie Versand). Der Account Owner ändert und gibt frei; der Agent hat nie ein Freigaberecht (Muster wie in `order-to-cash`).
- Eintrag im Lauf-Protokoll: Empfehlung, Begründung, wer hat freigegeben, Ergebnis.
- Kurzer Blick auf "Treffsicherheit": "Von den Rechnungen, die als riskant markiert waren, wurden x von y tatsächlich spät bezahlt" (in der Demo mit erfundenen Daten, ausdrücklich so beschriftet).
- **Satz:** "Nichts geht ohne mich raus, und ich kann später sehen, ob das Modell recht hatte."

## 5. Gestaltung der Bedienung (Punkte für die Gruppe)
| Thema | Vorschlag |
|---|---|
| Sortierung | nach erwartetem Betrag, nicht nach Prozent |
| Farbe | Risiko immer auch als Text und Symbol (Barrierefreiheit), Farben nur als Tokens |
| Zahlen | Spanne statt Scheingenauigkeit, Wahrscheinlichkeit als "hoch/mittel/niedrig" mit Zahl im Detail |
| Erklärung | ganze Sätze mit Zahlen, keine Merkmalsnamen |
| Nächster Schritt | genau eine empfohlene Aktion je Zeile, weitere hinter "Weitere Optionen" |
| Vertrauen | Engine, Datenstand und "synthetisch" sichtbar, "Diese Einschätzung ist falsch" als Rückmeldung |
| Leerzustände | Dienst nicht erreichbar, keine offenen Rechnungen, zu wenig Historie ("Zu wenig Daten für eine Prognose" statt einer Zahl) |
| Tonfall | Entwurf neutral und freundlich, nie anklagend; kein automatischer Versand |

## 6. Umsetzung (Vorschlag, noch nicht beschlossen)
- Neuer Space `collections` (Arbeitstitel) wie `order-to-cash`: `index.html` + `data.json` + `space.json`, Logik zwischen `@logic-start`/`@logic-end` (Sortierung nach erwartetem Betrag, Prüfung vor Ansprache, Staffelung der Maßnahme, Freigabegrenzen), Test mit dem echten Code, Anleitung `docs/collections-demo.md`.
- Prognose: bestehender Weg über `predict_late_payments` und die Brücke. Der Space sendet nur diese eine Anfrage. In der Demo-Fassung liegen die Ergebnisse als erfundene Daten vor, damit der Ablauf auch ohne Dienst läuft (ausdrücklich beschriftet).
- Zweiter erfundener Kunde (Variante B) und Nordlicht im Sales-Tab ergänzen.
- Branch und Worktree, Merge nur auf Hans-Peters Wunsch, `npm run check` grün.

## 7. Ehrlich benannt (Grenzen)
- Mockup mit **erfundenen Daten**, keine echte Bonitätsbewertung, kein SAP-Aufruf. Werkzeugnamen und Belegnummern sind erfunden.
- Trainingsdaten des Modells sind synthetisch. Ohne TabPFN-Gewichte läuft ein Ersatzmodell; die Demo muss die Engine zeigen.
- **Lizenz:** Gewichte von TabPFN 2.5 bis 3.5 sind laut Prior-Labs-Dokumentation nur nicht kommerziell nutzbar. Vor einer Kundendemo außerhalb des internen Kreises klären (gehostete API oder kommerzielle Lizenz).
- **Nicht geprüft:** echte Prognose für Nordlicht mit TabPFN oder Ersatzmodell, Anzeige in der Electron-App, Gmail-Entwurf, Treffsicherheit des Modells auf echten Daten. Die Zahlen der "Treffsicherheit" in Akt 4 sind in der Demo erfunden und dürfen nicht als Modellgüte vorgestellt werden.
- Datenschutz: Zahlungsverhalten eines Kunden ist sensibel. Bei echten Kundendaten braucht es eine Prüfung (Zweckbindung, wer darf was sehen); die Identität in der App ist nur ein Etikett, kein Schutz.

## 8. Offene Fragen an Gruppe und Kunde
1. Schwelle "zu spät": heute 14 Tage nach Fälligkeit. Passt das zum Kunden, oder wollen sie 7 oder 30?
2. Wer darf Prognosen sehen: nur der Account Owner, auch Finanzen, auch der Kunde? (Ändert die Wortwahl.)
3. Welche Maßnahmen sind für den Kunden zulässig (Anruf, Mail, Skonto, Ratenvereinbarung)?
4. Wollen sie Variante B (eigener Fehler) wirklich zeigen? Sie ist ehrlicher, aber heikler.
5. Welche Quellen sollen in Akt 3 echt angebunden werden (SAP, CRM, Ticketsystem), und welche bleiben erfunden?
6. Lizenz und Hosting des Modells für die Kundendemo.
