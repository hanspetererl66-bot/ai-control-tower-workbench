# Demo-Case: Von der Spezifikation zum geprüften Code (ARC-1)

**Botschaft in einem Satz:** Joule liest das ABAP-System, ohne es zu verändern, und beantwortet die Fragen, die sonst einen halben Tag Suchen kosten: Was ist von der Spezifikation schon gebaut? Was sagt die Codeprüfung? Wer sitzt mir im Transport im Weg?

**Dauer:** 8 bis 10 Minuten. **Zielgruppe:** ABAP-Entwicklung, Architektur, Basis/Security (die Sicherheitsfrage kommt in Akt 4 von selbst).
**Quelle der Idee:** Marian Zeis, "Introducing ARC-1" und "How to Connect Joule Work Desktop to SAP Systems" (blog.zeis.de). ARC-1 ist ein Open-Source-MCP-Server (MIT) für die ADT-Schnittstelle von SAP.

## Zwei Stufen, ehrlich benannt

| Stufe | Was läuft | Was du sagen darfst |
|---|---|---|
| **A: Space (Mockup)** | Space "ABAP Workbench", erfundene Daten, kein SAP-System | "So sieht es aus, und das sind die Werkzeugaufrufe dahinter." |
| **B: Live** | ARC-1 als Connector, echtes Entwicklungssystem, ein Anzeige-Benutzer | "Das Gleiche, jetzt auf unserem System." Nur sagen, wenn B vorher einmal gelaufen ist. |

Die Demo funktioniert vollständig mit Stufe A. Stufe B ist der Zusatz, wenn ein Entwicklungssystem mit Anzeige-Benutzer bereitsteht. **Nicht getestet:** ein echter ARC-1-Lauf gegen ein SAP-System (siehe "Offen" unten).

## Vorbereitung (einmal, 10 Minuten)
1. `npm run install:abap-workbench`, App neu laden: Space **ABAP Workbench** erscheint in der Spaces-Übersicht.
2. Optional Stufe B: Connector ARC-1 aus dem MCP Marketplace importieren (Anleitung `docs/arc-1.md`), **nur Anzeige-Benutzer, alle Schalter aus**. Arbeitsprofil **Review (read only)** wählen.
3. Space einmal durchklicken (Reiter Spec vs. system, ATC findings), Hell oder Dunkel nach Raum.
4. Bei Stufe B vorher die drei Fragen aus Akt 2 bis 4 gegen das eigene System probieren und die Antworten mit dem Space abgleichen: Die Objektnamen im Live-System weichen ab (Space: ZCL_ORDER_VALIDATOR usw.).

## Ablauf

### Akt 1: Verstehen (2 Minuten) – Reiter *Object search*, *Source code*, *Where-used*
- Suche `ORDER`, Objekt **ZI_SALESORDER** wählen. Quelltext und Dokumentation (KTD) erscheinen.
- *Where-used*: drei Abhängigkeiten, gruppiert nach RAP-Rolle. **Satz:** "Eine Änderung an der Schnittstelle trifft drei Objekte, bevor ich eine Zeile anfasse."
- Über jedem Ergebnis steht der Werkzeugaufruf (SAPContext, SAPRead). **Satz:** "Das ist keine Magie, das sind lesende Aufrufe."

### Akt 2: Spezifikation gegen System (3 Minuten) – Reiter *Spec vs. system*
- Spezifikation TFD-0142 (aus dem Agent Studio der Werkbank, hier erfunden). Sieben Anforderungen, **3 erfüllt, 1 teilweise, 3 fehlen**, jeweils mit Beleg (Objekt und Zeile).
- Zeige R3 (Kreditlimit-Prüfung fehlt), R5 (Nachricht 010 fehlt in ZMSG_ORDER) und R7 (kein Unit-Test).
- Unten: "In the system, not in the specification" (Objekte ohne Anforderung): Frage an den Spezifikationsverantwortlichen.
- **Satz:** "Der Abgleich ist kein Gefühl, jede Zeile hat einen Beleg, den ich nachprüfen kann."
- Stufe B: Knopf **Ask the real Joule to check this**.

