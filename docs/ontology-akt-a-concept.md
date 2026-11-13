# Konzept Akt A: "Was geht kaputt, wenn ich das freigebe?"

**Stand:** 13.11.2026, **Entwurf zur Abstimmung**, noch nichts gebaut. Gehört zu `docs/ontology-demo-concept.md` (Akt A der Kunden-Demo). Dieses Dokument legt fest, **woher** die Nutzer eines Begriffs kommen, **wie** sie gefunden und bestätigt werden, **was** der Freigeber sieht und **wie wir es testen**.

## 1. Ziel in einem Satz
Bevor jemand eine Änderung an einem Begriff freigibt, sieht er mit Namen, Eigentümern und Fundstellen, welche Agenten, Workflows, Skills und Spaces davon abhängen, getrennt nach *bestätigt* und *vermutet*, und die Freigabe wird mit genau dieser Liste protokolliert.

## 2. Was es schon gibt (daran bauen wir an)
- **Auswirkung im Modell:** `impactOf(ontology, term, depth)` und `impact_of_term` im Connector: was vom Begriff abhängt (bis 3 Schritte), wovon er abhängt, wen man vorher fragt (`ask`).
- **Erklärte Nutzer:** `Binding { slug, term, kind: agent|skill|report, name }` in `governance.json` (Reiter *Use*). Eine Person trägt sie ein; die App kann nicht in einen Agenten schauen.
- **Änderungsplan:** `ChangePlan` im Katalog (`OntologyDetails.tsx`): Änderung beschreiben, `planRequest` baut die Anfrage an die Verantwortlichen (die App sendet nichts), `Plan` mit Status *draft, asked, approved, rejected*.
- **Karte:** Reiter *Map* färbt rot, was am Begriff hängt (gleiche Regel wie `impactOf`, per Test gleichgesetzt), Nutzer sind eine Stufe dahinter.
- **Katalog-Schutz:** Der Katalog (Turtle) wird nie von der App geschrieben; die Übernahme läuft über den Connector mit `confirmed=true`, die vorige Fassung geht in `_history`.

**Die Lücke:** Die Liste der Nutzer ist nur so gut, wie jemand sie gepflegt hat. Akt A ersetzt "gepflegt" durch "gefunden und bestätigt".

## 3. Woher die Nutzer kommen (vier Quellen)
| Quelle | Was wir lesen | Wie | Was es hergibt | Sicherheit des Treffers |
|---|---|---|---|---|
| **Erklärte Nutzer** (heute) | `governance.json` `bindings` | schon da | Typ, Name | bestätigt (von einer Person erklärt) |
| **Registry** (Agenten, Workflows, Features) | Karte (`intent.register`): `relations` (Art *data, process, capability, system, model, mcp, item*), `tags`, `purpose`, Name, dazu `owner`, `steward`, `phase`, `criticality` | `list_work_items` und `get_work_item` über den Connector (wie `src/registry.ts`), im Renderer ausgewertet | Treffer mit **Fundstelle** ("Relation data: *Deferred revenue schedule*") und Eigentümer | vermutet, bis der Eigentümer bestätigt |
| **Skills** | `SKILL.md`: Name, Beschreibung, `domain`, `process`, `team`, Text | bestehende IPC `list-skills` und `read-skill` | Skill mit Fundstelle im Text | vermutet |
| **Spaces** | `space.json` (Titel, Beschreibung, Hinweise) und Seitentext sowie `data.json` | dieselbe Adresse, die den Space anzeigt (`/__spaces/<slug>/…`), nur lesend | Space mit Fundstelle | vermutet |

Eine fünfte Quelle (Zugriffe zur Laufzeit, die ein Agent erst beim Lauf macht) sehen wir **nicht**; das steht im Ergebnis ausdrücklich ("Laufzeitnutzung nicht erfasst").

