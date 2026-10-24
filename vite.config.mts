import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { parseSpaceMetadata } from './shared/space-metadata.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SPACES = join(ROOT, 'workspace/spaces');

/**
 * Serves the Spaces index at /__spaces, and each space's HTML at
 * /__spaces/<slug>/index.html.
 *
 * The HTML has to come from here rather than vite's static handler: vite treats
 * any .html as an entry and injects its HMR client, and those `type="module"`
 * scripts cannot load inside a sandboxed null-origin iframe — the frame renders
 * blank. Serving the bytes untouched avoids that entirely.
 *
 * ponytail: this app is run from source (`npm run dev`), so vite is always
 * present and one fetch path serves both Electron and a plain browser tab.
 * If it ever gets packaged, move this to an IPC handler in electron/main.mjs.
 */
function spacesApi(): Plugin {
  return {
    name: 'spaces-api',
    configureServer(server) {
      server.middlewares.use('/__spaces', (req, res, next) => {
        // Mounted path is stripped: "/" lists, "/<slug>/index.html" serves one.
        const match = /^\/([A-Za-z0-9._-]+)\/index\.html/.exec(req.url ?? '/');
        if (!match) return next();
        try {
          const html = readFileSync(join(SPACES, match[1], 'index.html'));
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        } catch {
          res.statusCode = 404;
          res.end('space not found');
        }
      });

      server.middlewares.use('/__spaces', (_req, res) => {
        let spaces: unknown[] = [];
        try {
          spaces = readdirSync(SPACES, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => {
              const dir = join(SPACES, e.name);
              let meta: Record<string, unknown> = {};
              try {
                meta = parseSpaceMetadata(readFileSync(join(dir, 'space.json'), 'utf8'));
              } catch {
                // A space without metadata is still a space — show the slug.
              }
              let updatedAt = 0;
              let cardCount = 0;
              try {
                const htmlPath = join(dir, 'index.html');
                const html = readFileSync(htmlPath, 'utf8');
                updatedAt = statSync(htmlPath).mtimeMs;
                for (const match of html.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)) {
                  if (match[1].split(/\s+/).includes('card')) cardCount += 1;
                }
                // Older or minimal agent-authored Spaces may use inline styles
                // instead of the documented class. They still represent one
                // visual card, and "1 card" is more truthful than "0 cards".
                if (cardCount === 0 && html.trim()) cardCount = 1;
              } catch {
                return null;
              }
              return {
                slug: e.name,
                title: typeof meta.title === 'string' ? meta.title : e.name,
                description: typeof meta.description === 'string' ? meta.description : '',
                insights: Array.isArray(meta.insights)
                  ? meta.insights.filter((line): line is string => typeof line === 'string')
                  : [],
                domain: typeof meta.domain === 'string' ? meta.domain.trim().slice(0, 30) : undefined,
                parent: typeof meta.parent === 'string' && /^[A-Za-z0-9._-]+$/.test(meta.parent.trim()) ? meta.parent.trim() : undefined,
                cardCount,
                updatedAt,
              };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => b.updatedAt - a.updatedAt);
        } catch {
          // No spaces dir yet — the agent hasn't made one.
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(spaces));
      });
    },
  };
}

/**
 * Mirrors the Electron `list-skills` IPC over HTTP so the renderer also works in
 * a plain browser tab. Same reason as spacesApi: one code path, testable.
 */
function skillsApi(): Plugin {
  const dir = join(ROOT, 'goose-home/.agents/skills');
  return {
    name: 'skills-api',
    configureServer(server) {
      server.middlewares.use('/__skills', (_req, res) => {
        let skills: unknown[] = [];
        try {
          skills = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => {
              let name = e.name;
              let description = '';
              try {
                const md = readFileSync(join(dir, e.name, 'SKILL.md'), 'utf8');
                const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
                if (fm) {
                  const grab = (key: string) => {
                    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1]);
                    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
                  };
                  name = grab('name') || name;
                  description = grab('description');
                }
              } catch {
                return null;
              }
              return { name, description: description.slice(0, 240), dir: e.name };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => a.name.localeCompare(b.name));
        } catch {
          // no skills dir
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(skills));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spacesApi(), skillsApi()],
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
});
