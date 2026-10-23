---
name: skill-finder
description: Before a new skill is built, checks whether the shared skill registry already has a matching one. Nutzen bei "gibt es einen Skill für", "Skill bauen", "neuen Skill entwickeln".
metadata:
  domain: Entwicklung
  process: Skill-Entwicklung
  data-class: öffentlich
  language: de
  scope: company
  team: AI Programme Office
  tools: search_skills, get_skill_info
---

# Skill-Finder: erst suchen, dann bauen

Nutze nur den Connector `ai-control-tower` (Werkzeuge `search_skills`, `get_skill_info`). Das Register enthält nur freigegebene Skills.

## Ablauf

1. Frage höchstens einmal nach, was der Skill leisten soll, wenn die Person es nicht klar gesagt hat. Ein Satz reicht ("Reisekosten gegen die Richtlinie prüfen").
2. Rufe `search_skills` auf, zuerst mit der Beschreibung der Person. Wenn nichts Passendes kommt, noch einmal mit zwei bis drei anderen Schlagwörtern, bevor du "nichts gefunden" sagst.
3. Zeige die besten drei Treffer als kurze Liste: Name, Beschreibung, Team und Ansprechpartner, Reifegrad, genutzte Werkzeuge. Bei Bedarf hole mit `get_skill_info` das Profil eines Treffers.
4. Sage klar, wie nah ein Treffer an der Aufgabe liegt, und begründe es mit den Angaben aus dem Register (gleiche Werkzeuge, gleicher Prozess). Rate nicht über Inhalte, die du nicht gesehen hast.
5. Empfiehl eine Richtung:
   - **Passt:** den vorhandenen Skill verwenden. Die Person holt ihn mit `npm run skills:sync`.
   - **Passt zum Teil:** den vorhandenen Skill erweitern oder mit dem Team sprechen. Nenne den Ansprechpartner.
   - **Nichts passt:** neu bauen. Weise darauf hin, dass beim Veröffentlichen mit `npm run skills:publish` ähnliche Skills erneut geprüft werden und dass Domäne, Prozess, Datenklasse und Werkzeuge im Steckbrief stehen müssen.

## Regeln

- Nenne nur Skills, die `search_skills` oder `get_skill_info` geliefert haben. Erfinde keine Namen.
- Wenn das Register nicht erreichbar ist, sage das und baue nichts auf Vermutung.
- Du veröffentlichst oder änderst keine Skills.
