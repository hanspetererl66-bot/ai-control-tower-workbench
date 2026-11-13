# Autonomous Operations: Bestand, Machbarkeit und Roadmap

Stand 12.11.2026. Stufe 1 (Bestand, Matrix, Machbarkeit, Quellen, Risiken) und Stufe 2 (Roadmap, ab Abschnitt "Stufe 2") des Prompts `docs/prompts/autonomous-operations-research-prompt.md`. Entscheidung von Hans-Peter am 12.11.2026: **erste echte Anbindung = Monitoring lesend plus n8n im Check-Modus**; Sprache und automatische Ausführung bleiben Demo. Nichts gebaut, kein echtes System angesprochen, nichts in Supabase geschrieben.

## Machbarkeitsaussage (drei Sätze)
1. Ohne echte Systeme ist der **Ablauf** (erkennen, einordnen, Ursache, Service Request, Fensterabsprache, Prüfung, Nachweis) heute belastbar als Demo mit erfundenen Daten und durchgesetzten Regeln (Vier-Augen, Policy, Freeze, Schutz vor Anweisungen im Alert-Text); als Betriebsnachweis taugt er nicht.
2. Realistisch erreichbar ist **"Agent schlägt vor, Mensch gibt frei, Automatisierung führt aus"** für wenige, vorher festgelegte Runbooks (Zertifikat erneuern, VM patchen) mit echter Anbindung von **Monitoring (lesend)**, **n8n/AWX im Check-Modus** und **Ticketsystem**; "Agent führt selbst aus" ist nur für eine kleine Liste risikoarmer Runbooks mit Rücknahme vertretbar und braucht eine Genehmigung außerhalb der Werkbank.
3. Der **KI-Sprachagent gegenüber echten Kunden** ist der schwächste Baustein: Telefonie, Kennzeichnung als KI, Aufzeichnungs-Einwilligung und die Zusage eines Fensters sind rechtlich und fachlich offen, deshalb nicht ratsam, bevor sie geklärt sind.

## Bestand je Baustein (echt oder simuliert)
Alle Spaces sind Einzeldateien ohne Netzwerk (`examples/*/index.html`, Kopfkommentar Zeile 10). Wirklich echt sind nur drei Dinge, alle mit Voraussetzungen: das Werkzeug `submit_infra_change` (sendet nach n8n, immer im Check-Modus, nur mit gesetzter Webhook-Adresse), das Werkzeug `read_wiki_page` (liest die erfundenen Wiki-Seiten) und seit PR #328 die Bestätigungsmail der Hotline (Gmail, nur an eine lokale Testadresse, mit Dialog).

