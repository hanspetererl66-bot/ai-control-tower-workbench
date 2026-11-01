/**
 * Similarity between a new ticket text and existing tickets or knowledge-base notes.
 * Pure and dependency-free on purpose: the Sub4Me Space page carries a copy of the block between the
 * markers (a test keeps both identical in behaviour), so the portal and the connector agree.
 */
/*match:start*/
const STOP = new Set(['the', 'and', 'for', 'with', 'after', 'from', 'not', 'are', 'was', 'has', 'have', 'that', 'this', 'when', 'into', 'since', 'still', 'our', 'its', 'but', 'all', 'can', 'cannot', 'does', 'did', 'get', 'gets', 'new', 'now', 'one', 'two', 'too', 'who', 'how', 'why', 'what', 'which', 'while', 'than', 'then', 'them', 'they', 'their', 'you', 'your', 'also', 'any', 'may', 'per', 'via', 'use', 'used', 'using', 'need', 'needs', 'want', 'each', 'other', 'only', 'some', 'there', 'here', 'will', 'would', 'should', 'could', 'been', 'being', 'were', 'return', 'returns', 'shows', 'show']);
function tokens(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return out;
}
function similarity(a, b) {
  const x = tokens((a.title || '') + ' ' + (a.title || '') + ' ' + (a.description || '') + ' ' + (a.keywords || ''));
  const y = tokens((b.title || '') + ' ' + (b.title || '') + ' ' + (b.description || '') + ' ' + (b.keywords || ''));
  if (!x.size || !y.size) return 0;
  let common = 0;
  x.forEach((t) => { if (y.has(t)) common += 1; });
  const jaccard = common / (x.size + y.size - common);
  const overlap = common / Math.min(x.size, y.size);
  const sameProduct = a.product && b.product && String(a.product).toLowerCase() === String(b.product).toLowerCase();
  return Math.min(1, Math.round((0.5 * jaccard + 0.5 * overlap + (sameProduct ? 0.12 : 0)) * 100) / 100);
}
/*match:end*/
export { similarity, tokens };
export const STRONG = 0.5;
export const POSSIBLE = 0.35;

/** Best matches above the POSSIBLE threshold, strongest first. */
export function rank(candidate, list, limit = 3) {
  return list
    .map((item) => ({ item, score: similarity(candidate, item) }))
    .filter((hit) => hit.score >= POSSIBLE)
    .sort((p, q) => q.score - p.score)
    .slice(0, limit)
    .map((hit) => ({ ...hit, strength: hit.score >= STRONG ? 'strong' : 'possible' }));
}