## 4. Datenmodell (additiv, nichts Altes bricht)
```
Usage {
  id            // "<slug>|<term>|<refKind>:<ref>"
  slug, term    // Begriff
  refKind       // 'agent' | 'workflow' | 'feature' | 'skill' | 'space' | 'report'
  ref           // Registry-Id, Skill-Verzeichnis, Space-Slug
  name          // Anzeigename
  owner         // aus Registry (owner/steward), sonst ""
  evidence      // [{ field, excerpt, via }]  field: relation.data | relation.process | tag | purpose | name | body
                //   via: 'label' | 'synonym' | 'mapping'
  state         // 'declared' | 'suspected'   (berechnet)
}
UsageDecision { key: "<slug>|<term>|<refKind>:<ref>", decision: 'confirmed' | 'dismissed', by, at }   // in governance.json
```
- **Gefundene** Nutzer werden **nicht gespeichert**, nur berechnet; gespeichert werden **Entscheidungen** (bestätigt oder verworfen) in `governance.json` (`usageDecisions`, additiv; `normalizeGovernance` kürzt und verwirft Ungültiges, ältere Dateien laden weiter). `ConsumerKind` wächst um `workflow`, `feature`, `space`.
- Ein bestätigter Nutzer wird zum erklärten Nutzer (`Binding`), damit Karte und Auswirkung ihn kennen.

## 5. Regeln für das Finden (reine Funktion, getestet)
1. **Normalisieren** wie die vorhandene Suche (Groß/Klein, Umlaute, ß, Satzzeichen).
2. **Suchwörter** je Begriff: Bezeichnung, Synonyme, gemappte Namen (SAP, IFRS 15 …). Begriffe unter 4 Zeichen oder aus einer Stoppliste (*Order*, *Item*, *Status* …) zählen nur in den starken Feldern.
3. **Ganze Wörter**, keine Teilstrings ("Revenue" trifft nicht "Revenues-Space" ohne Wortgrenze, Mehrwortbegriffe als Phrase).
4. **Feldgewicht:** `relation.data` und `relation.process` stark, `tag` und `name` mittel, `purpose` und Text schwach. Ein Treffer in nur einem schwachen Feld wird als *schwach* markiert und standardmäßig eingeklappt.
5. **Mehrdeutigkeit:** Kommt dieselbe Bezeichnung in zwei Ontologien vor, wird der Treffer **beiden** zugeordnet und als *mehrdeutig* markiert (Brücke zu Akt B).
6. **Kein Treffer ist ein Beweis.** Die Oberfläche nennt es *vermutet*, zeigt die Fundstelle, und nur der Eigentümer oder Freigeber bestätigt oder verwirft.
7. **Obergrenzen:** je Begriff höchstens 50 Nutzer, je Nutzer 3 Fundstellen, Ausschnitt 120 Zeichen; Registry höchstens 500 Karten, Spaces höchstens die installierten.

## 6. Was der Freigeber sieht
**Ort:** Katalog, Begriff, Karte *Change plan* (heute vorhanden), erweitert; dazu die Karte (*Map*) mit denselben Daten.
1. **Kopfzeile des Plans:** "Ersetzt *Deferred revenue* durch *Contract liability*. Reicht an **n** Stellen im Modell und **m** Nutzer (x bestätigt, y vermutet), **k** Eigentümer zu fragen, **q** Kompetenzfragen fallen weg."
2. **Liste *Betroffen*** nach Art (Space, Agent, Workflow, Skill, Bericht): Name, Eigentümer, Kritikalität aus der Registry (kritische zuerst), Zustand *bestätigt* oder *vermutet*, Fundstelle mit Ausschnitt, Knöpfe *Bestätigen* und *Kein Nutzer*.
3. **Karte:** Begriff in der Mitte, Abhängige rot (Modell), Nutzer als Knoten dahinter, *vermutete* gestrichelt.
4. **Kompetenzfragen:** welche der Fragen mit diesem Begriff nach der Änderung nicht mehr beantwortbar sind (vorhandene Prüfung `checkQuestion`, nach der Änderung gerechnet).
5. **Freigabe-Block:** Schalter *Freigeben* nur für den eingetragenen Freigeber (`approver`); gesperrt mit Grund, solange ein **kritischer** vermuteter Nutzer weder bestätigt noch verworfen ist (Regel in den Daten einstellbar). KI-Akteure geben nie frei.
6. **Nach der Freigabe:** Plan-Status *approved*, Protokolleintrag mit der vollständigen Nutzerliste und den Entscheidungen, Entwurf der Mitteilung an jeden Eigentümer (`planRequest` erweitert), **nichts wird gesendet**. Der Katalog selbst ändert sich weiter nur über den bestehenden Weg (`confirmed=true`).

