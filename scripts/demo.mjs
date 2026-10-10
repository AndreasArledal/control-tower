#!/usr/bin/env node
// Demo fixture for the README screenshot. Builds a throwaway Claude config dir with invented projects,
// sessions and agents, serves Control Tower on it with a stub summarizer (no `claude` call, no spend),
// and captures docs/screenshot.png with headless Chrome. Never reads ~/.claude.
//
//   node scripts/demo.mjs                 # write docs/screenshot.png and exit
//   node scripts/demo.mjs --keep          # also leave the server running for a look (Ctrl-C to stop)
//   node scripts/demo.mjs --port 4749 --out docs/screenshot.png
//   node scripts/demo.mjs --docs             # also regenerate every image under docs/images/
//   node scripts/demo.mjs --keep --no-shot   # just serve the fixture
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { TowerStore } from '../server/store.mjs';
import { Summarizer } from '../server/summarizer.mjs';
import { createTowerServer } from '../server/index.mjs';
import { makeHooksCtl } from '../server/hooks-ctl.mjs';
import { encodeProjectDir, towerDir } from '../server/paths.mjs';
import { WEB_DIR } from '../server/start.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', 4749));
const OUT = resolve(opt('--out', 'docs/screenshot.png'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---------- transcript builders ----------
const NOW = Date.now();
const min = (m, s = 0) => NOW - m * 60_000 - s * 1000;
let n = 0;
const uid = () => 'u' + (++n).toString(36);
const L = (o) => JSON.stringify(o) + '\n';
const base = (sid, ts, agentId = null) => ({ uuid: uid(), parentUuid: null, timestamp: new Date(ts).toISOString(), sessionId: sid, isSidechain: Boolean(agentId), ...(agentId ? { agentId } : {}) });
const user = (sid, ts, text, agentId) => L({ ...base(sid, ts, agentId), type: 'user', message: { role: 'user', content: text } });
const results = (sid, ts, ids, agentId) => L({ ...base(sid, ts, agentId), type: 'user', message: { role: 'user', content: ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) } });
const assistant = (sid, ts, blocks, { model = 'claude-fable-5-1', effort = 'high', stop = 'tool_use', ctx = 40_000, out = 600, agentId = null } = {}) =>
  L({ ...base(sid, ts, agentId), type: 'assistant', effort, message: { id: 'msg_' + uid(), role: 'assistant', model, stop_reason: stop, usage: { input_tokens: 1800, cache_read_input_tokens: ctx - 1800, cache_creation_input_tokens: 0, output_tokens: out }, content: blocks } });
const title = (sid, t) => L({ type: 'ai-title', aiTitle: t, sessionId: sid });
const think = (t) => ({ type: 'thinking', thinking: t });
const text = (t) => ({ type: 'text', text: t });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const agentCall = (id, description, subagent_type) => tool(id, 'Agent', { description, subagent_type, prompt: description });

// ---------- the invented world ----------
const HOME = mkdtempSync(join(tmpdir(), 'tower-demo-'));
const ATLAS = '/Users/demo/src/atlas', BILLING = '/Users/demo/src/billing-api', DS = '/Users/demo/src/design-system';
const children = [];
function register(sid, cwd, name, status, startedAt) {
  const child = spawn('sleep', ['3600'], { stdio: 'ignore' }); children.push(child);
  mkdirSync(join(HOME, 'sessions'), { recursive: true });
  writeFileSync(join(HOME, 'sessions', `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId: sid, cwd, name, status, startedAt }));
}
function transcript(cwd, sid, body) {
  const dir = join(HOME, 'projects', encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.jsonl`), body);
}
function agent(cwd, sid, id, meta, body) {
  const dir = join(HOME, 'projects', encodeProjectDir(cwd), sid, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ isFork: false, model: 'inherit', requestShape: 'foreground', spawnDepth: 1, ...meta }));
  writeFileSync(join(dir, `agent-${id}.jsonl`), body);
}
function hookEvent(payload) {
  const dir = join(towerDir(HOME), 'events');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `.ev.${Date.now()}.${uid()}.json`), JSON.stringify(payload));
}

