import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProjectDir, transcriptPathFor, claudeHome } from '../server/paths.mjs';

test('encodes a cwd the way Claude Code names project dirs', () => {
  assert.equal(encodeProjectDir('/Users/andreas/.claude'), '-Users-andreas--claude');
  assert.equal(encodeProjectDir('/Users/a/src/x/.claude/worktrees/hub-ai'), '-Users-a-src-x--claude-worktrees-hub-ai');
});

test('builds the transcript path under the claude home', () => {
  assert.equal(
    transcriptPathFor('/home/u/.claude', '/home/u/proj', 'abc-123'),
    '/home/u/.claude/projects/-home-u-proj/abc-123.jsonl'
  );
});

test('claudeHome honours CLAUDE_CONFIG_DIR', () => {
  assert.equal(claudeHome({ CLAUDE_CONFIG_DIR: '/tmp/cc', HOME: '/home/u' }), '/tmp/cc');
  assert.equal(claudeHome({ HOME: '/home/u' }), '/home/u/.claude');
});
