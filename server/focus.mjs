import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const APP_NAMES = { wezterm: 'WezTerm', iterm: 'iTerm', terminal: 'Terminal', kitty: 'kitty', ghostty: 'Ghostty', alacritty: 'Alacritty', warp: 'Warp', hyper: 'Hyper', vscode: 'Visual Studio Code', cursor: 'Cursor' };

const shq = (s) => String(s).replace(/([^A-Za-z0-9_\/:=.,~-])/g, '\\$1');

export function parseWezTermList(json) {
  try { return JSON.parse(json).map((p) => ({ paneId: p.pane_id, tty: String(p.tty_name ?? '').replace(/^\/dev\//, ''), windowId: p.window_id })); } catch { return []; }
}

/**
 * Pure planner: given what we know (terminal app, the process's tty, pane listings), return the
 * commands to run in order. Keeping this pure makes the per-terminal logic testable.
 */
export function planFocus({ terminal, tty, pid, cwd, panes = [], tmuxPanes = '', custom = null, platform = process.platform }) {
  if (custom) {
    const cmd = custom.replace(/\{(tty|pid|cwd|sessionId)\}/g, (_, k) => shq({ tty, pid, cwd }[k] ?? ''));
    return [['sh', '-c', cmd]];
  }
  const raise = platform === 'darwin' && APP_NAMES[terminal] ? [['open', '-a', APP_NAMES[terminal]]] : [];
  if (!tty) return raise;
  switch (terminal) {
    case 'wezterm': {
      const pane = panes.find((p) => p.tty === tty);
      return pane ? [['wezterm', 'cli', 'activate-pane', '--pane-id', String(pane.paneId)], ...raise] : raise;
    }
    case 'tmux': {
      const line = tmuxPanes.split('\n').map((l) => l.trim().split(/\s+/)).find(([t]) => t === tty || t === '/dev/' + tty);
      if (!line) return raise;
      const target = line[1]; const [sess, rest] = target.split(':'); const win = rest.split('.')[0];
      return [['tmux', 'switch-client', '-t', target], ['tmux', 'select-window', '-t', `${sess}:${win}`], ['tmux', 'select-pane', '-t', target], ...raise];
    }
    case 'iterm':
      return [['osascript', '-e', `tell application "iTerm"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s ends with "${tty}" then
          select t
          select s
          set index of w to 1
          return
        end if
      end repeat
    end repeat
  end repeat
end tell`]];
    case 'terminal':
      return [['osascript', '-e', `tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t ends with "${tty}" then
        set selected tab of w to t
        set index of w to 1
        return
      end if
    end repeat
  end repeat
end tell`]];
    case 'kitty':
      return [['kitty', '@', 'focus-window', '--match', `env:CLAUDE_PID=${pid}`], ...raise];
    default:
      return raise;
  }
}

async function ttyOf(pid) {
  try { const { stdout } = await run('ps', ['-o', 'tty=', '-p', String(pid)]); const t = stdout.trim(); return t && t !== '??' && t !== '?' ? t : null; } catch { return null; }
}

/** Walk up from the pid to find the terminal emulator (or tmux) that hosts it. */
async function detectTerminal(pid) {
  let cur = pid;
  for (let i = 0; i < 12 && cur > 1; i++) {
    let out;
    try { ({ stdout: out } = await run('ps', ['-o', 'ppid=,comm=', '-p', String(cur)])); } catch { return null; }
    const m = out.trim().match(/^(\d+)\s+(.*)$/); if (!m) return null;
    const comm = m[2].toLowerCase();
    if (/tmux/.test(comm)) return 'tmux';
    if (/wezterm/.test(comm)) return 'wezterm';
    if (/iterm/.test(comm)) return 'iterm';
    if (/terminal\.app|\/terminal$/.test(comm)) return 'terminal';
    if (/kitty/.test(comm)) return 'kitty';
    if (/ghostty/.test(comm)) return 'ghostty';
    if (/alacritty/.test(comm)) return 'alacritty';
    if (/warp/.test(comm)) return 'warp';
    if (/hyper/.test(comm)) return 'hyper';
    if (/code helper|electron.*code|visual studio code/.test(comm)) return 'vscode';
    if (/cursor/.test(comm)) return 'cursor';
    cur = Number(m[1]);
  }
  return null;
}

/** Bring the terminal pane that runs this Claude process to the front. Best effort; reports what it did. */
export async function focusProcess({ pid, cwd, custom = null }) {
  if (!pid) return { ok: false, reason: 'no process id for this session' };
  const tty = await ttyOf(pid);
  const terminal = custom ? null : await detectTerminal(pid);
  let panes = [], tmuxPanes = '';
  if (terminal === 'wezterm') { try { panes = parseWezTermList((await run('wezterm', ['cli', 'list', '--format', 'json'])).stdout); } catch { /* cli unavailable */ } }
  if (terminal === 'tmux') { try { tmuxPanes = (await run('tmux', ['list-panes', '-a', '-F', '#{pane_tty} #{session_name}:#{window_index}.#{pane_index}'])).stdout; } catch { /* no server */ } }
  const plan = planFocus({ terminal, tty, pid, cwd, panes, tmuxPanes, custom });
  if (!plan.length) return { ok: false, reason: terminal ? `no way to focus a ${terminal} pane` : 'could not tell which terminal runs this session', tty, terminal };
  for (const [cmd, ...args] of plan) {
    try { await run(cmd, args, { timeout: 5000 }); } catch (err) { return { ok: false, reason: `${cmd} failed: ${String(err.stderr || err.message).trim().slice(0, 200)}`, tty, terminal }; }
  }
  return { ok: true, via: custom ? 'custom command' : terminal, tty };
}
