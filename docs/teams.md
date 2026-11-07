# Microsoft Teams as a source for requirements

The connector `connectors/teams` reads Teams through Microsoft Graph. It only reads: teams, channels, channel messages and replies. Nothing is posted.

## Set-up (about 10 minutes, needs an Entra admin once)

1. Azure portal, Microsoft Entra ID, App registrations, New registration. Name "Werkbank Teams (read)", single tenant. Copy the **Application (client) ID** and **Directory (tenant) ID**.
2. Certificates and secrets, New client secret. Copy the **value** (shown once).
3. API permissions, Add, Microsoft Graph, **Application permissions**: `ChannelMessage.Read.All`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Group.Read.All`. Then **Grant admin consent**.
4. `npm run build:teams-mcpb`, install `dist/teams.mcpb` in the app (Skills and connectors) and enter tenant id, client id and secret. Restart the agent.

**First try without an app registration:** in Graph Explorer sign in, consent to `ChannelMessage.Read.All`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, copy the access token and paste it into "Access token". It lasts about an hour and wins over the app registration.

## Use

Start from requirements, source "Microsoft Teams". Give a team and channel ("Sales / Requirements"), search words, or a link from "Copy link to message". The agent reads, merges repeated statements into one requirement with a count and quotes (like Slack and Notion), and the clusters add them up.

## Limits

- Reading channel messages with an app registration is a "protected API": Microsoft may ask you to request access for the tenant (a form, a few days) before application permissions work. With a delegated access token it works at once for the channels you can see.
- Private and shared channels need the permission per channel; chats (1:1, group) are not read.
- Only the newest messages of a channel are read (up to 50, first page); there is no Graph search across channels in this connector.
- Message text is cut to 1500 characters; attachments and images are not read.
- Listing teams with an app registration goes through `/groups` (needs `Group.Read.All`); that path and the exact permission names are **not confirmed against a real tenant**.
