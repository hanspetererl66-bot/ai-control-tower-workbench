# 018 Der Notion-Connector darf schreiben, aber nichts löschen

- **Status:** entschieden
- **Datum:** 14.11.2026 (Auftrag im Chat)
- **Entscheider:** Hans-Peter

**Frage:** Darf der Agent in Notion schreiben (Gegenstück zu Entscheidung 008 beim Figma-Connector)?

**Entscheidung:** Ja, begrenzt. `notion_create_page` legt eine Seite unter einer Seite oder als Zeile in einer Datenbank an, `notion_update_page` ändert Eigenschaften und hängt Text am Ende an. Es gibt kein Löschen, kein Archivieren und kein Überschreiben von Text; `archived` und `in_trash` werden abgelehnt. Die Schreib-Werkzeuge verlangen laut Beschreibung eine Rückfrage bei der Person (wie bei Jira).

**Grund:** Notion soll auch Ziel sein (Ergebnisse ablegen), aber ein Fehlgriff des Agenten soll sich nicht unwiederbringlich auswirken. Hinzufügen und Ändern von Eigenschaften lässt sich in Notion nachvollziehen und zurücksetzen.

**Folgen:** Das Token braucht die Fähigkeiten "Read content", "Insert content" und "Update content". Eigenschaften werden gegen das Schema der Datenbank oder Seite geprüft; nicht schreibbare Typen (zum Beispiel Formel, Relation) werden abgelehnt. In der App gibt es keine eigene Vorschau-und-Freigabe-Maske für Notion; die Rückfrage steht nur in der Werkzeugbeschreibung.

**Quellen:** `connectors/notion`; `test/notion-connector.test.mjs`; `docs/status/sources-and-registry.md`.
