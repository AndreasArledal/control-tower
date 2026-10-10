import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegistry, isPidAlive } from '../server/registry.mjs';

test('readRegistry lists sessions and marks liveness by pid', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tower-home-'));
  mkdirSync(join(home, 'sessions'));
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's-live', cwd: '/p/a', name: 'a-1', status: 'busy', startedAt: 5, kind: 'interactive', version: '2.1.0' }));
  writeFileSync(join(home, 'sessions', '999999.json'), JSON.stringify({ pid: 999999, sessionId: 's-dead', cwd: '/p/b', name: 'b-1', status: 'idle', startedAt: 6 }));
  writeFileSync(join(home, 'sessions', 'junk.json'), '{not json');
  const list = await readRegistry(home);
  const live = list.find((s) => s.sessionId === 's-live');
  const dead = list.find((s) => s.sessionId === 's-dead');
  assert.deepEqual([live.alive, live.busy, live.cwd, live.name, live.pid], [true, true, '/p/a', 'a-1', process.pid]);
  assert.equal(dead.alive, false);
  assert.equal(list.length, 2);
});

test('isPidAlive is true for this process and false for a bogus pid', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(999999), false);
});
