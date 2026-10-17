# Werkbank

Werkbank is a local desktop workbench for AI-assisted conversations, file context,
persistent Spaces, MCP connectors, and reusable agent skills. The renderer talks to
a project-local [Goose](https://block.github.io/goose/) process through the Agent
Client Protocol; connector configuration and generated work stay in the local project
workspace.

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
