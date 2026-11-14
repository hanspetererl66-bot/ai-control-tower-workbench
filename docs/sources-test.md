# Real run: requirement sources against Jira Cloud and Slack

A test bed with a known answer. It creates invented requirements in a **test** Jira project and a **test** Slack channel, so you can check whether "Requirement collection" counts and clusters them correctly.

## What you need
- A Jira Cloud test project (key, for example `TB`) and an API token (`JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`).
- A Slack test channel and a bot token (`SLACK_BOT_TOKEN`, xoxb-…) with `chat:write`, `channels:read`, `channels:history`; invite the bot to the channel (`/invite @appname`). Private channels also need `groups:read`, `groups:history`.
- The Jira and Slack connectors installed in the app with the same credentials.

## Steps
1. Look first: `node scripts/sources-testbed.mjs --project TB --channel testbed` (dry run, changes nothing).
2. Create: `JIRA_SITE=… JIRA_EMAIL=… JIRA_API_TOKEN=… SLACK_BOT_TOKEN=… node scripts/sources-testbed.mjs --project TB --channel testbed --create` (`--only jira` or `--only slack` for one side). Run it once; running again creates duplicates.
3. In the app: Develop, Requirement collection. Read Jira (project `TB`, label `werkbank-testbed`) and Slack (the test channel).
4. Cluster and compare with `node scripts/sources-testbed.mjs --expect`.

## What to compare
| Check | Expected |
|---|---|
| Three clusters (Renewal reminders, Four-eyes approval, Dark mode) | all found, nothing merged wrongly |
| Mentions per cluster | 6 / 4 / 2 (Slack 5+1, 2+2, 1+1); one off is fine, two or more is a finding |
| Thread reply "+1, same for us in Legal" | counted for Renewal |
| Thread reply "Who could build that?" | not counted |
| Chatter (lunch, birthday, printer, all-hands, build green) | no requirement |
| Quotes | really appear in the Slack text, in the right cluster |
| Classification | feature for dark mode, agent or workflow for the others |

Note the limits: all Slack messages come from one bot, so "distinct people" cannot be tested (the names are in the text only). Nothing is deleted by the script; remove the Jira issues by label `werkbank-testbed` and the Slack messages marked `[testbed]` by hand.
Write down what differs; that decides what to improve (prompts, quote check, counting).