// atlas / S1: working, three agents, one of them with its own child agent
const S1 = 'a1f4c2e0-search-ranking';
register(S1, ATLAS, 'atlas-1', 'busy', min(48));
transcript(ATLAS, S1,
  user(S1, min(48), 'Move search ranking over to the new scoring service. Keep result quality identical; the relevance tests are the contract.') +
  title(S1, 'Move search ranking to the new scoring service') +
  assistant(S1, min(47), [think('The legacy ranker is called from more places than the search handler. Map the callers first.'), agentCall('tu-explore', 'Map every caller of the legacy ranker', 'Explore')], { ctx: 22_000 }) +
  results(S1, min(41), ['tu-explore']) +
  assistant(S1, min(40), [text('Fourteen callers, three of them outside search. I will add an adapter so none of them change.'), tool('tu-r1', 'Read', { file_path: 'src/search/ranker.ts' })], { ctx: 61_000 }) +
  results(S1, min(39, 50), ['tu-r1']) +
  assistant(S1, min(39), [tool('tu-w1', 'Write', { file_path: 'src/search/scoring-client.ts' })], { ctx: 74_000 }) +
  results(S1, min(38), ['tu-w1']) +
  assistant(S1, min(37), [tool('tu-e1', 'Edit', { file_path: 'src/search/ranker.ts' })], { ctx: 83_000 }) +
  results(S1, min(36), ['tu-e1']) +
  assistant(S1, min(35), [tool('tu-b1', 'Bash', { command: 'npm test -- relevance', description: 'Run the relevance tests against the adapter' })], { ctx: 96_000 }) +
  results(S1, min(31), ['tu-b1']) +
  user(S1, min(29), 'Good. Now plan the index cutover and get the adapter reviewed before you touch the index.') +
  assistant(S1, min(28), [think('Review and planning can run in parallel while I keep the test suite green.'), agentCall('tu-review', 'Review the scoring adapter for edge cases', 'code-reviewer'), agentCall('tu-plan', 'Plan the cutover for the search index', 'Plan')], { ctx: 118_000 }) +
  assistant(S1, min(0, 40), [tool('tu-b2', 'Bash', { command: 'npm test -- ranking-integration', description: 'Run the ranking integration suite' })], { ctx: 142_000 })
);
agent(ATLAS, S1, 'explore', { agentType: 'Explore', description: 'Map every caller of the legacy ranker', toolUseId: 'tu-explore' },
  user(S1, min(47), 'Map every caller of the legacy ranker', 'explore') +
  assistant(S1, min(46), [tool('tu-x1', 'Grep', { pattern: 'LegacyRanker', path: 'src' })], { ctx: 9_000, agentId: 'explore' }) +
  results(S1, min(45), ['tu-x1'], 'explore') +
  assistant(S1, min(42), [text('14 call sites: 11 under src/search, 2 in recommendations, 1 in the admin reindex job.')], { stop: 'end_turn', ctx: 31_000, agentId: 'explore' })
);
agent(ATLAS, S1, 'review', { agentType: 'code-reviewer', description: 'Review the scoring adapter for edge cases', toolUseId: 'tu-review' },
  user(S1, min(28), 'Review the scoring adapter for edge cases', 'review') +
  assistant(S1, min(27), [tool('tu-v1', 'Read', { file_path: 'src/search/scoring-client.ts' })], { ctx: 12_000, agentId: 'review' }) +
  results(S1, min(26), ['tu-v1'], 'review') +
  assistant(S1, min(1, 10), [think('The retry path swallows a timeout. Check how the caller treats an empty score list.'), tool('tu-v2', 'Grep', { pattern: 'scores.length === 0', path: 'src/search' })], { ctx: 48_000, agentId: 'review' })
);
agent(ATLAS, S1, 'plan', { agentType: 'Plan', description: 'Plan the cutover for the search index', toolUseId: 'tu-plan' },
  user(S1, min(28), 'Plan the cutover for the search index', 'plan') +
  assistant(S1, min(27), [tool('tu-p1', 'Read', { file_path: 'docs/search-index.md' })], { ctx: 14_000, agentId: 'plan' }) +
  results(S1, min(25), ['tu-p1'], 'plan') +
  assistant(S1, min(24), [think('I need to know when the index is rebuilt before I can pick a cutover window.'), agentCall('tu-deep', 'Find the index rebuild scripts and their schedules', 'Explore')], { ctx: 33_000, agentId: 'plan' })
);
agent(ATLAS, S1, 'deep', { agentType: 'Explore', description: 'Find the index rebuild scripts and their schedules', toolUseId: 'tu-deep', spawnDepth: 2 },
  user(S1, min(24), 'Find the index rebuild scripts and their schedules', 'deep') +
  assistant(S1, min(23), [tool('tu-d1', 'Glob', { pattern: '**/reindex*' })], { ctx: 6_000, agentId: 'deep' }) +
  results(S1, min(22), ['tu-d1'], 'deep') +
  assistant(S1, min(0, 15), [tool('tu-d2', 'Read', { file_path: 'ops/cron/reindex-nightly.sh' })], { ctx: 19_000, agentId: 'deep' })
);

