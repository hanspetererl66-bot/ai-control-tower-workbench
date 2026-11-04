import type { Extension } from '../requirements';

/**
 * The extensions of an existing agent or workflow that were added from the Sources tile (read only).
 * Each one is a new revision of the same registry item; the requirements are part of the next documents.
 */
export default function ExtensionList({ list }: { list?: Extension[] }) {
  if (!list?.length) return null;
  return (
    <section className="ext-list" aria-label="Extensions">
      <b>Extensions ({list.length})</b>
      <small>These requirements were added later. The documents are written with them; what already works stays.</small>
      <ul>
        {list.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span>{e.title}</span>
            {e.at > 0 && <small>{new Date(e.at).toISOString().slice(0, 10)}</small>}
            {e.refs.length > 0 && <span className="ext-keys">{e.refs.map((r) => r.key).slice(0, 8).join(', ')}{e.refs.length > 8 ? ', …' : ''}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
