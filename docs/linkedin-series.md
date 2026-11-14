# LinkedIn-Serie: Joule X Design Study (Stand 14.11.2026)

Festgelegte Reihenfolge der Videos, Erzähler, Stilregeln und Aufträge für den Serien-Trailer und Post 13. Das ist Redaktionsplanung, kein App-Code. Die fertigen Videos liegen in `docs/linkedin-series/` (siehe dortige `README.md`).

## Reihenfolge (Stand 14.11.2026): 14 Deep Dives (ersetzt den Stand mit 18 Posts)

Veröffentlichung: Serien-Trailer, Post 0, Pre-Trailer, dann Post 1 bis 14. Jeder Post ist ein Deep Dive zu **einem** Thema. Entscheidung von Hans-Peter am 14.11.2026. Die Zahl in den gesprochenen Intros der Posts 1, 3, 4 und 5 ("in eighteen short stories") muss auf "fourteen" geändert werden.

| Nr. | Deep Dive | Inhalt | Bestand |
|---|---|---|---|
| 1 | Tour | Überblick über die App, ein Satz zu den Einstellungen als Vorschau | fertig, Intro anpassen |
| 2 | Chat und Einstellungen | Chatfenster, Kontext-Symbol, Arbeitsprofile, die Einstellungen (elf Reiter), Mail und Diagramme im Chat | Chatfenster-Post und Profil-Post zusammenschneiden, Einstellungen und Neues ergänzen |
| 3 | Spaces | Spaces-Liste und Unter-Spaces, Space Designer mit Datenquellen, Space Analysis, Skins | Spaces-Post umschneiden, Designer neu |
| 4 | Skills und Scheduler | Skill-Tabelle, vier Genehmigungsstationen, Health, Marketplace, Zeitplan mit Ausgabeziel | zwei fertige Posts verschmelzen, Neues ergänzen |
| 5 | Ontology Manager | gemeinsamer Wortschatz, Wissensgraph, Begriffe im Space und im Chat | neu |
| 6 | Von der Stelle zum ersten Tag | Recruiting, Hiring Approvals, Onboarding | Recruiting fertig, Onboarding neu |
| 7 | Revenue Recognition | fünf Schritte, Behandlungen nach Softwareart, Zeitplan, Buchungen; kurzer Auftakt aus Order-to-Cash | neu |
| 8 | Financial Pre-Close | fünf Reiter, Daten aus Databricks, Rückstellungsvorschläge | fertig, umschneiden |
| 9 | Zahlungsverzug früh erkennen | TabPFN-Prognose und Collections, vom Hinweis zur Entscheidung | TabPFN-Post fertig, Collections neu |
| 10 | Sales und Kunde | Pipeline und Gates, Customer 360, Knowledge Graph, Sales-Journey | Sales-Teil fertig, Rest neu |
| 11 | Renewals | Heute-Ansicht, Autopilot mit Freigaben, Win-back, Briefing, Übergabe an Order-to-Cash | neu |
| 12 | Vom Wunsch zur Spezifikation | Prozessinterview per Sprache, Requirement collection, PRD Builder, Spec Builder | Requirement-collection-Post fertig, Rest neu |
| 13 | AI Governance | Build, Register, Run, Prove; Observability, Agent Network, n8n Performance Dashboard | Dashboard fertig, Rest neu |
| 14 | Autonomous Operations (Finale) | vom auslaufenden Zertifikat bis zu Orchestrator, Ursachenanalyse und Hotline | Infra-Post fertig, umschneiden |

Entfallen: Überblick Chat/Workflow/Agent/Skill; Admin console als eigener Teil (Skills, Registry und Ontology sind jetzt eigene Themen); der Joule Design Study Space (09.11. entfernt).

## Dramaturgie für Manager
Ziel: Eine Führungskraft versteht nach zwei Minuten, **was sich für ihre Arbeit ändert**, ohne die Technik zu kennen.

