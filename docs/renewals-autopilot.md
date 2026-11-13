# Renewals Autopilot (Schritt 1)

Stand 13.11.2026. Neuer Reiter **Autopilot** im Space `examples/renewals/`.

## Was gebaut ist
- Zustandsmaschine in `examples/renewals/logic.js` (`apStart`, `apAct`, `apSummary`, `apPolicy`; reine Funktionen, getestet in `test/renewals-autopilot.test.mjs`).
- Schritte: Watch, Brief, Offer, Policy check (alle Autopilot), Deal desk und Send (Person), Customer (Antwort des Kunden), Order (Autopilot).
- Modus **Autopilot**: Fälle innerhalb der Richtlinie (unter 30.000 EUR im Jahr, kein Warnsignal, Angebot innerhalb des Vertrags-Caps) laufen allein bis zur Antwort des Kunden. Alles andere hält an einem Tor und nennt die Gründe. Modus **Supervised**: eine Person gibt jedes Angebot frei und sendet es.
- Tore: Angebot freigeben (anderes Angebot wählen, ablehnen, übernehmen), Mail senden (Entwurf mit Joule möglich). Änderungswunsch des Kunden führt wieder zu einer Person. Absage endet als "Declined, win-back".
- Jeder Schritt steht im Protokoll (Autopilot, Person, Customer). Kennzahlen: wartet auf dich, beim Kunden, fertig, Schritte Autopilot : Person, Anteil ohne Person.
- Die Stufe der anderen Reiter folgt dem Autopilot, aber nie unter die Stufe, die eine Person vor dem Start gesetzt hatte; "Reset autopilot" stellt diese Stufe wieder her. Die Stufe 1 heißt "Prepared (autopilot)", wenn der Autopilot sie gesetzt hat, und "Prepared (by you)", wenn eine Person es markiert hat. Der Zustand geht über `wb:state` an den Host und wird beim Zurückkommen geprüft.

## Schritt 2: Übergabe und Mailentwurf
- Nach der Unterschrift geht der Auftrag über `wb:handoff` (open: false, in die Warteschlange) an den Space `order-to-cash-software`. Neuer Reiter **Renewal orders** dort: Bestellung anlegen, Berechtigung für die neue Laufzeit verlängern, Rechnung einplanen (je ein Knopf, "Order management"). Prüft jede Übergabe neu (Vertragsnummer, Laufzeit, Betrag), verwirft Doppelte und Ungültiges, behält den Zustand über `wb:state`.
- Nach dem dritten Schritt meldet der Space `order-confirmed` (Bestellnummer, erste Rechnung) zurück; im Autopilot-Protokoll steht "Booked in Order-to-Cash: SO-…". Ein Knopf "Open Order-to-Cash" öffnet den Space.
- "Draft with Joule" (am Tor Senden): Anfrage von höchstens 600 Zeichen, Gmail `create_draft` an die eigene Adresse, "do NOT send", keine Adresse in der Anfrage; einmal je Fall, im Protokoll vermerkt.

## Grenzen (ehrlich)
- Senden, Unterschrift und Buchung sind **simuliert**; die Antwort des Kunden wird mit Knöpfen nachgespielt. Die Mail geht nie selbst raus: "Draft with Joule" bittet den Agenten um einen Gmail-Entwurf an die eigene Adresse (braucht den Connector `gmail-drafts` mit Google-Zugang, nicht getestet).
- Zustand nur im Speicher des Hosts, nicht in der Datenbank; geht beim Schließen der App verloren.
- Die Richtlinie ist die vorhandene Regel (`autoCheck`); keine Rabattstufen, keine Rollentrennung, keine echte Identität (Person = Verantwortlicher des Vertrags).
- Win-back nach Absage ist nur ein Status, kein eigener Fall; Co-Terming, Zufriedenheit (CSAT) und Teil-/Gesamt-Churn je Kunde fehlen weiter (siehe `docs/renewals-konzept.md`).
- Nicht getestet: Ansicht im echten Fenster (hell/dunkel, schmal), nur Tests mit jsdom.

## Nächste Schritte (Vorschlag)
1. Verweis vom Dashboard auf den Vertrag; Briefing aus der Brücke im Schritt Brief.
2. Nicht getestet: beide Spaces in der echten App mit dem Host (Übergabe, Warteschlange, Rückmeldung), und der Gmail-Entwurf mit Live-Diensten. Die Tests nutzen einen Ersatz-Host (jsdom).
3. Win-back als eigener Fall; Erinnerung vor Ablauf der Angebotsgültigkeit (Scheduler).
4. Zustand und Protokoll in der Datenbank (Migration, braucht Entscheidung zur Identität).
