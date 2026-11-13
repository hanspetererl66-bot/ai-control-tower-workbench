# 003 Arbeitsweise mit Git: Worktree je Änderung, Freigabe nur auf Hans-Peters Wort

- **Status:** entschieden
- **Datum:** nicht belegt (gelebte Praxis, in CLAUDE.md und im Gedächtnis festgehalten)
- **Entscheider:** Hans-Peter

**Frage:** Wie arbeitet Claude mit Branches, Push und Merge?

**Entscheidung:** Je Änderung ein eigener Branch in einem eigenen `git worktree`; vor jedem Push `npm run check` grün; Commit, Push, PR, Merge und Löschen von Branch und Worktree nur auf Hans-Peters ausdrückliches Wort. Erst Konzept, dann kleine Schritte.

**Grund:** Mehrere Claude-Fenster teilen sich das Verzeichnis und schalten Branches um; Veröffentlichen, Mergen und Löschen sind schwer rückgängig zu machen.

**Folgen:** Jede Änderung ist ein PR mit Beschreibung (was, getestet, nicht getestet). Nach dem Merge werden Branch und Worktree nur auf Zuruf gelöscht und `main` gezogen.

**Quellen:** `CLAUDE.md` (Arbeitsweise); Gedächtnis "Git and confirmation workflow".
