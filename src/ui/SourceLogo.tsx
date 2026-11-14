import BrandMark from './BrandMark';
import type { SourceKind } from '../requirements';

/**
 * The mark of a requirement source (Requirement collection) and, with the same drawings, of the connectors:
 * Jira, Slack, Linear, Figma, Microsoft Teams and Notion. Simplified shapes in brand colours (see BrandMark);
 * decorative, the name always stands next to it.
 */
export default function SourceLogo({ id, size = 20 }: { id: SourceKind; size?: number }) {
  return <span className="sx-logo" style={{ width: size, height: size }} aria-hidden="true"><BrandMark id={id} /></span>;
}
