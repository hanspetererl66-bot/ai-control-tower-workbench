---
name: abap-code-documentation
description: Documents a custom ABAP object from the system: purpose, interface, dependencies, ATC findings and open questions, with the line each statement rests on. Writes no new code. Nutzen bei "ABAP dokumentieren", "was macht dieser Report".
metadata:
  domain: Entwicklung
  process: Legacy-Code dokumentieren
  data-class: intern
  language: en
  board-area: Engineering
  scope: team
  team: AI Programme Office
  tools: SAPSearch, SAPRead, SAPContext, SAPNavigate, SAPDiagnose
---

# Document an ABAP object from the system

Use only the connector `arc-1` (tools `SAPSearch`, `SAPRead`, `SAPContext`, `SAPNavigate`, `SAPDiagnose`). They only read. Look at each tool's own description for its arguments; do not guess them. Answer in the language of the question.

## Steps

1. Find the object. Call `SAPSearch` with the name or a part of it. If several objects fit, list them with type and package and ask which one is meant, once.
2. Read it. Call `SAPRead` for the source and take it as it is. Note the line numbers you rely on.
3. Collect the surroundings. Call `SAPContext` for the interface and the objects it uses, and `SAPNavigate` for where it is used. Do not follow more than two steps out.
4. Check the code quality. Call `SAPDiagnose` for the ATC findings of this object, with the check variant the person names (otherwise the system default). Report them as they come back.
5. Write the document with these headings, in this order:
   - **Purpose**: what the object does, in two or three sentences.
   - **Interface**: parameters, inputs and outputs, the way it is called.
   - **Depends on / used by**: the objects from steps 3, grouped by type.
   - **Data it touches**: tables and views that the source reads or writes.
   - **ATC findings**: priority, line, text. If there are none, say so.
   - **Risks and open questions**: what a change would affect, and what only the owner can answer.
6. After each statement about behaviour, give the line it rests on, for example `(line 12)`. Mark what you conclude from the names alone as "Inference", never as fact.

## Rules

- Never call a tool that writes or changes the system (`SAPWrite`, `SAPActivate`, `SAPTransport`, `SAPGit`, `SAPManage`) in this skill. Do not read table contents and do not run SQL (`SAPQuery`); the document is about code, not business data.
- If the source cannot be read (authorisation, object type not supported), say so and stop. Do not write a document from the object name.
- Say what is not covered: only what the system returned counts. Callers outside this system, jobs, and external interfaces that the code does not name are not listed.
- The document is a draft for the object's owner. Do not state that it is complete or approved.
