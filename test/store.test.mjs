import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TowerStore } from '../server/store.mjs';
import { encodeProjectDir } from '../server/paths.mjs';
import { mergeHooks } from '../server/hooks-install.mjs';

const L = (o) => JSON.stringify(o) + '\n';
const base = (sid, i) => ({ uuid: 'u' + i, parentUuid: i ? 'u' + (i - 1) : null, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(), sessionId: sid, isSidechain: false, cwd: '/p/a' });

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tower-home-'));
  mkdirSync(join(home, 'sessions'));
  const proj = join(home, 'projects', encodeProjectDir('/p/a'));
  mkdirSync(proj, { recursive: true });
  const sid = 'sess-1';
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'busy', startedAt: 1 }));
  const t = join(proj, `${sid}.jsonl`);
  writeFileSync(t,
    L({ ...base(sid, 0), type: 'user', message: { role: 'user', content: 'Build it' }, origin: { kind: 'human' } }) +
    L({ ...base(sid, 1), type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'claude-fable-5-1', stop_reason: 'tool_use', usage: { input_tokens: 1, cache_read_input_tokens: 10 }, content: [{ type: 'tool_use', id: 'tu-agent', name: 'Agent', input: { description: 'Scout the repo', subagent_type: 'Explore' } }] } }) +
    L({ type: 'ai-title', aiTitle: 'Building it', sessionId: sid })
  );
  const agents = join(proj, sid, 'subagents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', isFork: false, description: 'Scout the repo', toolUseId: 'tu-agent', spawnDepth: 1, model: 'inherit' }));
  writeFileSync(join(agents, 'agent-abc.jsonl'),
    L({ ...base(sid, 0), isSidechain: true, agentId: 'abc', type: 'user', message: { role: 'user', content: 'Scout' } }) +
    L({ ...base(sid, 1), isSidechain: true, agentId: 'abc', type: 'assistant', message: { id: 'm2', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: 'README.md' } }] } })
  );
  return { home, sid, transcript: t, proj };
}

test('store builds projects, sessions, agents and reacts to hook events', async () => {
  const { home, sid, transcript } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000;
  store._now = () => clock;
  await store.tick();
  let snap = store.snapshot();
  assert.equal(snap.projects.length, 1);
  assert.equal(snap.projects[0].path, '/p/a');
  assert.equal(snap.projects[0].name, 'a');
  assert.equal(snap.projects[0].active, true);
  const s = snap.sessions.find((x) => x.id === sid);
  assert.equal(s.title, 'Building it');
  assert.equal(s.state, 'working');
  assert.equal(s.activity.kind, 'tool');
  assert.equal(s.activity.tool, 'Agent');
  assert.equal(s.agents.length, 1);
  assert.deepEqual([s.agents[0].id, s.agents[0].description, s.agents[0].state, s.agents[0].parentAgentId, s.agents[0].activity.tool], ['abc', 'Scout the repo', 'running', null, 'Read']);

  // Stop hook arrives via spool dir
  const spool = join(home, 'control-tower', 'events');
  mkdirSync(spool, { recursive: true });
  writeFileSync(join(spool, 'ev1.json'), JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: '/p/a', transcript_path: transcript, last_assistant_message: 'All built.' }));
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'idle', startedAt: 1 }));
  await store.tick();
  snap = store.snapshot();
  assert.equal(snap.sessions[0].state, 'done');
  assert.equal(snap.attention.length, 0, 'a plain turn end is not attention');
  assert.equal(snap.hooksSeen, true);
  // a follow-up verdict makes it attention; seen clears the count but not the state
  store.sessions.get(sid).summary = { headline: 'h', goal: '', done: [], now: '', next: '', status: 'waiting_for_user', waitingFor: 'Pick one', at: clock + 1 };
  snap = store.snapshot();
  assert.equal(snap.attention.length, 1);
  assert.equal(snap.unseen, 1);
  store.markSeen(sid);
  snap = store.snapshot();
  assert.equal(snap.sessions[0].state, 'done', 'seen does not change the state');
  assert.equal(snap.attention[0].seen, true);
  assert.equal(snap.unseen, 0);
  store.sessions.get(sid).summary = null;

  // a new prompt makes it working again
  appendFileSync(transcript, L({ ...base(sid, 15), type: 'user', message: { role: 'user', content: 'Now test it' }, origin: { kind: 'human' } }));
  clock = 1_700_000_000_000 + 16_000;
  await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'working');
  assert.equal(store.snapshot().sessions[0].lastPrompt, 'Now test it');

  const tl = store.timeline(sid, null, { after: -1, limit: 50 });
  assert.deepEqual(tl.entries.map((e) => e.kind), ['prompt', 'tool_use', 'title', 'prompt']);
  const atl = store.timeline(sid, 'abc', { after: -1, limit: 50 });
  assert.deepEqual(atl.entries.map((e) => e.kind), ['prompt', 'tool_use']);
  store.stop();
});

