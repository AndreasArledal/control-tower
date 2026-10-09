import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Plain node:http server: static UI from webDir, a JSON API over the store, and one SSE stream
 * that pushes a fresh snapshot whenever the store changes.
 */
export function createRadarServer({ store, webDir, hooksCtl }) {
  const clients = new Set();
  const send = (snap) => { const data = `event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`; for (const c of clients) c.write(data); };
  store.on('change', send);
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);
  heartbeat.unref?.();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/') && !sameOrigin(req)) return json(res, 403, { error: 'cross-origin requests are not allowed' });
    try {
      if (p === '/api/state') return json(res, 200, store.snapshot());
      if (p === '/api/health') return json(res, 200, { ok: true });
      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/timeline') {
        const t = store.timeline(url.searchParams.get('session'), url.searchParams.get('agent') || null, {
          after: Number(url.searchParams.get('after') ?? -1), limit: Math.min(1000, Number(url.searchParams.get('limit') ?? 200)),
          before: url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null,
        });
        return t ? json(res, 200, t) : json(res, 404, { error: 'unknown session or agent' });
      }
      if (p === '/api/history') return json(res, 200, await store.history(url.searchParams.get('cwd') ?? ''));
      if (req.method === 'POST') {
        const m = p.match(/^\/api\/session\/([^/]+)\/(summarize|focus|seen)$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          if (m[2] === 'summarize') return json(res, 200, { queued: store.requestSummary(id, { force: true }) });
          if (m[2] === 'seen') return json(res, store.markSeen(id) ? 200 : 404, { ok: true });
          return json(res, 200, await store.focus(id));
        }
        if (p === '/api/settings') { store.setSettings(await readBody(req)); return json(res, 200, store.settings); }
        if (p === '/api/history/open') { const b = await readBody(req); await store.openHistory(b.cwd, b.id); return json(res, 200, { ok: true }); }
        if (p === '/api/hooks/install') return json(res, 200, await hooksCtl.install());
        if (p === '/api/hooks/uninstall') return json(res, 200, await hooksCtl.uninstall());
        return json(res, 404, { error: 'no such action' });
      }
      if (p === '/api/hooks') return json(res, 200, await hooksCtl.status());
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      return await serveStatic(res, webDir, p === '/' ? '/index.html' : p);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });
  server.on('close', () => clearInterval(heartbeat));
  return server;
}

/** Browsers send Origin on cross-site fetches; only our own page (or a tool like curl, which sends none) may use the API. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function serveStatic(res, webDir, p) {
  const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = join(webDir, safe);
  if (!file.startsWith(webDir)) { res.writeHead(404); return res.end('not found'); }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }
}
