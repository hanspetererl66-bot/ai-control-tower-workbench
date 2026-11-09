# Linear as a source for requirements

The connector `connectors/linear` reads Linear through its GraphQL API. It reads teams, projects and issues, and it can add **a comment to an issue**. That is the only change it can make: it cannot create, edit, move, assign or delete anything.

## Set-up (about 2 minutes, no admin needed)

1. Linear, Settings, Account, Security and access, **Personal API keys**, New key. Give it **Read** and, if comments should work, **Create comments**. Nothing more.
2. `npm run build:linear-mcpb`, install `dist/linear.mcpb` in the app (Skills and connectors) and paste the key. Restart the agent. Or `npm run connect:connectors -- --only linear` for a local checkout.
3. Ask the agent to run `linear_check_connection`: it shows your name and the workspace.

## Use

- **Start from requirements**, source "Linear": give a team key (`ENG`, reads the open backlog), an issue link or identifier (`ENG-12`), or search words. Each issue that states a need becomes one requirement (one issue is one voice, like Jira). Clusters, classification and the hand-over work as for the other sources.
- **Comments:** the agent is told to ask before it uses `linear_add_comment`. Nothing in the app writes to Linear yet; the preview-and-confirm flow like the Jira note comes in a later step.

## Limits

- Read access sees only what the key's owner sees. A team the owner is not in is not listed.
- Search is a case-insensitive "contains" on title and description (Linear's own full-text search is not used).
- Descriptions are cut (600 characters in a backlog, 4000 for one issue), comments to 800, and at most the last 10 comments of an issue are read.
- At most 50 issues per search and 100 per backlog; there is no paging.
- Rate limits of Linear answer as a readable message; the connector does not retry.
- **Not tested against a real Linear workspace:** only with a fake `fetch`. The GraphQL fields and filters (`issues(filter:)`, `state.type`, `commentCreate`) follow Linear's public schema but are unconfirmed here, as are the exact permission names of the key.
