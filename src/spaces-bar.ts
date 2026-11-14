/**
 * The bar form of the Spaces list (docked on top or at the bottom): the domains are tabs, the Spaces of the open domain are chips,
 * and the subspaces of a Space hang on its chip. Pure logic, so it can be tested; SpacesList.tsx draws what this returns.
 */
export type BarTab = { name: string; count: number };
export type BarChip = { slug: string; subs: string[] };
export type BarModel = { tabs: BarTab[]; active: string; chips: BarChip[]; flat: boolean };

type Input = {
  /** The Spaces to show (already narrowed by a search). */
  spaces: { slug: string }[];
  /** All domain names in display order. */
  domains: string[];
  domainOf: (slug: string) => string;
  parentOf: (slug: string) => string;
  /** The Space that is open, and the tab the person clicked last (null when none). */
  selected: string | null;
  chosen: string | null;
  searching: boolean;
};

/**
 * Tabs: every domain with the number of its Spaces. The open tab is the one the person clicked, else the domain of the open Space,
 * else the first domain that has Spaces. Chips: the top-level Spaces of that domain, each with its subspaces.
 * While searching there are no tabs: the hits are one flat row, subspaces included, so a subspace is found without its parent.
 */
export function barModel({ spaces, domains, domainOf, parentOf, selected, chosen, searching }: Input): BarModel {
  if (searching) return { tabs: [], active: '', chips: spaces.map((s) => ({ slug: s.slug, subs: [] })), flat: true };
  const tabs = domains.map((name) => ({ name, count: spaces.filter((s) => domainOf(s.slug) === name).length }));
  const own = selected ? domainOf(selected) : '';
  const active = chosen && domains.includes(chosen) ? chosen
    : own && domains.includes(own) ? own
    : (tabs.find((t) => t.count > 0) ?? tabs[0])?.name ?? '';
  const inDomain = spaces.filter((s) => domainOf(s.slug) === active);
  const chips = inDomain.filter((s) => !parentOf(s.slug)).map((s) => ({ slug: s.slug, subs: inDomain.filter((y) => parentOf(y.slug) === s.slug).map((y) => y.slug) }));
  return { tabs, active, chips, flat: false };
}

/** The chip that stands for the open Space: the Space itself, or the Space whose subspace is open. */
export function chipOf(chips: BarChip[], selected: string | null): string {
  if (!selected) return '';
  const hit = chips.find((c) => c.slug === selected || c.subs.includes(selected));
  return hit ? hit.slug : '';
}