| Baustein | Was er zeigt | Daten | Echt / simuliert | Tests | Es fehlt |
| --- | --- | --- | --- | --- | --- |
| Wiki/SOP (`infra-wiki`) | zwei SOP-Seiten, Schritt für Schritt | `pages.json` erfunden | simuliert; Tool `read_wiki_page` liest nur diese Datei (`connectors/_lib/server/infra-ops.mjs:277`) | `test/infra-story.test.mjs`, `test/infra-ops-sop.test.mjs` | echtes Wiki, Versionierung, Pflege |
| Fleet (`it-fleet`) | 41 Kunden, ca. 1.200 VMs, Treemap, Heatmap | `fleet.json` erfunden | simuliert | `test/it-fleet.test.mjs` | Inventar (CMDB), echte Gesundheitswerte |
| Kunden-VMs (`it-infrastructure`) | 25 VMs, Ampel mit Begründung, empfohlene Aufgaben | `vms.json` erfunden | simuliert | `test/it-infrastructure.test.mjs` | Anbindung an Monitoring |
| Alerts (`it-operations`) | sieben Alarme, Priorität P1 bis P3, Schutz vor eingeschleusten Anweisungen (`index.html:449`), Knopf "Run in n8n" | `alerts.json` erfunden, "no live monitoring" (`:316`) | Regeln echt (laufen im Test), Alarme erfunden; n8n-Workflow `04-it-operations-alert-triage.json` vorhanden | `test/it-operations.test.mjs` | Monitoring-Feed, Deduplizierung, Bereitschaft (On-call) |
| RCA (`infra-rca`) | Ursache, Belege mit Zitat, Konfidenz, Next best action | 9 Fälle, 6 Dokumente erfunden | Agent ist ein Mock (Signal- und Schlagwortabgleich, `index.html:1266`); Dokumente mit KI-Anweisungen werden zurückgehalten (`:1212`) | `test/infra-rca.test.mjs` | echte Fall-Datenbank, Volltextsuche, ein echtes Modell, Messung der Trefferqualität |
| Service request (`infra-ops`) | Plan, Pre-Check, zwei Freigaben, simulierte Ausführung, Nachweis | `data.json` erfunden | Regeln echt (Requester darf nicht freigeben, `infra-ops.mjs:209`); Ausführung simuliert (`index.html:408`); Übergabe an n8n im Check-Modus möglich (`infra-ops.mjs:271`, Webhook `:299`) | `test/infra-ops.test.mjs`, `test/infra-ops-links.test.mjs` | ITSM-Ticket, echte Freigabe über Teams, AWX-Lauf, Rückmeldung des Ergebnisses |
| Hotline (`infra-hotline`) | Policy je Task und Kunde, simulierter Sprachagent, Operator bestätigt | `data.json` erfunden | Regeln echt (`checkSlot` `:710`, `needsAgreement` `:687`); kein Anruf, keine Telefonie; Mail an Kunden nur an Testadresse | `test/infra-hotline.test.mjs`, `test/hotline-mail*.test.mjs` | Telefonie, KI-Kennzeichnung, Aufzeichnungs-Einwilligung, Rückfall auf Mensch im Betrieb |
| Auto-fix (`infra-ops-control`) | ein Klick, sieben Schritte, Nachweis, Mail-Vorschau | `data.json` erfunden | simuliert; Freigabe "auto (policy)" (`index.html:1216`) | `test/infra-ops-control.test.mjs` | echte Ausführung, Rücknahme, Policy für automatische Freigabe (eigene Entscheidung) |

Nicht in der Werkbank: Nachweis der Wirksamkeit im Betrieb, Kennzahlen aus echten Vorfällen, echte Zertifikatsstelle (z. B. ACME), Konfigurationsverwaltung.

## Fähigkeiten-Matrix
Stufen: **M** Mensch macht alles, **V** Agent schlägt vor, **F** Agent führt nach Freigabe aus, **S** Agent führt selbst aus.

| Schritt | Demo heute | Realistisch erreichbar | Kategorie |
| --- | --- | --- | --- |
| Erkennen | V (erfundene Alarme) | V, später S für Einordnen | mit Anbindung eines echten Systems (Monitoring, lesend) |
| Einordnen | S (feste Regeln P1 bis P3) | S mit Regeln, Mensch bei P1 | sofort mit dem Bestand, nach Feed |
| Ursache finden | V (Mock) | V mit echter Fall-Datenbank und Modell, immer mit Beleg | mit Anbindung (Ticketsystem, Wiki) |
| Änderung vorbereiten | V (Plan, Pre-Check) | V gegen echtes Inventar | mit Anbindung (CMDB) |
| Freigeben | M (zwei Rollen) | M bleibt; automatische Freigabe nur für Liste risikoarmer Runbooks | braucht Genehmigung (Change-Prozess) |
| Ausführen | simuliert | F über AWX nach Freigabe; S nur für kleine Liste mit Rücknahme | braucht Genehmigung, nicht ratsam für Produktion ohne Rücknahme |
| Prüfen | S (Regeln) | S (Health- und Zertifikatschecks) | mit Anbindung (AWX, Monitoring) |
| Nachweis | S (Protokoll im Space) | S, unveränderlich gespeichert | mit Anbindung (Datenbank, Archiv) |
| Kunde informieren | Mail V + Dialog; Anruf simuliert | Mail F (Dialog) mit echtem Empfänger; Anruf nicht ratsam | Mail: mit Anbindung; Sprache: nicht ratsam, bis Recht und Telefonie geklärt sind |

