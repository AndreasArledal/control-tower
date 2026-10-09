import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RadarStore } from './store.mjs';
import { Summarizer } from './summarizer.mjs';
import { createRadarServer } from './index.mjs';
import { makeHooksCtl } from './hooks-ctl.mjs';
import { claudeHome, radarDir } from './paths.mjs';

export const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url)).replace(/\/$/, '');

/** Boot the whole thing in-process: store, summarizer, HTTP server. Used by the CLI and the menu bar app. */
export async function startRadar({ port = 4747, host = '127.0.0.1', summaries = null, model = 'haiku', home = claudeHome(), onError = (e) => console.error('[radar]', e.message) } = {}) {
  const hooksCtl = makeHooksCtl(home);
  const summarizer = new Summarizer({ cacheFile: join(radarDir(home), 'summaries.json'), runOptions: { model, cwd: join(radarDir(home), 'summarizer') } });
  await summarizer.load();
  const store = new RadarStore({ home, summarizer, settings: summaries ? { summaries } : {} });
  summarizer.onResult = (id, sum, key) => store.onSummary(id, sum, key);
  summarizer.onError = (id, err) => store.onSummaryError(id, err);
  store.on('error', onError);
  await store.start();
  const server = createRadarServer({ store, webDir: WEB_DIR, hooksCtl });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const url = `http://localhost:${server.address().port}`;
  return { store, server, summarizer, hooksCtl, home, url, close() { store.stop(); server.closeAllConnections?.(); server.close(); } };
}
