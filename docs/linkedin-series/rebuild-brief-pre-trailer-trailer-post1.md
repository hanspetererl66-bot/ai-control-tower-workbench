# Neubau: Pre-Trailer, Serien-Trailer, Post 1 (Auftrag für die Produktion, Stand 14.11.2026)

Grundlage: `docs/linkedin-series.md` (14 Deep Dives, Hook und Brücke je Post, Casimir in jedem Video, Manager-Dramaturgie). Gesprochene Texte auf Englisch, Auftrag auf Deutsch. Nummern und Zeiten sind Richtwerte.

Gemeinsam für alle drei Videos:
- Hook **vor** "Hi, I am …" und vor der Wäscheleine, erstes Bild trägt die Spannung auch ohne Ton (LinkedIn spielt stumm ab, keine Untertitel; Texteinblendung im Hook nur, wenn Hans-Peter es freigibt).
- Casimir (der violette Pixel-Kater) ist in Intro und Outro zu sehen. Name im Sprechertext höchstens einmal.
- Intro und Outro wie bisher (Lavendel, Diamant, Mausloch, Footer, Accenture-Seite). Kein Rot.
- Die Zahl im gesprochenen Intro lautet jetzt **fourteen** (bisher eighteen). Einheitlich "deep dives" statt "short stories" ist ein Vorschlag; den bisher abgenommenen Wortlaut mit "short stories" behält Hans-Peter, solange er nichts anderes sagt.

## 1. Pre-Trailer "Under the hood"
Länge ca. 90 s. Gag: Casimir läuft von links nach rechts (Start und Ende), wie bisher.

| Abschnitt | Sprechertext (weibliche Stimme, natürlich, mit Pausen) |
|---|---|
| **Hook (0:00)** | "One desktop app. Fourteen stories. And here is what is under the hood." |
| Intro | "Accenture developed a design and feature study, provided as open source, demonstrating high-value customer use cases for SAP Joule Work and SAP Joule Studio. One possible direction for their evolution, in fourteen short stories!" |
| Joule Work X | "This is Joule Work X. An evolution of the new innovative experience layer Joule Work and Joule Studio from SAP." |
| Start | "It starts on GitHub with Werkbank, an open-source desktop workbench by marianfoo. We forked it, and extended it into a design study for Joule Work and Joule Studio!" |
| Stack | "The stack is light and modern: Vite, React and TypeScript, packaged as an Electron desktop app." |
| Agenten und Connectoren | "An agent runtime, Goose, talks through the Agent Client Protocol. MCP connectors plug it into the landscape: an SAP mock, ARC-1, the MCP server for SAP, n8n, Jira, Slack, Notion, Linear, Figma, Teams, SmartRecruiters, Databricks, and a read-only monitoring connection! And one more group: import. Bring in a Notion page, a Slack thread or a Jira ticket, by link or ID." |
| AI-Gateway | "A new AI gateway layer: OpenRouter and Hugging Face. One door to hundreds of models, open and closed." |
| SAP-Schicht | "And a new SAP layer: the SAP Business Accelerator Hub, and an SAP sandbox system. Real SAP interfaces, safe to try!" |
| Prognosen und Gedächtnis | "For forecasts, TabPFN from Prior Labs, a model for tabular data. A Cognee knowledge graph gives the agents memory." |
| Datenschicht | "Supabase is the data layer: projects, work items, skills, and the renewal cases." |
| Gebaut mit | "And how was it built? With Claude Code! Every change is a pull request, with automated checks and more than a thousand tests. Merged only when the author says so." |
| Schluss | "Accenture developed a design and feature study. The next post describes the first edition. Stay tuned!" |
| Outro | "So, what is this all about? Follow along, and find out!" |

Änderungen gegenüber der alten Fassung: Hook vorangestellt; "fourteen" im Intro; die Connectorliste um Notion, Linear, Figma, Teams und das lesende Monitoring ergänzt (alle im Repo vorhanden, Stand `main` 14.11.2026); Supabase nennt jetzt auch Skills und Renewal-Fälle; Testzahl "more than a thousand" statt "more than a hundred" (Testsuite zuletzt 1109 Tests am 05.11.2026, der aktuelle Stand ist nicht neu gezählt).
Ungeprüft: ob alle genannten Connectoren in der laufenden Desktop-App bei Hans-Peter aktiv sind.

