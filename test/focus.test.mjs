import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFocus, parseWezTermList } from '../server/focus.mjs';

test('wezterm: finds the pane whose tty matches and focuses it, then raises the app', () => {
  const panes = parseWezTermList(JSON.stringify([{ pane_id: 3, tty_name: '/dev/ttys007', window_id: 2 }, { pane_id: 9, tty_name: '/dev/ttys001', window_id: 4 }]));
  const plan = planFocus({ terminal: 'wezterm', tty: 'ttys001', panes, platform: 'darwin' });
  assert.deepEqual(plan.map((c) => c.join(' ')), ['wezterm cli activate-pane --pane-id 9', 'open -a WezTerm']);
});

test('iterm and terminal.app: AppleScript selects the session by tty', () => {
  const it = planFocus({ terminal: 'iterm', tty: 'ttys003', platform: 'darwin' });
  assert.equal(it[0][0], 'osascript');
  assert.match(it[0].join(' '), /ttys003/);
  const ta = planFocus({ terminal: 'terminal', tty: 'ttys003', platform: 'darwin' });
  assert.match(ta[0].join(' '), /Terminal/);
});

test('tmux: selects the pane by tty', () => {
  const plan = planFocus({ terminal: 'tmux', tty: 'ttys003', tmuxPanes: 'ttys003 main:1.0\nttys004 main:2.1', platform: 'darwin' });
  assert.deepEqual(plan[0], ['tmux', 'switch-client', '-t', 'main:1.0']);
  assert.deepEqual(plan[1], ['tmux', 'select-window', '-t', 'main:1']);
  assert.deepEqual(plan[2], ['tmux', 'select-pane', '-t', 'main:1.0']);
});

test('a custom command template wins over detection', () => {
  const plan = planFocus({ custom: 'myfocus --tty {tty} --pid {pid} --cwd {cwd}', tty: 'ttys003', pid: 42, cwd: '/p a', platform: 'darwin' });
  assert.deepEqual(plan, [['sh', '-c', 'myfocus --tty ttys003 --pid 42 --cwd /p\\ a']]);
});

test('unknown terminal with a known app still raises the app', () => {
  const plan = planFocus({ terminal: 'ghostty', tty: 'ttys003', platform: 'darwin' });
  assert.deepEqual(plan, [['open', '-a', 'Ghostty']]);
  assert.deepEqual(planFocus({ terminal: null, tty: null, platform: 'linux' }), []);
});
