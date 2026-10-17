import { relativeTime, type Space } from '../spaces';

type Props = {
  spaces: Space[];
  selected: string | null;
  onSelect: (slug: string) => void;
};

export default function SpacesList({ spaces, selected, onSelect }: Props) {
  return (
    <aside className="list">
      <div className="list-head">
        <span className="list-title">Spaces</span>
        <button className="icon-btn" title="Search" aria-label="Search">
          <SearchIcon />
        </button>
        <button className="icon-btn" title="Filter" aria-label="Filter">
          <FilterIcon />
        </button>
      </div>

      {spaces.length === 0 ? (
        <p className="list-empty">
          No Spaces yet. Ask Werkbank to create a dashboard from grounded data.
        </p>
      ) : (
        spaces.map((s) => (
          <button
            key={s.slug}
            className={`card ${selected === s.slug ? 'card-on' : ''}`}
            onClick={() => onSelect(s.slug)}
          >
            <span className="card-head">
              <span className="card-icon"><SpaceIcon /></span>
              <span className="card-title-wrap">
                <span className="card-title">{s.title}</span>
                <span className="card-meta">Updated {relativeTime(s.updatedAt)}</span>
              </span>
              <span className="card-more" aria-hidden="true">···</span>
            </span>
            {s.description && <span className="card-desc">{s.description}</span>}
          </button>
        ))
      )}
    </aside>
  );
}

function SpaceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 6h12.4M6.4 6v7.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 3.2h11.6L9.5 8.1v3.5l-3 1.5v-5z" fill="currentColor" />
    </svg>
  );
}
