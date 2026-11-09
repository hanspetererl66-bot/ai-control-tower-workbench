# LinkedIn-Serie: Joule X Design Study (Stand 08.11.2026)

Festgelegte Reihenfolge der Videos, Erzähler, Stilregeln und Aufträge für den Serien-Trailer und Post 13. Das ist Redaktionsplanung, kein App-Code. Die fertigen Videos liegen in `docs/linkedin-series/` (siehe dortige `README.md`).

## Reihenfolge (Stand 09.11.2026, ersetzt den Stand vom 08.11.)

Veröffentlichung: Serien-Trailer, Post 0, Pre-Trailer, dann Post 1 bis 19. Neu seit dem 08.11. sind sechs Themen aus der App (Onboarding, Order-to-Cash Software, Revenue Recognition, Sales Journey mit Customer 360 und E-Mail, AI Governance, Infra-Ops-Story). Sie stehen jeweils neben dem Thema, zu dem sie inhaltlich gehören. Dadurch ändern sich fast alle Nummern; die Spalte "bisher" zeigt, welche Datei welche neue Nummer bekommt.

| Nr. | Post | bisher | Stand |
|---|---|---|---|
| Serien-Trailer | Hook für die ganze Serie | – | neu zu bauen mit 19 Folgen (Auftrag unten) |
| 0 | Joule Work, Joule Studio und Joule Studio 2.0 als neuer Experience Layer | 0 | fertig, 38 s |
| Pre-Trailer | "Under the hood": Stack, endet mit "The next post describes the first edition" | Pre | fertig |
| **Kapitel A: Die Werkbank** | | | |
| 1 | Design-Study-Tour inkl. Skills | 1 | fertig |
| 2 | Chatfenster | 2 | fertig |
| 3 | Spaces (inkl. Übersicht mit Bewegung, Unter-Spaces, Skins) | 3 | fertig; Übersicht und Skins (09.11.) prüfen, ob ein Zusatzclip nötig ist |
| **Kapitel B: HR** | | | |
| 4 | Recruiting (US-Fall, inkl. Hiring Approvals) | 4 | fertig |
| 5 | **Onboarding** (23 Schritte in fünf Phasen, fünf Kandidaten, Übergabe aus Hiring Approvals) | neu | neu zu bauen |
| **Kapitel C: Automatisieren und Skills** | | | |
| 6 | Scheduler | 5 | fertig |
| 7 | Skill management | 6 | fertig |
| **Kapitel D: Finance** | | | |
| 8 | **Order-to-Cash für ein Softwareunternehmen** (14 Schritte, sieben Systeme, n8n-Prozess, drei Freigaben) | neu | neu zu bauen |
| 9 | **Revenue Recognition** (fünf Schritte, 14 Behandlungen, Zeitplan, Buchungen) | neu | neu zu bauen |
| 10 | Financial Pre-Close mit Daten aus Databricks | 7 | fertig |
| 11 | TabPFN-Zahlungsverzug-Prognose | 9 | fertig |
| **Kapitel E: Sales** | | | |
| 12 | **Sales Journey**: Customer 360 (Lindenau), Sales mit Knowledge-Graph und Priorisierter Inbox, E-Mail-Space als ein Ablauf | neu | neu zu bauen |
| 13 | Sales und Renewals (Sicht des Account Managers; Renewals jetzt mit fünf Reitern und animierter Kundenkarte) | 10 | fertig; Renewals-Teil neu aufnehmen (09.11.) |
| **Kapitel F: Governance und Betrieb der Plattform** | | | |
| 14 | **AI Governance**: Einstieg Build, Register, Run, Prove mit Agent observability, Agent registry und Agent compliance | neu | neu zu bauen |
| 15 | n8n Performance Dashboard und Admin console | 8 | fertig; Admin-Kachel "Agent observability" entfällt, Hinweis auf Post 14 |
| 16 | Chat-Einstellungen und Harness-Profile | 11 | fertig |
| **Kapitel G: Bauen mit Absicht** | | | |
| 17 | Jira-, Notion-, Slack- und Teams-Integration im Agentic-Engineering-Prozess | 12 | fertig |
| 18 | Prozessinterview und Erstellung des n8n-Workflows (per Sprache) | 13 | noch zu bauen (Auftrag unten) |
| **Finale** | | | |
| 19 | IT Infrastructure Operations: Zertifikat läuft ab, vom SOP im Infra Wiki bis zum Nachweis (fünf Spaces, ca. 8 Minuten Story) | 14 | Video neu schneiden: der Ablauf wurde am 08./09.11. umgebaut (Infra Wiki mit zwei SOPs, Schrittleiste, Alerts mit Kunde und Host, Fleet nach EMEA/NALA/APAC) |

