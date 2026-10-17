import {
  buildInstallPageUrl,
  buildMcpInstallPageUrl,
  buildSkillInstallPageUrl,
} from './install.mjs';

export const CATALOG = [
  {
    id: 'arc-1',
    kind: 'connector',
    title: 'ARC-1',
    subtitle: 'SAP ADT MCP Server',
    description: 'Read, analyze, test, and develop against a live SAP system through guarded ADT tools.',
    tags: ['ABAP', 'ADT', 'Live SAP'],
    trust: 'Community',
    source: 'SAP AI MCP catalog',
    sourceUrl: 'https://github.com/arc-mcp/arc-1',
    install: {
      type: 'mcpb',
      url: 'https://github.com/arc-mcp/arc-1/releases/download/v1.0.2/arc-1-1.0.2.mcpb',
    },
    featured: true,
  },
  {
    id: 'sap-notes',
    kind: 'connector',
    title: 'SAP Notes MCP',
    subtitle: 'SAP Notes & KB articles',
    description: 'Search and retrieve SAP Notes and Knowledge Base articles with full metadata.',
    tags: ['Notes', 'Knowledge Base', 'SAP login'],
    trust: 'Community',
    source: 'SAP AI MCP catalog',
    sourceUrl: 'https://github.com/marianfoo/sap-mcp-servers/tree/main/packages/notes',
    install: {
      type: 'mcpb',
      url: 'https://github.com/marianfoo/sap-mcp-servers/releases/download/sap-notes-latest/sap-notes.mcpb',
    },
    featured: true,
  },
  {
    id: 'sap-docs',
    kind: 'connector',
    title: 'SAP Docs MCP',
    subtitle: 'Hosted · public · read-only',
    description: 'Search SAP developer documentation, examples, community content, and released-object data.',
    tags: ['Docs', 'RAP', 'CAP', 'UI5'],
    trust: 'Community',
    source: 'SAP AI MCP catalog',
    sourceUrl: 'https://github.com/marianfoo/mcp-sap-docs',
    install: {
      type: 'mcp',
      name: 'sap-docs',
      config: {
        type: 'streamable_http',
        url: 'https://mcp-sap-docs.marianzeis.de/mcp',
        description: 'SAP documentation, notes and community search',
      },
    },
    featured: true,
  },
  {
    id: 'abap-cloud',
    kind: 'skill',
    title: 'ABAP Cloud',
    subtitle: 'Lik Wei Tan',
    description: 'Apply the three-tier model, released APIs, wrapper patterns, and ABAP Cloud restrictions.',
    tags: ['ABAP', 'Clean Core', 'Cloud'],
    trust: 'Community',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/likweitan/abap-skills/tree/main/skills/abap-cloud',
    install: {
      type: 'skill',
      repository: 'https://github.com/likweitan/abap-skills',
      name: 'abap-cloud',
    },
  },
  {
    id: 'cap-upgrade',
    kind: 'skill',
    title: 'CAP Upgrade',
    subtitle: 'SAP CAP Team',
    description: 'Upgrade CAP projects to the latest CDS version with guided detection and fixes.',
    tags: ['CAP', 'CDS', 'Migration'],
    trust: 'SAP Certified',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/capire/skills/tree/main/skills/cap-upgrade',
    install: {
      type: 'skill',
      repository: 'https://github.com/capire/skills',
      name: 'cap-upgrade',
    },
  },
  {
    id: 'ui5-best-practices',
    kind: 'skill',
    title: 'UI5 Best Practices',
    subtitle: 'SAP SE',
    description: 'Write modern UI5 applications with official coding patterns, tooling, and standards.',
    tags: ['UI5', 'TypeScript', 'Standards'],
    trust: 'SAP Certified',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/UI5/plugins-coding-agents/tree/main/plugins/ui5/skills/ui5-best-practices',
    install: {
      type: 'skill',
      repository: 'https://github.com/UI5/plugins-coding-agents',
      name: 'ui5-best-practices',
    },
  },
  {
    id: 'ui5-typescript-conversion',
    kind: 'skill',
    title: 'UI5 TypeScript Conversion',
    subtitle: 'SAP SE',
    description: 'Convert JavaScript-based UI5 projects to TypeScript with a structured migration path.',
    tags: ['UI5', 'TypeScript', 'Migration'],
    trust: 'SAP Certified',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/UI5/plugins-coding-agents',
    install: {
      type: 'skill',
      repository: 'https://github.com/UI5/plugins-coding-agents',
      name: 'ui5-typescript-conversion',
    },
  },
  {
    id: 'ui5-tables',
    kind: 'skill',
    title: 'UI5 Table Best Practices',
    subtitle: 'SAP SE',
    description: 'Choose and implement the right responsive, grid, tree, Smart, or MDC table.',
    tags: ['UI5', 'Tables', 'Accessibility'],
    trust: 'SAP Certified',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/UI5/plugins-coding-agents',
    install: {
      type: 'skill',
      repository: 'https://github.com/UI5/plugins-coding-agents',
      name: 'ui5-best-practices-tables',
    },
  },
  {
    id: 'ui5-web-components-styling',
    kind: 'skill',
    title: 'UI5 Web Components Styling',
    subtitle: 'SAP SE',
    description: 'Customize UI5 Web Components with shadow parts, custom states, and CSS variables.',
    tags: ['UI5', 'CSS', 'Design systems'],
    trust: 'SAP Certified',
    source: 'SAP AI Skills Library',
    sourceUrl: 'https://github.com/UI5/webcomponents/tree/main/skills/styling',
    install: {
      type: 'skill',
      repository: 'https://github.com/UI5/webcomponents',
      name: 'styling',
    },
  },
];