Regeln für jeden Deep Dive:
1. **Eine Frage, die ein Manager stellt**, in den ersten zehn Sekunden (nicht den Namen des Space).
2. **Drei Szenen**, nicht zehn: Problem (ca. 15 s), der eine Moment (ca. 60 s), Kontrolle (ca. 30 s: wer entscheidet, was bleibt nachvollziehbar).
3. **Ergebnis vor Werkzeug.** Werkzeugnamen (n8n, TabPFN, Databricks, MCP) höchstens in einem halben Satz "under the hood"; im Titel und in der Frage stehen Rollen und Ergebnisse.
4. **Eine Zahl je Post**, aus den Beispieldaten, mit dem Hinweis "sample data". Keine Zahl ohne Beleg im Space oder in der Doku.
5. **Immer der Satz "A person decides"** am Ende (steht schon in den fertigen Posts) und genau **eine ehrliche Grenze** (Beispieldaten, nichts angebunden, nicht getestet).
6. **Länge:** Ziel zwei Minuten, Governance und Finale bis drei.
7. Letzte Zeile ist die Brücke zum nächsten Post.

| Nr. | Frage des Managers | Botschaft in einem Satz | Die drei Szenen | Wertzeile |
|---|---|---|---|---|
| 1 | Wie fühlt sich Arbeit auf SAP künftig an? | Ein Ort, an dem du fragst, siehst und entscheidest. | Rail, Liste, Chat; Spaces nach Bereichen; Skills, Develop, Scheduler und deine Einstellungen als Vorschau | "Work comes to you." |
| 2 | Weiß der Assistent, was er wissen darf, und tut er nur, was ich erlaube? | Du siehst, was mit jeder Frage mitgeht, und legst die Regeln fest. | Kontext-Symbol (Memory, Gruppe, Persona, Space, "what Joule knows"); Arbeitsprofile, die den Assistenten nur strenger machen; die Einstellungen in drei Gruppen (Aussehen: Skin; Arbeitsregeln: Profile, Work, Assistant, Chat, Memory; Unternehmen: Gruppen, Speicher, Monitoring, Daten und Audit) | "You set the rules. Joule follows." |
| 3 | Wie komme ich zu meiner eigenen Auswertung, ohne auf die IT zu warten? | Eine Seite für deine Arbeit entsteht in Minuten und bleibt innerhalb der Regeln. | Spaces nach Bereichen; Seite aus Bausteinen und Datenquellen bauen; Space Analysis prüft jede Seite gegen die Regeln | "Self-service, inside the rules." |
| 4 | Wie wird gute Praxis für alle nutzbar, ohne Wildwuchs? | Aus einem Gespräch wird ein Skill, der geprüft und freigegeben wird. | Skill aus dem Gespräch; vier Genehmigungsstationen mit Rollen; Health und Dubletten, dazu der Zeitplan mit Ausgabeziel | "Reuse, with control." |
| 5 | Meinen Menschen und Agenten dasselbe, wenn sie "Kunde" oder "Verlängerung" sagen? | Ein gemeinsamer Wortschatz, den man sieht und der Änderungen prüfbar macht. | Begriff, seine Nutzer und die Folgen einer Änderung vor der Freigabe; Begriff im Space mit Definitionskarte; Chat fragt bei Mehrdeutigkeit nach | "One vocabulary for people and agents." |
| 6 | Wie schnell und fair stellen wir ein, und was passiert am ersten Tag? | Vom Stellenprofil bis zum ersten Tag, ohne dass ein Schritt verloren geht. | Anzeige ohne erfundene Gehaltsangabe, Kandidaten ohne Namen; Freigabe durch vier Rollen; Onboarding in fünf Phasen | "From requisition to day one." |
| 7 | Wann zählt der Umsatz, und wer entscheidet? | Ein Vertrag, fünf Schritte, und die Ermessensstellen sind sichtbar. | Vertrag und Leistungsbündel; Preisverteilung und Zeitplan (Rechnung gegen Umsatz); Buchungen und Ermessensstellen | "Revenue, explained." |
| 8 | Sind wir Tage vor dem Abschluss bereit? | Du siehst früh, wo der Abschluss hängt, und prüfst nur Vorschläge. | Prognose mit Bandbreite und Abschlussreife; offene Posten nach Wirkung; Rückstellungsvorschläge, die eine Person freigibt | "No surprises at close." |
| 9 | Wer zahlt voraussichtlich zu spät, und was tue ich heute? | Vor der Fälligkeit wissen, welche Rechnung kippt und warum. | Liste nach Risiko mit den Gründen; zuerst die eigene Seite prüfen (Lieferung, Ticket, Vertrag); Entscheidung über die Ansprache und Spur der Treffer | "Cash, earlier." |
| 10 | Wie sehe ich einen Kunden ganz? | Ein Kunde, eine Geschichte, quer durch die Fachseiten. | Pipeline mit Gates und Forecast; Customer 360 mit Zeitleiste und Wissensgraph; Journey-Leiste als Pfad aus fünf Schritten | "One customer, one story." |
| 11 | Wie verhindern wir, dass bei Hunderten Verlängerungen etwas durchrutscht? | Der Tag beginnt mit dem, was jetzt zählt, und der Autopilot arbeitet nur bis zur nächsten Freigabe. | Heute-Ansicht mit drei Zahlen; Autopilot und Win-back mit Freigaben; Briefing und Übergabe an Order-to-Cash | "Nothing slips." |
| 12 | Wie wird aus einem Wunsch eine Spezifikation, die man bauen kann? | Sprechen, sammeln, ableiten, nichts in den Quellen ändern. | Interview per Sprache oder Anforderungen aus Jira, Slack, Notion und Linear sammeln; PRD mit Bearbeitung und Bestätigung; Spezifikation und Architektur mit Word-Export | "From wish to blueprint." |
| 13 | Wissen wir, was unsere Agenten tun, und können wir es belegen? | Entlang des Lebenszyklus sichtbar: Build, Register, Run, Prove. | Einstieg mit vier Kacheln; Spur eines Laufs und Kosten; Agenten, die sich gegenseitig fragen, und das Dashboard für Workflows | "Prove what agents did." |
| 14 | Kann der IT-Betrieb sich selbst steuern, und wie sicher ist das? | Autonomie wird in Stufen verdient: zuerst vorschlagen, dann mit Freigabe, zuletzt allein. | Zertifikat läuft ab, SOP und Plan; Orchestrator und Ursachenanalyse schlagen vor, Vier-Augen-Freigabe; Schattenmodus vor dem Ernstfall | "Autonomy, step by step." |

