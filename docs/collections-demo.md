# Demo-Case: Collections (Zahlungsverzug früh erkennen)

**Botschaft in einem Satz:** Der Account Owner erfährt vor dem Fälligkeitstermin, welche Rechnung wahrscheinlich zu spät bezahlt wird und warum, entscheidet selbst über die Ansprache, und jeder Schritt bleibt nachvollziehbar.

**Dauer:** 8 bis 10 Minuten. **Zielgruppe:** Vertrieb und Account Owner. **Space:** `collections` (`npm run install:collections`, App neu laden). Konzept: `docs/collections-demo-concept.md`.

## Ehrlich benannt
- Der Space ist ein **Mockup mit erfundenen Daten** (Nordwerk Software, fünf Kunden, Account Owner Sven Albrecht). Er ruft kein System auf und sendet nichts.
- **Die Prognosezahlen sind Beispielzahlen**, geformt wie die Ausgabe von `predict_late_payments`, **keine Modellausgabe** und keine Bonitätsbewertung. Das steht im Kopf der Seite und im Reiter "Why".
- Die Zahlungshistorie von Nordlicht spiegelt den Beispielkunden aus der Migration `20261104_025` (acht Rechnungen, 9 bis 35 Tage zu spät, Schnitt 22,8 Tage; hier aus den Daten berechnet). Die beiden offenen Rechnungen sind für die Demo zugeschnitten (eine 12 Tage überfällig, eine in 2 Tagen fällig) und weichen von der Migration ab.
- Werkzeugnamen außer `predict_late_payments` (`create_task`, `draft_email`, `create_approval_request`, `create_ticket`) sind erfunden. Prüfungen "Customer 360, Order-to-Cash, Tickets, Vertrag" sind Beispieldaten, nicht angebunden.
- Der Reiter "Track record" ist eine **erfundene Stichprobe**. Diese Zahlen dürfen nicht als Modellgüte vorgestellt werden.

## Der Fall
Fünf Kunden, 569.720 EUR offen, 333.653 EUR erwarteter Betrag in Gefahr (offener Betrag mal Wahrscheinlichkeit). Zwei Kunden brauchen heute Kontakt: Nordlicht (zahlt regelmäßig spät, eine Rechnung schon überfällig) und Küstenlogistik (hohe Verzugswahrscheinlichkeit, aber die Rechnung ist strittig).

## Ablauf

### Akt 1: Die Morgenliste (2 Minuten) – Reiter *Morning list*
- Vier Kennzahlen, darunter die Kunden **nach erwartetem Betrag in Gefahr sortiert**, nicht nach Prozent. Risiko steht als Text mit Symbol (▲ likely late, ◆ watch, ✓ on time), nicht nur als Farbe.
- **Satz:** "Das Modell sagt nicht, wer ein schlechter Kunde ist, sondern mit wem ich heute sprechen sollte."
- Klick auf Nordlicht (oder Eingabetaste auf der Zeile) öffnet "Why".

### Akt 2: Warum? (2 Minuten) – Reiter *Why*
- Je Rechnung: Betrag, Fälligkeit, Wahrscheinlichkeit, **Spanne** ("14 bis 30 Tage nach Fälligkeit") mit Skala (Fälligkeit und 14-Tage-Linie), Gründe in ganzen Sätzen. Der erste Grund wird aus der Historie berechnet ("8 von 8 Rechnungen nach Fälligkeit bezahlt, im Schnitt 22,8 Tage, 6 davon mehr als 14 Tage").
- Darunter die Zahlungshistorie mit Balken. "This assessment looks wrong" merkt sich den Widerspruch nur für diese Sitzung (ein echter Aufbau müsste ihn an den Modellverantwortlichen senden).
- **Satz:** "Ich sehe die Gründe und kann widersprechen."