Je Anbindung die offenen Fragen: **Monitoring** (Schnittstelle lesend, Berechtigung nur Lesen; Alert-Text ist nicht vertrauenswürdig), **Ticketsystem/ITSM** (Anlegen und Schließen, Nachweis, Trennung von Anfordern und Freigeben), **AWX/Ansible** (Job-Vorlagen mit geprüften Parametern, Check-Modus zuerst, Snapshot und Rollback), **Zertifikatsstelle** (Schlüsselverwaltung, wer darf ausstellen), **Telefonie** (Anbieter, Nummer, Kennzeichnung als KI, Aufzeichnung, Datenschutz).

## Externe Recherche (Datum, Art der Quelle)
Die Beleglage ist **dünn**: fast alles sind Hersteller- und Praxisblogs. Zahlen daraus habe ich nicht übernommen.

| Aussage | Quelle | Art, Datum |
| --- | --- | --- |
| Von Menschen festgelegte Runbooks sind die Kontrollinstanz; der Agent wählt nur aus vorab erlaubten Abhilfen | [Akuity-Beispiel bei TFiR](https://tfir.io/ai-autonomous-incident-response-human-runbooks-akuity/) | Herstellernah, Datum nicht geprüft |
| Runbook als Brücke zwischen Mensch und Agent hält den Ablauf erklärbar | [Amazon Science, IEEE CogMI 2025 (PDF)](https://cdn.amazon.science/78/ae/133af2444c9f98d4dd40d025751f/scipub-approval152129-40856700-humanintheloop-runbook-improvement-with-agentic-support-automation.pdf) | Fachveröffentlichung 2025, glaubwürdigste Quelle hier |
| Autonomie nach Risiko abstufen, hohe Risiken mit Mensch | [arXiv 2602.02585](https://arxiv.org/pdf/2602.02585) | Vorabdruck, Februar 2026 (aus der Kennung), nicht begutachtet |
| Für wenige risikoarme Runbooks darf der Agent allein handeln; jede Entscheidung und jeder Beleg wird protokolliert; Wiederholschleifen bei Werkzeugfehlern sind eine Gefahr | [tianpan.co](https://tianpan.co/blog/2026-04-12-ai-assisted-incident-response-giving-your-on-call-agent-a-runbook) | Praxisblog, 12.04.2026 (aus der Adresse) |
| KI-Sprachagenten müssen sich als KI zu erkennen geben (EU AI Act Art. 50, laut Quellen ab 02.08.2026); Aufzeichnungs-Einwilligung ist getrennt zu regeln (ePrivacy, DSGVO) | u. a. [Telnyx](https://telnyx.com/resources/eu-ai-act), [Famulor](https://www.famulor.io/blog/digital-omnibus-2026-new-ai-act-timeline-for-voice-agents) | **Anbieter, die Compliance-Werkzeuge verkaufen**, kein Rechtsrat; Datum und Geltung am Originaltext (Verordnung (EU) 2024/1689) zu prüfen |

Wo die Evidenz fehlt: unabhängige Messungen, wie viel automatisch gelöst wird und wie oft die Automatik falsch liegt; Fehlerquoten von KI-Sprachagenten bei Terminzusagen.

## Risiken und Ausschlüsse
| Was ein Agent in Produktion nie allein tun darf | Fehlerfolge | Schutz in der Demo | Müsste echt werden |
| --- | --- | --- | --- |
| Ein Fenster für Wartung zusagen | falsche Zusage an den Kunden, Vertragsverletzung | Agent setzt nie selbst ein Fenster, Operator bestätigt (`infra-hotline`) | Bestätigung durch eine benannte Person mit Protokoll |
| Neustart, Patch oder Umzug im falschen Zeitraum | Ausfall, Freeze verletzt | `checkSlot`: Nächte, Freeze, Vorlauf | Freeze-Kalender aus einer echten Quelle, Prüfung zum Ausführungszeitpunkt |
| Eigene Änderung freigeben | Umgehung der Trennung von Anfordern und Freigeben | technisch erzwungen (`infra-ops.mjs:209`) | gleiche Regel im ITSM, Identität nicht nur eine E-Mail |
| Anweisungen aus Alert- oder Dokumenttext ausführen | eingeschleuste Befehle | Alert und Dokument mit KI-Anweisung werden zurückgehalten (`it-operations:449`, `infra-rca:1212`) | zusätzlich Trennung der Rechte: der Agent hat keine Schreibrechte außerhalb seiner Liste |
| Mail an Kunden senden | falscher Inhalt oder Empfänger | Text fest, Empfänger nur lokale Testadresse, Dialog, Protokoll (PR #328) | echte Empfängerliste je Kunde, Freigabe des Textes |
| Wiederholter Fehlversuch (Retry-Sturm) | Folgeschäden | keine echte Ausführung | Obergrenze für Versuche, Abbruch und Eskalation |
| Anruf ohne Kennzeichnung oder Einwilligung | Rechtsverstoß | kein Anruf | Kennzeichnung, Einwilligung, Anbieter, Aufbewahrung |

## Entscheidung (am 12.11.2026 getroffen)
**Soll die Roadmap bis zu einer ersten echten Anbindung führen, und wenn ja, an welches System zuerst?**
Empfehlung: **lesend an das Monitoring** (kein Schreibrecht, kein Risiko für Kunden) plus **n8n/AWX im Check-Modus** (der Weg existiert schon: `submit_infra_change`, Workflow `08-infra-change-request.json`); Sprache und automatische Ausführung bleiben Demo, bis Recht und Genehmigung geklärt sind. Alternative: die Roadmap bleibt bei der Demo und schärft nur Qualität und Messbarkeit.

## Nachtrag 12.11.2026: Entscheidung und was seitdem gebaut ist
- **Richtung (Hans-Peter):** Der reaktive Teil ist in der Demo gut abgebildet; gebaut werden soll ein **proaktiver Orchestrator-Agent** mit einem Schalter *Human in the loop* (an/aus). Gewählt: aus heißt "mit Untergrenze" (hohes Risiko, Produktion über niedrigem Risiko, Kundenfenster, Freeze und Nächte, nicht erreichbare Frist und kein Wiederholen lassen sich nicht abschalten) und ein Hauptschalter plus Matrix je Task und Kunde.
- **Gebaut (PR #335):** Space `infra-orchestrator`, Schritt 9 der Story-Leiste, simuliert und mit erfundenen Befunden (Details `docs/infra-ops-story.md`, Akt 8). Er ändert nichts an der Machbarkeitsaussage oben: ein Beleg für den Betrieb ist er nicht.
- **Entschieden:** erste echte Anbindung = Monitoring lesend plus n8n im Check-Modus; die Roadmap steht unten (Stufe 2). Die Tabellen von Stufe 1 nennen den Orchestrator noch nicht als Baustein.

## Stufe 2: Umsetzungs-Roadmap
Grundlage ist allein, was Stufe 1 als machbar ausweist: **Agent schlägt vor, Mensch gibt frei, Automatisierung führt aus**, für wenige festgelegte Runbooks (Zertifikat erneuern, VM patchen); echte Anbindung nur **lesend** (Monitoring) und **im Check-Modus** (n8n mit AWX). Aufwände sind **Annahmen** (Größenordnung in Personentagen für eine Person mit dem Repo vertraut, ohne Wartezeiten auf Zugänge).

### Phasen
| Phase | Ziel | Lieferergebnis | Danach anders | Abhängigkeiten | Aufwand (Annahme) | Messgröße | Abbruchkriterium |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **0 Messbar und lernend (nur Demo)** | Lücken des reaktiven Teils schließen, ohne ein echtes System | Kennzahlen (MTTR, Anteil vom Agenten gelöst, Anteil zurückgerollt) im Orchestrator und in Auto-fix; Ergebnis eines Service Requests fließt als neuer Fall in die RCA-Datenbank; Alarme mit gleichem Host und Signal werden zu einem Vorfall zusammengeführt; Fristen mit Eskalation ("niemand hat freigegeben") | Autonomie lässt sich an Zahlen beurteilen, bevor etwas Echtes angebunden wird | keine | 5 bis 8 | Kennzahlen vorhanden und im Test stabil; "Seen before" findet den neuen Fall | Zahlen lassen sich in der Demo nicht aussagekräftig erzeugen: dann Phase 1 trotzdem, aber Kennzahlen erst aus echten Daten |
| **1 Monitoring lesend** | echte Alarme und Messwerte in die Werkbank holen, nichts schreiben | neuer Connector `monitoring-read` (nur Lesen) und eine feste Brücke `mon:*` Space → Hauptprozess (wie `src/onboarding-bridge.ts`, der Agent hat kein Werkzeug dafür); Abbildung auf das Befund-Format des Orchestrators und das Alarm-Format von `it-operations`; Alert-Text bleibt nicht vertrauenswürdig (Wächter aus `it-operations/index.html:449`) | Alerts-Space und Orchestrator zeigen echte Daten (Kennzeichen "live data"), Demo-Daten bleiben als Rückfall | **Entscheidung 1 und 2** (welches Monitoring, Lesetoken); Netzfreigabe vom Hauptprozess aus | 8 bis 12 | Anteil der Alarme, die richtig abgebildet sind (Stichprobe von Hand); Latenz bis zur Anzeige | Das Monitoring liefert keinen reinen Lesezugang oder keine verwertbaren Kennwerte: Abbruch, kein Schreibzugang als Ersatz |
| **2 Schattenbetrieb** | Orchestrator auf echten Befunden, aber ohne jede Aktion | Sweep über echte Befunde; Vorschläge und Entscheidungen im Audit-Log (neue Tabelle in Supabase, nur anhängbar, nach dem Muster `recruiting.onboarding_event`); Mensch vergleicht mit seiner eigenen Entscheidung (stimmt / stimmt nicht) | Belastbare Zahl, wie oft der Agent richtig vorschlägt und die Untergrenzen richtig greifen | Phase 1; **Entscheidung 3** (wer bewertet) | 6 bis 10, dazu 2 bis 4 Wochen Laufzeit | Anteil richtiger Vorschläge; Anteil, bei dem eine Untergrenze fälschlich nicht gegriffen hat (Ziel: 0) | Eine Untergrenze greift in der Stichprobe auch nur einmal falsch nicht: Stopp, Regel korrigieren, Phase neu starten |
| **3 n8n im Check-Modus** | Plan eines Service Requests geht echt durch n8n und AWX im Check-Modus, das Ergebnis kommt zurück | `submit_infra_change` (vorhanden, `connectors/_lib/server/infra-ops.mjs:271`) auf eine **Testinstanz** von n8n und AWX; Workflow `08-infra-change-request.json` mit Rückmeldung des Check-Ergebnisses an die Werkbank (Rücksprung-Webhook oder Abfrage über `list_n8n_executions`); der Pre-Check im Service Request zeigt das echte Ergebnis | Der Pre-Check ist nicht mehr erfunden, sondern ein echter `--check --diff`-Lauf | **Entscheidung 4 und 5** (Testinstanzen, Ticket- und Teams-Ziel); Phase 1 nicht zwingend | 8 bis 12 | Anteil der Check-Läufe, deren Ergebnis richtig in der Werkbank steht; Laufzeit | n8n oder AWX lassen sich nicht ohne Schreibwirkung außerhalb des Check-Modus betreiben |
| **4 Freigabe und Nachweis echt** | Vier-Augen und Nachweis nicht mehr nur im Space | Freigabe über das Ticket- oder Teams-Ziel von Phase 3 mit einer Identität, die mehr ist als eine E-Mail; Nachweis (Plan, Check-Ergebnis, Freigeber, Zeit) unveränderlich in Supabase | Der Nachweis ist auditierbar | Phase 3; **Entscheidung 6** (Identität) | 6 bis 10 | Anteil der Läufe mit lückenlosem Nachweis (Ziel: alle) | Es gibt keine tragfähige Identität: bei E-Mail-Etikett bleibt der Nachweis ein Hinweis, nicht ein Beleg, und Phase 4 wird gestrichen |
| **5 Echte Ausführung (nicht zugesagt)** | prüfen, ob für wenige risikoarme Runbooks in **Nicht-Produktion** die Ausführung nach Freigabe vertretbar ist | nur eine Entscheidungsvorlage mit den Ergebnissen aus Phase 2 bis 4 | eine Entscheidung mit Zahlen statt Bauchgefühl | Phasen 2 bis 4 abgeschlossen; Genehmigung außerhalb der Werkbank | 2 (Vorlage) | Ergebnis der Phasen 2 bis 4 | Die Zahlen tragen die Entscheidung nicht: bleibt bei "Agent schlägt vor, Mensch führt aus" |

Phase 0 kann sofort beginnen und ist unabhängig von Zugängen; 1 und 3 können parallel laufen, sobald die Entscheidungen da sind. Echte Anbindungen kommen erst, wenn ihre Schutzmaßnahmen stehen: Phase 1 nur Lesen (Token ohne Schreibrecht), Phase 3 nur Testinstanzen.

### Zuordnung zum Bestand
| Phase | Erweitert | Neu |
| --- | --- | --- |
| 0 | `infra-orchestrator`, `infra-ops-control`, `infra-rca` (Fälle), `it-operations` (Zusammenführen); Tests `test/infra-orchestrator.test.mjs`, `test/infra-rca.test.mjs` | Kennzahlen-Logik zwischen `@logic-start`/`@logic-end`, Test dazu |
| 1 | `it-operations` und `infra-orchestrator` lesen "live data" statt `alerts.json`/`data.json`; Muster `src/onboarding-bridge.ts`, `electron/main.mjs` (IPC), `electron/preload.cjs` | `connectors/monitoring-read/`, `src/monitoring-bridge.ts`, Abbildungs-Modul mit Test |
| 2 | `infra-orchestrator` (Schattenmodus-Schalter, Vergleich), Muster `supabase/migrations/20261108_039_onboarding.sql` | Migration (Audit-Tabelle, nur anhängbar), Funktionen nur für `service_role` |
| 3 | `connectors/_lib/server/infra-ops.mjs`, `examples/n8n-workflows/08-infra-change-request.json`, `infra-ops` (Pre-Check) | Rücksprung im Workflow, Auswertung des Ergebnisses mit Test |
| 4 | `infra-ops` (Freigabe), Migration aus Phase 2 | Identitätsanbindung (je nach Entscheidung 6) |

### Entscheidungen und Voraussetzungen
**Von Hans-Peter** (Zugänge und Genehmigungen, nicht durch mich zu klären):
1. **Welches Monitoring** wird angebunden (Name, Version) und gibt es eine Testumgebung oder nur Produktion?
2. **Lesetoken** ohne Schreibrecht und Freigabe des Netzwegs vom Hauptprozess; welche Felder dürfen die Werkbank verlassen (Datenschutz, Kundennamen)?
3. **Wer bewertet** im Schattenbetrieb die Vorschläge, und wie lange läuft er?
4. **Testinstanzen** von n8n und AWX (kein Produktivsystem) und Zuständigkeit dafür.
5. **Ziel für Ticket und Teams** im Test: ein Sandbox-Ticketsystem und ein Testkanal. Wichtig: im Workflow `08` ist nur der AWX-Lauf ein Check-Lauf; **"Create ticket" und "Ask for approval in Teams" sind echte Schreibzugriffe** (`examples/n8n-workflows/08-infra-change-request.json`).
6. **Identität** für die Freigabe (Phase 4): Anmeldung oder weiter nur E-Mail-Etikett.

**Allein von mir erledigbar:** Phase 0 vollständig; Abbildungs- und Brückencode samt Tests gegen Fake-Daten (Phase 1); Audit-Migration samt SQL-Tests mit Wegwerf-Datenbank (Phase 2); Auswertung des Check-Ergebnisses (Phase 3).

### Teststrategie je Phase
| Phase | In der Werkbank mit Fake-Daten prüfbar | Nur gegen ein echtes System prüfbar (bleibt "nicht getestet") |
| --- | --- | --- |
| 0 | alles (jsdom, Logik-Tests) | Aussagekraft der Kennzahlen im Betrieb |
| 1 | Abbildung, Brücke, Datenminimierung, Wächter gegen eingeschleuste Anweisungen mit Fake-Antworten | Verbindung, Token, echte Feldformen, Last |
| 2 | Vergleichslogik, SQL (Wegwerf-Datenbank) | Trefferquote auf echten Befunden |
| 3 | Auswertung eines aufgezeichneten Check-Ergebnisses; Webhook mit Fake-Antwort | echter `--check --diff`-Lauf, Wirkung im Ticketsystem und in Teams |
| 4 | Nachweis-Format, Unveränderlichkeit | Identität und Rechte im echten System |

### Offene Fragen
- Was ist der Wert der Autonomie, den das Management sehen will (MTTR, Entlastung, Kosten)? Davon hängen die Messgrößen ab.
- Wie viele der 1.200 VMs der Demo stehen tatsächlich in der echten Landschaft, und welche Runbooks decken die häufigsten Befunde ab?
- Gibt es bereits eine Alarm-Deduplizierung im Monitoring, die wir nicht doppelt bauen sollen?
- Wer pflegt die Policy (Autonomie-Matrix, Fenster-Schwellen) im Betrieb, und wer genehmigt Änderungen?

### Was bewusst fehlt
Echte Ausführung (nur als Entscheidungsvorlage in Phase 5), Sprache und Telefonie (bleibt Demo, bis Recht und Anbieter geklärt sind), Mails an echte Kunden, Zertifikatsstelle und Schlüsselverwaltung, Anbindung eines Produktions-Ticketsystems, Mandantentrennung mehrerer Kunden in einer Installation, Kostenrechnung.

## Nachtrag Phase 1 (12.11.2026)
Entschieden: **neutrales Gerüst, minimale Felder.** Gebaut: Lesezugang `shared/monitoring-read.mjs` mit Adapter-Schnittstelle (nur `listAlerts`), Adapter `http-json`, Abbildung auf das Alarm-Format, feste Brücke `mon:*`, Alerts-Space mit *Load live alerts* (Anleitung `docs/monitoring-read.md`). **Abweichung von der Tabelle oben:** kein Connector für den Agenten, sondern ein Zugang nur für den Hauptprozess; der Orchestrator wird in Phase 1 nicht gespeist (minimale Felder liefern Alarme, keine Kennwerte). Danach gebaut: Einstellungsdialog für Zugang und Token (PR #370) und ein Adapter für Zabbix (13.11.2026, `docs/monitoring-read.md`). Offen: ein echter Test mit deinem Zabbix und einem Lese-Token. Nicht gegen ein echtes Monitoring getestet.

## Nicht geprüft
Aufwände und Abbruchkriterien der Roadmap sind Annahmen, keine Messung. Alle Aussagen über den Bestand sind aus dem Code und den Dokumenten gelesen, nicht in der Electron-App ausprobiert. Der n8n-Workflow wurde nicht gegen einen echten n8n-Server gelaufen. Externe Quellen: nur über die Websuche gelesen, nicht im Original geprüft; Datumsangaben teils aus der Adresse abgeleitet. Rechtliche Aussagen sind kein Rechtsrat.
