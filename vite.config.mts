import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { installSkill } from './shared/skill-install.mjs';
import { parseSpaceMetadata } from './shared/space-metadata.mjs';
import { MAX_PACKAGE_BYTES, buildSpacePackage, parseSpacePackage, uniqueSlug } from './shared/space-package.mjs';

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
      // Share a Space: GET /<slug>/package returns it as one file; POST /import?mode=new|replace installs one.
      server.middlewares.use('/__spaces', (req, res, next) => {
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        const pkg = /^\/([A-Za-z0-9._-]+)\/package$/.exec((req.url ?? '').split('?')[0]);
        if (pkg && req.method === 'GET') {
          try {
            const dir = join(SPACES, pkg[1]);
            const files: Record<string, string> = { 'index.html': readFileSync(join(dir, 'index.html'), 'utf8') };
            try { files['space.json'] = readFileSync(join(dir, 'space.json'), 'utf8'); } catch { /* optional */ }
            let title = pkg[1];
            try { const m = parseSpaceMetadata(files['space.json'] ?? ''); if (typeof m.title === 'string') title = m.title; } catch { /* slug */ }
            return json(200, buildSpacePackage({ slug: pkg[1], title, files }));
          } catch {
            return json(404, { error: 'space not found' });
          }
        }
        // Delete a Space: DELETE /<slug> removes its folder. The page asks the person first.
        const del = /^\/([A-Za-z0-9._-]+)$/.exec((req.url ?? '').split('?')[0]);
        if (del && req.method === 'DELETE') {
          const slug = del[1];
          if (slug === '.' || slug === '..' || !existsSync(join(SPACES, slug, 'index.html'))) return json(404, { error: 'space not found' });
          try {
            rmSync(join(SPACES, slug), { recursive: true, force: true });
            return json(200, { deleted: slug });
          } catch (error) {
            return json(500, { error: error instanceof Error ? error.message : 'delete failed' });
          }
        }
        if ((req.url ?? '').split('?')[0] === '/import' && req.method === 'POST') {
          const mode = new URL(req.url ?? '/', 'http://x').searchParams.get('mode');
          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= MAX_PACKAGE_BYTES + 1024) chunks.push(chunk);
          });
          req.on('end', () => {
            try {
              if (size > MAX_PACKAGE_BYTES + 1024) throw new Error('The file is too large for a Space (limit 5 MB).');
              const space = parseSpacePackage(Buffer.concat(chunks).toString('utf8'));
              mkdirSync(SPACES, { recursive: true });
              const existing = readdirSync(SPACES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
              const taken = existing.includes(space.slug);
              if (taken && mode !== 'new' && mode !== 'replace') return json(409, { exists: true, slug: space.slug, title: space.title });
              const slug = taken && mode === 'new' ? uniqueSlug(space.slug, existing) : space.slug;
              const dir = join(SPACES, slug);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, 'index.html'), space.files['index.html']);
              if (space.files['space.json']) writeFileSync(join(dir, 'space.json'), space.files['space.json']);
              else if (existsSync(join(dir, 'space.json')) === false) writeFileSync(join(dir, 'space.json'), JSON.stringify({ title: space.title }, null, 2));
              return json(200, { slug, title: space.title, replaced: taken && mode === 'replace' });
            } catch (error) {
              return json(400, { error: error instanceof Error ? error.message : 'import failed' });
            }
          });
          return;
        }
        next();
      });

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
      server.middlewares.use('/__skill', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('dir') ?? '';
        let text = '';
        if (/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(name)) {
          try { text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8').slice(0, 40_000); } catch { /* none */ }
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(text);
      });
      // Install a skill the agent drafted: POST /__skills/install?replace=1 with the SKILL.md as the body.
      server.middlewares.use('/__skills/install', (req, res) => {
        const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method !== 'POST') return json(405, { error: 'POST only' });
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => { size += c.length; if (size > 200_000) req.destroy(); else chunks.push(c); });
        req.on('end', () => {
          try {
            const replace = new URL(req.url ?? '', 'http://x').searchParams.get('replace') === '1';
            json(200, installSkill(dir, Buffer.concat(chunks).toString('utf8'), { replace }));
          } catch (e: any) {
            json(e?.status ?? 500, { error: e?.message ?? 'The skill could not be installed.', exists: e?.exists === true, name: e?.name });
          }
        });
      });
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

/** Short git commit of this checkout, shown on the cover sheet so it is obvious which version is running. */
function buildStamp(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  plugins: [react(), spacesApi(), skillsApi()],
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
});
