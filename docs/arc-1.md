# ARC-1 in der Werkbank

ARC-1 (`arc-mcp/arc-1`, MIT, `npx arc-1`) ist ein MCP-Server für SAP ABAP Development Tools (ADT). Lesend ist der Standard. Quellen: Blog von Marian Zeis (ARC-1 und "Connect Joule Work Desktop to SAP Systems"), Konfigurationsreferenz und Berechtigungsdoku des Projekts.

## Was es schon gab
- **MCP Marketplace** führt ARC-1 mit 12 Werkzeugen, Schaltern, Bewertung und Pilotplan (`examples/mcp-marketplace/servers.json`). Katalog der Website: `site/assets/catalog.mjs` (MCPB v1.0.2).
- **Space ABAP Workbench** (`npm run install:abap-workbench`): Mockup mit erfundenen Daten. Neu seit 05.11.2026: Reiter *Spec vs. system* und *ATC findings*, Werkzeug SAPDiagnose.

## Was neu ist (Branch `feat/arc1-approval`)
- `src/approval.ts` kennt die ARC-1-Werkzeugnamen. Sie heißen `SAPRead`, `SAPWrite` usw. ohne Unterstrich; die Wortregeln der Werkbank konnten sie nicht unterscheiden, **jeder Aufruf galt als "unknown"** und ein `SAPWrite` wurde nicht als Änderung gezeigt. Jetzt (nach Werkzeugname, nicht nach Connector-Name, weil ein zentraler Connector z. B. "ARC-1 | S4 DEV" heißen kann):
  - lesend: SAPRead, SAPSearch, SAPNavigate, SAPContext, SAPLint, SAPDiagnose
  - ändernd: SAPWrite, SAPActivate, SAPGit, SAPTransport (außer list, get, check, history)
  - prüfen: SAPQuery, SAPManage und jedes Lesen mit dem Wert `TABLE_CONTENTS` in irgendeinem Argument
- Das Arbeitsprofil "Review (read only)" blockiert damit alles außer Lesen.
- Tests: `test/arc1-approval.test.mjs` (u. a.: jedes Werkzeug des Katalogeintrags ist eingestuft, nichts Schreibendes oder Datenlesendes erscheint als Lesen).

## Einrichten (lokal, ein Entwickler)
1. ARC-1 als Connector aus dem MCP Marketplace importieren.
2. `SAP_URL`, `SAP_USER`, `SAP_PASSWORD` (Secret), `SAP_CLIENT`. **Anzeige-Benutzer, Entwicklungssystem zuerst.**
3. Sichere Voreinstellung lassen: `SAP_ALLOW_WRITES` aus (Hauptschalter), `SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_FREE_SQL`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES` aus, `SAP_ALLOWED_PACKAGES` auf `$TMP` (Standard).
4. Arbeitsprofil **Review (read only)** wählen.

## Zentral (mehrere Entwickler)
ARC-1 läuft zentral (z. B. BTP Cloud Foundry) mit OAuth/OIDC; in Joule als Connector mit URL, die auf `/mcp` endet. Die Werkbank erlaubt für Remote-Connectoren nur HTTPS ohne Zugangsdaten in der URL und keine geheimen Header ("use connector OAuth"). API-Schlüssel mit Profilen (`ARC1_API_KEYS`, z. B. viewer, developer) und Audit-Protokoll (`ARC1_LOG_*`) sind serverseitig. **Nicht erprobt.**

## Grenzen
- Kein echter ARC-1-Lauf, nicht in der Electron-App (nur Logik per Test und Space im Headless-Browser).
- Argumentnamen (`action`, `type`) stammen aus der Konfigurationsreferenz. Ändern sie sich, greift bei Transporten die Vorsicht: eine unbekannte Aktion gilt als Änderung.
- Demo-Anleitung: `docs/arc-1-demo.md`.
