# Revenue Recognition – Space

Eigener Space unter **Finance**: Was alles unter Umsatzrealisierung fällt, wenn ein Softwareunternehmen Lizenzen, Subscription, Verbrauch und Services verkauft. Gleicher Fall wie `order-to-cash-software` (Vertrag C-4410, Kestrel Versicherung AG); beide Seiten nutzen denselben Rechenkern (`@core-start` bis `@core-end`, ein Test vergleicht den Text).

Installieren: `npm run install:revenue-recognition`. Daten: `examples/revenue-recognition/data.json`, danach `npm run sync:mockups`.

## Der Weg (seit 14.11.2026)
Eine Prozessleiste oben führt in der Reihenfolge der fünf Schritte des Standards, jeder Schritt mit eigener Farbe und eigener Seite; der aktuelle Schritt ist gefüllt und pulsiert, bereits durchlaufene tragen ein Häkchen, die Linie zum nächsten Schritt fließt. Rechts davon stehen die drei Seiten **nach Vertragsabschluss**. Über jeder Seite steht ein Banner: Schritt, Frage, ein Satz dazu, **Back** und **Next** (auch der Weg über die Leiste bleibt möglich).

1. **Contract** (blau) – die ganze Geschichte als fünf animierte Karten mit den Zahlen dieses Vertrags (anklickbar), danach die fünf Schritte in Worten (zugeklappt) und der Vertrag in einer Tabelle.
2. **Obligations** (türkis) – 14 Konstellationen (Dauerlizenz, Zeitlizenz, SaaS, Hosted licence, Support, Verbrauch, Overage, Implementierung, Training, Managed Operations, Pilot, Verlängerungsoption, Reseller, Finanzierungskomponente), filterbar nach Muster.
3. **Price** (gold) – variable Gegenleistung: Service Credit (SLA-Stufen), Mengenrabatt (Erwartungswert gegen wahrscheinlichster Betrag, Begrenzung).
4. **Allocation** (violett) – relative Einzelveräußerungspreise oder Restwertmethode, dazu drei Balken (Einzelpreise, Vertragspreis, Verteilung) in der Farbe jeder Position, der Rabatt schraffiert.
5. **Revenue** (grün), zwei Ansichten: **Schedule** (Verlauf über 38 Monate, ein Knopf **Play** und ein Regler spielen die Monate ab, vier Karten zeigen abgerechnet, Umsatz, vereinnahmt und die Vertragsverbindlichkeit oder den Vertragsvermögenswert des Monats; gestapelte Fläche nach Position; Abstand zwischen Rechnung und Umsatz; Umsatz je Jahr) und **Balances and entries** (Monatsende wählen: Salden, Positionen, Buchungssätze mit farbigen Konten, Konten des Monats).
6. Nach Vertragsabschluss: **Changes and costs** (Vertragsänderung A: eigener Vertrag, B: prospektiv mit Neuverteilung; Provision als Vertragskosten, Aktivierung 60 Monate), **Disclosures** (Aufteilung der Erlöse, Vertragssalden, Restleistungsverpflichtungen nach Zeitband), **Judgements and system** (zwölf Ermessensstellen mit Kontrolle und Verantwortlichem; Zuordnung zu den Stufen einer Revenue-Accounting-Komponente, illustrativ).

## Farben und Bewegung
- Jeder Schritt, jede der sieben Positionen und jedes Konto (Forderung blau, Bank grün, passive Abgrenzung amber, Umsatz violett) hat überall dieselbe Farbe. Nur Tokens, hell und dunkel.
- Bewegung gibt es nur beim Öffnen einer Seite (Einblenden, Zählen der Zahlen, Balken wachsen, Linien zeichnen sich), nie beim Drücken eines Knopfes auf der Seite. Bei "reduce motion" (System oder Einstellung der App) steht alles still.

## Tipps
Sprechblasen erklären die Schritte (2 bis 3 je Seite, beim ersten Besuch einer Seite, danach über den Knopf **Tips**). **Aus** geht in der Blase ("Turn off tips"), über den Knopf oder in der App unter Einstellungen, Skin, Tips; dort stehen auch Größe und Farben. Die App sagt der Seite beim Start und bei jeder Änderung Bescheid; "Turn off tips" gibt die Seite an die App zurück, die es als Einstellung speichert.

## Grenzen
- Lehr-Mockup mit erfundenen Zahlen; keine Bilanzierungsberatung. Methodenwahl, Schätzungen und Zuordnung zum Finanzsystem müssen die Buchhalter bestätigen.
- Keine echte SAP-/RAR-Anbindung; Feldnamen und Abläufe sind nicht gezeigt.
- Nutzung nach Januar 2027 wird nicht prognostiziert. Die Schwelle von 90 % für „Preis entspricht Einzelveräußerungspreis" ist eine Annahme dieser Demo.
- Nur mit Typecheck, Tests und Headless-Browser geprüft, nicht in der Electron-App.
