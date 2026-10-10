import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionModel } from './model.mjs';
import { parseLine } from './transcript.mjs';
import { projectsDir, transcriptPathFor } from './paths.mjs';

/** Browsing sessions that are no longer running: recent transcripts per project, and opening one read-only into the store. */
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

/** Recent transcripts for a project dir, for browsing sessions that are no longer running. */
export async function history(store, cwd, limit = 20) {
  const dir = join(projectsDir(store.home), cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    let st; try { st = await stat(join(dir, f)); } catch { continue; }
    out.push({ id, modified: st.mtimeMs, size: st.size, live: store.sessions.get(id)?.alive ?? false });
  }
  out.sort((a, b) => b.modified - a.modified);
  const top = out.slice(0, limit);
  for (const h of top) {
    const known = store.sessions.get(h.id);
    if (known) { h.title = known.model.title; h.turns = known.model.turns; continue; }
    const m = await peekTranscript(join(dir, `${h.id}.jsonl`));
    Object.assign(h, m);
  }
  return top;
}

/** Load a finished session on demand so its timeline can be read. */
export async function openHistory(store, cwd, id) {
  if (!/^[\w-]{1,128}$/.test(String(id))) throw new Error('invalid session id');
  if (store.sessions.has(id)) return store.sessions.get(id);
  const s = store._session(id);
  s.cwd = cwd; s.transcriptPath = transcriptPathFor(store.home, cwd, id); s.alive = false; s.lastSeenAliveAt = store._now(); s.pinned = true;
  await store._pollTranscript(s); await store._pollAgents(s); s.loaded = true;
  store._dirty();
  return s;
}

export async function peekTranscript(path) {
  const m = new SessionModel();
  try {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const lines = buf.toString('utf8', 0, bytesRead).split('\n');
      lines.pop();
      lines.forEach((raw, i) => { for (const e of parseLine(raw, i)) m.ingest(e); });
      const st = await stat(path);
      if (st.size > buf.length) { // titles land at the end; peek the tail too
        const tail = Buffer.alloc(64 * 1024);
        const r = await fh.read(tail, 0, tail.length, st.size - tail.length);
        for (const raw of tail.toString('utf8', 0, r.bytesRead).split('\n')) { if (raw.includes('"ai-title"')) for (const e of parseLine(raw, 0)) if (e.kind === 'title') m.ingest(e); }
      }
    } finally { await fh.close(); }
  } catch { /* unreadable */ }
  return { title: m.title, firstPrompt: clip(m.firstPrompt, 200), turns: m.turns, created: m.firstActivityAt };
}
