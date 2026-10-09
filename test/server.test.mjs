import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRadarServer } from '../server/index.mjs';

function fakeStore() {
  const s = new EventEmitter();
  s.snapshot = () => ({ projects: [], sessions: [{ id: 'a' }], attention: [] });
  s.timeline = (id) => (id === 'a' ? { total: 1, entries: [{ kind: 'prompt', text: 'hi' }], hasMore: false } : null);
  s.requested = [];
  s.requestSummary = (id) => { s.requested.push(id); return true; }; s.seen = []; s.markSeen = (id) => { s.seen.push(id); return true; }; s.setSettings = (p) => { s.settings = p; }; s.settings = {};
  return s;
}

test('serves the page, state, timeline and queues summaries', async () => {
  const webDir = mkdtempSync(join(tmpdir(), 'radar-web-'));
  writeFileSync(join(webDir, 'index.html'), '<title>Radar</title>');
  const store = fakeStore();
  const server = createRadarServer({ store, webDir, hooksCtl: { status: async () => ({ installed: false }) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base + '/')).text(), /Radar/);
  assert.equal((await (await fetch(base + '/api/state')).json()).sessions[0].id, 'a');
  assert.equal((await (await fetch(base + '/api/timeline?session=a')).json()).entries[0].text, 'hi');
  assert.equal((await fetch(base + '/api/timeline?session=zzz')).status, 404);
  assert.equal((await fetch(base + '/api/session/a/summarize', { method: 'POST' })).status, 200);
  assert.deepEqual(store.requested, ['a']);
  assert.equal((await fetch(base + '/api/session/a/seen', { method: 'POST' })).status, 200);
  assert.deepEqual(store.seen, ['a']);
  assert.equal((await fetch(base + '/../etc/passwd')).status, 404);
  server.closeAllConnections?.(); server.close();
});

test('rejects cross-origin requests so a web page cannot drive the local API', async () => {
  const webDir = mkdtempSync(join(tmpdir(), 'radar-web-'));
  const store = fakeStore();
  const server = createRadarServer({ store, webDir, hooksCtl: { status: async () => ({}) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const raw = (method, path, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await raw('POST', '/api/session/a/summarize', { origin: 'https://evil.example' }), 403);
    assert.equal(await raw('POST', '/api/session/a/summarize', { origin: `http://127.0.0.1:${port}` }), 200);
    assert.equal(await raw('POST', '/api/session/a/summarize', {}), 200, 'curl-style requests without Origin stay allowed');
    assert.equal(await raw('GET', '/api/state', { origin: 'https://evil.example' }), 403, 'reads are private too');
  } finally { server.closeAllConnections?.(); server.close(); }
});
