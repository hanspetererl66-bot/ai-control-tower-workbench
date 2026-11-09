# LinkedIn-Serie: Joule X Design Study (Stand 08.11.2026)

Festgelegte Reihenfolge der Videos, Erzähler, Stilregeln und Aufträge für den Serien-Trailer und Post 13. Das ist Redaktionsplanung, kein App-Code. Die fertigen Videos liegen in `docs/linkedin-series/` (siehe dortige `README.md`).

## Reihenfolge (Stand 09.11.2026 abends, nach Prüfung auf Doppelungen)

Veröffentlichung: Serien-Trailer, Post 0, Pre-Trailer, dann Post 1 bis 18. Gegenüber dem Stand vom Nachmittag (19 Posts) sind zwei Posts zusammengelegt und drei Posts zugeschnitten, damit nichts doppelt erzählt wird (Abschnitt "Geprüfte Doppelungen" unten).

| Nr. | Post | bisher | Stand |
|---|---|---|---|
| Serien-Trailer | Hook für die ganze Serie | – | neu zu bauen mit 18 Folgen (Auftrag unten) |
| 0 | Joule Work, Joule Studio und Joule Studio 2.0 als neuer Experience Layer | 0 | fertig, 38 s |
| Pre-Trailer | "Under the hood": Stack, endet mit "The next post describes the first edition" | Pre | fertig |
| **Kapitel A: Die Werkbank** | | | |
| 1 | Design-Study-Tour inkl. Skills | 1 | fertig |
| 2 | Chatfenster | 2 | fertig |
| 3 | Chat-Einstellungen und Arbeitsprofile (Harness) | 11 | **kürzen**: der Teil "ein Symbol, alles was mitgeht" und "Sprache, Länge, Ton" entfällt (steht in Post 2), bleiben Profile, Personas und Befehle, Memory, Daten und Audit |
| 4 | Spaces (inkl. Übersicht mit Bewegung, Unter-Spaces, Skins) | 3 | fertig; Übersicht und Skins (09.11.) prüfen, ob ein Zusatzclip nötig ist |
| **Kapitel B: HR** | | | |
| 5 | Recruiting (US-Fall, inkl. Hiring Approvals) | 4 | fertig |
| 6 | **Onboarding** (23 Schritte in fünf Phasen, fünf Kandidaten, Übergabe aus Hiring Approvals) | neu | neu zu bauen |
| **Kapitel C: Automatisieren und Skills** | | | |
| 7 | Scheduler | 5 | fertig |
| 8 | Skill management | 6 | fertig |
| **Kapitel D: Finance** | | | |
| 9 | **Von Vertrag zu Cash und Umsatz**: Order-to-Cash für ein Softwareunternehmen (14 Schritte, sieben Systeme, n8n-Prozess, drei Freigaben) und Revenue Recognition (derselbe Fall C-4410, Zeitplan, Buchungen) | neu (zwei Posts zu einem) | neu zu bauen |
| 10 | Financial Pre-Close mit Daten aus Databricks | 7 | fertig |
| 11 | TabPFN-Zahlungsverzug-Prognose | 9 | fertig |
| **Kapitel E: Sales** | | | |
| 12 | Sales und Renewals (Sicht des Account Managers) | 10 | fertig; Renewals-Teil neu aufnehmen (fünf Reiter, animierte Kundenkarte, 09.11.) |
| 13 | **Customer Journey über drei Spaces**: Customer 360 (Lindenau), E-Mail-Space, Übergaben der Journey-Leiste; nur kurz zurück in Sales (Knowledge-Graph, Execute in Chat Window) | neu | neu zu bauen; Inbox und Meetings **nicht** nochmal erklären (Post 12) |
| **Kapitel F: Governance und Plattform** | | | |
| 14 | **AI Governance**: Einstieg Build, Register, Run, Prove mit Agent observability, Agent registry und Agent compliance | neu | neu zu bauen |
| 15 | n8n Performance Dashboard | 8 | **kürzen**: der Teil Admin console (Ontologies, Solution register, Skill management) entfällt, weil Skill management Post 8 ist und die Registry in Post 14 vorkommt |
| **Kapitel G: Bauen mit Absicht** | | | |
| 16 | Jira-, Notion-, Slack- und Teams-Integration im Agentic-Engineering-Prozess | 12 | fertig |
| 17 | Prozessinterview und Erstellung des n8n-Workflows (per Sprache) | 13 | noch zu bauen (Auftrag unten) |
| **Finale** | | | |
| 18 | IT Infrastructure Operations: Zertifikat läuft ab, vom SOP im Infra Wiki bis zum Nachweis (fünf Spaces, ca. 8 Minuten Story) | 14 | Video neu schneiden: der Ablauf wurde am 08./09.11. umgebaut |