// atlas / S2: blocked on a question
const S2 = 'b7e9d1a3-flaky-checkout';
register(S2, ATLAS, 'atlas-2', 'busy', min(22));
transcript(ATLAS, S2,
  user(S2, min(22), 'The checkout integration test is flaky on CI again. Find out why and fix it.') +
  title(S2, 'Fix the flaky checkout integration test') +
  assistant(S2, min(21), [tool('tu-c1', 'Bash', { command: 'npm test -- checkout --repeat 20', description: 'Repeat the checkout test to reproduce the flake' })], { ctx: 18_000, model: 'claude-opus-5-5', effort: 'medium' }) +
  results(S2, min(15), ['tu-c1']) +
  assistant(S2, min(14), [think('Three failures in twenty runs, all on cart cleanup racing the next test\'s setup.'), tool('tu-c2', 'Read', { file_path: 'test/checkout.integration.test.ts' })], { ctx: 34_000, model: 'claude-opus-5-5', effort: 'medium' }) +
  results(S2, min(13), ['tu-c2']) +
  assistant(S2, min(3), [text('It is a race: cart cleanup from one test overlaps the next test\'s setup. Two ways forward.'), tool('tu-q1', 'AskUserQuestion', { questions: [{ question: 'Skip the test on CI for now, or fix the cleanup race first?', header: 'Approach', options: [{ label: 'Fix the race', description: 'Serialise cart cleanup; about an hour.' }, { label: 'Skip on CI', description: 'Unblocks the pipeline today, race stays.' }] }] })], { ctx: 41_000, model: 'claude-opus-5-5', effort: 'medium' })
);

// billing-api / S3: finished, ready for a new prompt
const S3 = 'c3d8f5b2-vat-rounding';
register(S3, BILLING, 'billing-1', 'idle', min(35));
transcript(BILLING, S3,
  user(S3, min(35), 'Swedish invoices come out one öre off when VAT is rounded on the total. Round per line instead.') +
  title(S3, 'Round VAT per line for Swedish invoices') +
  assistant(S3, min(34), [tool('tu-i1', 'Grep', { pattern: 'roundVat', path: 'src' })], { ctx: 15_000, effort: 'medium' }) +
  results(S3, min(33), ['tu-i1']) +
  assistant(S3, min(32), [tool('tu-i2', 'Edit', { file_path: 'src/invoice/vat.ts' })], { ctx: 27_000, effort: 'medium' }) +
  results(S3, min(31), ['tu-i2']) +
  assistant(S3, min(30), [tool('tu-i3', 'Bash', { command: 'npm test -- vat', description: 'Run the VAT tests' })], { ctx: 33_000, effort: 'medium' }) +
  results(S3, min(9), ['tu-i3']) +
  assistant(S3, min(8), [text('Done. VAT is rounded per line in `src/invoice/vat.ts`, the three Swedish fixtures now match the expected totals, and the full VAT suite passes.')], { stop: 'end_turn', ctx: 36_000, effort: 'medium' })
);
hookEvent({ hook_event_name: 'Stop', session_id: S3, cwd: BILLING, last_assistant_message: 'Done. VAT is rounded per line in src/invoice/vat.ts, the three Swedish fixtures now match the expected totals, and the full VAT suite passes.' });

