# Autonomous Operations: Bestand und Machbarkeit (Stufe 1)

Stand 12.11.2026. **Nur Stufe 1** des Prompts `docs/prompts/autonomous-operations-research-prompt.md`: Bestand, Matrix, Machbarkeit, Quellen, Risiken. Die Roadmap (Stufe 2) folgt erst nach der Entscheidung am Ende, weil sie eine echte Anbindung betrifft. Nichts gebaut, kein echtes System angesprochen, nichts in Supabase geschrieben.

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

## Entscheidung, bevor Stufe 2 geschrieben wird
**Soll die Roadmap bis zu einer ersten echten Anbindung führen, und wenn ja, an welches System zuerst?**
Empfehlung: **lesend an das Monitoring** (kein Schreibrecht, kein Risiko für Kunden) plus **n8n/AWX im Check-Modus** (der Weg existiert schon: `submit_infra_change`, Workflow `08-infra-change-request.json`); Sprache und automatische Ausführung bleiben Demo, bis Recht und Genehmigung geklärt sind. Alternative: die Roadmap bleibt bei der Demo und schärft nur Qualität und Messbarkeit.

## Nachtrag 12.11.2026: Entscheidung und was seitdem gebaut ist
- **Richtung (Hans-Peter):** Der reaktive Teil ist in der Demo gut abgebildet; gebaut werden soll ein **proaktiver Orchestrator-Agent** mit einem Schalter *Human in the loop* (an/aus). Gewählt: aus heißt "mit Untergrenze" (hohes Risiko, Produktion über niedrigem Risiko, Kundenfenster, Freeze und Nächte, nicht erreichbare Frist und kein Wiederholen lassen sich nicht abschalten) und ein Hauptschalter plus Matrix je Task und Kunde.
- **Gebaut (PR #335):** Space `infra-orchestrator`, Schritt 9 der Story-Leiste, simuliert und mit erfundenen Befunden (Details `docs/infra-ops-story.md`, Akt 8). Er ändert nichts an der Machbarkeitsaussage oben: ein Beleg für den Betrieb ist er nicht.
- **Weiter offen:** die Frage nach der ersten echten Anbindung (Empfehlung: Monitoring lesend plus n8n/AWX im Check-Modus) und damit Stufe 2 (die eigentliche Roadmap). Die Tabellen oben nennen den Orchestrator noch nicht als Baustein.

## Nicht geprüft
Alle Aussagen über den Bestand sind aus dem Code und den Dokumenten gelesen, nicht in der Electron-App ausprobiert. Der n8n-Workflow wurde nicht gegen einen echten n8n-Server gelaufen. Externe Quellen: nur über die Websuche gelesen, nicht im Original geprüft; Datumsangaben teils aus der Adresse abgeleitet. Rechtliche Aussagen sind kein Rechtsrat.
