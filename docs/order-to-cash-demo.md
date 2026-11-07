# Demo-Case: Order-to-Cash (Claude und Joule)

**Botschaft in einem Satz:** Claude bereitet den Fall am Arbeitsplatz vor, der Joule-Agent liest und bucht im SAP-System, und kein Weg führt an der Berechtigung der Person vorbei.

**Dauer:** 8 bis 10 Minuten. **Zielgruppe:** SAP-Entscheider (Produkt, Plattform, Vertrieb/Finanzen). **Space:** `order-to-cash` (`npm run install:order-to-cash`, App neu laden).

## Ehrlich benannt
Der Space ist ein **Mockup mit erfundenen Daten** (Nordwerk Maschinenbau, Kunde Bergmann Handel GmbH). Es wird kein SAP-System aufgerufen, Werkzeugnamen (`s4_*`) und Belegnummern sind erfunden. Sag auf der Bühne: "So sieht es aus und so laufen die Regeln", nicht "das ist eine bestehende Joule-Integration". Ein echter Lauf bräuchte einen S/4-Connector; der Sandbox-Connector (`connectors/sap-sandbox`, nur lesend, Feldnamen ungeprüft) deckt nur den Lese-Teil.

## Der Fall
Der Kunde hält die Zahlung der Rechnung 90001873 zurück: falscher Preis (125,00 statt Vertragspreis 118,75 EUR) und nur 160 von 200 Stück fakturiert (Position 20 hat Fakturasperre 01). Korrektur: Gutschriftsanforderung 1.000,00 EUR, Zusatzrechnung 4.750,00 EUR, netto schuldet der Kunde 3.750,00 EUR mehr.

## Ablauf

### Akt 1: Claude baut die Fallakte (2 Minuten) – Reiter *Case file*
- Vier Kennzahlen oben, dann sechs Befunde, jeder mit **Belegzeile** (Mail, Lieferschein, Vertrag, S/4-Beleg) und Haken "verified".
- F5 trägt die Marke **Inference** (Schluss aus den Belegen, kein Fakt).
- **Satz:** "Claude schreibt keine Behauptung ohne Zeile, auf der sie beruht. Die Quellen darunter zeigen, welche Zeilen zitiert sind."

### Akt 2: Joule liest den Belegfluss (2 Minuten) – Reiter *S/4 document flow*
- Auftrag, Lieferung (Position 20 mit Fakturasperre), Rechnung (160 Stück zu 125,00). Der Auftrag hat keinen Vertragsbezug.
- **Satz:** "Der Agent liest unter den Rechten von Lena. Er kann nur sehen, was sie sehen darf."

### Akt 3: Vorschläge und Freigabe (3 Minuten) – Reiter *Proposals*
- Oben rechts steht **Lena Vogt (Sachbearbeiterin)**. P1 freigeben: geht. P3 (Gutschrift 1.000,00) freigeben: **blockiert**, Limit 500,00, nötig ist der Teamleiter.
- Auf **Jonas Meier (Teamleiter)** umschalten, P3 freigeben: geht. P2 und P4 folgen in der Reihenfolge; P2 braucht P1, P4 braucht P2 und P3.
- **Satz:** "Der Agent schlägt vor, ein Mensch entscheidet, innerhalb seiner Grenze. Das ist keine Bitte an das Modell, sondern eine Regel."

### Akt 4: Guardrails und Spur (1 bis 2 Minuten) – Reiter *Guardrails*, *Audit trail*
- Tabelle der Rechte: Claude und der Joule-Agent haben **nie** ein Freigaberecht. Darunter sechs Versuche, durch dieselbe Regel gerechnet (Claude versucht es selbst, falsche Reihenfolge, Limit).
- *Audit trail*: jeder Schritt mit Akteur, Werkzeug und Art (gelesen, Entwurf, geschrieben, blockiert); die eigenen Klicks aus Akt 3 stehen schon dort.
- **Satz:** "Wer prüft, was passiert ist, findet jeden Schritt, auch die abgelehnten."

## Fragen, die kommen
- **"Ist das schon Joule?"** Nein, ein Entwurf im Werkbank-Design. Die Joule-Seite ist simuliert; echte Anbindung hängt an den Schnittstellen von Joule Studio für externe Agenten (MCP, A2A, REST), die vor einem Kundenkonzept gegen die SAP-Dokumentation zu prüfen sind.
- **"Wo kommen die Grenzen her?"** Im Beispiel stehen sie in den Daten (Sachbearbeiter 500, Teamleiter 5.000 bei Gutschriften). In echt kämen sie aus den SAP-Berechtigungen und Freigabegrenzen des Kunden; die Werkbank-Freigabe ist die zweite Schicht davor.
- **"Wohin gehen die Daten?"** Dokumenttext geht als Werkzeugergebnis an das Modell. Vor Echtdaten klären, was das Modell sehen darf (Kundendaten, Bankdaten).
- **"Was, wenn Claude falsch liegt?"** Jede Aussage hat eine Zeile; fehlt sie, zeigt die Seite "not verified". Der Test dafür liegt in `test/order-to-cash.test.mjs`.

## Wenn etwas schiefgeht
- Seite zeigt nichts: App neu laden (Refresh), Space neu installieren.
- Zurück auf Anfang: Knopf **Reset demo** im Reiter *Proposals*.
- "Ask the real Joule this" im Reiter *Ask Joule* schickt die Frage an den Chat; ohne S/4-Connector antwortet der Chat nur aus dem, was ihm vorliegt. Nicht live zeigen, bevor ein Connector läuft.

## Nicht getestet
Electron-App, andere Skins als Violet; ein echter Lauf gegen S/4 oder Joule Studio; `src/approval.ts` kennt nur ARC-1-Werkzeugnamen, die `s4_*`-Schreibwerkzeuge müssten dort ergänzt werden. Im Headless-Browser in Hell und Dunkel gesehen, ohne Seitenfehler.