// billing-api / S4: looks idle, but the last reply left a question with the user
const S4 = 'd9a2e7c4-release-notes';
register(S4, BILLING, 'billing-2', 'idle', min(70));
transcript(BILLING, S4,
  user(S4, min(70), 'Draft the release notes for 2.4 from the merged PRs since the 2.3 tag.') +
  title(S4, 'Draft the 2.4 release notes') +
  assistant(S4, min(69), [tool('tu-n1', 'Bash', { command: 'git log 2.3..HEAD --merges --oneline', description: 'List merged PRs since 2.3' })], { ctx: 12_000, model: 'claude-sonnet-5', effort: 'low' }) +
  results(S4, min(68), ['tu-n1']) +
  assistant(S4, min(66), [tool('tu-n2', 'Write', { file_path: 'CHANGELOG.md' })], { ctx: 29_000, model: 'claude-sonnet-5', effort: 'low' }) +
  results(S4, min(65), ['tu-n2']) +
  assistant(S4, min(64), [text('Draft is in CHANGELOG.md: 23 PRs grouped into features, fixes and internal. One of them changes the webhook payload shape, which is breaking. Should that go first under its own heading, or stay inside the features list?')], { stop: 'end_turn', ctx: 31_000, model: 'claude-sonnet-5', effort: 'low' })
);

// design-system / S5: working, one agent finished
const S5 = 'e5b1c9d6-contrast-audit';
register(S5, DS, 'design-system-1', 'busy', min(12));
transcript(DS, S5,
  user(S5, min(12), 'Audit colour contrast across the token set and fix anything under 4.5:1 for text.') +
  title(S5, 'Audit colour contrast across the token set') +
  assistant(S5, min(11), [agentCall('tu-a11y', 'Check every text token pair against WCAG AA', 'accessibility-tester')], { ctx: 9_000, effort: 'medium' }) +
  results(S5, min(5), ['tu-a11y']) +
  assistant(S5, min(4), [text('Four pairs fail: tertiary text on both surfaces and the two muted link states. Fixing the tokens.'), tool('tu-t1', 'Read', { file_path: 'tokens/colour.css' })], { ctx: 27_000, effort: 'medium' }) +
  results(S5, min(3), ['tu-t1']) +
  assistant(S5, min(0, 20), [tool('tu-t2', 'Edit', { file_path: 'tokens/colour.css' })], { ctx: 38_000, effort: 'medium' })
);
agent(DS, S5, 'a11y', { agentType: 'accessibility-tester', description: 'Check every text token pair against WCAG AA', toolUseId: 'tu-a11y' },
  user(S5, min(11), 'Check every text token pair against WCAG AA', 'a11y') +
  assistant(S5, min(10), [tool('tu-y1', 'Read', { file_path: 'tokens/colour.css' })], { ctx: 8_000, agentId: 'a11y' }) +
  results(S5, min(9), ['tu-y1'], 'a11y') +
  assistant(S5, min(6), [text('4 of 22 text pairs fail AA: text-tertiary on surface and on raised surface (3.9:1), link-muted hover and visited (4.1:1).')], { stop: 'end_turn', ctx: 21_000, agentId: 'a11y' })
);

