# Renewals: Prozess vollständig abbilden, mehrere Produkte, Zufriedenheit als Churn-Signal

Stand 11.11.2026. Recherche und Konzept, **nichts davon ist gebaut**. Grundlage: Durchsicht des Space `examples/renewals/` (Stand `main`) und Websuche. Die Quellen sind überwiegend Hersteller-Blogs, keine unabhängigen Studien; genannte Zahlen sind Konventionen, keine Messwerte. Nicht getestet wurde hier nichts neu: alles ist Lesen des Codes und der Quellen, kein Lauf des Space.

## 1. Ausgangslage (aus dem Bestand)

Die drei Beispielkunden haben schon mehrere Produkte (21 Fälle in `renewals.json`):

| Kunde | Verträge | Jahreswert | Besonderheit in den Daten |
|---|---|---|---|
| Muster Industrie AG | 8 | 1.863.100 EUR | Eskalation (AI-Core-Kontingent), drei Tickets auf einem Vertrag, Concur Travel ungenutzt und abgelaufen, vier Enddaten bei den laufenden Verträgen |
| Hanse Handelsgruppe AG | 7 | 1.033.450 EUR | Neuer CFO, Wunsch nach einem Bündel (Commerce und Analytics), Angebote für Commerce Cloud und Integration Suite über dem Preis-Cap, Integration Suite abgelaufen, vier Enddaten |
| Lindenau Pharma AG | 6 | 780.600 EUR | GxP und Validierung als Bremse, Upgrade blockiert, Ariba abgelaufen, vier Enddaten |

Was der Space heute kann (rechnet, handelt nicht): Entscheidungsdatum, Gesundheit je **Vertrag** aus neun Signalen (das schlechteste gewinnt), Phase, alternative Angebote mit Retention und Lebenszeitwert, bis zu drei nächste Aktionen, Eignung für die „Automatic renewal“ (unter 30.000 EUR, kein Warnsignal). Senden und Unterschreiben sind simuliert, nichts geht an einen Kunden.

Was fehlt:
- keine Gesundheit je **Kunde** über mehrere Produkte, kein Ausweis von Teil- und Gesamt-Churn
- keine Zufriedenheit (CSAT) als Signal; vorhanden sind nur die Mail-Stimmung (`mood`), Tickets und die Eskalation
- kein Co-Terming (mehrere Verträge auf ein Enddatum)
- Verhandeln, Bestellung und Win-back sind nur Text
- keine Deal-Desk-Freigabe als Schritt; die Automatik prüft Rabatt und Deal Desk nicht
- der Fortschritt (Stufe) liegt nur im Speicher der Seite
- Unstimmigkeit in den Beispieldaten: die Hanse-Mail H-202 spricht von einem Ariba-Preisanstieg über dem Cap (Vertrag C-2025-0458), dieser Vertrag steht nicht in den Fällen und Hanse hat kein Ariba
- Stichtag der Seite fest `2026-10-19`, die Briefing-Karten im Chat rechnen mit dem aktuellen Datum (README behauptet Gleichheit)

## 2. Befunde der Recherche

| Thema | Befund |
|---|---|
| Zeitplan | Meilensteine bei 180, 120, 90, 60 und 30 Tagen vor dem Ende; große Kunden starten bei 180. Die Quellen streiten über den Start (90, 120 oder 180). Die sieben Phasen des Space passen dazu. |
| Health-Score | Gewichteter Verbund; Nutzung ist der größte Anteil (genannt 35–45 %), Support etwa 20 %. Gewichte gehören gegen die **eigene** Churn-Historie geprüft, sonst ist der Score „Dekoration“. Wir haben keine Historie. |
| CSAT und NPS | Allein schwache, nachlaufende Signale; Verhalten (Nutzung, Tickets, Beziehung) sagt Abwanderung besser voraus. In kleinen Konten schwankt der Wert stark. Antwortquote im B2B 15–30 % (nur ein Hersteller). Keine unabhängige Studie zu Antwortverzerrung gefunden. |
| CSAT-Arten | Beziehungsumfrage (ganzer Kunde) und Vorgangsumfrage (ein Ticket) beantworten verschiedene Fragen und werden nicht gemittelt. Im B2B ist der „Kunde“ ein Konto mit vielen Personen. |
| Mehrere Produkte | Umsatzgewichteter Durchschnitt plus **Boden** (ein gefährdetes strategisches Produkt verhindert „gesund“), dazu das schwächste Produkt zeigen. Ein einfacher Durchschnitt versteckt Risiko. |
| Teil-Churn | GitLab trennt Teil-Churn (einige Verträge enden) und Gesamt-Churn (alle). |
| Co-Terming | Mehrere Verträge auf ein Enddatum; Anker meist das nächste Ablaufdatum, Zukäufe werden anteilig berechnet. Rat: Modulpreise dabei neu verhandeln. |

**Nicht belegt oder nicht recherchiert:** wen im Konto man befragen sollte (Sponsor, Einkauf, Anwender); SAP-spezifische Abläufe (Order Form, Renewal Quote); wie gut Zufriedenheit Abwanderung bei SAP-Kunden vorhersagt.

## 3. Vorschlag

**Zwei Ebenen.** Kunde → Verträge. Gesundheit je Vertrag wie heute; je Kunde umsatzgewichtet, mit Boden und Hinweis auf das schwächste Produkt. Teil-Churn und Gesamt-Churn getrennt ausweisen.