Aus der Serie entfallen: Überblick Chat/Workflow/Agent/Skill und der Ontology Manager (er kam zuletzt nur noch als Teil der Admin console in Post 15 vor; mit dem Zuschnitt dort gibt es keinen Ontology-Teil mehr). Der Joule Design Study Space wurde am 09.11. aus dem Repo entfernt; das berührt die Videos nicht. Kandidaten für eine spätere Staffel: Sub4Me, Ontologies und Solution register als eigener Post, Quellen-Testbett (Jira/Slack).

## Geprüfte Doppelungen (Grundlage: Sprechertexte der fertigen Posts und Statusnotizen)
| Fund | Entscheidung |
|---|---|
| Post 8 (n8n + Admin console) zeigt in der Admin console Skill management, Solution register und Ontologies. Skill management ist Post 6, die Registry kommt mit Post 14 (AI Governance), die Admin-Kachel Agent observability ist seit 09.11. entfernt. | Admin-Teil aus dem n8n-Post streichen (neu Post 15, nur Dashboard). |
| Post 11 (Chat-Einstellungen) wiederholt das Kontext-Symbol aus Post 2: Memory, Gruppe, Persona, Space, "Was mit jeder Nachricht geht", Sprache/Länge/Ton. | Post 11 kürzen und direkt hinter Post 2 setzen (neu Post 3), Schwerpunkt Arbeitsprofile. |
| Order-to-Cash Software und Revenue Recognition erzählen denselben Fall (Vertrag C-4410, Kestrel Versicherung AG, gleicher Rechenkern). | Ein Post: erst der Ablauf über sieben Systeme, am Ende der Schritt Umsatz, dann Revenue Recognition mit Zeitplan und Buchungen. Fall nur einmal einführen. |
| Neue Sales Journey (Sales, Customer 360, E-Mail) überschneidet sich mit Post 10 in Sales (Inbox, Meetings, Deal-Drawer). | Post 12 (Sales und Renewals) bleibt der Sales-Post; der Journey-Post zeigt Customer 360, E-Mail und die Übergaben, Sales nur als Ziel. |
| Post 1 (Tour) nennt Spaces, Unter-Spaces, "Change with Joule", Skills, Scheduler, Skins; Post 3/4, 6 und 7 vertiefen. | Gewollt (Tour als Vorschau, danach Vertiefung); nicht ändern. Nur darauf achten, dass die Vertiefungen nichts Neues überspringen. |
| Post 7 (Pre-Close, TabPFN-Rückstellungen) und Post 9 (TabPFN, "same method in Controlling") nennen beide die Rückstellungs-Schätzung. | Gering; Post 10 nur ein Satz, die Methode erklärt Post 11. Nicht schneiden. |
| Post 12 (Anforderungen) und Post 13 (Prozessinterview) gehören beide zu Develop. | Kein Inhalt doppelt: Quellen lesen gegen Interview führen. In Post 17 nur kurz auf Post 16 zurückverweisen. |
| Post 4 (Recruiting) endet beim Angebot; Onboarding beginnt beim unterschriebenen Vertrag. | Keine Überschneidung; die Übergabe aus Hiring Approvals ist die Brücke. |

