---
name: ticket-writer
description: Macht aus einer kurzen Problembeschreibung ein sauberes Sub4Me-Serviceticket (Titel, Produkt, Priorität, Beschreibung) und legt es nach Bestätigung an. Nutzen bei "Ticket eröffnen", "Störung melden", "Sub4Me Ticket".
metadata:
  domain: Service & Support
  process: Serviceticket anlegen
  data-class: intern
  language: de
  board-area: Engineering
  lob: SuccessFactors
  scope: lob
  team: AI Programme Office
  tools: list_tickets, create_ticket
---

# Sub4Me-Ticket schreiben

Nutze nur den Connector `ai-control-tower` (Werkzeuge `list_tickets`, `create_ticket`). Das sind Demo-Tickets mit erfundenen Daten.

## Ablauf

1. Lies die Beschreibung der Person. Frage höchstens einmal nach, falls Produkt oder Auswirkung völlig unklar sind.
2. Rufe `list_tickets` auf und prüfe, ob es ein offenes Ticket zum selben Problem gibt. Wenn ja, nenne es und frage, ob trotzdem ein neues angelegt werden soll.
3. Entwirf das Ticket:
   - **Titel**: höchstens 120 Zeichen, nennt Produkt, Symptom und Ort ("BTP AI Core: Deployment-Quota in eu10 überschritten").
   - **Produkt**: kurzer Name wie in der Vertragsliste (zum Beispiel "BTP AI Core", "Joule copilots", "S/4HANA Cloud Private Edition").
   - **Priorität** nach diesen Kriterien:
     - *Very high*: Produktivsystem steht, kein Workaround.
     - *High*: starke Einschränkung oder Frist in Sicht, Workaround aufwendig.
     - *Medium*: Fehlfunktion mit Workaround.
     - *Low*: Frage, Wunsch, kosmetisch.
   - **Beschreibung** (höchstens 2000 Zeichen): Was passiert, seit wann, Auswirkung, bereits Versuchtes, gewünschtes Ergebnis. Keine Passwörter, Schlüssel oder personenbezogene Daten.
4. Zeige den Entwurf der Person und frage: "So anlegen?" Lege **nichts** an, bevor sie bestätigt.
5. Nach der Bestätigung rufe `create_ticket` genau einmal auf. Melde die Ticketnummer aus der Antwort und dass es ein Demo-Ticket in Supabase ist.

## Regeln

- Nie ein Ticket ohne ausdrückliche Bestätigung anlegen. Nie mehrere gleichzeitig.
- Bei einem Fehler von `create_ticket` den Fehlertext nennen und nicht erneut versuchen, ohne zu fragen.
