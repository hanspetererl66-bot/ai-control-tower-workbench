# Demo-Case: Order-to-Cash für ein Softwareunternehmen (Claude und Joule)

**Botschaft in einem Satz:** Bei einer bestätigten Softwarebestellung starten kaufmännische und technische Schritte gleichzeitig; Claude und der Joule-Agent bereiten sie vor, und eine Person gibt jeden Schritt innerhalb ihrer Grenze frei.

**Dauer:** 8 bis 10 Minuten. **Space:** `order-to-cash-software` (`npm run install:order-to-cash-software`, App neu laden). Der Maschinenbau-Fall bleibt als Space `order-to-cash` unverändert daneben.

## Ehrlich benannt
Mockup mit erfundenen Daten (Rheinsoft Solutions, Kunde Kestrel Versicherung AG). Es wird kein System aufgerufen. Werkzeugnamen (`s4_*`, `sub_*`, `rev_*`, `prov_*`, `ent_*`), Preise, Belegnummern und die Mandanten-Vorlage sind erfunden. "LeanIX" ist nur das Beispielprodukt; wie LeanIX-Mandanten tatsächlich bereitgestellt werden, ist nicht abgebildet.

## Warum anders als der Warenfall
Recherche (06.11.2026, überwiegend Anbieter- und SAP-Lernseiten): Softwareunternehmen führen den Prozess als Quote-to-Cash. Der unterschriebene Vertrag ist der Auftrag, es gibt keine Lieferung und keinen Warenausgang. Die Bereitstellung (Mandant, Zugang, Berechtigung) läuft parallel zur Abrechnung, die Abrechnung folgt dem Plan im Vertrag, und Umsatz wird über die Laufzeit realisiert (ASC 606 / IFRS 15). Fakturiert und realisiert sind getrennte Zahlen.

Quellen: [Ordway](https://ordwaylabs.com/blog/quote-to-cash-process-saas/), [Zuora](https://www.zuora.com/glossary/revenue-recognition-saas), [SAP Learning: Entitlement Management](https://learning.sap.com/courses/discovering-sap-solutions-for-quote-to-cash-management-public-cloud-for-business-user/understanding-the-sap-entitlement-management-process_a4e8a6f6-1b32-48a8-b9f7-1426d2129918), [SAP Learning: Lead-to-Cash](https://learning.sap.com/learning-journey/explore-integrated-business-processes-in-sap-s-4hana-/describing-the-lead-to-cash-business-process_eb851981-68d6-4b08-89c9-747f979cf18b).

## Der Fall
Bestellung OF-7731: 500 LeanIX-Benutzerlizenzen, 36 Monate, 37,80 EUR je Benutzer und Monat (18.900,00 pro Monat, 226.800,00 pro Jahr, 680.400,00 Laufzeit), dazu Onboarding 8.000,00. Zum Auftrag gehören: Rechnungsempfänger weicht ab (Kestrel Group Services GmbH), die Vorlage legt den Mandanten in us-east an, obwohl die Daten nur in der EU liegen dürfen, und das Kreditrisiko (234.800,00) liegt über dem Limit (200.000,00).

## Ablauf
1. **Case file (2 Min.):** Claude liest Angebot, Bestellformular, zwei Mails und die Vorlage; sechs Befunde mit Belegzeile, F6 (Umsatz über die Laufzeit, Onboarding getrennt) ist als *Inference* markiert.
2. **Systems and money (2 Min.):** der Joule-Agent liest die Systeme; Tabelle "Was die Systeme jetzt halten" und die drei Zahlen zum 31.12.2026: fakturiert 226.800,00, realisiert 18.900,00, abgegrenzt 207.900,00. Darunter der Vergleich Ware gegen Software.
3. **Parallel tracks (4 Min.):** als Mira (Auftragsabwicklung) T4 (Mandant, Region eu-central) freigeben, T1 (Kreditsperre) wird **blockiert** (Limit 50.000,00), als Tobias (Kreditmanager) T1 freigeben. T6 (500 Lizenzen aktivieren) braucht Mandant **und** Kreditentscheidung und liegt über Miras Limit von 100 Lizenzen. Der Kundenbrief T7 wartet auf Abrechnungsplan, Zugang und Lizenzen.
4. **Guardrails und Audit trail (1 bis 2 Min.):** Rechtetabelle, sieben Versuche durch dieselbe Regel, jede Freigabe und jede Ablehnung steht in der Spur.

## Fragen, die kommen
- **"Ist das schon Joule?"** Nein, Entwurf; die Joule-Seite ist simuliert.
- **"Warum wartet die Lizenzaktivierung auf den Kredit?"** Das steht im Beispiel als Regel der Finanzabteilung (Beleg E2 Zeile 4), nicht als Branchenregel.
- **"Ist die Aufteilung des Onboardings richtig?"** Offen: als Inference markiert, die Umsatzbuchhaltung muss bestätigen.
- **"Läuft das gegen echtes SAP?"** Nein. Ein echter Lauf bräuchte Konnektoren zu S/4, Subscription Billing, Revenue Accounting und der Bereitstellung.

## Nicht getestet
Electron-App, andere Skins als Violet; ein echter Lauf gegen SAP oder Joule Studio; `src/approval.ts` kennt die Werkzeugnamen nicht. Im Headless-Browser in Hell und Dunkel gesehen, ohne Seitenfehler.
