#!/usr/bin/env node
// Generate an "Add to Werkbank" install badge for an MCP server README.
//
//   node scripts/make-badge.mjs --name sap-docs --command npx --args "-y,@marianfoo/mcp-sap-docs"
//   node scripts/make-badge.mjs --name arc1-2023 --url https://arc1-2023.example.com/mcp
//
// Emits the deep link plus ready-to-paste Markdown and HTML. Same encoding
// convention as Cursor's and VS Code's MCP install links: base64url JSON in a
// `config` query param.

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const name = opt('--name');
const url = opt('--url');
const command = opt('--command');
// For servers that need credentials, put the whole config (including MCPB-style
// user_config) in a file — flags get unreadable fast.
const from = opt('--from');
// Point the button at a hosted .mcpb instead of inlining config — one artifact
// then serves both Claude Desktop and Werkbank.
const mcpbUrl = opt('--mcpb-url');
const label = opt('--label') ?? 'Add to Werkbank';
const description = opt('--description');

if (mcpbUrl && !/^https:\/\//.test(mcpbUrl)) {
  console.error('--mcpb-url must be https');
  process.exit(1);
}

if (!name || (!url && !command && !from && !mcpbUrl)) {
  console.error('usage: --name <slug> (--url <https-endpoint> | --command <npx|uvx|node|…> [--args "a,b"] | --from <config.json> | --mcpb-url <https .mcpb>)');
  console.error('       [--description <text>] [--label <button text>]');
  process.exit(1);
}

const config = mcpbUrl ? {} : from
  ? JSON.parse(readFileSync(from, 'utf8'))
  : url
    ? { type: 'streamable_http', url, ...(description ? { description } : {}) }
    : {
        command,
        args: (opt('--args') ?? '').split(',').filter(Boolean),
        ...(description ? { description } : {}),
      };

const link = mcpbUrl
  ? `werkbank://install-mcpb?url=${encodeURIComponent(mcpbUrl)}`
  : `werkbank://install-mcp?name=${encodeURIComponent(name)}&config=${Buffer.from(
      JSON.stringify(config)
    ).toString('base64url')}`;

// The host validates every field again on arrival — this is convenience, not trust.
const shield = `https://img.shields.io/badge/${encodeURIComponent(label.replace(/-/g, '--'))}-6d28d9?style=for-the-badge&logo=data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><path d="M22 4 38 20 22 40 6 20z" fill="#fff"/></svg>'
).toString('base64')}`;

/**
 * Button-style SVG, sized to hug its label. shields.io looks like a badge; this
 * looks like the install buttons vendors put in their docs. Text stays as text
 * (not paths), so a viewer on another OS may render it a hair wider or narrower
 * — acceptable for a label this short.
 */
const buttonSvg = (text) => {
  const w = Math.round(50 + text.length * 8.6 + 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44" viewBox="0 0 ${w} 44" role="img" aria-label="${text}">
  <title>${text}</title>
  <rect width="${w}" height="44" rx="9" fill="#5B3FE8"/>
  <g transform="translate(18 11)">
    <path d="M11 0 22 11 11 22 0 11z" fill="#ffffff"/>
    <path d="M11 0 15.5 11 11 22 6.5 11z" fill="#5B3FE8" opacity=".18"/>
  </g>
  <text x="50" y="28" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif"
        font-size="15.5" font-weight="600" fill="#ffffff">${text}</text>
</svg>
`;
};

const svgOut = opt('--svg-out');
if (svgOut) {
  writeFileSync(svgOut, buttonSvg(label), 'utf8');
  console.log(`# Wrote button SVG\n\n${svgOut}\n`);
}

console.log('# Deep link\n');
console.log(link);
console.log('\n# Markdown — button (needs the SVG committed to the repo)\n');
console.log(`[![${label}](${svgOut ?? 'assets/add-to-werkbank.svg'})](${link})`);
console.log('\n# Markdown — shields.io fallback (no file needed)\n');
console.log(`[![${label}](${shield})](${link})`);
console.log('\n# HTML\n');
console.log(`<a href="${link}"><img src="${svgOut ?? 'assets/add-to-werkbank.svg'}" alt="${label}" height="44"></a>`);
if (mcpbUrl) {
  console.log('\n# Installs from bundle\n');
  console.log(mcpbUrl);
  console.log('\nWerkbank downloads it, reads manifest.json, and shows the command');
  console.log('plus a form built from user_config before anything is extracted.');
} else {
  console.log('\n# Decoded config (what the user is shown before it installs)\n');
  console.log(JSON.stringify(config, null, 2));
}