test('a background agent is not finished just because its launch call returned', async () => {
  const { home, sid, transcript, proj } = fakeHome();
  const agents = join(proj, sid, 'subagents');
  writeFileSync(join(agents, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Scout the repo', toolUseId: 'tu-agent', spawnDepth: 1, requestShape: 'background' }));
  appendFileSync(transcript, L({ ...base(sid, 2), type: 'user', toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-agent', content: 'Async agent launched successfully.' }] } }));
  const store = new TowerStore({ home, summarizer: null });
  await store.tick();
  assert.equal(store.snapshot().sessions[0].agents[0].state, 'running');
  appendFileSync(join(agents, 'agent-abc.jsonl'),
    L({ ...base(sid, 2), isSidechain: true, agentId: 'abc', type: 'user', toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-read', content: 'x' }] } }) +
    L({ ...base(sid, 3), isSidechain: true, agentId: 'abc', type: 'assistant', message: { id: 'm3', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Report done.' }] } }));
  await store.tick();
  assert.equal(store.snapshot().sessions[0].agents[0].state, 'done');
  store.stop();
});

test('store treats a session whose process is gone as exited', async () => {
  const { home, sid } = fakeHome();
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: 999999, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'idle', startedAt: 1 }));
  const store = new TowerStore({ home, summarizer: null });
  await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'exited');
  store.stop();
});

test('hook events that pile up between ticks are applied in write order, not name order', async () => {
  const { home, sid, transcript } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  const spool = join(home, 'control-tower', 'events'); mkdirSync(spool, { recursive: true });
  // "a" sorts first by name but was written later: a prompt after the stop must win
  writeFileSync(join(spool, 'z-first.json'), JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: '/p/a', transcript_path: transcript, last_assistant_message: 'done' }));
  utimesSync(join(spool, 'z-first.json'), new Date(clock - 2000), new Date(clock - 2000));
  writeFileSync(join(spool, 'a-second.json'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: '/p/a', transcript_path: transcript, prompt_text: 'more' }));
  utimesSync(join(spool, 'a-second.json'), new Date(clock - 1000), new Date(clock - 1000));
  await store.tick();
  assert.notEqual(store.snapshot().sessions[0].state, 'done');
  store.stop();
});

test('timeline pages by seq and survives the entry cap', async () => {
  const { home, sid } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  await store.tick();
  const all = store.timeline(sid, null, { after: -1, limit: 10 });
  assert.deepEqual(all.entries.map((e) => e.seq), [0, 1, 2]);
  assert.equal(store.timeline(sid, null, { after: 1, limit: 10 }).entries.map((e) => e.seq).join(), '2');
  const before = store.timeline(sid, null, { before: 2, limit: 1 });
  assert.deepEqual(before.entries.map((e) => e.seq), [1]);
  assert.equal(before.hasMore, true);
  store.stop();
});

test('projects carry a headline: session titles by default, the summarizer result when available', async () => {
  const { home, sid } = fakeHome();
  const results = [];
  const fakeSummarizer = { available: true, lastError: null, lastRunAt: new Map(), cached: () => null, isQueued: () => false, request: (id, key, digestFn) => { results.push({ id, key, digest: digestFn() }); return true; } };
  const store = new TowerStore({ home, summarizer: fakeSummarizer, settings: { summaries: 'auto' } });
  await store.tick();
  assert.equal(store.snapshot().projects[0].headline, 'Building it');
  const job = results.find((r) => r.id === 'project:/p/a');
  assert.ok(job, 'a project summary was requested');
  assert.match(job.digest, /Building it/);
  store.onSummary('project:/p/a', { headline: 'Shipping the dashboard', progress: '', needs: '', at: 1 }, job.key);
  assert.equal(store.snapshot().projects[0].headline, 'Shipping the dashboard');
  store.stop();
});

test('a working session gets its summary refreshed once it is older than the refresh interval', async () => {
  const { home, sid } = fakeHome();
  const requests = [];
  const fakeSummarizer = { available: true, lastError: null, lastRunAt: new Map(), cached: () => null, isQueued: () => false, request: (id, key) => { requests.push({ id, key }); return true; } };
  const store = new TowerStore({ home, summarizer: fakeSummarizer, settings: { summaries: 'auto', summaryRefreshMinutes: 1 } });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  const first = requests.filter((r) => r.id === sid).length;
  assert.ok(first >= 1, 'summarised on first sight');
  store.onSummary(sid, { headline: 'h', goal: '', done: [], now: '', next: '', at: clock }, requests.find((r) => r.id === sid).key);
  clock += 30_000; await store.tick();
  assert.equal(requests.filter((r) => r.id === sid).length, first, 'not yet stale');
  clock += 60_000; fakeSummarizer.lastRunAt.set(sid, 0);
  store.sessions.get(sid).model.count++; // something happened since
  await store.tick();
  assert.equal(requests.filter((r) => r.id === sid).length, first + 1, 'refreshed after the interval');
  store.stop();
});

test('a session the summarizer judges as waiting for the user needs attention and keeps its project active', async () => {
  const { home, sid } = fakeHome();
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'idle', startedAt: 1 }));
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 3 * 60 * 60 * 1000; store._now = () => clock; // three hours later: past the active window
  await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'idle');
  assert.equal(store.snapshot().projects[0].active, false);
  const s = store.sessions.get(sid);
  s.summary = { headline: 'h', goal: '', done: [], now: '', next: '', status: 'waiting_for_user', waitingFor: 'Choose option A or B', at: clock };
  const snap = store.snapshot();
  assert.equal(snap.sessions[0].needsYou, true);
  assert.equal(snap.sessions[0].followUp.reason, 'Choose option A or B');
  assert.equal(snap.attention[0].state, 'followup');
  assert.equal(snap.projects[0].active, true);
  store.markSeen(sid);
  assert.equal(store.snapshot().unseen, 0);
  store.stop();
});

