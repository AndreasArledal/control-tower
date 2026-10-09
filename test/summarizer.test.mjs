import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, parseSummary, Summarizer } from '../server/summarizer.mjs';

const view = { title: 'Dashboard build', cwd: '/p/a', state: 'done', turns: 2, toolCalls: 5, firstPrompt: 'Build a dashboard', lastPrompt: 'Make it blue', lastAssistantText: 'Done, it is blue now.', agents: [{ description: 'Review CSS', type: 'general-purpose', state: 'done' }], stateMessage: null };
const entries = [
  { kind: 'tool_use', tool: { name: 'Bash', input: { command: 'ls' } } },
  { kind: 'tool_use', tool: { name: 'Edit', input: { file_path: 'web/app.js' } } },
  { kind: 'prompt', text: 'Build a dashboard' },
  { kind: 'prompt', text: 'Make it blue' },
];

test('buildDigest includes the facts a summary needs and stays bounded', () => {
  const d = buildDigest(view, entries);
  for (const s of ['Dashboard build', '/p/a', 'done', 'Build a dashboard', 'Make it blue', 'Review CSS', 'Bash: ls', 'Edit: web/app.js']) assert.ok(d.includes(s), `missing ${s}`);
  const huge = buildDigest({ ...view, lastAssistantText: 'x'.repeat(50_000) }, entries);
  assert.ok(huge.length < 8000);
});

test('parseSummary accepts structured output or a JSON result string', () => {
  assert.deepEqual(parseSummary({ structured_output: { headline: 'h', goal: 'g', done: ['a', 'b'], now: 'n', next: 'x' } }), { headline: 'h', goal: 'g', done: ['a', 'b'], now: 'n', next: 'x', progress: '' });
  assert.deepEqual(parseSummary({ result: '{"headline":"h2","progress":"p2","needs":"n2"}' }), { headline: 'h2', goal: '', done: [], now: '', next: 'n2', progress: 'p2' });
  assert.equal(parseSummary({ result: 'Not logged in', is_error: true }), null);
});

test('Summarizer runs one job at a time, caches by key and reports results', async () => {
  const calls = [];
  const runner = async (prompt) => { calls.push(prompt); await new Promise((r) => setTimeout(r, 5)); return { total_cost_usd: 0.002, structured_output: { headline: 'H', goal: 'G', done: [], now: '', next: '' } }; };
  const results = [];
  const s = new Summarizer({ runner, onResult: (id, sum) => results.push([id, sum]) });
  s.request('s1', 'k1', () => 'digest one');
  s.request('s1', 'k1', () => 'digest one again');
  s.request('s2', 'k2', () => 'digest two');
  await s.idle();
  assert.equal(calls.length, 2);
  assert.deepEqual(results.map((r) => r[0]), ['s1', 's2']);
  assert.equal(results[0][1].headline, 'H');
  s.request('s1', 'k1', () => 'cached');
  await s.idle();
  assert.equal(calls.length, 2, 'same key is served from cache');
  assert.equal(s.spend.count, 2);
  assert.ok(Math.abs(s.spend.usd - 0.004) < 1e-9);
  assert.equal(s.spend.todayCount, 2);
});