// ---------- stub summaries, keyed by what the digest says ----------
const S = (headline, goal, done, now, next, status = 'working', waiting_for = '') => ({ headline, goal, done, now, next, status, waiting_for });
const BY_TITLE = {
  'Move search ranking to the new scoring service': S('Wiring the scoring adapter into search', 'Serve search from the new scoring service with identical result quality.', ['Mapped the 14 callers of the legacy ranker', 'Added ScoringClient with retries and a 200 ms budget', 'Relevance tests pass against the adapter'], 'Running the ranking integration suite while the adapter is reviewed and the cutover is planned.', 'Cut the index over once the reviewer signs off on the adapter.'),
  'Fix the flaky checkout integration test': S('Asking how to handle the cart cleanup race', 'Make the checkout integration test reliable on CI.', ['Reproduced the flake: 3 failures in 20 runs', 'Traced it to cart cleanup racing the next test\'s setup'], 'Waiting for you to choose between fixing the race and skipping the test on CI.', 'Fix the race or skip on CI, your call.', 'waiting_for_user', 'Fix the race or skip the test on CI'),
  'Round VAT per line for Swedish invoices': S('VAT now rounds per line, suite green', 'Stop Swedish invoices coming out one öre off.', ['Moved rounding from the total to each line in vat.ts', 'Updated the three Swedish fixtures', 'Full VAT suite passes'], 'Finished and ready for a new prompt.', '', 'complete'),
  'Draft the 2.4 release notes': S('Release notes drafted, one placement question', 'Publish release notes for 2.4 covering every merged PR since 2.3.', ['Listed 23 merged PRs since the 2.3 tag', 'Drafted CHANGELOG.md grouped into features, fixes and internal'], 'Asked where the breaking webhook payload change should go.', 'Say whether the breaking change gets its own heading at the top.', 'waiting_for_user', 'Where to place the breaking webhook change in the notes'),
  'Audit colour contrast across the token set': S('Fixing four token pairs that fail AA', 'Every text token pair at 4.5:1 or better.', ['Audited 22 text pairs; 4 fail AA', 'Identified tertiary text and muted link states as the culprits'], 'Editing tokens/colour.css to lift the failing pairs.', 'Re-run the audit and update the design system doc.'),
};
const BY_PROJECT = {
  [ATLAS]: S('Moving search onto the new scoring service', 'Search ranking via the scoring service, plus a reliable checkout test.', [], '', ''),
  [BILLING]: S('Swedish VAT fix shipped, 2.4 notes drafted', 'Correct invoices and a 2.4 release.', [], '', ''),
  [DS]: S('Lifting four colour tokens to WCAG AA', 'Accessible text contrast across the token set.', [], '', ''),
};
async function runner(prompt) {
  const t = /^Title: (.*)$/m.exec(prompt)?.[1];
  const p = /^Project directory: (.*)$/m.exec(prompt)?.[1];
  const obj = (t && BY_TITLE[t]) || (p && BY_PROJECT[p]) || S('Working', '', [], '', '');
  return { structured_output: obj, total_cost_usd: 0 };
}

// ---------- boot ----------
const hooksCtl = makeHooksCtl(HOME);
await hooksCtl.install(); // in the fake home only, so the page shows hooks as installed
const summarizer = new Summarizer({ runner, cacheFile: null });
const store = new TowerStore({ home: HOME, summarizer, settings: { summaries: 'auto' } });
summarizer.onResult = (id, sum, key) => store.onSummary(id, sum, key);
summarizer.onError = (id, err) => store.onSummaryError(id, err);
store.on('error', (e) => console.error('[demo]', e.message));
await store.start();
const server = createTowerServer({ store, webDir: WEB_DIR, hooksCtl });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const url = `http://localhost:${PORT}`;
for (let i = 0; i < 3; i++) { await store.tick(); await summarizer.idle(); }
await store.tick();
const snap = store.snapshot();
console.log(`demo: ${snap.sessions.length} sessions, ${snap.projects.length} projects, ${snap.attention.length} need you, at ${url}`);
console.log(`      states: ${snap.sessions.map((v) => `${v.title.split(' ').slice(0, 3).join(' ')}=${v.state}${v.followUp ? '+followup' : ''}`).join(', ')}`);

function cleanup() {
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
  store.stop(); server.closeAllConnections?.(); server.close();
  if (!flag('--keep')) rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/**
 * Drive headless Chrome over the DevTools protocol: the page keeps an SSE stream open, which stalls Chrome's own
 * --screenshot mode. One Chrome, one tab, many captures; each capture navigates, optionally acts, then clips.
 */
async function chromeSession() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${join(HOME, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    chrome.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) resolve(m[1]); });
    chrome.on('exit', () => reject(new Error('chrome exited: ' + err.slice(-300))));
    setTimeout(() => reject(new Error('chrome did not start')), 15_000).unref();
  });
  const target = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable'); await send('Runtime.enable');
  const click = async (selector) => { await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})?.click()` }); await sleep(900); };
  /** url, out, optional clip {x,y,width,height} in CSS px, scale (2 for crisp docs), theme, and an async act(click) to run before the shot. */
  async function capture({ url: pageUrl, out, clip = { x: 0, y: 0, width: 1440, height: 900 }, scale = 2, theme = 'dark', act = null, settle = 3500 }) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await send('Page.navigate', { url: pageUrl }); await sleep(settle); // first snapshot over SSE, fonts, fit animation
    if (act) await act(click);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale } });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`demo: wrote ${out}`);
  }
  return { capture, close() { ws.close(); const gone = new Promise((r) => chrome.once('exit', r)); chrome.kill(); return gone; } };
}

/** A second tower over an empty config dir, for the "nothing running" captures. */
async function emptyTower(port) {
  const home = mkdtempSync(join(tmpdir(), 'tower-empty-'));
  const store = new TowerStore({ home, summarizer: null }); await store.start();
  const server = createTowerServer({ store, webDir: WEB_DIR, hooksCtl: makeHooksCtl(home) });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://localhost:${port}`, close() { store.stop(); server.closeAllConnections?.(); server.close(); rmSync(home, { recursive: true, force: true }); } };
}

