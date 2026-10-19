---
name: skill-search
description: Durchsucht den Skill-Marketplace nach Aufgabe, Rolle oder Bereich, vergleicht die besten Treffer (Reife, Risiko, Nutzen) und empfiehlt einen. Nutzen bei "welcher Skill hilft bei", "Skills für meine Rolle", "Skill-Suche".
metadata:
  domain: Skill-Management
  process: Skill-Suche
  data-class: intern
  language: de
  scope: company
  team: AI Programme Office
  tools: recommend_skills, search_skills, list_skill_catalog, get_skill_ranking, get_skill_info, get_skill_governance, get_skill_impact, get_skill_lifecycle, find_skill_gaps, search_graph, get_graph_neighbors
---

# Skill-Suche: den passenden Skill im Dschungel finden

Nutze nur den Connector `ai-control-tower`. Der Skill `skill-finder` ist für die Frage "gibt es das schon, bevor ich baue". Dieser Skill hier ist für den Alltag: finden, vergleichen, auswählen.

## Ablauf

1. **Einstieg klären.** Frage höchstens einmal nach, wenn weder Aufgabe noch Rolle noch Bereich erkennbar sind. Ein Satz reicht ("Was willst du erledigen, oder in welcher Rolle?").
2. **Treffer sammeln.**
   - Aufgabe oder Rolle genannt: `recommend_skills` (Rolle und/oder Aufgabe) und `search_skills` mit der Aufgabe. Wenn nichts Passendes kommt, noch einmal mit zwei bis drei anderen Schlagwörtern.
   - Überblick gewünscht ("Was gibt es in Engineering?", "Was hat Team X gebaut?"): `list_skill_catalog` mit den passenden Filtern.
   - "Was ist beliebt?": `get_skill_ranking`.
3. **Die besten drei prüfen.** Je Treffer `get_skill_governance` (Risikoklasse, erlaubte Datenklassen, nächster Review), `get_skill_impact` (Nutzung, Erfolgsquote, Wert) und `get_skill_lifecycle` (Abhängigkeiten, Ersatz, Sunset-Datum). Nutze `get_skill_info`, wenn ein Profil fehlt.
4. **Zusammenhänge zeigen, wenn sie helfen.** `get_graph_neighbors` für einen Skill zeigt genutzte Werkzeuge, Risiken, Agenten und den bedienten Kunden. Das ist nützlich bei "Was hängt daran?" oder wenn zwei Skills ähnlich wirken.
5. **Nichts gefunden?** Rufe `find_skill_gaps` auf. Gibt es dort eine passende Lücke oder Anfrage, nenne sie und verweise auf `skill-finder`, falls die Person bauen möchte.

## Antwort

Kurze Vergleichstabelle der besten drei: Name, Passung (hoch, mittel, gering mit einem Satz Begründung), Reifegrad, Risikoklasse, Nutzen, Hinweis. Darunter eine klare Empfehlung und ein Beispiel-Prompt zum Ausprobieren, wenn das Profil eines liefert.

## Regeln

- Nenne nur Skills, die ein Werkzeug geliefert hat. Erfinde keine Namen, Zahlen oder Inhalte.
- Begründe die Passung mit Angaben aus dem Register (Aufgabe, Werkzeuge, Rolle), nicht mit Vermutungen über den Skill-Text.
- Warne bei Pilot-Skills, bei überfälligem Review, bei einem Sunset-Datum oder wenn ein Skill ersetzt wurde. Nenne dann den Nachfolger.
- Prüfe das Feld `dataSource` und nenne am Ende, ob Beispieldaten oder Supabase-Daten verwendet wurden.
- Du installierst, veröffentlichst oder änderst keine Skills.
