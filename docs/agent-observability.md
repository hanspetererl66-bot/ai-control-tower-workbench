# Agent Observability (Stand 07.11.2026, Branch `feat/agent-observability`)

Ein eigener Space (`examples/agent-observability/`, installieren mit `npm run install:agent-observability`) zeigt, was Agenten, Workflows und Skills der Werkbank **tatsächlich getan haben**. Er hat keine Beispieldaten in der Seite: alles kommt aus der Datenbank.

## Was die Seite zeigt
- **Fleet:** acht Kennzahlen (Läufe, grün, Ergebnis erreicht, "grün aber falsch", Kosten, Tempo p95, blockiert, erreichte Personen) mit Vergleich zur Vorperiode, Läufe je Tag nach Ergebnis, Heatmap Wochentag × Stunde, Tabelle aller Agenten (Rechte, 14-Tage-Verlauf, Ergebnisquote, Lücke, Eskalation, p95, Kosten, blockiert, Version), fehlerreichste Werkzeuge, Kosten nach Modell und Abteilung.
- **Traces:** Laufliste mit Filtern (Agent, Status, Kosten), je Lauf ein Baum der Schritte als Wasserfall (`invoke_agent`, Guardrail, `chat`, `execute_tool`, Retrieval, Freigabe-Wartezeit), Namen nach OpenTelemetry GenAI. **Der Text von Prompts und Antworten wird nicht gespeichert.**
- **Quality:** Beobachtbarkeit ist nicht Bewertung. Ergebnisprüfung (Zustand nach dem Lauf gegen das Ziel) neben dem Laufstatus, nächtliche Fälle je Version mit pass^3 (ein Fall zählt nur, wenn alle drei Versuche bestanden), Review-Warteschlange für Menschen.
- **Cost:** Kosten je Tag, auffällige Tage, Kosten je Agent und je grünem Lauf, Verschwendung durch fehlgeschlagene Läufe, teuerste Läufe, Monatsende-Schätzung (Faustregel, kein Modell).
- **Safety:** blockierte Aktionen, Agenten, die verändern oder unbeaufsichtigt laufen, Guardrail-Treffer, Wartezeit auf Freigaben.
- **Alerts:** drei Stufen (page, ticket, info), Zahlen in den Meldungen aus den Läufen berechnet.

## Datenbank
- `supabase/migrations/20261107_036_agent_observability.sql`: Schema `observability` (Agent, Lauf, Schritt, Testfall und -ergebnis, Alarm, Review), Läufe und Schritte nur anhängen (Trigger), Lesefunktionen `obs_dashboard`, `obs_runs`, `obs_trace`, `obs_quality`, `obs_safety`, `obs_cost`, `obs_alerts` nur für service_role, Personen nur als Pseudonym (`u-0412`).
- `supabase/migrations/20261107_037_agent_observability_seed.sql`: **erzeugte, erfundene** Historie der letzten 90 Tage: 27 Agenten/Workflows/Skills, rund 25.000 Läufe, rund 165.000 Schritte, 16.000 Testläufe, 12 Alarme (lokal ca. 8 s). Deterministisch über eine Hash-Funktion; zweites Anwenden tut nichts (Läufe sind nur anhängbar). Die Zeiten sind relativ zum Tag des Anwendens.
- **Von Hand im Supabase-SQL-Editor anzuwenden: erst 036, dann 037.**

## Eingebaute Geschichten (damit es etwas zu finden gibt)
1. Endlosschleife: Supplier delay scout, vor 9 Tagen am Nachmittag, 30 Läufe am Schrittlimit, rund 170 EUR (das 25- bis 30-fache eines normalen Tages).
2. Qualitätsabfall nach Version 1.4 (Renewal watcher, vor 21 Tagen): Läufe bleiben zu 96 % grün, die Ergebnisprüfung fällt von ca. 88 % auf ca. 69 %, die nächtlichen Fälle (pass^3) von ca. 97 % auf ca. 55 %.
3. Blockierte Buchungen (Payment proposal check, vor 3 bis 5 Tagen): Buchung über dem Freigabelimit.
4. Störung des SAP-Werkzeugs `sap_query` vor 3 Tagen von 14:00 bis 17:30 über mehrere Agenten.
5. Mehr Eskalationen (HR policy assistant ab 1.1), langsamer (IT ticket triage ab 3.2), teurer (Margin analyst).
6. Zwei Agenten ohne Mensch (autonomous), einer kaum genutzt (Travel expense helper), einer stillgelegt (Legacy ticket router).

## App
- `src/observability-bridge.ts`: nur `ob:get-request` mit sieben festen Ansichten, Parameter auf das Bekannte gekürzt, Antwort in Tiefe, Länge und Textlänge begrenzt.
- Hauptprozess: `connectors/_lib/server/observability.mjs` (Whitelist je Ansicht, Absender immer die gespeicherte E-Mail), `workStore.observe`, IPC `observability-call`, Preload `observabilityCall`. **Nur lesend, kein Agentenwerkzeug.**
- Tests: `test/observability.test.mjs` (Brücke, Argumente, Seite, und mit `SKILL_SQL_TEST_DSN="postgresql:///obs_test?host=/tmp&port=5544&user=postgres"` die Migrationen gegen echtes Postgres 16).

## Ehrlich
- Alle Daten sind erzeugt. Nichts wird von einem echten Lauf geschrieben: **es gibt noch keinen Schreiber** (der Scheduler schreibt nur `job_run`, der Agent-Lauf nicht). Der Space zeigt, wie die Ansicht aussähe; echte Daten brauchen einen Schreiber (z. B. OpenTelemetry-Export aus Goose/Joule Studio) und eine Entscheidung über Aufbewahrung.
- Die Identität ist nur die E-Mail, keine Rollenprüfung: wer Key und E-Mail hat, sieht alles. Vor echten Personendaten Anmeldung, Betriebsrat und Datenschutz klären (auch Pseudonyme lassen sich in kleinen Gruppen zuordnen).
- Alarme kommen aus der Seed-Migration, nicht aus laufenden Regeln. Kein Quittieren, kein Pausieren oder Stoppen eines Agenten (kein Kill-Switch), keine Rückschreibung der 30-Tage-Zahlen in die Registerkarte, kein OTel-Export.
- Die Ergebnisprüfung und das Urteil (judge) sind im Seed erfunden; wie man sie für echte Läufe bestimmt, ist offen.
- **Nicht getestet:** Electron-App und echtes Supabase. Die Seite lief im Headless-Browser (hell und dunkel, ohne Seitenfehler) mit den echten Antworten der Funktionen aus lokalem Postgres 16 über eine simulierte Brücke.
