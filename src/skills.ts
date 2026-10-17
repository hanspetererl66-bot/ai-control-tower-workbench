export type Skill = { name: string; description: string; dir: string };

/**
 * Prefers the Electron IPC (works in the packaged app), falls back to the vite
 * dev endpoint so the renderer also runs in a plain browser tab.
 */
export async function listSkills(): Promise<Skill[]> {
  const viaHost = await window.host?.listSkills?.();
  if (viaHost?.length) return viaHost;
  try {
    const res = await fetch('/__skills', { cache: 'no-store' });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}
