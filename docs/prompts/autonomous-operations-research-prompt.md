# Forschungs-Prompt für Claude Code: Autonomous Operations

Zum Einfügen in eine neue Claude-Code-Sitzung im Repo `ai-control-tower-workbench`. Stand 12.11.2026. Der Prompt arbeitet in zwei Stufen: erst Bestandsanalyse und Machbarkeit, dann Roadmap. Er baut nichts.

---

## Prompt

Du arbeitest im Repo `ai-control-tower-workbench` (Werkbank). Lies zuerst `CLAUDE.md` und halte dich an dessen Regeln: Deutsch mit mir, UI-Texte Englisch, erst Konzept, kleine Schritte, committen, pushen, mergen und löschen nur auf mein Wort, eigener `git worktree`, ehrlich dokumentieren, was nicht getestet ist.

### Ziel
Erarbeite eine belastbare Antwort auf zwei Fragen, in dieser Reihenfolge:
1. **Was ist bei Autonomous Operations tatsächlich machbar**, nachdem du analysiert hast, was schon existiert?
2. **Wie sieht eine Umsetzungs-Roadmap** auf Basis dieser Machbarkeit aus?

Nichts darf in Stufe 2 stehen, was Stufe 1 nicht trägt.

### Stufe 1: Bestand und Machbarkeit
**Bestand lesen, nicht voraussetzen.** Autonomous Operations ist die Domäne mit mehreren Spaces und einer Story (`docs/infra-ops-story.md`; Spaces unter `examples/`: `infra-wiki`, `it-fleet`, `it-infrastructure`, `infra-ops` mit Alerts und Service Requests, `infra-rca`, `infra-hotline`, `infra-ops-control`, dazu die Story-Leiste `examples/shared/infra-story.html`). Lies außerdem `docs/status/look-and-spaces.md` und `docs/status/dashboards-observability.md` (n8n, Agent Observability), die Connectoren in `connectors/` (vor allem n8n Automation) und `docs/agent-network.md`.

1. **Bestandsaufnahme je Baustein** (Wiki/SOP, Fleet, Kunden-VMs, Alerts, RCA, Service Request, Hotline, Auto-fix): Was zeigt er, woher kommen die Daten, was ist **echt**, was **simuliert** (Mock-Agent, erfundene Daten, keine Telefonie, keine echte Ausführung), was steht in den Tests, was fehlt. Belege jede Aussage mit Datei und Zeile.
2. **Fähigkeiten-Matrix:** Für jeden Schritt der Story (erkennen, einordnen, Ursache finden, Änderung vorbereiten, freigeben, ausführen, prüfen, Nachweis, Kunde informieren) die Stufe der Autonomie: *Mensch macht alles*, *Agent schlägt vor*, *Agent führt nach Freigabe aus*, *Agent führt selbst aus*. Zeige Ist-Stand und das, was heute realistisch erreichbar ist.
3. **Machbarkeit prüfen** je Fähigkeit mit den Kategorien *sofort mit dem Bestand*, *mit Anbindung eines echten Systems*, *braucht neue Plattform oder Genehmigung*, *nicht ratsam*. Für jede Anbindung: welches echte System (Monitoring, Ticketsystem, Konfigurationsverwaltung, Zertifikatsstelle, Telefonie), welche Schnittstelle, welche Berechtigung, welche Sicherheits- und Compliance-Frage (Trennung von Anfordern und Freigeben, Nachweis, Datenschutz, Aufzeichnungseinwilligung bei Sprache, Alert-Text als nicht vertrauenswürdige Eingabe).
4. **Recherche extern, wo nötig:** Wie machen es etablierte Ansätze (AIOps, Runbook-Automatisierung, selbstheilende Infrastruktur, KI-Sprachagenten für Serviceanrufe)? Nenne Quellen mit Datum, trenne Herstellerangaben von unabhängigen Belegen, und sage, wo die Evidenz dünn ist.
5. **Risiken und Ausschlüsse:** Was darf ein Agent in Produktion nie allein tun? Was sind Fehlerfolgen (falscher Neustart, falscher Zeitpunkt, falsche Zusage an den Kunden)? Welche Schutzmaßnahmen existieren schon in der Demo, welche müssten echt werden?

**Ergebnis Stufe 1:** eine Machbarkeitsaussage in drei Sätzen plus die Matrix. **Halte hier an und lege sie mir vor, bevor du Stufe 2 schreibst**, wenn die Machbarkeit eine Entscheidung von mir verlangt (z. B. Anbindung eines echten Systems).

### Stufe 2: Umsetzungs-Roadmap
Nur auf Basis dessen, was Stufe 1 als machbar ausweist.
1. **Phasen** in kleinen Schritten (je Phase: Ziel, Lieferergebnis, was danach anders ist, Abhängigkeiten, Aufwand in Größenordnung, Messgröße, Abbruchkriterium). Beginne mit dem, was ohne echte Systeme einen Mehrwert zeigt, und führe echte Anbindungen erst ein, wenn die Schutzmaßnahmen stehen.
2. **Zuordnung zum Bestand:** je Phase, welche vorhandenen Spaces, Connectoren und Tests erweitert werden und was neu entsteht.
3. **Entscheidungen und Voraussetzungen** für mich, getrennt von dem, was du allein erledigen kannst.
4. **Teststrategie je Phase:** was in der Werkbank mit Fake-Daten prüfbar ist, was nur gegen ein echtes System prüfbar wäre und deshalb als „nicht getestet“ ausgewiesen bleibt.
5. **Offene Fragen** und eine Liste dessen, was in dieser Roadmap bewusst fehlt.

### Ergebnis
Lege **ein** Dokument `docs/autonomous-operations-roadmap.md` an (Deutsch, Tabellen, kurz): Bestand, Matrix, Machbarkeit, Quellen, Roadmap, offene Fragen, **Nicht geprüft**. Eigener Worktree, neuer Branch. Committe und pushe erst auf mein Wort. Schließe im Chat mit höchstens zehn Zeilen: Machbarkeitsaussage, erste Phase, die eine Entscheidung, die ich treffen muss.

### Grenzen
- Jede Aussage über den Bestand mit Datei als Beleg. Jede Zahl aus externer Quelle mit Quelle und Datum, jede eigene Schätzung als Annahme.
- Nichts bauen, keine echten Systeme ansprechen, nicht gegen Supabase schreiben.
- Die Demo ist ausdrücklich erfunden (kein Live-Monitoring, keine echte Ausführung, keine Telefonie). Behandle sie nicht als Beleg für Machbarkeit im Betrieb.

---

## Hinweise zur Nutzung
- Die Reihenfolge ist Absicht: Erst klären, was machbar ist, dann planen. Der Haltepunkt nach Stufe 1 verhindert eine Roadmap auf unsicherer Grundlage.
- Der Aufbau folgt dem Renewal-Prompt (`renewals-review-prompt.md`), damit beide gleich behandelt werden.
