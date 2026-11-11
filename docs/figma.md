# Figma as a source for requirements

The connector `connectors/figma` reads Figma through its REST API. It is **read only**: every call is a GET, so it cannot comment on, edit, move or delete anything in Figma (a test checks that no other HTTP method appears).

## Set-up (about 2 minutes, no admin needed)

1. Figma, Settings, Security, **Personal access tokens**, Generate new token. Read scopes only: File content (read), Comments (read), Projects (read).
2. `npm run build:figma-mcpb`, install `dist/figma.mcpb` in the app (Skills and connectors) and paste the token. Or `npm run connect:connectors -- --only figma` for a local checkout. Restart the agent.
3. Ask the agent to run `figma_check_connection`, or use the Figma card under "Connect your tools" on the Connectors page ("Test connection").

## Use

- **Start from requirements**, source "Figma": paste a file or frame link (Share, Copy link; `?node-id=` picks one frame) or a file key. The agent reads the **open comments** first (a comment that states a need or a change becomes a requirement) and, where a design states rules, the **text in up to 5 frames**. Several comments saying the same count as mentions with quotes, like Slack and Notion. Clusters, classification and the hand-over work as for the other sources.
- Tools: `figma_check_connection`, `figma_list_project_files`, `figma_get_file_outline` (pages and top-level frames), `figma_read_frame_text` (up to 10 frames), `figma_list_comments` (open, resolved or all, with replies).

## Limits

- The agent gets **text only**. It does not see the pictures, layout, colours or prototypes, and is told not to claim what a screen looks like. No image export, no variables or styles, no Dev Mode annotations as such (only their text if it sits in the file).
- Read access covers what the token's owner can open. A file the owner cannot see answers 403.
- Frame text is cut at 150 text items or 6000 characters per frame; comments at 100 threads, 10 replies each, 600 characters per comment. One outline reads two levels deep (pages and top-level frames). No paging.
- No search across files and no team-wide listing; give a file link or a project id.
- No writing back (no comment in Figma from the app).
- Rate limits of Figma answer as a readable message; the connector does not retry.
- **Not tested against a real Figma file:** only with a fake `fetch`. Endpoints (`/v1/me`, `/v1/files/:key?depth=2`, `/v1/files/:key/nodes`, `/v1/files/:key/comments`, `/v1/projects/:id/files`) and the scope names follow Figma's public REST documentation but are unconfirmed here; the comment link is built from the file key, node id and comment id and may not open exactly that comment. Not tested in the Electron app or with the real agent (whether it picks the tools and answers valid JSON).
