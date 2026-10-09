import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHooks, removeHooks, hasRadarHooks, RADAR_EVENTS } from '../server/hooks-install.mjs';

const existing = { model: 'x', hooks: { WorktreeCreate: [{ matcher: '', hooks: [{ type: 'command', command: '~/.claude/hooks/on-worktree-create.sh' }] }] } };

test('mergeHooks adds radar hooks for every event and keeps existing hooks and settings', () => {
  const out = mergeHooks(existing, '/home/u/.claude/claude-radar/hook.sh');
  assert.equal(out.model, 'x');
  assert.equal(out.hooks.WorktreeCreate[0].hooks[0].command, '~/.claude/hooks/on-worktree-create.sh');
  for (const ev of RADAR_EVENTS) assert.ok(out.hooks[ev], `missing ${ev}`);
  const stop = out.hooks.Stop.find((g) => g.hooks.some((h) => h.command.includes('claude-radar')));
  assert.ok(stop);
  assert.equal(stop.hooks[0].async, true);
  assert.equal(hasRadarHooks(out), true);
  assert.equal(hasRadarHooks(existing), false);
  assert.deepEqual(existing.hooks.WorktreeCreate.length, 1, 'input not mutated');
});

test('mergeHooks is idempotent and removeHooks restores the original', () => {
  const once = mergeHooks(existing, '/x/claude-radar/hook.sh');
  const twice = mergeHooks(once, '/x/claude-radar/hook.sh');
  assert.deepEqual(twice, once);
  const back = removeHooks(twice);
  assert.deepEqual(back, existing);
});

test('AskUserQuestion hooks only match that tool', () => {
  const out = mergeHooks({}, '/x/claude-radar/hook.sh');
  assert.equal(out.hooks.PreToolUse[0].matcher, 'AskUserQuestion');
  assert.equal(out.hooks.PostToolUse[0].matcher, 'AskUserQuestion');
});