Ehrliche Grenzen je Post (für den letzten Satz): Beispieldaten und nichts angebunden in allen. Zusätzlich: Post 9 Prognose auf synthetischen Rechnungsdaten, keine Bonitätsbewertung; Post 11 Nutzen (1.200 Verlängerungen, 1,5 Stunden) ist eine Annahme von Hans-Peter und wird erst durch den Pilot gemessen (ab etwa 6 % gesparter Vorbereitungszeit trägt sich der Assistent, siehe `docs/renewals-pilot.md`); Post 12 Interview ohne echtes Mikrofon in der Desktop-App getestet; Post 14 kein echtes Monitoring, Sprachagent bleibt Demo.

## Wäsche, Kater und Musik: Zuordnung zu den neuen Nummern (Vorschlag, offen)
| Neu | Übernimmt | Offen |
|---|---|---|
| 1 | Tour: ein Shirt (Ben) | – |
| 2 | Chatfenster: zwei weiße Shirts, Wollknäuel; Profil-Post: Bühne, Scheinwerfer, Bongos | Wäsche und Gag wählen (Vorschlag: Bühne, weil dort der Kater schon den Scheinwerfer hat und die Einstellungen ein Bühnenthema sind) |
| 3 | Spaces: Wind, Handtücher, Kappe, ABBA-Stil | – |
| 4 | Skill management: tanzender Kater mit Zylinder; Scheduler: Wecker | Vorschlag: Zylinder-Kater, dazu ein Wecker an der Leine |
| 5 | neu | Gag offen |
| 6 | Recruiting: weiße Socken mit blauem Logo; Onboarding: Willkommens-Shirt, Hausschuhe, Karton | Vorschlag: Recruiting-Gag und der Karton am Schluss |
| 7 | neu: Bettlaken und kleine Waage (Vorschlag), Kater wiegt Socken | Vorschlag nicht abgenommen |
| 8 | Pre-Close: zwei marineblaue "AI"-Shirts, Fahrrad, Beach-Boys-Stil | – |
| 9 | TabPFN: sechs Socken, Regen, Schirm, "Singin' in the Rain"-Stil | – |
| 10 | Sales und Renewals: Gummistiefel, Handtücher, roter Schal, Hip-Hop; Journey: fünf Wimpel | Vorschlag: Gummistiefel-Gag bleibt, Wimpel dazu |
| 11 | neu | Gag offen |
| 12 | Anforderungen: Heißluftballon, südafrikanisch; Interview: Headset, Mikrofon | Vorschlag: Ballon bleibt, Mikrofon dazu |
| 13 | neu: vier gestempelte Hemden, Siegel (Vorschlag), n8n-Dashboard: Kater am Schreibtisch mit Laptop und Brille | Vorschlag nicht abgenommen |
| 14 | Infra: Rücken zum Betrachter an der Konsole, Kraftwerk-Stil | – |