/** The three menu bar icons on a light and a dark menu bar, as one small page. */
function menuBarPreview() {
  const img = (f) => `data:image/png;base64,${readFileSync(new URL(`../app/${f}`, import.meta.url)).toString('base64')}`;
  const row = (cls) => `<div class="${cls}">` + [['iconTemplate@2x.png', 'nothing running'], ['iconLiveTemplate@2x.png', 'sessions live'], ['iconNeedsTemplate@2x.png', 'needs you']].map(([f, l]) => `<span><img src="${img(f)}">${l}</span>`).join('') + '</div>';
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px -apple-system,sans-serif;width:640px}div{padding:14px 20px;display:flex;gap:28px;align-items:center}.l{background:#ececec;color:#222}.d{background:#1e1e1e;color:#eee}.d img{filter:invert(1)}img{width:18px;height:18px}span{display:flex;gap:7px;align-items:center}</style>${row('l')}${row('d')}`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

const seen = (id) => fetch(`${url}/api/session/${encodeURIComponent(id)}/seen`, { method: 'POST' });
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));

if (!flag('--no-shot')) {
  let chrome = null, empty = null;
  try {
    chrome = await chromeSession();
    const S1_URL = `${url}/#session=${encodeURIComponent(S1)}`;
    await chrome.capture({ url: S1_URL, out: OUT });
    if (flag('--docs')) {
      const drawer = { x: 992, y: 80, width: 448, height: 820 };
      await chrome.capture({ url: `${url}/`, out: join(DOCS, 'images/beacon-needs.png'), clip: { x: 0, y: 0, width: 560, height: 44 } });
      await chrome.capture({ url: `${url}/`, out: join(DOCS, 'images/needs-you-list.png'), clip: { x: 0, y: 0, width: 760, height: 250 }, act: (click) => click('#attention-badge') });
      await chrome.capture({ url: S1_URL, out: join(DOCS, 'images/drawer-summary.png'), clip: drawer });
      await chrome.capture({ url: S1_URL, out: join(DOCS, 'images/transcript.png'), clip: drawer, act: async (click) => { await click('[data-act="transcript"]'); await new Promise((r) => setTimeout(r, 1500)); } });
      await chrome.capture({ url: `${url}/`, out: join(DOCS, 'images/settings.png'), clip: { x: 1080, y: 0, width: 360, height: 395 }, act: (click) => click('#settings-btn') });
      await chrome.capture({ url: S1_URL, out: join(DOCS, 'images/light-theme.png'), theme: 'light', scale: 1 });
      await seen(S4); // the release-notes follow-up has been looked at
      await chrome.capture({ url: `${url}/`, out: join(DOCS, 'images/seen-followup.png'), clip: { x: 0, y: 440, width: 760, height: 370 } });
      await chrome.capture({ url: `${url}/`, out: join(DOCS, 'images/needs-you-list-seen.png'), clip: { x: 0, y: 0, width: 760, height: 250 }, act: (click) => click('#attention-badge') });
      empty = await emptyTower(PORT + 1);
      await chrome.capture({ url: `${empty.url}/`, out: join(DOCS, 'images/beacon-empty.png'), clip: { x: 0, y: 0, width: 560, height: 44 } });
      await chrome.capture({ url: `${empty.url}/`, out: join(DOCS, 'images/empty.png'), scale: 1 });
      await chrome.capture({ url: menuBarPreview(), out: join(DOCS, 'images/menubar-icons.png'), clip: { x: 0, y: 0, width: 640, height: 100 }, settle: 800 });
    }
  } catch (err) { console.error('[demo] screenshot failed:', err.message); }
  finally { await chrome?.close(); empty?.close(); }
}

if (flag('--keep')) {
  console.log(`demo: serving ${url} from ${HOME} (Ctrl-C to stop)`);
  process.on('SIGINT', () => { cleanup(); rmSync(HOME, { recursive: true, force: true }); process.exit(0); });
} else {
  cleanup();
}
