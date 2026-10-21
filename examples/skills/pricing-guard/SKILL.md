---
name: pricing-guard
description: Prüft ein Angebot gegen Rabattschwellen und Freigaberegeln und sagt, ob Deal Desk oder Vorgesetzte zustimmen müssen. Nutzen bei "Rabatt prüfen", "Angebot freigeben", "Deal Desk".
metadata:
  domain: Vertrieb
  process: Preise und Rabatte prüfen
  data-class: vertraulich
  language: de
  board-area: Sales
  scope: team
  team: Deal Desk
  tools: get_offer, list_offers, get_contract
---

# Preise und Rabatte prüfen

Phase **Sell**. Preise und Rabatte sind vertraulich. Du prüfst, du entscheidest nichts.

## Regeln der Beispieldaten

- Rabatt **bis 15 %**: Freigabe durch die Account Executive genügt.
- Rabatt **über 15 %**: Freigabe durch den Deal Desk nötig (so steht es im Feld `approval` der Beispielangebote).
- Preissteigerungsgrenze und Preisgarantie müssen zum Vertrag passen.

## Ablauf

1. Hole das Angebot mit `get_offer` (oder suche mit `list_offers`). Bei Verlängerungen hole den Vertrag mit `get_contract`.
2. Vergleiche: Listenpreis, Rabatt in %, Jahreswert, Laufzeit, Preisgarantie in Monaten, Preissteigerungsgrenze, Zahlungsbedingungen.
3. Prüfe die Schwelle und das Feld `approval`: Passt der Status zur Höhe des Rabatts?
4. Bei Verlängerung: Ist der Rabatt höher oder niedriger als im Vertrag, und was bedeutet das für den Jahreswert?
5. Antworte in drei Teilen: **Befund** (eine Zeile mit Ampel: grün, gelb, rot), **Abweichungen** (Tabelle: Punkt, Wert, Regel), **Nächster Schritt** (wer muss was freigeben).

## Regeln

- Rechne nach und nenne die Rechnung (Listenpreis mal Rabatt gleich Jahreswert). Zahlen nur aus den Werkzeugantworten.
- Keine Rabatte vorschlagen, keine Zusagen formulieren. Verhandlungsspielraum benennt nur die Person mit Verantwortung.
- Prüfe auch das Feld `dataSource` und nenne es am Ende.
