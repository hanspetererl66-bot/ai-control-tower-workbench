---
name: rate-skill
description: Bewertet einen Skill aus dem Marketplace mit 1 bis 5 Sternen und optionalem Kommentar, nach Bestätigung. Nutzen bei "Skill bewerten", "gib dem Skill 4 Sterne", "wie fandest du den Skill", "Bewertung abgeben".
metadata:
  domain: Skill-Management
  process: Skill-Bewertung
  data-class: intern
  language: de
  scope: company
  team: AI Programme Office
  tools: rate_skill, get_skill_ratings, get_skill_info
---

# Skill bewerten

Nutze nur den Connector `ai-control-tower`. Bewertungen sind anonym und zählen einmal pro Person und Skill; eine neue Bewertung ersetzt die alte.

## Ablauf

1. **Skill und Sterne klären.** Frage nur nach, was fehlt: welcher Skill, wie viele Sterne von 1 (schlecht) bis 5 (sehr gut). Wenn die Person den Namen nicht genau kennt, hole mit `get_skill_info` das Profil oder zeige mit `get_skill_ratings` den Stand.
2. **Kommentar anbieten, nicht verlangen.** Ein Satz reicht, höchstens 280 Zeichen. Weise darauf hin, dass keine Namen, Kundendaten oder Zugangsdaten hineingehören. Enthält der Kommentar so etwas, bitte die Person, ihn umzuformulieren.
3. **Bestätigung einholen.** Wiederhole Skill, Sterne und Kommentar in einer Zeile und frage, ob du so abgeben sollst. Bewerte nie ohne dieses Ja und nie von dir aus.
4. **Abgeben.** Rufe `rate_skill` auf. Sage danach, ob die Bewertung neu gespeichert oder aktualisiert wurde, und nenne den neuen Stand ("4,6 von 5, 42 Bewertungen").
5. **Fehler ehrlich melden.** Beispiel-Skills lassen sich nicht bewerten, und ohne Supabase-Verbindung wird nichts gespeichert. Sage das und bewerte nichts auf Vermutung.

## Regeln

- Eine Bewertung beschreibt den Skill, nicht Personen. Gib nichts weiter, was die Person nicht ausdrücklich bewerten wollte.
- Du bewertest nur Skills, die `rate_skill` akzeptiert. Erfinde keine Skill-Namen oder Zahlen.
- Biete bei einer sehr schlechten Bewertung an, die Lücke als Anfrage an das Team zu melden (`find_skill_gaps` zeigt, ob es sie schon gibt).
