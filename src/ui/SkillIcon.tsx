import type { ReactElement } from 'react';
import { skillIconKey, type SkillIconKey } from '../skill-icons';

const PATHS: Record<SkillIconKey, ReactElement> = {
  chart: (
    <>
      <path d="M3 13V8.5M8 13V3.5M13 13V6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  ticket: (
    <>
      <path d="M2.5 5.2a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1.4a1.5 1.5 0 0 0 0 2.8v1.4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.4a1.5 1.5 0 0 0 0-2.8z" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.2 4.6v6.8" strokeWidth="1.3" strokeDasharray="1.2 1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" strokeWidth="1.5" />
      <path d="m10.3 10.3 3 3" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  rocket: (
    <>
      <path d="M9.6 3.2c1.6-.4 2.9-.3 3.2-.2.1.3.2 1.6-.2 3.2-.5 1.7-1.7 3-3.2 3.9L7 8.2 5.9 7.1c.9-1.5 2.2-2.7 3.7-3.9z" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.9 7.1 3.6 7.4 2.8 9l2.2.3M8.2 10.1 7.9 12.4 6.3 13.2 6 11" strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  layout: (
    <>
      <rect x="2.4" y="3" width="11.2" height="10" rx="1.8" strokeWidth="1.4" />
      <path d="M2.4 6.4h11.2M6.6 6.4V13" strokeWidth="1.4" />
    </>
  ),
  spark: (
    <>
      <path d="M8 2.6l1.3 3.4 3.4 1.3-3.4 1.3L8 12l-1.3-3.4L3.3 7.3 6.7 6z" strokeWidth="1.3" strokeLinejoin="round" />
    </>
  ),
};

export default function SkillIcon({ name }: { name: string }) {
  const key = skillIconKey(name);
  return (
    <span className={`skill-icon skill-icon-${key}`} aria-hidden="true" data-icon={key}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
        {PATHS[key]}
      </svg>
    </span>
  );
}