Aus der Serie entfallen weiterhin: Überblick Chat/Workflow/Agent/Skill und Ontology Manager. Der Joule Design Study Space wurde am 09.11. aus dem Repo entfernt; das berührt die Videos nicht, die Rahmung "Design Study" bleibt. Kandidaten für eine spätere Staffel: Sub4Me, AI Control Tower Dashboards, Quellen-Testbett (Jira/Slack).

**Zwei Wege, mit den Nummern umzugehen:**
1. *Thematisch (empfohlen, oben):* alle Videos in neuer Reihenfolge, die Dateinamen `postN-…` werden umbenannt (bisher 5 bis 14 betroffen). Falls die Nummer im Bild oder im Sprechertext vorkommt, müssen diese Clips neu gerendert werden. Das ist bei den Posts nicht belegt, bitte im Produktionschat prüfen.
2. *Nur anhängen:* bestehende Nummern 1 bis 14 bleiben, die sechs neuen Posts werden 15 bis 20, IT Infrastructure Operations rückt aus der Finale-Rolle. Weniger Arbeit, aber Sales, Finance und HR sind dann über die Serie verstreut.

## Vorschläge für Wäsche, Kater und Musik der neuen Posts (noch nicht abgenommen)
| Post | Wäscheleine | Kater | Musik / Stimme |
|---|---|---|---|
| 5 Onboarding | ein Willkommens-Shirt und ein Paar Hausschuhe | trägt einen Karton mit dem ersten Arbeitstag, Namensschild am Fell | warmer Indie-Pop, junge weibliche Stimme |
| 8 Order-to-Cash | sieben Handtücher in einer Reihe (sieben Systeme) | schiebt eine Kiste über ein Förderband von links nach rechts | Marschrhythmus, leicht mechanisch; sachlicher männlicher Sprecher |
| 9 Revenue Recognition | Bettlaken und eine kleine Waage | wiegt zwei Socken auf einer Waage, Taschenrechner | Jazz-Trio, ruhige tiefe Frauenstimme |
| 12 Sales Journey | fünf Wimpel (Today, Understand, Decide, Act, Follow up) | läuft die Wimpel entlang wie eine Schnitzeljagd | Funk, energischer Sprecher |
| 14 AI Governance | vier Hemden mit Stempeln (Build, Register, Run, Prove) | stempelt ein Dokument mit Siegel | Orchester-Elektro, ruhige, formelle Sprecherin |

## Intro/Outro und Bildwelt (für alle Videos)
- 4:5, Englisch, Voice-over, Musik, keine Untertitel. Rahmung: mögliche Designvorschläge im Rahmen eines MVP, kein SAP-Produkt, Beispieldaten.
- Lavendel-Hintergrund, Titel "A Design Study. / Joule X. / Just Engineered.", violetter 3D-Diamant an einer Wäscheleine. Am Ende fällt der Diamant und rollt ins Mausloch, danach die lila Seite mit Accenture-Logo (bisher Text-Platzhalter).
- Trademark-Footer ("Design study · Personal view · Sample data · SAP and Joule are trademarks of SAP SE") am Anfang und am Ende.
- Accenture-Violett, kein Rot (Ausnahme: der rote Schal in Post 10).
- Der Kater ist in groben Pixeln gezeichnet, eine eigene Figur ohne Anlehnung an bestehende Maskottchen. Jede Folge hat ihre eigene Wäsche und ihren eigenen Kater-Gag.

