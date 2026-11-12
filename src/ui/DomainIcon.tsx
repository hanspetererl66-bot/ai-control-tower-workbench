import type { ReactElement } from 'react';
import { domainIconKey, type DomainIconKey } from '../domain-icons';

const PATHS: Record<DomainIconKey, ReactElement> = {
  sales: (<><path d="M3 17l5-5 4 4 8-9" strokeWidth="1.8" /><path d="M15 7h5v5" strokeWidth="1.8" /></>),
  operations: (<><circle cx="12" cy="12" r="3" strokeWidth="1.7" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeWidth="1.7" /></>),
  governance: (<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" strokeWidth="1.7" /><path d="M9 12l2.2 2.2L15.5 10" strokeWidth="1.7" /></>),
  people: (<><circle cx="9" cy="8.5" r="3" strokeWidth="1.7" /><path d="M3.5 19c.5-3 2.8-4.7 5.5-4.7s5 1.7 5.5 4.7" strokeWidth="1.7" /><path d="M16 5.8a3 3 0 0 1 0 5.4M17.5 14.6c1.8.5 3 2 3.3 4.4" strokeWidth="1.7" /></>),
  finance: (<><circle cx="12" cy="12" r="8.5" strokeWidth="1.7" /><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2c1.7.3 2.8.8 2.8 2s-1.1 2-2.8 2c-1.2 0-2.2-.4-2.8-1.2M12 6.5V8M12 16v1.5" strokeWidth="1.6" /></>),
  marketplace: (<><path d="M4 9l1.2-4.5h13.6L20 9" strokeWidth="1.7" /><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9v10H4z" strokeWidth="1.7" /><path d="M10 19v-5h4v5" strokeWidth="1.7" /></>),
  service: (<><path d="M4 13v-1a8 8 0 0 1 16 0v1" strokeWidth="1.7" /><rect x="3" y="13" width="4" height="6" rx="1.5" strokeWidth="1.7" /><rect x="17" y="13" width="4" height="6" rx="1.5" strokeWidth="1.7" /><path d="M19 19c0 1.5-1.5 2.5-4 2.5h-2" strokeWidth="1.7" /></>),
  development: (<><path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4M13.5 5.5l-3 13" strokeWidth="1.8" /></>),
  automation: (<><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" strokeWidth="1.7" /></>),
  data: (<><ellipse cx="12" cy="6" rx="7" ry="2.8" strokeWidth="1.7" /><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" strokeWidth="1.7" /></>),
  generic: (<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth="1.7" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" strokeWidth="1.7" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth="1.7" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" strokeWidth="1.7" /></>),
};

/** The icon of a domain tile, chosen from the domain name. Decorative: the tile title says what it is. */
export default function DomainIcon({ name }: { name: string }) {
  return (
    <span className="sov-tile-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">{PATHS[domainIconKey(name)]}</svg>
    </span>
  );
}
