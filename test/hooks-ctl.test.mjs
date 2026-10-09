import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeHooksCtl } from '../server/hooks-ctl.mjs';

test('install and uninstall round-trip settings.json and keep a backup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'radar-home-'));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  const ctl = makeHooksCtl(home);
  assert.equal((await ctl.status()).installed, false);
  await ctl.install();
  assert.equal((await ctl.status()).installed, true);
  assert.ok(existsSync(join(home, 'control-tower', 'hook.sh')));
  assert.ok(existsSync(join(home, 'settings.json.radar-backup')));
  const after = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
  assert.equal(after.hooks.Stop[0].hooks[0].command, 'echo hi');
  await ctl.uninstall();
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')), { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } });
});

test('refuses to touch a settings.json that is not valid JSON', async () => {
  const home = mkdtempSync(join(tmpdir(), 'radar-home-'));
  writeFileSync(join(home, 'settings.json'), '{ "model": "x", ');
  const ctl = makeHooksCtl(home);
  await assert.rejects(() => ctl.install(), /not valid JSON/);
  await assert.rejects(() => ctl.uninstall(), /not valid JSON/);
  assert.equal(readFileSync(join(home, 'settings.json'), 'utf8'), '{ "model": "x", ');
});
