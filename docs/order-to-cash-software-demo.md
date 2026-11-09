# Demo-Case: Order-to-Cash für ein Softwareunternehmen (Neufassung 08.11.2026)

**Botschaft in einem Satz:** Vom unterschriebenen Vertrag bis zu Cash und Umsatzrealisierung läuft ein Ablauf über sieben Systeme (CRM, Auftrag, Material, Entitlement, Bereitstellung, Billing, Revenue); ein n8n-Prozess ruft sie der Reihe nach auf, und eine Person entscheidet an drei Stellen.

**Dauer:** 8 bis 10 Minuten. **Space:** `order-to-cash-software` (`npm run install:order-to-cash-software`, App neu laden). Der Warenfall bleibt als Space `order-to-cash` daneben.

## Ehrlich benannt
Mockup mit erfundenen Daten (Rheinsoft Solutions, Kunde Kestrel Versicherung AG, Vertrag C-4410). Es wird kein System aufgerufen. Systemnamen, Werkzeugnamen (`crm_*`, `s4_*`, `mat_*`, `ent_*`, `prov_*`, `sub_*`, `rev_*`), Preise, Mengen und Belegnummern sind erfunden. Die Verteilung nach Einzelverkaufspreis, der Zeitpunkt der Umsatzrealisierung je Position und die Annahmen zu Zahlungen (immer 30 Tage nach Rechnung) sind Annahmen für die Demo, keine Buchungsrichtlinie; die Umsatzbuchhaltung müsste sie bestätigen.

## Der Fall
Vertrag C-4410 vom 28.10.2026, 36 Monate ab 01.12.2026, fester Preis 388.000,00 EUR:
- **Software 1, Lizenzkauf:** 40 Architect-Server-Lizenzen, 58.000,00 einmalig.
- **Software 2, Subscription:** Insight Cloud, 250 Benutzer zu 28,00 im Monat (7.000,00), dazu **Overage** ab dem 251. Benutzer zu 34,00.
- **Software 3, Consumption:** Flow Engine, 0,40 je 1.000 API-Aufrufe, Abrechnung im Nachhinein.
- **Services:** Implementierung (24.000,00, drei Meilensteine), Schulung (6 Tage zu 1.800,00), Managed Operations (1.200,00 im Monat, 36 Monate).

## Die 14 Schritte
1 Vertrag unterschrieben (CRM), 2 Auftrag, 3 Stückliste (Material), 4 **Entitlement-Prüfung vor der Lieferung** (zwei Abweichungen, Person entscheidet), 5 Lieferung (Lizenzschlüssel, Mandant, Zähler, Serviceplan), 6 **Wareneingang: der Kunde bestätigt** (Person entscheidet), 7 Entitlement erteilt, 8 technische Bereitstellung, 9 Rückmeldung "erledigt", 10 Billing, 11 **Verbrauch gegen Billing** (Differenz 2.300.000 Aufrufe = 920,00; Person entscheidet), 12 Revenue, 13 Cash-Eingang, 14 Umsatzrealisierung (Periodenabschluss).

Reiter: End-to-End O2C Process (Zeile je Schritt, Spalte je System, Klick für Details; darunter der n8n-Prozess), Order and bill of material (mit enthaltenen Services und drei Tenants), Entitlement, Provisioning, Billing and consumption, Revenue and cash (Monatsende wählbar). Oben die Leiste "Run step / Run to the next decision / Start again".

## n8n
`examples/n8n-workflows/13-order-to-cash-software.json`: Webhook `/webhook/o2c-software`, 14 HTTP-Knoten (je einer pro Schritt, URL aus `CRM_URL`, `ORDER_URL`, `MATERIAL_URL`, `ENTITLEMENT_URL`, `PROVISIONING_URL`, `BILLING_URL`, `REVENUE_URL`, Schlüssel `O2C_API_KEY`), drei Wait-Knoten für die Entscheidungen. Der Ablauf entscheidet nichts. Gegen echte Systeme nicht getestet.

## Nicht getestet
Electron-App, echter n8n-Lauf, echte Systeme. Im Headless-Browser durchgespielt (alle drei Entscheidungen, alle Reiter), Rechenkern und Ablauf in `test/order-to-cash-software.test.mjs`.