test('a seen follow-up stops counting and stops keeping its project active, but stays listed as seen', async () => {
  const { home, sid } = fakeHome();
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'idle', startedAt: 1 }));
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 3 * 60 * 60 * 1000; store._now = () => clock;
  await store.tick();
  store.sessions.get(sid).summary = { headline: 'h', goal: '', done: [], now: '', next: '', status: 'waiting_for_user', waitingFor: 'Choose option A or B', at: clock };
  assert.equal(store.snapshot().projects[0].active, true);
  store.markSeen(sid);
  const snap = store.snapshot();
  assert.equal(snap.sessions[0].needsYou, false, 'a seen follow-up no longer needs you');
  assert.equal(snap.sessions[0].followUp.reason, 'Choose option A or B', 'the question is kept');
  assert.equal(snap.sessions[0].followUp.seen, true);
  assert.equal(snap.attention.length, 1, 'still listed');
  assert.equal(snap.attention[0].seen, true);
  assert.equal(snap.unseen, 0);
  assert.equal(snap.projects[0].active, false, 'no longer keeps the project active');
  store.stop();
});

test('a seen blocking question still needs you: the terminal is stuck until it is answered', async () => {
  const { home, sid, transcript } = fakeHome();
  appendFileSync(transcript, L({ ...base(sid, 2), type: 'assistant', message: { id: 'm3', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu-q', name: 'AskUserQuestion', input: { questions: [{ question: 'Port 80 or 8080?' }] } }] } }));
  const store = new TowerStore({ home, summarizer: null });
  await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'question');
  store.markSeen(sid);
  const snap = store.snapshot();
  assert.equal(snap.sessions[0].needsYou, true);
  assert.equal(snap.attention[0].seen, true);
  assert.equal(snap.unseen, 0);
  assert.equal(snap.projects[0].active, true);
  store.stop();
});

test('a state change while a summary is in flight is summarised again once that run finishes', async () => {
  const { home, sid } = fakeHome();
  mkdirSync(join(home, 'control-tower', 'events'), { recursive: true });
  const requests = []; const running = new Set();
  const fakeSummarizer = { available: true, lastError: null, lastRunAt: new Map(), cached: () => null, isQueued: (id) => running.has(id), request: (id, key) => { if (running.has(id)) return false; requests.push({ id, key }); running.add(id); return true; } };
  const store = new TowerStore({ home, summarizer: fakeSummarizer, settings: { summaries: 'auto' } });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  const first = requests.find((r) => r.id === sid);
  assert.ok(first, 'summarised on first sight');
  writeFileSync(join(home, 'control-tower', 'events', 'stop.json'), JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: '/p/a' }));
  clock += 1000; await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'done');
  assert.equal(requests.filter((r) => r.id === sid).length, 1, 'the second request is refused while the first run is in flight');
  running.delete(sid); fakeSummarizer.lastRunAt.set(sid, clock);
  store.onSummary(sid, { headline: 'h', goal: '', done: [], now: '', next: '', status: 'working', at: clock }, first.key);
  const mine = requests.filter((r) => r.id === sid);
  assert.equal(mine.length, 2, 're-requested when the run finished');
  assert.match(mine[1].key, /:done$/);
  store.stop();
});

