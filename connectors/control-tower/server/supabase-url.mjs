/**
 * Accepts what people actually paste into the connector dialog and returns the project origin:
 * "https://abc.supabase.co", "abc.supabase.co", "https://abc.supabase.co/", "https://abc.supabase.co/rest/v1".
 * Throws a plain message instead of the cryptic "Invalid URL".
 */
export function normalizeSupabaseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('the Supabase project URL is empty');
  const local = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(raw);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('the Supabase project URL looks wrong; use the form https://<project-ref>.supabase.co');
  }
  if (!url.hostname.includes('.') && !['localhost'].includes(url.hostname)) {
    throw new Error('the Supabase project URL looks wrong; use the form https://<project-ref>.supabase.co');
  }
  return url.origin;
}
