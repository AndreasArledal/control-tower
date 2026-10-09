import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionModel, resolveState, resolveAgentState } from '../server/model.mjs';

const T0 = Date.parse('2026-10-09T07:00:00Z');
const e = (kind, extra = {}, i = 0, ts = T0 + i * 1000) => ({ i, ts, kind, uuid: 'u' + i, parentUuid: null, agentId: null, ...extra });

test('model tracks title, prompts, last text and counts', () => {
  const m = new SessionModel();
  m.ingest(e('prompt', { text: 'Build a dashboard please' }, 0));
  m.ingest(e('thinking', { text: 'ok' }, 1));
  m.ingest(e('tool_use', { tool: { id: 't1', name: 'Bash', input: { command: 'ls -la' } }, usage: { context: 1200 }, model: 'claude-fable-5-1' }, 2));
  m.ingest(e('tool_result', { result: { toolUseId: 't1', text: 'files', isError: false } }, 3));
  m.ingest(e('text', { text: 'Done, here it is.', stopReason: 'end_turn' }, 4));
  m.ingest(e('title', { text: 'Dashboard build' }, 5));
  assert.equal(m.title, 'Dashboard build');
  assert.equal(m.firstPrompt, 'Build a dashboard please');
  assert.equal(m.lastPrompt, 'Build a dashboard please');
  assert.equal(m.lastAssistantText, 'Done, here it is.');
  assert.equal(m.turns, 1);
  assert.equal(m.toolCalls, 1);
  assert.equal(m.contextTokens, 1200);
  assert.equal(m.model, 'claude-fable-5-1');
  assert.equal(m.pendingTools.size, 0);
  assert.equal(m.lastStopReason, 'end_turn');
});

test('model falls back to the first prompt as title', () => {
  const m = new SessionModel();
  m.ingest(e('prompt', { text: 'A very long first prompt that goes on and on and should be truncated for a title somewhere sensible' }, 0));
  assert.ok(m.title.length <= 60);
  assert.ok(m.title.startsWith('A very long first prompt'));
});

test('activity reports the running tool, thinking, responding, or question', () => {
  const m = new SessionModel();
  m.ingest(e('prompt', { text: 'go' }, 0));
  m.ingest(e('thinking', { text: 'Let me look' }, 1));
  assert.equal(m.activity().kind, 'thinking');
  m.ingest(e('tool_use', { tool: { id: 't1', name: 'Bash', input: { command: 'pnpm test', description: 'Run tests' } } }, 2));
  assert.deepEqual([m.activity().kind, m.activity().tool, m.activity().label], ['tool', 'Bash', 'Run tests']);
  m.ingest(e('tool_result', { result: { toolUseId: 't1', text: '', isError: false } }, 3));
  m.ingest(e('text', { text: 'Tests pass.' }, 4));
  assert.equal(m.activity().kind, 'responding');
  m.ingest(e('tool_use', { tool: { id: 't2', name: 'AskUserQuestion', input: { questions: [{ question: 'Which DB?' }] } } }, 5));
  assert.equal(m.activity().kind, 'question');
  assert.equal(m.pendingQuestion.text, 'Which DB?');
});

test('resolveState: exited beats everything, attention beats done, done beats working', () => {
  const base = { alive: true, busy: false, doneAt: null, lastPromptAt: T0, attention: null, pendingQuestion: null, ackedAt: null, lastActivityAt: T0, now: T0 + 60_000 };
  assert.equal(resolveState({ ...base, alive: false }).state, 'exited');
  assert.equal(resolveState({ ...base, attention: { kind: 'permission', at: T0 + 5 } }).state, 'permission');
  assert.equal(resolveState({ ...base, pendingQuestion: { text: 'x' } }).state, 'question');
  assert.equal(resolveState({ ...base, doneAt: T0 + 10 }).state, 'done');
  assert.equal(resolveState({ ...base, doneAt: T0 + 10, ackedAt: T0 + 11 }).state, 'idle');
  assert.equal(resolveState({ ...base, doneAt: T0 - 10 }).state, 'idle', 'done before the last prompt is stale');
  assert.equal(resolveState({ ...base, busy: true }).state, 'working');
  assert.equal(resolveState({ ...base, lastActivityAt: T0 + 59_000 }).state, 'working', 'fresh transcript activity counts as working');
  assert.equal(resolveState({ ...base }).state, 'idle');
});

test('resolveAgentState: done on end_turn, parent result or hook stop; exited with session', () => {
  const m = new SessionModel();
  m.ingest(e('tool_use', { tool: { id: 'a1', name: 'Read', input: {} } }, 0));
  assert.equal(resolveAgentState({ model: m, parentHasResult: false, stopped: false, sessionAlive: true }), 'running');
  assert.equal(resolveAgentState({ model: m, parentHasResult: true, stopped: false, sessionAlive: true }), 'done');
  assert.equal(resolveAgentState({ model: m, parentHasResult: false, stopped: true, sessionAlive: true }), 'done');
  assert.equal(resolveAgentState({ model: m, parentHasResult: false, stopped: false, sessionAlive: false }), 'exited');
  m.ingest(e('tool_result', { result: { toolUseId: 'a1', text: '', isError: false } }, 1));
  m.ingest(e('text', { text: 'Report', stopReason: 'end_turn' }, 2));
  assert.equal(resolveAgentState({ model: m, parentHasResult: false, stopped: false, sessionAlive: true }), 'done');
});
