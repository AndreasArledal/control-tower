import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Claude Code keeps one JSON per running CLI in <home>/sessions/<pid>.json with its sessionId, cwd,
 * derived name and a busy/idle status. Entries whose pid is gone are returned with alive=false.
 */
export async function readRegistry(home) {
  const dir = join(home, 'sessions');
  let files = [];
  try { files = await readdir(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let raw;
    try { raw = JSON.parse(await readFile(join(dir, f), 'utf8')); } catch { continue; }
    if (!raw?.sessionId || !raw?.cwd) continue;
    out.push({
      pid: raw.pid ?? null,
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      name: raw.name ?? null,
      busy: raw.status === 'busy',
      status: raw.status ?? null,
      startedAt: raw.startedAt ?? null,
      kind: raw.kind ?? null,
      version: raw.version ?? null,
      alive: isPidAlive(raw.pid),
      updatedAt: raw.statusUpdatedAt ?? raw.updatedAt ?? null,
    });
  }
  return out;
}
