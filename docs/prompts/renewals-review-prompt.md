# Prompt für Claude Code: Renewal-Prozess prüfen und Agenten-Nutzen bewerten

Zum Einfügen in eine neue Claude-Code-Sitzung im Repo `ai-control-tower-workbench`. Stand 12.11.2026. Der Prompt baut nichts. Er liefert zuerst einen Befund, dann eine Entscheidungsvorlage. Gebaut wird erst nach Freigabe.

---

## Prompt

Du arbeitest im Repo `ai-control-tower-workbench` (Werkbank). Lies zuerst `CLAUDE.md` und halte dich an dessen Regeln: Deutsch mit mir, UI-Texte Englisch, erst Konzept, kleine Schritte, committen, pushen, mergen und löschen nur auf mein Wort, eigener `git worktree` statt Umschalten im geteilten Checkout, ehrlich dokumentieren, was nicht getestet ist.

### Ziel
Prüfe den Renewal-Prozess Ende zu Ende aus Sicht von **Account Executive und Sales Manager**, die damit arbeiten, und beurteile, ob ein oder zwei Agenten oder eine agentische Lösung darunter sich nach Rendite lohnen. Ergebnis ist ein Befund und eine Entscheidungsvorlage, kein Code.

### Was schon da ist (zuerst selbst lesen, nichts davon voraussetzen)
- Space `examples/renewals/index.html` (fünf Reiter), Logik in `examples/renewals/logic.js` (Gesundheit, Phasen, Angebotsalternativen, Auto-Prüfung, Kundensituation), Daten per `npm run sync:renewals` aus Sub4Me-Daten und Zusatzlisten in `scripts/sync-renewals.mjs`.
- Space `examples/renewals-analytics/` (Dashboard für den Sales Manager, lesend, Namen standardmäßig aus).
- Konzepte: `docs/renewals-konzept.md` (Kundenebene, Zufriedenheit als Churn-Signal, Recherche) und `docs/renewals-analytics-konzept.md`.
- Tests: `test/renewals.test.mjs`, `test/renewals-tabs.test.mjs`, `test/renewals-analytics.test.mjs`.
- Bekannte Lücken: Senden und Signieren sind simuliert, die Stufen liegen nur im Seitenspeicher, die Beispieldaten sind erfunden und dünn, Zufriedenheit fehlt noch, Kundenebene über mehrere Produkte ist erst teilweise gebaut. Prüfe, ob das heute noch stimmt.
- Vorhandene Agenten-Bausteine: sieh nach, was die Werkbank an Agenten, Agent-Netz, Registry, Connectoren und Skills bietet (`docs/agent-network.md`, `docs/agent-observability.md`, `connectors/`, `docs/skills-concept.md`), bevor du etwas Neues vorschlägst.

### Teil 1: Review Ende zu Ende
1. Gehe den Prozess als **Account Executive** durch: Was will ich morgens wissen, was muss ich heute tun, wie bereite ich ein Kundengespräch vor, wie hole ich ein Angebot, wie bekomme ich Freigabe, wie sehe ich Fortschritt? Wiederhole das als **Sales Manager**: Wo brennt es, wo fehlt Kapazität, was ist die Prognose, wo muss ich eingreifen?
2. Öffne beide Spaces tatsächlich (Playwright, hell und dunkel, Screenshots ansehen, Seitenfehler melden) und bewerte je Schritt: Klicks bis zum Ziel, Brüche zwischen Reitern, doppelte oder widersprüchliche Zahlen, Stellen ohne nächsten Schritt, Leerraum, Text vor Daten.
3. Erstelle eine Tabelle **Schritt × (manuell, halb, automatisch) × Rolle × Reibung**. Trenne ehrlich: was ist echt automatisiert (Berechnung auf der Seite), was nur simuliert, was fehlt.
4. Priorisiere Verbesserungen nach Nutzen für die zwei Rollen und Aufwand. Markiere, was ohne Agent geht.

### Teil 2: Lohnt sich ein Agent oder eine agentische Lösung?
1. Leite aus Teil 1 **Kandidaten** ab, zum Beispiel (nur wenn der Befund sie stützt): Vorbereitung des Kundengesprächs, Angebotsentwurf mit Preisprüfung gegen die Vertragsgrenze, Antwortentwurf auf Kundenmails, Erkennen von Churn-Signalen, Wochenbericht für den Sales Manager.
2. Je Kandidat: Aufgabe, Eingaben (welche Quellen sind in der Werkbank schon erreichbar), Ausgabe, wo der Mensch freigibt, was **nie** automatisch passiert (Senden, Preise, Freigaben), Risiken (falsche Zusage, Datenschutz, Prompt-Injection durch Kundenmails).
3. **Rendite rechnen, ohne Zahlen zu erfinden.** Nenne die Formel und die Eingangsgrößen (Zeit je Aufgabe, Häufigkeit, Kosten je Stunde, Modellkosten, Aufbau- und Betriebsaufwand, Fehlerkosten, gewonnener oder gehaltener Umsatz). Jede Eingangsgröße ist als **Annahme** zu kennzeichnen mit Quelle oder „zu erheben bei: …“. Rechne drei Szenarien (vorsichtig, erwartet, optimistisch) und zeige, ab welchem Wert der wichtigsten Annahme sich der Agent nicht mehr lohnt (Break-even).
4. Vergleiche **drei Optionen**: kein Agent (nur bessere Oberfläche), ein einzelner Assistent mit festen Aufgaben, mehrere Agenten oder ein agentischer Ablauf. Empfiehl eine Option oder „noch nicht“, mit Begründung.
5. Wenn du einen Agenten empfiehlst: kleinster sinnvoller erster Schritt, Messgröße für Erfolg, Abbruchkriterium.

### Ergebnis
Lege **ein** Dokument `docs/renewals-review.md` an (Deutsch, kurz, mit Tabellen) mit: Befund, priorisierte Verbesserungen, Kandidaten, Renditerechnung samt Annahmen, Empfehlung, offenen Fragen, **Nicht geprüft**. Schreibe es in einem eigenen Worktree auf einem neuen Branch. Committe und pushe erst auf mein Wort. Beantworte mir am Ende im Chat in höchstens zehn Zeilen: Empfehlung, die drei wichtigsten Befunde, die eine Entscheidung, die ich treffen muss.

### Grenzen
- Keine Zahl ohne Quelle oder Kennzeichnung als Annahme. Beispieldaten sind erfunden; sage das bei jeder daraus abgeleiteten Zahl.
- Nichts bauen, bevor ich die Empfehlung freigegeben habe.
- Schreibe nicht gegen Supabase und führe keine SQL-Tests gegen die Live-Datenbank aus.

---

## Hinweise zur Nutzung
- Der Prompt beantwortet die offene Frage, ob Agenten unter dem Renewal-Prozess ihre Rendite rechtfertigen. Er entscheidet sie nicht.
- Die Liste der Kandidaten ist ein Vorschlag, kein Befund. Der Prompt verlangt, sie aus dem Review abzuleiten.
