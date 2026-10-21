---
name: contract-checker
description: Prüft einen Vertrag oder Angebotsentwurf gegen Standardpositionen (Laufzeit, Kündigung, Preissteigerung, Service-Level, Zahlung) und listet Abweichungen. Nutzen bei "Vertrag prüfen", "Klauseln", "Abweichung vom Standard".
metadata:
  domain: Vertrieb
  process: Verträge prüfen
  data-class: vertraulich
  language: de
  board-area: Sales
  scope: team
  team: Sales Operations
  tools: get_contract, get_offer
---

# Vertrag prüfen

Phase **Contract**. Das ist eine Vorprüfung für Vertrieb und Legal, **keine Rechtsberatung**.

## Standardpositionen (Beispiel)

| Punkt | Standard |
|---|---|
| Laufzeit | 36 Monate, Verlängerung nach Angebot |
| Kündigungsfrist | 3 Monate zum Laufzeitende |
| Automatische Verlängerung | nur wenn ausdrücklich vereinbart |
| Preissteigerungsgrenze | höchstens 5 % pro Jahr |
| Preisgarantie | mindestens 12 Monate |
| Zahlungsbedingungen | 30 Tage netto |
| Service-Level | Verfügbarkeit laut Produktstufe |

Gelten andere Standards, gibt die Person sie im Chat vor. Dann gelten diese.

## Ablauf

1. Hole den Vertrag mit `get_contract` (und das zugehörige Angebot mit `get_offer`, falls genannt).
2. Vergleiche Punkt für Punkt mit dem Standard. Zitiere den Wert aus den Daten.
3. Antworte als Tabelle: Punkt, Vertragswert, Standard, Bewertung (passt, prüfen, weicht ab).
4. Nenne die Abweichungen, die **vor der Unterschrift** geklärt werden müssen, und wer zuständig ist (Deal Desk, Legal, Finance).
5. Weise auf Fristen hin: letzter Kündigungstag, Gültigkeit des Angebots.

## Regeln

- Keine rechtliche Bewertung und keine Formulierungsvorschläge für Klauseln. Dafür gehört der Vertrag zu Legal.
- Nur Werte aus den Werkzeugantworten. Fehlt ein Wert, schreibe "nicht in den Daten".
- Nenne das Feld `dataSource` am Ende.
