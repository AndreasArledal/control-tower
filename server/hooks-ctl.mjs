import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHooks, removeHooks, hasTowerHooks } from './hooks-install.mjs';
import { towerDir } from './paths.mjs';

const HOOK_SRC = fileURLToPath(new URL('../hooks/hook.sh', import.meta.url));

/** Missing settings.json means a fresh install; a present but unparseable one must never be overwritten. */
async function readSettings(home) {
  let raw;
  try { raw = await readFile(join(home, 'settings.json'), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
  try { return JSON.parse(raw); } catch { throw new Error('settings.json is not valid JSON; refusing to touch it'); }
}

async function backup(settingsPath) {
  try { await copyFile(settingsPath, settingsPath + '.control-tower-backup'); } catch { /* no settings yet */ }
}

/** Installs the spool hook script under <home>/control-tower and registers it in settings.json (backup kept). */
export function makeHooksCtl(home) {
  const settingsPath = join(home, 'settings.json');
  const hookPath = join(towerDir(home), 'hook.sh');
  return {
    hookPath,
    async status() { return { installed: hasTowerHooks(await readSettings(home)), hookPath, settingsPath }; },
    async install() {
      await mkdir(join(towerDir(home), 'events'), { recursive: true });
      await copyFile(HOOK_SRC, hookPath); await chmod(hookPath, 0o755);
      const current = await readSettings(home);
      await backup(settingsPath);
      await writeFile(settingsPath, JSON.stringify(mergeHooks(current, hookPath), null, 2) + '\n');
      return { installed: true, hookPath, settingsPath, note: 'Hooks apply to sessions started from now on; running sessions pick them up after /hooks reload or restart.' };
    },
    async uninstall() {
      const current = await readSettings(home);
      await backup(settingsPath);
      await writeFile(settingsPath, JSON.stringify(removeHooks(current), null, 2) + '\n');
      return { installed: false, hookPath, settingsPath };
    },
  };
}
