/**
 * Product-facing connector names deliberately differ from their runtime MCP
 * identifiers. Keep those differences in one place so the picker, management
 * view, routing, and tests cannot drift apart.
 */

export const BUILT_IN_WORK_SOURCES = ['Work Email', 'Work Calendar'] as const;

export const INTEGRATION_MENU_ITEMS = [
  { id: 'model', label: 'Model', trailing: 'submenu' },
  { id: 'web-search', label: 'Web Search', trailing: 'switch' },
] as const;

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isMicrosoft365Backend(name: string): boolean {
  return normalized(name) === 'ms365';
}

export function connectorDisplayName(name: string): string {
  switch (normalized(name)) {
    case 'sapnotes':
      return 'Knowledge@SAP';
    case 'arc1':
      return 'ARC-1';
    default:
      return name;
  }
}

export function connectorDisplayOrder(name: string): number {
  switch (connectorDisplayName(name)) {
    case 'Knowledge@SAP':
      return 0;
    case 'ARC-1':
      return 1;
    default:
      return 2;
  }
}