test('exited sessions expire after the TTL and sessions that were never live are dropped at once', async () => {
  const { home, sid } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  assert.equal(store.snapshot().sessions[0].alive, true);
  unlinkSync(join(home, 'sessions', `${process.pid}.json`)); // the CLI exited
  clock += 1000; await store.tick();
  assert.equal(store.snapshot().sessions[0].alive, false);
  clock += 6 * 60 * 60 * 1000 - 5000; await store.tick();
  assert.ok(store.sessions.has(sid), 'still listed just inside the TTL');
  clock += 10_000; await store.tick();
  assert.ok(!store.sessions.has(sid), 'gone after the TTL');
  store._session('ghost'); await store.tick();
  assert.ok(!store.sessions.has('ghost'), 'a record that never went live and has no pid is dropped');
  store.stop();
});

test('the snapshot is only rebuilt when something could have changed; seen still forces a push', async () => {
  const { home, sid, transcript } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  let builds = 0; const real = store.snapshot.bind(store); store.snapshot = () => { builds++; return real(); };
  let changes = 0; store.on('change', () => changes++);
  await store.tick();
  const after1 = builds; assert.ok(after1 >= 1); assert.equal(changes, 1);
  clock += 1000; await store.tick();
  assert.equal(builds, after1, 'nothing changed: no snapshot built');
  appendFileSync(transcript, L({ ...base(sid, 3), type: 'assistant', message: { id: 'm9', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }));
  clock += 1000; await store.tick();
  assert.ok(builds > after1, 'a new transcript line rebuilds the snapshot');
  assert.equal(changes, 2);
  const after2 = builds;
  store.markSeen(sid); clock += 1000; await store.tick();
  assert.ok(builds > after2, 'marking seen rebuilds');
  assert.equal(changes, 3, 'and pushes a change even though the views look the same');
  store.stop();
});

test('hooksInstalled is read asynchronously and cached, refreshed on demand and every few seconds', async () => {
  const { home } = fakeHome();
  const store = new TowerStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  assert.equal(store.snapshot().hooksInstalled, false);
  writeFileSync(join(home, 'settings.json'), JSON.stringify(mergeHooks({}, '/x/control-tower/hook.sh')));
  assert.equal(store.snapshot().hooksInstalled, false, 'cached until refreshed');
  assert.equal(typeof store.refreshHooks, 'function');
  await store.refreshHooks();
  assert.equal(store.snapshot().hooksInstalled, true);
  writeFileSync(join(home, 'settings.json'), '{}');
  clock += 1000; await store.tick();
  assert.equal(store.snapshot().hooksInstalled, true, 'not re-read on every tick');
  clock += 15_000; await store.tick();
  assert.equal(store.snapshot().hooksInstalled, false, 're-read after the interval');
  store.stop();
});
