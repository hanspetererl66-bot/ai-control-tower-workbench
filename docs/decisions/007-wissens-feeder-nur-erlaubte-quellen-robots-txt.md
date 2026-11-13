# 007 Wissens-Feeder: nur erlaubte Quellen, robots.txt, keine Tarnung

- **Status:** entschieden
- **Datum:** 11.11.2026 (Auftrag, PR #317)
- **Entscheider:** Hans-Peter

**Frage:** Wie laden wir SAP-Quellen in den Wissensgraphen?

**Entscheidung:** Nur Quellen mit Status `allowed` (Volltext) oder `metadata_only` (Titel, Link, Datum), geprüft im Code und nicht per Schalter umgehbar; Lizenz je Repo (nur CC-BY-4.0, Apache-2.0, MIT); `robots.txt` je Host, höchstens eine Anfrage pro Sekunde (mit `Crawl-delay`); eigener User-Agent ohne Tarnung; kein Abruf von help.sap.com, Community-Seiten, News-Artikeln, SAP Notes oder hinter einer Anmeldung; keine Suchmaschinen oder Caches als Umweg; Postfach-Aufnahme ist nicht Teil davon; Standard ist ein Trockenlauf, `--seed` ist ausdrücklich.

**Grund:** Die Nutzungsbedingungen von SAP verbieten Bots und das Weitergeben an KI-Anbieter; wir halten uns an die Quellen, die erlaubt sind.

**Folgen:** `news.sap.com/robots.txt` sperrt unseren User-Agent, deshalb wird der News-Feed verweigert. Heruntergeladene Inhalte werden nie committet (`data/knowledge/` ist ignoriert). Die Quellen, die geprüft werden müssen (`needs_review`), werden nie von uns auf Volltext ausgeweitet.

**Quellen:** `docs/knowledge-feeder.md`; `sources/registry.json`.