## Vorschläge für Wäsche, Kater und Musik der neuen Posts (noch nicht abgenommen)
| Post | Wäscheleine | Kater | Musik / Stimme |
|---|---|---|---|
| 6 Onboarding | ein Willkommens-Shirt und ein Paar Hausschuhe | trägt einen Karton mit dem ersten Arbeitstag, Namensschild am Fell | warmer Indie-Pop, junge weibliche Stimme |
| 9 Vertrag zu Cash und Umsatz | sieben Handtücher in einer Reihe (sieben Systeme) | schiebt eine Kiste über ein Förderband von links nach rechts, am Ende wiegt er eine Münze auf einer Waage | Marschrhythmus mit Jazz-Schluss; sachlicher männlicher Sprecher |
| 13 Customer Journey | fünf Wimpel (Today, Understand, Decide, Act, Follow up) | läuft die Wimpel entlang wie eine Schnitzeljagd | Funk, energischer Sprecher |
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
| 18 (Infra) | – | sitzt mit dem Rücken zum Betrachter an einer großen Konsole mit vielen Monitoren | Kraftwerk-Stil |

Erzähler: Post 1 Ben (männlich), Post 2 Muriel (weiblich, energisch, großer Tonumfang), Post 3 weibliche britische Nachrichtensprecherin, ca. 35. Striche (–) bedeuten: in dieser Planung nicht festgelegt, siehe Voiceover-Datei und Video.

## Auftrag: Serien-Trailer mit 18 Folgen (neu)
- 4:5, ca. 80 s, keine Untertitel. Intro und Outro wie in den Posts (Footer, Diamant, Mausloch, Accenture-Seite).
- Stimme: weiblich, mittleren Alters, energiegeladen, empathisch, warm, leicht sinnlich, sehr klar gesprochen, leichter amerikanischer Akzent, weniger synthetisch.
- Musik: eigener Track, moderner melodischer Afro-House mit Mainstream-Dance-Appeal (Black Coffee, David Guetta), 122 bis 124 BPM; Filter-Intro, Riser, Drop bei der Montage, Break vor der Hook-Frage. Kein bekannter Titel, keine geschützte Melodie.
- Hook: "Eighteen short stories. One purple diamond." Die Frage nach dem Diamanten wird erst im letzten Post beantwortet.
- Aufbau: sieben Kapitel (A bis G) plus Finale, je Folge ca. 2,5 s mit unscharfem Screen-Ausschnitt und großer Nummer; Beat-Wechsel zwischen den Kapiteln.

| Zeit | Sprechertext |
|---|---|
| 0:00–0:08 | "What if working with Joule felt completely different?" |
| 0:08–0:15 | "Eighteen short stories. One purple diamond. And a few things you won't see coming." |
| A | 1 "First: a tour of what could be." 2 "Then a chat that listens. Literally." 3 "Set the rules, pick your working profile." 4 "Spaces that turn a request into a live workspace." |
| B | 5 "Recruiting, the American way." 6 "And the day after the signature? Onboarding, planned to the hour." |
| C | 7 "Work that starts itself, right on time." 8 "Skills you can actually trust." |
| D | 9 "From signed contract to cash, and to revenue." 10 "Close the books with data from Databricks." 11 "Know who pays late, before they do." |
| E | 12 "Sales and renewals, through an account manager's eyes." 13 "One customer, one journey, three spaces." |
| F | 14 "Build it. Register it. Run it. Prove it." 15 "Know how every workflow performs." |
| G | 16 "From Jira ticket to working agent." 17 "Describe your process out loud, and watch a workflow appear." |
| Finale | 18 "And IT operations? They talk back." |
| 1:08–1:15 | "Which one are you most curious about? Follow along. Episode one is next!" |
| 1:15–1:25 | Outro: "And where did the diamond go? You'll see." |

Die Zeiten sind Richtwerte. Alternative bei zu langem Schnitt: nur die sieben Kapitel nennen und die Folgen als Bildflimmern zeigen.

## Auftrag: Post 17 (bisher 13), Prozessinterview und n8n-Workflow
Gleiches Intro und Outro wie die anderen Posts. Der Post steht jetzt im Kapitel "Bauen mit Absicht" direkt hinter der Integration von Jira, Notion, Slack und Teams (Post 16). Wäsche, Kater-Gag, Erzähler und Musik sind noch festzulegen (Vorschläge: eine eigene Wäsche, ein eigener Gag und eine eigene Stimme, damit sich Post 13 von den Nachbarn abhebt).

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