## 7. Anbindung (technisch, klein gehalten)
- **Neue Datei** `src/ontology-usage.ts`: reine Funktionen `findUsages(terms, sources)`, `rankEvidence`, `summarize` (kein DOM, kein Netz, in Tests direkt aufrufbar), analog `graph-map.ts`.
- **Lader** in der Oberfläche: Registry über den vorhandenen `Api` (`list_work_items`, `get_work_item`), Skills über die IPC `list-skills`/`read-skill`, Spaces über die Space-Adressen. Fehlende Quelle heißt: Hinweis "Registry nicht erreichbar" und die Zahl der gelesenen Quellen steht im Ergebnis; nie stillschweigend leer.
- **Ablage:** `usageDecisions` additiv in `governance.json` (Migration 026 bleibt, die gemeinsame Datenbank nimmt das Dokument unverändert auf).
- **Connector:** `impact_of_term` bleibt wie er ist (liest das Modell). Die Suche nach Nutzern läuft in der App, nicht im Connector, damit sie die Registry-Karten ohne neue Tools lesen kann.
- **Beispielmodus:** Ohne Registry zeigt die Oberfläche die Beispiel-Nutzer aus `src/ontology-examples.ts` (beschriftet), damit die Demo auch offline läuft.

## 8. Tests (vorher festgelegt)
- **Finden:** Bezeichnung, Synonym und Mapping finden den Treffer; Wortgrenzen; Stoppliste; Feldgewichte; Mehrdeutigkeit (zwei Ontologien); Obergrenzen; leere Quelle ergibt leere Liste mit Hinweis.
- **Gleichheit mit dem Modell:** Die Zahl der betroffenen Modellstellen stimmt mit `impactOf` und der Karte überein (vorhandener Gleichheitstest wird erweitert).
- **Entscheidungen:** bestätigen wird zum `Binding`, verwerfen unterdrückt den Treffer, bleibt über Neustart erhalten, ältere `governance.json` lädt weiter.
- **Freigabe:** nur der eingetragene Freigeber, nie ein Agent; gesperrt bei offenem kritischem Nutzer; Protokoll enthält die Liste.
- **Oberfläche (jsdom):** Plan, Liste, Karte und Freigabe-Block rendern mit Beispieldaten ohne Fehler; hell und dunkel nur über Tokens.

## 9. Ehrlich benannt (Grenzen)
- **Treffer sind Textabgleich** und können falsch sein ("Revenue" in einem fremden Zusammenhang). Deshalb *vermutet*, mit Fundstelle, mit Entscheidung der Menschen.
- **Laufzeitnutzung** (ein Agent holt den Begriff erst beim Lauf) und Code in nicht erfassten Systemen bleiben unsichtbar.
- **Die Registry** ist hier eine Datenbank mit Karten, die Menschen gepflegt haben (Relationen, Tags). Ist eine Karte leer, finden wir nur über Name und Beschreibung.
- **Nicht getestet** (weil nicht gebaut): alles in diesem Dokument. Verlässlich messbar wird die Trefferqualität erst an echten Karten; Ziel ist ein Probelauf auf den Beispiel-Registry-Einträgen (`src/registry-examples.ts`) und den installierten Skills und Spaces, mit gezählten Treffern und falschen Treffern.
- Bei echten Kundendaten braucht es eine Prüfung, wer Einträge anderer Eigentümer sehen darf (Identität in der Werkbank ist nur ein Etikett).

## 9a. Aufwand (grobe Schätzung, ohne Gewähr)
Reine Logik und Tests: klein bis mittel. Lader für drei Quellen: mittel. Oberfläche (Liste, Freigabe-Block, Karte um zwei Knotenarten): mittel. Zusammen ein Branch, in drei Schritten lieferbar: (1) Logik und Tests, (2) Liste und Entscheidungen im Change plan, (3) Freigabe-Block und Karte.

## 10. Offene Fragen
1. **Kritikalität:** Soll ein offener vermuteter *mission-critical* oder *critical* Nutzer die Freigabe sperren, oder nur warnen?
2. **Wer bestätigt?** Der Eigentümer der Karte (Registry `owner`) oder der Freigeber der Ontologie? Mein Vorschlag: der Eigentümer bestätigt seinen Nutzer, der Freigeber sieht alles und gibt frei.
3. **Welche Spaces zählen?** Alle installierten, oder nur die einer Domain? (Mein Vorschlag: alle, mit Filter.)
4. **Sprache:** Begriffe auf Deutsch und Englisch: reichen Synonyme, oder braucht es eine Übersetzungsliste je Begriff?
5. **Demo-Daten:** Reichen die Beispiel-Registry-Einträge für den Fall *Deferred revenue*, oder legen wir passende Beispielkarten an (beschriftet)?