Die Sprecherrollen der neuen Posts sind im Produktionschat gegen die vorhandenen Stimmen (Ben, Muriel, Alicia, Camille, Walter, Grace, Isla, Theo, Lily, Marcus, Nova, Leo) zu prüfen.

## Intro/Outro und Bildwelt (für alle Videos)
- 4:5, Englisch, Voice-over, Musik, keine Untertitel. Rahmung: mögliche Designvorschläge im Rahmen eines MVP, kein SAP-Produkt, Beispieldaten.
- Lavendel-Hintergrund, Titel "A Design Study. / Joule X. / Just Engineered.", violetter 3D-Diamant an einer Wäscheleine. Am Ende fällt der Diamant und rollt ins Mausloch, danach die lila Seite mit Accenture-Logo (bisher Text-Platzhalter).
- Trademark-Footer ("Design study · Personal view · Sample data · SAP and Joule are trademarks of SAP SE") am Anfang und am Ende.
- Accenture-Violett, kein Rot (Ausnahme: der rote Schal in Post 10).
- Der Kater ist in groben Pixeln gezeichnet, eine eigene Figur ohne Anlehnung an bestehende Maskottchen. Jede Folge hat ihre eigene Wäsche und ihren eigenen Kater-Gag.

## Wäsche, Kater und Musik der bestehenden Posts (alte Nummern, Zuordnung zu den neuen Nummern oben)

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

## Auftrag: Serien-Trailer mit 14 Folgen (neu)
- 4:5, ca. 70 s, keine Untertitel. Intro und Outro wie in den Posts (Footer, Diamant, Mausloch, Accenture-Seite).
- Stimme: weiblich, mittleren Alters, energiegeladen, empathisch, warm, leicht sinnlich, sehr klar gesprochen, leichter amerikanischer Akzent, weniger synthetisch.
- Musik: eigener Track, moderner melodischer Afro-House mit Mainstream-Dance-Appeal (Black Coffee, David Guetta), 122 bis 124 BPM; Filter-Intro, Riser, Drop bei der Montage, Break vor der Hook-Frage. Kein bekannter Titel, keine geschützte Melodie.
- Hook: "Fourteen deep dives. One purple diamond." Die Frage nach dem Diamanten wird erst im letzten Post beantwortet.
- Je Teaser ca. 3 s mit unscharfem Screen-Ausschnitt und großer Nummer; Teaser sprechen die Frage des Managers an, nicht den Namen des Space.

| Zeit | Sprechertext |
|---|---|
| 0:00–0:08 | "What if working with Joule felt completely different?" |
| 0:08–0:15 | "Fourteen deep dives. One purple diamond. And a few things you won't see coming." |
| 1 | "First: a tour of what could be." |
| 2 | "A chat that shows what it knows. And you set the rules." |
| 3 | "Your own page, in minutes. Inside the rules." |
| 4 | "Turn good practice into skills everyone can trust." |
| 5 | "Do your people and your agents mean the same thing?" |
| 6 | "From the first posting to the first day." |
| 7 | "When does revenue count? See it, step by step." |
| 8 | "Are you ready to close? Know days before." |
| 9 | "Know who pays late, before they do." |
| 10 | "One customer. One story." |
| 11 | "Hundreds of renewals. Nothing slips." |
| 12 | "From a spoken wish to a build-ready spec." |
| 13 | "Prove what your agents did." |
| 14 | "And IT operations? They talk back." |
| 0:57–1:03 | "Which one are you most curious about? Follow along. Episode one is next!" |
| 1:03–1:12 | Outro: "And where did the diamond go? You'll see." |

## Auftrag: Prozessinterview und n8n-Workflow (Teil von Post 12, bisher Post 13/17)
Gleiches Intro und Outro wie die anderen Posts. Das Interview ist jetzt die erste Szene von Post 12 (Vom Wunsch zur Spezifikation) und kein eigener Post mehr; es muss in rund 40 Sekunden erzählt werden. Wäsche, Kater-Gag, Erzähler und Musik sind noch festzulegen (Vorschläge: eine eigene Wäsche, ein eigener Gag und eine eigene Stimme, damit sich Post 13 von den Nachbarn abhebt).

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