**Zufriedenheit als Signal, nicht als Vorhersage.** Drei getrennte Quellen:
1. Beziehungs-CSAT je Kunde und Quartal (1–5), mehrere Rollen, mit Konfidenz (Anzahl und Alter der Antworten)
2. Vorgangs-CSAT je Ticket, damit je Produkt
3. Mail-Stimmung (Feld `mood`, vorhanden)

Anzeige wie die vorhandenen Signale: gelb oder rot mit Begründung. Schwellen sind Annahmen. Eine gewichtete Summe erst bauen, wenn echte Verlängerungs-Historie vorliegt; bis dahin die Regeln erweitern, keine Gewichte erfinden.

**Beispielbogen je Kunde** (aus Fakten, die in den Daten stehen):
- Muster: Sponsor zufrieden, Fachbereich nicht (Eskalation, drei Tickets); Teil-Churn Concur Travel; vier Enddaten für Co-Terming
- Hanse: Bündelwunsch des CFO, Angebote über dem Preis-Cap (Commerce Cloud, Integration Suite), mittlere Zufriedenheit
- Lindenau: hohe Nutzung, aber niedrige Zufriedenheit bei Quality Assurance wegen des blockierten Upgrades; Win-back Ariba

**Lücken im Prozess schließen:**

| Phase | Was fehlt |
|---|---|
| Watch | tägliche Aktualisierung (Scheduler-Job), Erinnerung vor dem Entscheidungsdatum |
| Prepare | Umfrage-Entwurf, Versand als Entwurf |
| Offer | Bündelangebot mit Ankerdatum und Anteilsberechnung, Deal-Desk-Freigabe als eigener Schritt, Preis-Cap-Prüfung |
| Negotiate | Verhandlungsstand, Erinnerung an die Angebotsgültigkeit |
| Decide | Entscheidung je Vertrag (verlängert, angepasst, gekündigt), Teil- oder Gesamt-Churn |
| Order | Übergabe an den Space Order-to-Cash |
| Win-back | Fall mit Schritten und Verantwortlichem |

Dazu: Ereignisprotokoll je Schritt, Fortschritt über Neuöffnen hinaus, Automatik nur mit Deal-Desk-Prüfung, ein einheitlicher Stichtag.

## 4. Offene Entscheidungen

1. Quelle der Zufriedenheit: erfundene Umfrageergebnisse für die Demo (klar als Beispiel markiert) oder Anbindung an echte Tickets und Umfragen. Empfehlung: erfundene Werte, weil echte Quellen fehlen.
2. Umfang des ersten Schritts: zuerst Datenmodell und Kundenebene mit Zufriedenheit, danach Prozessphasen und Co-Terming. Empfehlung: in kleinen Schritten.
3. Soll die Automatik ohne Freigabe einer Person weiter möglich sein? Aktuell überspringt sie die Freigabe vollständig.

## Quellen

- [How to Build a Customer Health Score That Predicts Churn](https://blog.buildbetter.ai/how-to-build-a-customer-health-score/)
- [Customer Health Score Says Green but They're Leaving?](https://blog.buildbetter.ai/why-your-health-score-is-green-but-the-customer-is-churning/)
- [How to Build a Customer Health Score That Actually Predicts Churn (Statisfy)](https://www.statisfy.com/blog/customer-health-score-predict-churn)
- [The 5 Inputs a Customer Health Score Needs Beyond Product Usage](https://www.enterpret.com/guides/the-5-inputs-a-customer-health-score-needs-beyond-product-usage)
- [What CX metrics actually predict churn in B2B support](https://www.supportbench.com/?p=24226)
- [Behavioral signals vs NPS: which predicts churn in B2B](https://www.producthunt.com/p/churnbase/behavioral-signals-vs-nps-which-actually-predicts-churn-in-your-b2b)
- [Transactional and relationship surveys: They're different](https://customerthink.com/transactional-and-relationship-surveys-theyre-different/)
- [NPS and satisfaction surveys (Rework)](https://resources.rework.com/libraries/post-sale-management/nps-satisfaction-surveys)
- [SaaS Renewal Process: Step-by-Step Guide & Timeline](https://www.cloudnuro.ai/blog/renewal-workflow)
- [A step by step guide to retention, renewals and expansion](https://www.customersuccesscollective.com/a-step-by-step-guide-to-retention-renewals-and-expansion/)
- [GitLab Renewals Managers: How we do it](https://handbook.gitlab.com/handbook/customer-experience/renewals-managers/how/)
- [Co-term subscriptions (Nue)](https://www.nue.io/how-nue-works/co-term-subscriptions/)
- [Co-term a subscription pack (JetBrains)](https://sales.jetbrains.com/hc/en-gb/articles/26390351096338-Co-term-a-subscription-pack)
- [ServiceNow co-terming](https://redresscompliance.com/servicenow-co-terming-align-contract-dates.html)
- [Dynamic relationship roll-up to company health weighting (Gainsight community)](https://communities.gainsight.com/customer-success-cs-15/dynamic-relationship-roll-up-to-company-health-weighting-17917)
- [Health scores (Vitally docs)](https://docs.vitally.io/account-health-scores-and-metrics/health-scores)