## Wäsche, Kater und Musik je Folge (bestehende Posts, Nummern wie bisher, "bisher" in der Tabelle oben)

| Nr. | Wäscheleine | Kater | Musik |
|---|---|---|---|
| 1 | ein Shirt | läuft durch das Intro, schaut am Outro vom Bildrand | afro-house (Black Coffee) |
| 2 | zwei weiße Shirts mit verschwommenem SAP-Logo | schleicht mit Wollknäuel, am Ende mit Maus | Kraftwerk-Stil |
| 3 | zwei weiße Handtücher mit verschwommenem SAP-Logo, Pfosten schief im starken Wind | drückt mit beiden Pfoten gegen den Pfosten, die Kappe fliegt schräg nach oben rechts weg | 80er-Rock-Pop (Tina-Turner-artig) |
| 4 | zwei weiße Socken mit blauem SAP-Logo | – | – |
| 5 | Shirt und weiße Hose | Wecker | – |
| 6 | – | tanzt mit Zylinder, Stock und schwarzen Schuhen | 80er-Pop-Funk (Michael-Jackson-artig), tiefe Männerstimme |
| 7 | zwei marineblaue Shirts mit weißer Aufschrift "AI", Sonne, leichter Wind | fährt auf dem Fahrrad von links nach rechts | Beach-Boys-/California-Stil |
| 8 | – | sitzt am Schreibtisch mit Laptop und Brille | – |
| 9 | sechs weiße Socken mit blauen Streifen, Regen | tanzt mit Regenschirm | "Singin' in the Rain"-Stil |
| 10 | zwei Gummistiefel, zwei weiße Handtücher mit blauem Logo | fährt Fahrrad mit rotem Schal im Wind | deutscher Hip-Hop |
| 11 | – | steht auf einer Bühne, drei Scheinwerfer gehen nacheinander an und werfen Schatten, am Ende läuft eine Maus über die Bühne | Bongos und Ölfässer, leise beginnend, zum Ende lauter |
| 12 | – | sitzt im Heißluftballon, am Boden verankert, vor der Wäscheleine rechts vorne, schwebt nach links oben | südafrikanisch |
| 19 (Infra) | – | sitzt mit dem Rücken zum Betrachter an einer großen Konsole mit vielen Monitoren | Kraftwerk-Stil |

Erzähler: Post 1 Ben (männlich), Post 2 Muriel (weiblich, energisch, großer Tonumfang), Post 3 weibliche britische Nachrichtensprecherin, ca. 35. Striche (–) bedeuten: in dieser Planung nicht festgelegt, siehe Voiceover-Datei und Video.

## Auftrag: Serien-Trailer mit 19 Folgen (neu)
- 4:5, ca. 85 s, keine Untertitel. Intro und Outro wie in den Posts (Footer, Diamant, Mausloch, Accenture-Seite).
- Stimme: weiblich, mittleren Alters, energiegeladen, empathisch, warm, leicht sinnlich, sehr klar gesprochen, leichter amerikanischer Akzent, weniger synthetisch.
- Musik: eigener Track, moderner melodischer Afro-House mit Mainstream-Dance-Appeal (Black Coffee, David Guetta), 122 bis 124 BPM; Filter-Intro, Riser, Drop bei der Montage, Break vor der Hook-Frage. Kein bekannter Titel, keine geschützte Melodie.
- Hook: "Nineteen short stories. One purple diamond." Die Frage nach dem Diamanten wird erst im letzten Post beantwortet.
- Aufbau: sieben Kapitel (A bis G) plus Finale, je Folge ca. 2,5 s mit unscharfem Screen-Ausschnitt und großer Nummer. Die Kapitel werden durch kurzen Beat-Wechsel getrennt.

