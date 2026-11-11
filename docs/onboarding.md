# Onboarding (Space, Stand 08.11.2026)

Dritter Block im Bereich HR nach Recruiting und Hiring Approvals: alles, was nach dem **unterschriebenen Vertrag** passiert. Space `examples/onboarding/` (`npm run install:onboarding`), Domäne HR. Reiner Entwurf mit erfundenen Daten: kein HR-System, kein IT-Service-Desk, keine Lohnabrechnung wird aufgerufen.

## Prozessschritte (23, in fünf Phasen)

| Phase | Schritte (Verantwortlich) |
| --- | --- |
| Preboarding (ab Unterschrift bis zum Vorabend) | Betriebsrat informieren (HR, darf schon vor der Unterschrift), Mitarbeiterstamm im HR-System anlegen (HR), persönliche Daten im Self-Service eintragen (neue Person), Arbeits-/Aufenthaltserlaubnis prüfen (HR, nur wenn nötig), Lohnabrechnung einrichten (Payroll), Konten, Postfach, Rollen (IT), Laptop und Telefon (IT), Ausweis, Platz, Parkplatz (Facilities), Buddy benennen, erste Woche und 30-60-90-Ziele planen, Willkommensnachricht (Vorgesetzte) |
| Tag eins | Geräte und Ausweis übergeben (IT), persönlich empfangen (Vorgesetzte), Datenschutz- und Sicherheitserklärungen unterschreiben (neue Person) |
| Erste Woche | Buddy-Rundgang, Pflichtschulungen, Check-in nach der ersten Woche |
| 90 Tage | Check-in 30 und 60 Tage, Benefits wählen, Puls-Umfrage, 90-Tage-Review |
| Probezeit | Entscheidung über das Ende der Probezeit (HR und Vorgesetzte) |

Abhängigkeiten stehen in den Daten (`after`): z. B. Lohnabrechnung erst nach Stammdaten **und** Selbstauskunft. Fälligkeit = Starttag plus Versatz (`offset`).

## Darstellung: fünf Kandidaten, fünf Formen

Fünf Pseudonyme in fünf Lagen (Stichtag im Beispiel 09.11.2026): wartet auf die Unterschrift (C-3702), Preboarding mit frühem Hindernis (C-3908, Aufenthaltstitel), Start in sieben Tagen mit Laptop-Lieferproblem und überfälliger Selbstauskunft (C-3320), erste Woche im Plan (C-3202), 90-Tage-Review überfällig (C-2901).

- **Board**: Spalten nach Phase, Karte je Person mit Fortschritt und nächstem Schritt.
- **Timeline**: alle ausgerichtet auf ihren Starttag, Punkte je Schritt, heute als Linie (Achse gestreckt, wo die Schritte dicht liegen).
- **Matrix**: Schritte × Personen.
- **Person**: Checkliste mit Verantwortlichem, Fälligkeit, Hindernis, was Joule vorbereitet; ein Satz zur Lage; "Draft a reminder".
- **By owner**: wer wartet auf wen (HR, Payroll, IT, Facilities, Vorgesetzte, Buddy, neue Person).
- **How it works**: die 23 Schritte.

Zustände (`done`, `blocked`, `overdue`, `soon`, `planned`, `waiting`, `locked`, `na`) und alle Zahlen werden in der Seite aus Schritten und Daten berechnet (Logik zwischen `@logic-start`/`@logic-end`, Test `test/onboarding.test.mjs`, 8 Tests). Joule entwirft und erinnert; jede Person erledigt oder bestätigt ihren Schritt. Joule sendet, bestellt, bucht und unterschreibt nichts.

## Grenzen / nicht gebaut

Keine Datenbank, keine Brücke, keine Übergabe aus Hiring Approvals (der Vertragszustand steht im Beispiel in den Daten), kein Eintragen von "erledigt" oder "blockiert" in der Oberfläche, keine echten Systeme (Employee Central/HCM, Service-Desk, Payroll, E-Learning), kein Betriebsrat-Prozess über den Hinweis hinaus. Datenschutz: Namen, Adressen und Bankdaten gehören in die Fachsysteme, nicht in die Werkbank. Nicht getestet: Electron-App; im Headless-Browser hell und dunkel gesehen, ohne Seitenfehler.

## Anbindung an die Datenbank (Migration 039)

Der Onboarding-Space ist jetzt zweigleisig: **im Browser** zeigt er weiter die Beispieldaten (fünf erfundene Neueinstellungen); **in der App** liest und schreibt er die gemeinsame Datenbank (Tag „live data“).

- **Übergabe:** Nach der Unterschrift (Vertrag `signed`, Migration 038) übergibt HR die Einstellung an Onboarding, entweder im Space *Hiring Approvals* (Button „Hand over to onboarding“ am unterschriebenen Vertrag) oder im Onboarding-Space (Liste „Signed, waiting for the handover“). Eingegeben wird der erste Arbeitstag. `recruiting_onboarding_handover` prüft: Vertrag unterschrieben, nur der HR-Genehmiger (oder ein Board-Admin), ein Fall je Antrag. Danach stehen alle 23 Schritte auf „offen“.
- **Status je Schritt:** „Mark done“, „Blocked…“ (Begründung Pflicht), „Not needed“, „Reopen“ über `recruiting_onboarding_set`. Jede Änderung steht im nur anhängbaren Protokoll `recruiting.onboarding_event`. Wer beteiligt ist (Antragsteller, Genehmiger, Vorgesetzter der Stelle, Board-Admin), darf lesen und ändern; die Identität ist nur die E-Mail, ein Etikett.
- **Weg:** Space → feste Nachrichten `ob:*` (`src/onboarding-bridge.ts`) / `ha:handover-request` → Hauptprozess (IPC `onboarding-*`) → Datenbankfunktionen mit service_role. Keine Agent-Werkzeuge; der Agent kann nichts übergeben oder abhaken.
- **Der Name der neuen Person** steht nicht in der Werkbank (nur die Kandidaten-ID im Recruiting-System). Die Fälle heißen deshalb „H-<Antragsnummer>“ mit Stellentitel.
- **Angewendet (11.11.2026) / nicht getestet:** Migration 039 (und 038) sind auf Supabase angewendet; 039 über das Supabase-Werkzeug (Name `onboarding`), Kontrollabfrage: 23 Schritte, 3 Funktionen, kein Zugriff für anon/authenticated. Getestet: SQL gegen lokales Postgres (44 Tests), Bridge, Space im Headless-Browser mit einem Mock als App. Nicht getestet: ein Durchlauf (Übergabe, Schrittstatus) gegen die echte Supabase-Datenbank, die Electron-App, mehrere echte Personen mit E-Mail.
