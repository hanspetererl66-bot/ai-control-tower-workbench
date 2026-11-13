# Entscheidungsprotokoll

Hier steht, was entschieden ist, und was noch auf eine Entscheidung wartet. Eine Seite je Entscheidung, damit man später nachlesen kann, **warum** etwas so ist. Stand dieser Übersicht: 13.11.2026 (Entwurf).

## So funktioniert es
- **Was hinein gehört:** nur, was später jemand fragen würde ("Warum so?"). Keine Aufgaben, keine Statusberichte (die stehen in `docs/status/`), keine Absichten ohne Folgen.
- **Eine Seite je Entscheidung:** Nummer, Status (*vorgeschlagen*, *entschieden*, *abgelöst*), Datum, Entscheider, Frage, Entscheidung, Grund, Folgen, Quellen. Vorlage: [`TEMPLATE.md`](TEMPLATE.md).
- **Nichts wird überschrieben.** Ändert sich eine Entscheidung, bekommt sie einen neuen Eintrag, und der alte wird *abgelöst* und verweist auf den neuen.
- **Offene Fragen** stehen als *vorgeschlagen*, mit dem, der entscheidet. Ist sie beantwortet, wird der Status geändert (im selben PR, der die Folgen umsetzt).
- **Datum und Quellen nur, wenn belegt.** Wo wir das Datum nicht kennen, steht "nicht belegt".
- `CLAUDE.md` bleibt kurz und verweist nur auf diese Übersicht.

## Übersicht
| Nr | Titel | Status | Datum | Entscheider |
|---|---|---|---|---|
| 001 | [Goose bleibt die Agent-Laufzeit](001-goose-bleibt-die-agent-laufzeit.md) | entschieden | nicht belegt (steht seit dem Projektstand in CLAUDE.md) | Hans-Peter |
| 002 | [Identität ist nur ein E-Mail-Etikett](002-identitaet-ist-nur-ein-e-mail-etikett.md) | entschieden | nicht belegt (steht seit dem Projektstand in CLAUDE.md) | Hans-Peter |
| 003 | [Arbeitsweise mit Git: Worktree je Änderung, Freigabe nur auf Hans-Peters Wort](003-arbeitsweise-mit-git-worktree-je-aenderung.md) | entschieden | nicht belegt (gelebte Praxis, in CLAUDE.md und im Gedächtnis festgehalten) | Hans-Peter |
| 004 | [Spaces sind Einzeldateien: kein Netzwerk, kein localStorage, Farben nur als Tokens](004-spaces-sind-einzeldateien-kein-netzwerk-kein.md) | entschieden | nicht belegt (steht seit dem Projektstand in CLAUDE.md) | Hans-Peter |
| 005 | [Der Katalog des Ontology Managers wird nie von der App geschrieben](005-der-katalog-des-ontology-managers-wird-nie-von.md) | entschieden | 04. bis 05.11.2026 (PR #177, PR #190) | Hans-Peter |
| 006 | [Kein Versionsvergleich im Ontology Manager](006-kein-versionsvergleich-im-ontology-manager.md) | entschieden | 09.11.2026 (Auswahl beim Ausbau) | Hans-Peter |
| 007 | [Wissens-Feeder: nur erlaubte Quellen, robots.txt, keine Tarnung](007-wissens-feeder-nur-erlaubte-quellen-robots-txt.md) | entschieden | 11.11.2026 (Auftrag, PR #317) | Hans-Peter |
| 008 | [Der Figma-Connector ist nur lesend](008-der-figma-connector-ist-nur-lesend.md) | entschieden | laut PR #314 | Hans-Peter |
| 009 | [Ontology Manager: Kunden-Demo in drei Akten, Akt A zuerst](009-ontology-manager-kunden-demo-in-drei-akten-akt-a.md) | entschieden | 13.11.2026 | Hans-Peter |
| 010 | [Entscheidungsprotokoll im Repo](010-entscheidungsprotokoll-im-repo.md) | entschieden | 13.11.2026 | Hans-Peter |
| 011 | [Downtime-Fenster: "größer als 2 h" oder "ab 2 h"?](011-downtime-fenster-groesser-als-2-h-oder-ab-2-h.md) | vorgeschlagen | 12.11.2026 (Workshop) | Kunde (Infrastruktur-Betrieb) |
| 012 | [Kundenbenachrichtigung: welche Tasks werden gemeldet?](012-kundenbenachrichtigung-welche-tasks-werden.md) | vorgeschlagen | 12.11.2026 (PR #350) | Kunde (Infrastruktur-Betrieb) |
| 013 | [TabPFN-Lizenz vor einer Kundendemo](013-tabpfn-lizenz-vor-einer-kundendemo.md) | vorgeschlagen | 13.11.2026 | Hans-Peter |
| 014 | [Ontology Akt A: offene Fragen der Konzeption](014-ontology-akt-a-offene-fragen-der-konzeption.md) | vorgeschlagen | 13.11.2026 | Hans-Peter |
| 015 | [Wissens-Feeder: Seed-Lauf und rechtliche Fragen](015-wissens-feeder-seed-lauf-und-rechtliche-fragen.md) | vorgeschlagen | 11.11.2026 | Hans-Peter |
| 016 | [Ontology Akt B: offene Fragen der Konzeption](016-ontology-akt-b-offene-fragen-der-konzeption.md) | vorgeschlagen | 13.11.2026 | Hans-Peter |
