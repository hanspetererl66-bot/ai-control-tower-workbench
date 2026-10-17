# Werkbank website

This folder contains the Werkbank landing page, a small curated app store, and the
browser-to-app handoffs for MCPB bundles, hosted/local MCP configurations, and agent skills.

GitHub Actions publishes this directory to GitHub Pages from `main`. The repository may
remain private; the deployed website is intended to be public so connector READMEs can use
its guarded install pages and hosted button asset.

The catalog lives in `assets/catalog.mjs`. Its current shelf contains ARC-1, SAP Notes MCP,
SAP Docs MCP, and a reviewed subset of installable skills sourced from the public SAP AI MCP
catalog and SAP AI Skills Library. Refresh release URLs and skill review metadata before launch.

## Local preview

From the repository root:

```sh
python3 -m http.server 4173 --directory site
```

Then open `http://localhost:4173/`. Any generated install page can be inspected without launching
the app by adding `&auto=0` to its URL.

## README install button

Use the hosted SVG so the button renders even when the Werkbank source repository is private.
The link target must contain an HTTPS `.mcpb` URL encoded as the `url` query parameter.

```md
[![Add to Werkbank](https://getwerkbank.com/assets/add-to-werkbank.svg)](https://getwerkbank.com/install-mcpb/?url=https%3A%2F%2Fgithub.com%2Fmarianfoo%2Fsap-mcp-servers%2Freleases%2Fdownload%2Fsap-notes-latest%2Fsap-notes.mcpb&title=SAP%20Notes%20MCP)
```

The web page never installs a connector silently: it validates the source, opens the guarded
`werkbank://` deep link, and leaves the final review and confirmation inside the desktop app.

## Release checklist

1. Publish a signed Werkbank desktop build that registers the `werkbank://` protocol.
2. Confirm the desktop build can review and install the published SAP Notes MCPB bundle.
3. Confirm the Pages deployment for `getwerkbank.com` is healthy and HTTPS is enforced.
4. Refresh ARC-1's pinned MCPB release and confirm every skill still exists and remains suitable
   for one-click installation.
5. Verify the catalog search/filter behavior plus every valid, invalid-link, retry, copy, and
   download path.
6. Add the encoded `https://getwerkbank.com/install-mcpb/?url=...` button to connector READMEs.
