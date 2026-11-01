/** Star rating maths shared by the rating tools and the skill recommendations. */
export const RATING_DEFAULTS = { priorMean: 3.8, priorWeight: 5, minRatings: 5 };

/** distribution = number of 1, 2, 3, 4 and 5 star ratings. score is a damped average so few votes do not dominate. */
export function summarise(distribution, settings = {}) {
  const s = { ...RATING_DEFAULTS, ...settings };
  const dist = [0, 1, 2, 3, 4].map((i) => Number(distribution?.[i] ?? 0));
  const count = dist.reduce((a, b) => a + b, 0);
  const total = dist.reduce((a, c, i) => a + c * (i + 1), 0);
  const average = count ? Math.round((total / count) * 100) / 100 : null;
  const score = Math.round(((s.priorMean * s.priorWeight + total) / (s.priorWeight + count)) * 100) / 100;
  return { count, average, distribution: dist, score, enough: count >= s.minRatings, label: count >= s.minRatings ? `${average.toFixed(1)} of 5 (${count} ratings)` : count ? `new (${count} ${count === 1 ? 'rating' : 'ratings'})` : 'not rated yet' };
}
