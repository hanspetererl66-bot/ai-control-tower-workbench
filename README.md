# Joule - Diamond Edition

Joule - Diamond Edition (a private prototype, based on the open-source [Werkbank](https://github.com/marianfoo/werkbank) by marianfoo) is a local desktop workbench for AI-assisted conversations, file context,
persistent Spaces, MCP connectors, and reusable agent skills. The renderer talks to
a project-local [Goose](https://block.github.io/goose/) process through the Agent
Client Protocol; connector configuration and generated work stay in the local project
workspace.

> **Not affiliated with SAP.** "Joule" is the name of an SAP product. This is an independent prototype in a similar style; it is not
> SAP software and is not endorsed by SAP. Internal identifiers (the `werkbank://` link scheme, storage keys, package name) keep
> the original name so existing links and data keep working.

## What works

- Streaming conversations with stop, permission, and mode controls
- Multiple active and archived conversations stored locally
- Word, PowerPoint, text, CSV, JSON, and image attachments
- Persistent, sandboxed HTML Spaces generated from grounded data
- Session-scoped MCP connector selection and guarded `.mcpb` imports
- Connector configuration with secret-shaped values stored through Electron safe storage
- Skill install deep links with an explicit in-app confirmation step
- Light, dark, and system appearance settings

## Local development

Werkbank currently targets macOS for source-based development. Node.js 22.12 or newer
is required.

```sh
npm install
cp .env.example .env
# Add OPENROUTER_API_KEY and choose a compatible GOOSE_MODEL in .env
npm run dev
```

The app uses the repository-local `goose-home/` and `workspace/` directories. Runtime
credentials, selected attachments, generated Spaces, and outputs are ignored by Git.
Only the files under `workspace/demo-files/` are synthetic fixtures intended for tests.

## Using the app store

The current release runs from source, so start Werkbank before using an install button:

1. Complete the local setup above and keep `npm run dev` running with the Werkbank window open.
2. Open the [Werkbank app store](https://getwerkbank.com/#store) in your browser.
3. Choose an MCP server or skill and select **Add to Werkbank** or **Add skill**.
4. On the install page, select **Open Werkbank** and allow the browser to open the
   `werkbank://` link.
5. Review the source and requested configuration inside Werkbank, provide any required
   credentials, and confirm the installation.

Installed items appear under **Connectors & Skills** in the app, where connectors can be
configured, restarted, or removed. If an install page does not return to the app, confirm
that the Werkbank window is still running, reload the install page, and select
**Open Werkbank** again.

## AI Control Tower example Space

This fork bundles an AI Control Tower dashboard (illustrative sample data) as a Space.
Install it into the spaces folder with:

```
npm run install:control-tower
```

It then appears in the Spaces list. The source lives in `examples/control-tower/`.

The risk register is data-driven: edit `examples/control-tower/data.json`, then run
`npm run sync:control-tower` to embed it into the page (a Space cannot fetch files
from inside the sandbox). `npm test` fails if the two drift apart.

### Control Tower connector (MCP)

`connectors/control-tower/` is a small, dependency-free MCP server that lets the chat
query the same `data.json` the Space renders: risks, agent registry, unregistered
assets, overprivileged agents and the AI budget. All tools are read-only.

```
npm run build:control-tower-mcpb     # writes dist/ai-control-tower.mcpb
```

Then in Werkbank open **Connectors & Skills**, choose **Import MCP bundle**, pick the
file and confirm. Ask, for example, "Which risks are below 40% mitigated?". Edits to
the bundled `data.json` apply without restarting the agent. Every result carries a
`view` field naming the Control Tower tab that shows the same information.

## Verification

```sh
npm run check
```

This runs the TypeScript check, Node test suite, and production renderer build.

## Connectors and skills

Use **Connectors & Skills** inside the app to import an MCP bundle, configure an
installed connector, restart the local agent, or remove a connector or skill. Browser
handoffs use the `werkbank://` protocol and always stop at an in-app review dialog.

[![Add SAP Notes MCP to Werkbank](https://getwerkbank.com/assets/add-to-werkbank.svg)](https://getwerkbank.com/install-mcpb/?url=https%3A%2F%2Fgithub.com%2Fmarianfoo%2Fsap-mcp-servers%2Freleases%2Fdownload%2Fsap-notes-latest%2Fsap-notes.mcpb&title=SAP%20Notes%20MCP)

Connector maintainers can use the same button in their own README. Replace the encoded
bundle URL and title in the link target; the hosted page validates the HTTPS source and
opens Werkbank's guarded in-app confirmation. See [`site/README.md`](site/README.md) for
the copyable Markdown.

## Publication status

The source, static website, and guarded install handoffs are release-prepared. A signed,
notarized desktop installer is not included yet; follow the order in
[`site/README.md`](site/README.md) before publishing the website or advertising binary
downloads.

## License

[Apache License 2.0](LICENSE)

### Supabase as data source (optional)

The connector reads the sample data from Supabase when `Supabase project URL` and
`Supabase secret key` are filled in on import; otherwise it uses the bundled `data.json`.
If Supabase is configured but unreachable, it falls back to `data.json` and every result
carries a `dataSource` field saying which one was used.

- `supabase/migrations/` creates the `control_tower` schema (RLS on, no access for `anon`/`authenticated`),
  seeds it from `data.json`, and adds `public.control_tower_snapshot()`, executable only by the server-side key.
- Use a **secret** key (`sb_secret_…`) of a project that holds only this sample data. It bypasses RLS,
  so never put it in the repo; Werkbank stores it as a secret.
- Read-only: the connector has no write tools. `data.json` stays the source for the embedded dashboard.

### Chat → dashboard

After an answer that used the Control Tower connector, the chat shows a button such as
"Im Control Tower ansehen: Risk & Compliance". It opens the Space and switches to the tab that shows the
same information (`src/control-tower-views.ts`: risks → Risk & Compliance, agents → Agent Repository,
budget → Model Governance). The Space only accepts a `ct:open-tab` message from its parent window and
only for tab ids that exist on the page. After pulling, run `npm run install:control-tower` once so the
installed Space contains the updated page.

### Cover sheet and one-click connector

- Clicking the diamond at the top of the left rail opens a full-screen cover sheet:
  "Joule - Diamond Edition · Prototype · Built by Accenture · Demo only". Click anywhere outside the
  text, "Close" or Esc to dismiss it.
- If the AI Control Tower connector is not installed or not connected, the empty chat says so and offers
  **Jetzt installieren**. That stages the connector bundled in this repository and opens the usual approve
  dialog; the Supabase URL and key fields can stay empty to use the sample data. No `.mcpb` file is needed.