### Akt 3: Codeprüfung und Transport (2 Minuten) – Reiter *ATC findings*, dann *Transports*
- Drei Befunde, ein Befund je Zeile mit der betroffenen Codezeile. F2 betrifft **ZORDER_REPORT**.
- Das Feld darunter: **"Conflict"**: der Report liegt in zwei offenen Transportaufträgen verschiedener Besitzer (DEVK900231 / DEVELOPER1, DEVK900252 / DEVELOPER2).
- **Satz:** "Der Fix wäre eine Zeile. Das eigentliche Problem ist, dass zwei Kollegen am selben Objekt arbeiten. Das sieht man sonst erst beim Transport."
- *Ask Joule for a fix proposal*: Joule zeigt die geänderten Zeilen als Text, schreibt nichts.

### Akt 4: Sicherheit (1 bis 2 Minuten) – Reiter *Connection*
- ARC-1 ist **standardmäßig nur lesend**. Schreiben, freies SQL, Tabelleninhalte und Git-Schreiben sind getrennte Schalter, alle aus; Pakete eingegrenzt (Standard `$TMP`).
- Was die Werkbank zusätzlich tut (neu): Jeder ARC-1-Aufruf trägt in der Freigabe-Abfrage das richtige Etikett. `SAPRead` ist **Only reads**, `SAPWrite` und `SAPActivate` sind **Changes something**, `SAPQuery` und Tabelleninhalte sind **Check before allowing**. Das Arbeitsprofil "Review (read only)" blockiert alles außer Lesen, auch bei Transporten alles außer list, get, check, history.
- **Satz:** "Die Sicherheit hängt nicht an meinem Wohlwollen, sondern an drei Stellen: Schalter am Server, SAP-Berechtigung des Benutzers, Freigabe in der Werkbank."

### Zugabe (1 Minute, nur Stufe B): Dokumentation auf Knopfdruck
- Skill **abap-code-documentation** im Chat: "Dokumentiere den Report ZORDER_REPORT." Ergebnis ist ein Entwurf mit Zeilenbelegen und "Inference"-Markierung, offene Fragen gehen an den Objektverantwortlichen.
- **Satz:** "Das ist der Teil, für den es sonst Plattformen gibt. Hier ist es ein Skill auf einem lesenden Server."
- Nicht live zeigen, wenn der Skill vorher nicht gegen das echte System gelaufen ist.

## Fragen, die kommen
- **"Kann Joule auch Code schreiben?"** Technisch ja (SAPWrite, SAPActivate), aber nur mit dem Hauptschalter am Server, einem Entwicklungspaket und einer Freigabe pro Aufruf. Für die Demo bewusst aus.
- **"Welcher Benutzer läuft?"** Ein Dienstbenutzer mit Anzeigerechten. Für eine zentrale Betriebsvariante bietet ARC-1 OAuth und Principal Propagation (jeder Entwickler mit eigenen Rechten); nicht von uns erprobt.
- **"Sieht Joule Geschäftsdaten?"** Nur, wenn Tabelleninhalte oder freies SQL eingeschaltet sind. Standard: nein; die Werkbank stuft solche Aufrufe als "Check before allowing" ein.
- **"Wo laufen die Daten hin?"** Quelltext geht als Werkzeugergebnis an das Modell des Agenten. Vor Echtdaten klären, was das Modell sehen darf.
- **"Warum nicht Eclipse/ADT?"** Für das Schreiben bleibt die Entwicklungsumgebung. Die Demo zeigt das Verstehen, Prüfen und Abgleichen davor und danach.

## Wenn etwas schiefgeht
- Live-Antwort leer oder falsch: zurück auf den Reiter *Ask Joule* im Space (gleiche Fragen, aufgezeichnet). Nicht live debuggen.
- Transport-Aktion wird blockiert: richtig so. Nur *list/get/check/history* sind Lesen; auch ARC-1 selbst kann Transportschreiben getrennt sperren.
- Objektnamen im Live-System anders: die Fragen vorher mit echten Namen anpassen (Stufe B, Vorbereitung 4).

## Offen (nicht getestet)
- Echter ARC-1-Lauf gegen ein SAP-System (Argumentnamen `action`/`type` und Werkzeugergebnisse im Space sind vereinfacht; der Space zeigt "Tool names follow ARC-1; the arguments are simplified").
- Anbindung mit OAuth an die Goose-basierte App (zentrale Variante) und Principal Propagation.
- Einstufung von **SAPManage**: unser MCP-Marketplace führt es als lesend, die ARC-1-Berechtigungsdoku zählt es zum Schreibbereich. Die Werkbank behandelt es vorsichtig als "Check before allowing".
