import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RadarStore } from '../server/store.mjs';
import { encodeProjectDir } from '../server/paths.mjs';

const L = (o) => JSON.stringify(o) + '\n';
const base = (sid, i) => ({ uuid: 'u' + i, parentUuid: i ? 'u' + (i - 1) : null, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(), sessionId: sid, isSidechain: false, cwd: '/p/a' });

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'radar-home-'));
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
  const store = new RadarStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000;
  store._now = () => clock;
  await store.tick();
  let snap = store.snapshot();
  assert.equal(snap.projects.length, 1);
  assert.equal(snap.projects[0].path, '/p/a');
  assert.equal(snap.projects[0].name, 'a');
  const s = snap.sessions.find((x) => x.id === sid);
  assert.equal(s.title, 'Building it');
  assert.equal(s.state, 'working');
  assert.equal(s.activity.kind, 'tool');
  assert.equal(s.activity.tool, 'Agent');
  assert.equal(s.agents.length, 1);
  assert.deepEqual([s.agents[0].id, s.agents[0].description, s.agents[0].state, s.agents[0].parentAgentId, s.agents[0].activity.tool], ['abc', 'Scout the repo', 'running', null, 'Read']);

  // Stop hook arrives via spool dir
  const spool = join(home, 'claude-radar', 'events');
  mkdirSync(spool, { recursive: true });
  writeFileSync(join(spool, 'ev1.json'), JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: '/p/a', transcript_path: transcript, last_assistant_message: 'All built.' }));
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: '/p/a', name: 'a-1', status: 'idle', startedAt: 1 }));
  await store.tick();
  snap = store.snapshot();
  assert.equal(snap.sessions[0].state, 'done');
  assert.equal(snap.attention.length, 1);
  assert.equal(snap.hooksSeen, true);

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
  const store = new RadarStore({ home, summarizer: null });
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
  const store = new RadarStore({ home, summarizer: null });
  await store.tick();
  assert.equal(store.snapshot().sessions[0].state, 'exited');
  store.stop();
});

test('hook events that pile up between ticks are applied in write order, not name order', async () => {
  const { home, sid, transcript } = fakeHome();
  const store = new RadarStore({ home, summarizer: null });
  let clock = 1_700_000_000_000 + 10_000; store._now = () => clock;
  await store.tick();
  const spool = join(home, 'claude-radar', 'events'); mkdirSync(spool, { recursive: true });
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
  const store = new RadarStore({ home, summarizer: null });
  await store.tick();
  const all = store.timeline(sid, null, { after: -1, limit: 10 });
  assert.deepEqual(all.entries.map((e) => e.seq), [0, 1, 2]);
  assert.equal(store.timeline(sid, null, { after: 1, limit: 10 }).entries.map((e) => e.seq).join(), '2');
  const before = store.timeline(sid, null, { before: 2, limit: 1 });
  assert.deepEqual(before.entries.map((e) => e.seq), [1]);
  assert.equal(before.hasMore, true);
  store.stop();
});
