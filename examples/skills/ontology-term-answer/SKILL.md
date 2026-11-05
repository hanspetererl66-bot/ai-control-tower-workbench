---
name: ontology-term-answer
description: Answers "What is DSO?" or "Who owns Margin?" with the certified definition, formula and owner from the Ontology Manager, and names who to ask before a change. Nutzen bei "Was bedeutet", "wer verantwortet".
metadata:
  domain: Governance & Risiko
  process: Business terms
  data-class: intern
  language: en
  board-area: Engineering
  scope: board-area
  team: AI Programme Office
  tools: search_classes, describe, impact_of_term
---

# Answer with the certified term

Use only the connector `ontology-manager` (tools `search_classes`, `describe`, `impact_of_term`). They only read. Answer in the language of the question.

## Steps

1. Find the term. Call `search_classes` with the word the person used. If several terms fit, name them and ask which one is meant, once.
2. Read it. Call `describe` for the term and take the definition, the formula and the certifier (`certifiedBy`) exactly as stored. Quote the definition; do not paraphrase a number or a rule.
3. If the person asks what a change would affect, or whether a term can be changed, call `impact_of_term` and report: how many things depend on it, which company codes are reached, and who to ask first (`ask_before_changing`). Do not change anything and do not promise that anyone agrees.
4. Say where the answer comes from (the ontology name) and what is not covered: only what is modelled counts; agents, skills and reports that use the term but are not in the ontology are not listed.

## Rules

- If the ontology has no definition for the term, say so. Do not invent one and do not fill the gap from general knowledge; offer to create a proposal from a document instead.
- If a term has no certifier, say that nobody is named as owner.
- Never use a tool that writes (`apply_ontology_proposal`, `add_ontology`) in this skill.