### Akt 3: Stimmt auf unserer Seite alles? (2 Minuten) – Reiter *Our side*
- Nordlicht wählen: vier Prüfungen grün, "Nothing on our side blocks contact".
- **Küstenlogistik wählen:** zwei Prüfungen rot (Preis 2.400 EUR über Vertragspreis, Ticket T-5521 offen). Urteil: **Clarify first**, keine Mahnung.
- **Satz:** "Dasselbe Signal, zwei verschiedene richtige Antworten. Das ist der Wert gegenüber einer reinen Mahnliste."

### Akt 4: Vorschlag, Freigabe, Spur (2 bis 3 Minuten) – Reiter *Action*, *Track record*, *Rights & audit*
- Nordlicht: P1 Anruf, P2 freundliche Erinnerung (Entwurf sichtbar, **erwähnt die Prognose nie**), P3 Eskalation an die Vertriebsleitung (ab 150.000 EUR offen). Als Sven P2 freigeben: blockiert (braucht P1). P1, P2 freigeben: geht. P3: blockiert, nur Marlene Voss (Sales Director) darf eskalieren. Auf Marlene umschalten, P3 freigeben: geht.
- Claude und der Collections-Agent können **nie** freigeben (jeder Versuch ist blockiert). Der Knopf "Ask Claude to create the Gmail draft" gibt den Auftrag an Claude weiter (nur Entwurf, nichts wird gesendet).
- *Track record*: wie oft die markierten Rechnungen tatsächlich spät bezahlt wurden (erfundene Stichprobe, 9 von 12). *Rights & audit*: Rechtetabelle, sieben Versuche durch dieselbe Regel, Audit-Spur.
- **Satz:** "Nichts geht ohne mich raus, und ich kann später sehen, ob das Modell recht hatte."

## Live-Prognose
Der Knopf "Ask Claude to run the live forecast" (Morning list) schickt eine Anfrage an Claude, die mit dem Connector `sub4me` die echte Prognose abruft (Dienst `services/tabpfn/`, siehe `docs/status/cognee-tabpfn.md`). Der Space selbst ruft nichts auf. Voraussetzung: Connector eingerichtet und Dienst gestartet. Ohne TabPFN-Gewichte antwortet das beschriftete Ersatzmodell (`engine: baseline`); das muss man in der Demo sagen.

## Regeln (im Code und getestet)
- Rangfolge nach erwartetem Betrag. Schwellen als Daten: hoch ab 60 %, mittel ab 30 %, Eskalation ab 150.000 EUR offen (`policy` in `data.json`).
- Prüfung auf unserer Seite vor jedem Kontakt: ein rotes Ergebnis ersetzt die Erinnerung durch "Clarify first".
- Maßnahmen gestaffelt: überfällig → Anruf, Erinnerung, ggf. Eskalation; hoch vor Fälligkeit → Erinnerung (ggf. Eskalation); mittel → beobachten; niedrig → nichts.
- KI-Akteure geben nie frei; Reihenfolge (P2 braucht P1, P3 braucht P2); Eskalation nur durch die Vertriebsleitung.
- Entwurf neutral, nennt Rechnungen und Fälligkeiten, nie Prognose, Prozent oder Risiko.

## Offene Fragen (aus dem Konzept)
Schwelle "zu spät" (hier 14 Tage), wer die Prognosen sehen darf, zulässige Maßnahmen beim Kunden (Skonto, Ratenzahlung), ob der Fall "wir haben den Fehler" gezeigt werden soll, welche Quellen echt angebunden werden, Lizenz und Hosting des Modells (TabPFN-Gewichte 2.5 bis 3.5 nur nicht kommerziell).

## Nicht getestet
Electron-App, echter Lauf des Knopfs "Ask Claude" (Live-Prognose, Gmail-Entwurf), Prognose für Nordlicht mit echtem TabPFN oder Ersatzmodell, Anbindung der Prüfungen an echte Systeme. Geprüft: Logik und Oberfläche mit jsdom (13 Tests), Headless-Browser in Hell und Dunkel bei 1280 und 400 px Breite.