| Zeit | Sprechertext |
|---|---|
| 0:00–0:08 | "What if working with Joule felt completely different?" |
| 0:08–0:15 | "Nineteen short stories. One purple diamond. And a few things you won't see coming." |
| A | 1 "First: a tour of what could be." 2 "Then a chat that listens. Literally." 3 "Spaces that turn a request into a live workspace." |
| B | 4 "Recruiting, the American way." 5 "And the day after the signature? Onboarding, planned to the hour." |
| C | 6 "Work that starts itself, right on time." 7 "Skills you can actually trust." |
| D | 8 "From signed contract to cash, across seven systems." 9 "Revenue, recognized by the book." 10 "Close the books with data from Databricks." 11 "Know who pays late, before they do." |
| E | 12 "One customer, one journey, three spaces." 13 "Sales and renewals, through an account manager's eyes." |
| F | 14 "Build it. Register it. Run it. Prove it." 15 "Every automation in sight, one console to run it all." 16 "Tune how Joule works, one profile at a time." |
| G | 17 "From Jira ticket to working agent." 18 "Describe your process out loud, and watch a workflow appear." |
| Finale | 19 "And IT operations? They talk back." |
| 1:12–1:20 | "Which one are you most curious about? Follow along. Episode one is next!" |
| 1:20–1:30 | Outro: "And where did the diamond go? You'll see." |

Die Zeiten sind Richtwerte; bei 19 Folgen sind 2,5 s je Teaser das Maximum, sonst wird der Trailer zu lang. Alternative: nur die Kapitel nennen (sieben Teaser) und die Folgen als Bildflimmern zeigen.

## Auftrag: Post 18 (bisher 13), Prozessinterview und n8n-Workflow
Gleiches Intro und Outro wie die anderen Posts. Der Post steht jetzt im Kapitel "Bauen mit Absicht" direkt hinter der Integration von Jira, Notion, Slack und Teams. Wäsche, Kater-Gag, Erzähler und Musik sind noch festzulegen (Vorschläge: eine eigene Wäsche, ein eigener Gag und eine eigene Stimme, damit sich Post 13 von den Nachbarn abhebt).

Inhalt (aus der App, Stand `CLAUDE.md`):
1. **Zwei Wege am Schritt Intent im Workflow-Assistenten:** "Describe it yourself" oder "Interview the person who does the work". Das Interview ist nur für Workflows.
2. **Interview per Sprache:** Joule stellt die Fragen (auf Wunsch vorgelesen), die Person antwortet per Mikrofon oder Text. Nach jeder Antwort wird die größte gewichtete Lücke gefragt, bei Signalwörtern wie "usually" oder "it depends" gibt es eine Nachfrage nach versteckten Regeln. Automation-Potenzial ist Pflichtthema.
3. **Schrittmodell:** pro Schritt Akteur, System, Eingabe, Ausgabe, Regel, Ausnahme, Beleg. Zurücklesen des Prozesses zur Bestätigung, Flussdiagramm im Ergebnis.
4. **Mehrere Interviews:** "Interview another person" führt die Interviews zusammen, markiert Widersprüche und noch nicht befragte Rollen.
5. **Datenschutz und Nachvollziehbarkeit:** Einwilligung vor dem Start, Schwärzung nach Muster, Aufbewahrung wählbar (Standard 90 Tage), "Delete the log", Verweise von jeder Notiz auf die Log-Zeile, Hinweis zum Betriebsrat.
6. **Ergebnis:** Prozessbeschreibung füllt das Formular, das Gesprächsprotokoll wird als Datei gespeichert, daraus entsteht der n8n-Workflow.

Ehrliche Hinweise für den Sprechertext: Beispieldaten, Mikrofon, Vorlesen und der echte Agent sind noch nicht in der Desktop-App getestet, die Schwärzung ist reine Mustererkennung, und Datenschutz und Betriebsrat sind vor echten Interviews zu klären.

## Bekannte Kleinigkeiten
- Das Accenture-Logo im Outro ist noch ein Text-Platzhalter.
- Die Datei `docs/linkedin-series/trailer-design-study.mp4` ist noch die Fassung mit zehn Folgen und wird durch den neuen Trailer ersetzt. Die README der Videos nennt weiter die alten Dateinamen, sie wird erst nach der Umbenennung angepasst.
- Die Erzähler der Posts 4 bis 14 stehen in den jeweiligen Voiceover-Dateien.
