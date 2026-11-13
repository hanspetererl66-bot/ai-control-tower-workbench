# Renewals Autopilot (Schritt 1)

Stand 13.11.2026. Neuer Reiter **Autopilot** im Space `examples/renewals/`.

## Was gebaut ist
- Zustandsmaschine in `examples/renewals/logic.js` (`apStart`, `apAct`, `apSummary`, `apPolicy`; reine Funktionen, getestet in `test/renewals-autopilot.test.mjs`).
- Schritte: Watch, Brief, Offer, Policy check (alle Autopilot), Deal desk und Send (Person), Customer (Antwort des Kunden), Order (Autopilot).
- Modus **Autopilot**: Fälle innerhalb der Richtlinie (unter 30.000 EUR im Jahr, kein Warnsignal, Angebot innerhalb des Vertrags-Caps) laufen allein bis zur Antwort des Kunden. Alles andere hält an einem Tor und nennt die Gründe. Modus **Supervised**: eine Person gibt jedes Angebot frei und sendet es.
- Tore: Angebot freigeben (anderes Angebot wählen, ablehnen, übernehmen), Mail senden (Entwurf mit Joule möglich). Änderungswunsch des Kunden führt wieder zu einer Person. Absage endet als "Declined, win-back".
- Jeder Schritt steht im Protokoll (Autopilot, Person, Customer). Kennzahlen: wartet auf dich, beim Kunden, fertig, Schritte Autopilot : Person, Anteil ohne Person.
- Die Stufe der anderen Reiter folgt dem Autopilot. Der Zustand geht über `wb:state` an den Host und wird beim Zurückkommen geprüft.

## Schritt 2: Übergabe und Mailentwurf
- Nach der Unterschrift geht der Auftrag über `wb:handoff` (open: false, in die Warteschlange) an den Space `order-to-cash-software`. Neuer Reiter **Renewal orders** dort: Bestellung anlegen, Berechtigung für die neue Laufzeit verlängern, Rechnung einplanen (je ein Knopf, "Order management"). Prüft jede Übergabe neu (Vertragsnummer, Laufzeit, Betrag), verwirft Doppelte und Ungültiges, behält den Zustand über `wb:state`.
- Nach dem dritten Schritt meldet der Space `order-confirmed` (Bestellnummer, erste Rechnung) zurück; im Autopilot-Protokoll steht "Booked in Order-to-Cash: SO-…". Ein Knopf "Open Order-to-Cash" öffnet den Space.
- "Draft with Joule" (am Tor Senden): Anfrage von höchstens 600 Zeichen, Gmail `create_draft` an die eigene Adresse, "do NOT send", keine Adresse in der Anfrage; einmal je Fall, im Protokoll vermerkt.

## Schritt 3: Win-back als eigener Fall
- Ein abgelaufener Vertrag (Status Lapsed) wird beim Start des Autopiloten nicht mehr als Renewal behandelt, sondern wird direkt ein Win-back-Fall. Sagt der Kunde ab, nennt man den Grund (Preis, Wettbewerber, Umfang, Budget, unbekannt); daraus entsteht ein Win-back-Fall mit diesem Grund.
- Schritte: Analyse und Plan (Autopilot, Plan nach Grund, Angebot "Win-back entry price" aus den Optionen oder 15 % unter heute für 12 Monate), Plan freigeben mit Verantwortlichem (Person), erste Nachricht senden (Person, Entwurf mit Joule möglich), Antwort des Kunden, Auftrag. Ein Win-back braucht immer eine Person, auch im Modus Autopilot.
- Gewonnen: Übergabe an Order-to-Cash (Software) wie beim Renewal, mit Rückmeldung der Bestellnummer. Nicht gewonnen: Fall geschlossen, nach sechs Monaten wieder ansehen.
- Zustand (`wb`) wird wie der des Autopiloten über `wb:state` gehalten und beim Zurückkommen geprüft.

## Grenzen (ehrlich)
- Senden, Unterschrift und Buchung sind **simuliert**; die Antwort des Kunden wird mit Knöpfen nachgespielt. Die Mail geht nie selbst raus: "Draft with Joule" bittet den Agenten um einen Gmail-Entwurf an die eigene Adresse (braucht den Connector `gmail-drafts` mit Google-Zugang, nicht getestet).
- Zustand nur im Speicher des Hosts, nicht in der Datenbank; geht beim Schließen der App verloren.
- Die Richtlinie ist die vorhandene Regel (`autoCheck`); keine Rabattstufen, keine Rollentrennung, keine echte Identität (Person = Verantwortlicher des Vertrags).
- Die Erinnerung nach 14 Tagen im Win-back ist nur ein Text, kein Scheduler-Job; Co-Terming, Zufriedenheit (CSAT) und Teil-/Gesamt-Churn je Kunde fehlen weiter (siehe `docs/renewals-konzept.md`).
- Nicht getestet: Ansicht im echten Fenster (hell/dunkel, schmal), nur Tests mit jsdom.

## Nächste Schritte (Vorschlag)
1. Verweis vom Dashboard auf den Vertrag; Briefing aus der Brücke im Schritt Brief.
2. Nicht getestet: beide Spaces in der echten App mit dem Host (Übergabe, Warteschlange, Rückmeldung), und der Gmail-Entwurf mit Live-Diensten. Die Tests nutzen einen Ersatz-Host (jsdom).
3. Erinnerungen (Angebotsgültigkeit, Win-back nach 14 Tagen) als Scheduler-Job.
4. Zustand und Protokoll in der Datenbank (Migration, braucht Entscheidung zur Identität).
