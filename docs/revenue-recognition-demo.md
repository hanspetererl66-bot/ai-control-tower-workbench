# Revenue Recognition (Software) – Space

Eigener Space unter **Finance**: Was alles unter Umsatzrealisierung fällt, wenn ein Softwareunternehmen Lizenzen, Subscription, Verbrauch und Services verkauft. Gleicher Fall wie `order-to-cash-software` (Vertrag C-4410, Kestrel Versicherung AG); beide Seiten nutzen denselben Rechenkern (`@core-start` bis `@core-end`, ein Test vergleicht den Text).

Installieren: `npm run install:revenue-recognition`. Daten: `examples/revenue-recognition/data.json`, danach `npm run sync:mockups`.

## Reiter
1. **Five steps** – die fünf Schritte nach IFRS 15 / ASC 606 mit dem Fall, den Ermessensstellen und dem Verantwortlichen (zugeklappt).
2. **Treatment by software type** – 14 Konstellationen (Dauerlizenz, Zeitlizenz, SaaS, Hosted licence, Support, Verbrauch, Overage, Implementierung, Training, Managed Operations, Pilot, Verlängerungsoption, Reseller, Finanzierungskomponente), filterbar nach Muster.
3. **Price allocation** – relative Einzelveräußerungspreise; Umschalter auf die Restwertmethode.
4. **Schedule** – kumuliert abgerechnet/Umsatz/vereinnahmt über 38 Monate, Abstand zwischen Rechnung und Umsatz, Umsatz je Jahr.
5. **Balances and entries** – Monatsende wählen: Vertragsverbindlichkeit/-vermögenswert, offene Posten, Restleistungsverpflichtung, Buchungssätze und Konten.
6. **Variable consideration** – Service Credit (SLA-Stufen), Mengenrabatt (Erwartungswert gegen wahrscheinlichster Betrag, Begrenzung).
7. **Changes and costs** – Vertragsänderung (A: eigener Vertrag, B: prospektiv mit Neuverteilung) und Provision als Vertragskosten (Aktivierung, 60 Monate).
8. **Disclosures** – Aufteilung der Erlöse, Vertragssalden, Restleistungsverpflichtungen nach Zeitband.
9. **Judgements and system** – zwölf Ermessensstellen mit Kontrolle und Verantwortlichem; Zuordnung zu den Stufen einer Revenue-Accounting-Komponente (illustrativ).

## Grenzen
- Lehr-Mockup mit erfundenen Zahlen; keine Bilanzierungsberatung. Methodenwahl, Schätzungen und Zuordnung zum Finanzsystem müssen die Buchhalter bestätigen.
- Keine echte SAP-/RAR-Anbindung; Feldnamen und Abläufe sind nicht gezeigt.
- Nutzung nach Januar 2027 wird nicht prognostiziert. Die Schwelle von 90 % für „Preis entspricht Einzelveräußerungspreis" ist eine Annahme dieser Demo.
- Nur mit Typecheck, Tests und Headless-Browser geprüft, nicht in der Electron-App.