export function installPageFor(item, baseUrl) {
  if (item.install.type === 'mcpb') {
    return buildInstallPageUrl(item.install.url, baseUrl, item.title);
  }
  if (item.install.type === 'mcp') {
    return buildMcpInstallPageUrl(
      item.install.name,
      item.install.config,
      baseUrl,
      item.title
    );
  }
  if (item.install.type === 'skill') {
    return buildSkillInstallPageUrl(
      item.install.repository,
      item.install.name,
      baseUrl,
      item.title
    );
  }
  return null;
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createCard(document, item, baseUrl) {
  const card = element(document, 'article', `catalog-card catalog-card-${item.kind}`);
  card.dataset.catalogKind = item.kind;
  card.dataset.catalogText = [item.title, item.subtitle, item.description, ...item.tags]
    .join(' ')
    .toLocaleLowerCase();

  const top = element(document, 'div', 'catalog-card-top');
  const icon = element(document, 'span', `catalog-icon catalog-icon-${item.kind}`);
  icon.setAttribute('aria-hidden', 'true');
  icon.append(element(document, 'i'), element(document, 'i'));
  top.append(icon);

  const badges = element(document, 'div', 'catalog-badges');
  badges.append(
    element(document, 'span', 'catalog-kind', item.kind === 'connector' ? 'MCP server' : 'Skill'),
    element(
      document,
      'span',
      item.trust === 'SAP Certified' ? 'catalog-trust is-certified' : 'catalog-trust',
      item.trust
    )
  );
  top.append(badges);

  const heading = element(document, 'div', 'catalog-card-heading');
  heading.append(element(document, 'h3', '', item.title), element(document, 'p', '', item.subtitle));

  const description = element(document, 'p', 'catalog-description', item.description);
  const tags = element(document, 'div', 'catalog-tags');
  for (const tag of item.tags) tags.append(element(document, 'span', '', tag));

  const footer = element(document, 'div', 'catalog-card-footer');
  const source = element(document, 'a', 'catalog-source', `${item.source} ↗`);
  source.href = item.sourceUrl;
  source.target = '_blank';
  source.rel = 'noreferrer';

  const install = element(document, 'a', 'catalog-install', item.kind === 'skill' ? 'Add skill' : 'Add to Werkbank');
  install.href = installPageFor(item, baseUrl);
  install.setAttribute('aria-label', `${install.textContent}: ${item.title}`);
  footer.append(source, install);

  card.append(top, heading, description, tags, footer);
  return card;
}

export function initializeCatalog({ document, location } = {}) {
  if (!document || !location) return { count: 0 };
  const grid = document.querySelector('[data-catalog-grid]');
  if (!grid) return { count: 0 };

  const search = document.querySelector('[data-catalog-search]');
  const filters = [...document.querySelectorAll('[data-catalog-filter]')];
  const count = document.querySelector('[data-catalog-count]');
  const empty = document.querySelector('[data-catalog-empty]');
  let activeFilter = 'all';

  const render = () => {
    const query = search?.value.trim().toLocaleLowerCase() ?? '';
    const visible = CATALOG.filter((item) => {
      const typeMatches = activeFilter === 'all' || item.kind === activeFilter;
      const text = [item.title, item.subtitle, item.description, ...item.tags]
        .join(' ')
        .toLocaleLowerCase();
      return typeMatches && text.includes(query);
    });

    grid.replaceChildren(...visible.map((item) => createCard(document, item, location.href)));
    if (count) count.textContent = String(visible.length);
    empty?.toggleAttribute('hidden', visible.length > 0);
    return visible;
  };

  search?.addEventListener('input', render);
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      activeFilter = filter.dataset.catalogFilter;
      for (const item of filters) {
        const active = item === filter;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      }
      render();
    });
  }

  const visible = render();
  return { count: visible.length, items: visible };
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  initializeCatalog({ document, location });
}