## 2. Serien-Trailer
Text, Zeiten und Musikbeschreibung stehen in `docs/linkedin-series.md`, Abschnitt "Auftrag: Serien-Trailer mit 14 Folgen". Ergänzungen für die Produktion:
- Die Teaser ziehen ihre Bilder aus den **neuen** Spaces (Ontology Manager, Revenue Recognition, Renewals Heute-Ansicht, AI Governance-Einstieg, Autonomous Operations), nicht aus den alten Clips.
- Casimir: kurzer Auftritt in jedem dritten Teaser, am Ende sitzt er vor dem Mausloch. Letzter Satz: "Casimir knows where the diamond went."
- Stimme: weiblich, mittleren Alters, energiegeladen, empathisch, warm, leicht amerikanisch, klar gesprochen, wenig synthetisch. Musik: eigener Afro-House, 122 bis 124 BPM, kein bekannter Titel.

## 3. Post 1, Tour (Sprecher Ben)
Länge ca. 2:00. Gag wie bisher: ein Shirt an der Leine, Casimir läuft durch das Intro und schaut am Outro vom Bildrand.

| Abschnitt | Sprechertext |
|---|---|
| **Hook (0:00)** | "Imagine your whole workday in one window." (Bild: Rail, Liste und Chat bauen sich nacheinander auf) |
| Begrüßung | "Hi, I am Ben! Design Study twenty twenty-six: how Joule Work and Joule Studio could evolve. Ideas of future features, within an MVP. Not a finished product." |
| Überblick | "Let us start with the overview. On the far left, the narrow bar is the rail. Next to it, the list of your conversations. And on the right, the chat window, where you work with Joule." |
| Rail | "From top to bottom: Conversations. Spaces, your work organized by domain. Develop, for workflows, agents and skills. The Scheduler. Admin. And at the bottom: help, your settings, and your profile." |
| Chat | "The chat starts with four tabs: Favorites, Suggested, Popular, and What's new." |
| Spaces | "Spaces are small dashboards, grouped by domain, with subspaces. Drag one onto another, and it moves in. And every Space can be changed with Joule, right from the top." |
| Develop | "Develop guides you in five steps: intent, requirements, specification, build, and test and go live." |
| Skills | "Skills are reusable abilities for Joule, on three levels: personal, department and company. A skill moves up only with an approval." |
| Scheduler | "The Scheduler runs agents, workflows or skills, daily, weekly, monthly, or by cron." |
| Einstellungen (neu) | "And your settings: skins, profiles, memory, and the rules for what Joule may do. Yours to shape." |
| Schluss | "A design study. Fourteen stories follow." |
| **Brücke** | "But what does the assistant actually know about you?" |

Änderungen gegenüber der alten Fassung: Hook; "exciting new features" ersetzt durch "ideas of future features" (wie bei Post 2 und 3 abgenommen); "Skills with governance" und Scheduler gekürzt (eigene Deep Dives); Einstellungen als Vorschau auf Post 2; Brücke zu Post 2. Der Teil "Chat mit vier Tabs" bleibt, weil er im Video vor dem Chatfenster-Deep-Dive zu sehen ist.

## Offen, vor dem Bau zu klären
1. Texteinblendung im Hook: ja oder nein?
2. "fourteen short stories" oder "fourteen deep dives" im gesprochenen Intro (einheitlich für alle Posts)?
3. Bildmaterial: Die Spaces und Intro/Outro-Szenen liegen im Produktionschat. Dort sind die Aufnahmen für Rail, Spaces, Develop und Settings aus dem aktuellen `main` neu zu ziehen (Skins, Titel in Sales-Stil, Spaces-Liste als Baum oder als Leiste).
4. Sprecher: Ben, die Trailer-Sprecherin und die Pre-Trailer-Sprecherin bleiben; die Stimmen der neuen Posts sind separat zu klären.
