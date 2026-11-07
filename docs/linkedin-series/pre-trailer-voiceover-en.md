# Pre-trailer "Under the hood" – spoken text (female voice)

## Intro (screens 1 and 2)
Accenture developed a design and feature study covering high-value customer use cases for SAP Joule Work and SAP Joule Studio. One possible direction for their evolution, with exciting new features!
These are possible design and deployment proposals within an MVP. Not a finished product.
Here is the underlying technology stack.

## Joule Work X – Next Gen
This is Joule Work X, Next Gen. A design study from Accenture Germany.

## Under the hood
Before the series starts, let us look under the hood. How is this design study built?

## Starting point: GitHub
It starts on GitHub with Werkbank, an open-source desktop workbench by marianfoo. We forked it, and extended it into a design study for Joule Work and Joule Studio!

## The stack
The stack is light and modern: Vite, React and TypeScript, packaged as an Electron desktop app.

## Agents and connectors
An agent runtime, Goose, talks through the Agent Client Protocol. And MCP connectors plug it into the landscape: an SAP mock, ARC-1, the MCP server for SAP, n8n, Jira, Slack, SmartRecruiters, and Databricks! And one more group of interfaces: import. Bring in a Notion page, a Slack thread or a Jira ticket, by link or ID.

## A new SAP layer
And a new SAP layer: the SAP Business Accelerator Hub, and an SAP sandbox system. Real SAP interfaces, safe to try!

## Forecasts and memory
For forecasts, we use TabPFN from Prior Labs, a model for tabular data. And a Cognee knowledge graph gives the agents memory.

## Data layer
Supabase is the data layer: projects, work items, and the skill lifecycle.

## Built with Claude Code
And how was it built? With Claude Code! Every change is a pull request, with automated checks and more than a hundred tests. Merged only when the author says so.

## Closing
Accenture developed a design and feature study. The next post describes the first functional block. Stay tuned!

## Outro
So, what is this all about? Follow along, and find out!
