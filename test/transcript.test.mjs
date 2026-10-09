import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseLine, TranscriptTailer } from '../server/transcript.mjs';

const L = (o) => JSON.stringify(o);
const base = { uuid: 'u1', parentUuid: 'p1', timestamp: '2026-10-09T07:23:10.636Z', sessionId: 's1', isSidechain: false };

test('parses a typed human prompt', () => {
  const e = parseLine(L({ ...base, type: 'user', message: { role: 'user', content: 'Build it' }, origin: { kind: 'human' } }), 0);
  assert.equal(e.length, 1);
  assert.equal(e[0].kind, 'prompt');
  assert.equal(e[0].text, 'Build it');
  assert.equal(e[0].ts, Date.parse(base.timestamp));
  assert.equal(e[0].uuid, 'u1');
});

test('parses assistant thinking, text and tool_use blocks as separate entries', () => {
  const e = parseLine(L({ ...base, type: 'assistant', message: { id: 'm1', model: 'claude-fable-5-1', stop_reason: null, role: 'assistant', usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 },
    content: [ { type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Hi' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } } ] } }), 3);
  assert.deepEqual(e.map(x => x.kind), ['thinking', 'text', 'tool_use']);
  assert.equal(e[0].text, 'hmm');
  assert.equal(e[2].tool.name, 'Bash');
  assert.equal(e[2].tool.id, 't1');
  assert.equal(e[2].usage.context, 1002);
  assert.equal(e[2].model, 'claude-fable-5-1');
  assert.equal(e[2].i, 3);
});

test('parses tool results, keeping text short and flagging errors', () => {
  const e = parseLine(L({ ...base, type: 'user', toolUseResult: {}, message: { role: 'user', content: [ { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [ { type: 'text', text: 'boom' } ] } ] } }), 4);
  assert.equal(e[0].kind, 'tool_result');
  assert.equal(e[0].result.toolUseId, 't1');
  assert.equal(e[0].result.isError, true);
  assert.equal(e[0].result.text, 'boom');
});

test('treats system-injected user text as notice, not prompt', () => {
  const e = parseLine(L({ ...base, type: 'user', isMeta: true, message: { role: 'user', content: [ { type: 'text', text: '<task-notification>done</task-notification>' } ] } }), 5);
  assert.equal(e[0].kind, 'notice');
});

test('parses ai-title and ignores attachments', () => {
  assert.equal(parseLine(L({ type: 'ai-title', aiTitle: 'Dashboard', sessionId: 's1' }), 6)[0].kind, 'title');
  assert.equal(parseLine(L({ ...base, type: 'attachment', attachment: { type: 'date' } }), 7).length, 0);
  assert.equal(parseLine('not json', 8).length, 0);
});

test('tailer returns only new entries and tolerates partial trailing lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const f = join(dir, 't.jsonl');
  writeFileSync(f, L({ ...base, type: 'user', message: { role: 'user', content: 'one' } }) + '\n');
  const t = new TranscriptTailer(f);
  const first = await t.poll();
  assert.equal(first.length, 1);
  assert.equal(first[0].text, 'one');
  assert.equal((await t.poll()).length, 0);
  const second = L({ ...base, uuid: 'u2', type: 'user', message: { role: 'user', content: 'two' } });
  appendFileSync(f, second.slice(0, 20));
  assert.equal((await t.poll()).length, 0);
  appendFileSync(f, second.slice(20) + '\n');
  const more = await t.poll();
  assert.equal(more.length, 1);
  assert.equal(more[0].text, 'two');
  assert.equal(more[0].i, 1);
});

test('a line without a timestamp gets ts null instead of now', () => {
  const e = parseLine(L({ type: 'ai-title', aiTitle: 'X', sessionId: 's1' }), 0)[0];
  assert.equal(e.ts, null);
});

test('empty thinking blocks are dropped', () => {
  const e = parseLine(L({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'x' }] } }), 0);
  assert.deepEqual(e.map((x) => x.kind), ['text']);
});

test('a multibyte character split across two reads is decoded intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const f = join(dir, 'u.jsonl');
  const line = Buffer.from(L({ ...base, type: 'user', message: { role: 'user', content: 'Klart 🎉 bra' } }) + '\n');
  const cut = line.indexOf('🎉') + 2; // inside the 4-byte emoji
  writeFileSync(f, line.subarray(0, cut));
  const t = new TranscriptTailer(f);
  assert.equal((await t.poll()).length, 0);
  appendFileSync(f, line.subarray(cut));
  const got = await t.poll();
  assert.equal(got[0].text, 'Klart 🎉 bra');
});

test('tailer survives the file vanishing between polls', async () => {
  const t = new TranscriptTailer('/nonexistent/radar/t.jsonl');
  assert.deepEqual(await t.poll(), []);
});
