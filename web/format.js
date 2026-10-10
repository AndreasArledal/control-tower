export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ago(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Coarser than ago(): stays stable for a minute so node labels do not churn every second. */
export function agoCoarse(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  return ago(ts, now);
}

export function duration(ms) {
  if (ms == null || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function tokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

/** Markdown is noise in a one-line status: drop emphasis, list markers, headings and code ticks. */
export function plain(s) {
  return String(s ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
}

export function clip(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export const STATE_LABEL = { working: 'working', question: 'has a question', permission: 'needs permission', done: 'finished', idle: 'ready', paused: 'ready', exited: 'ended', running: 'running', followup: 'needs you', needs: 'needs you', finished: 'finished' };


/**
 * The four states the page speaks in, derived from the server's finer ones:
 * working · needs you (blocked on a prompt, or the last reply asked you something and you have not looked yet) ·
 * paused (turn ended, waiting for your next prompt; the summary says where it stands) · ended.
 * No "finished": a model reading one reply cannot know whether you intend to continue.
 */
export function uiState(v) {
  if (!v.alive) return 'exited';
  if (v.state === 'working') return 'working';
  if (v.state === 'question' || v.state === 'permission' || (v.followUp && !v.followUp.seen)) return 'needs';
  return 'paused';
}
export const UI_RANK = { needs: 0, working: 1, paused: 2, exited: 3 };
export const AGENT_CLASS = { running: 'running', done: 'finished', exited: 'ended' };

/** The timestamp a node and the drawer both show next to the state: when it started asking, when it last replied, or when the state began. */
export function sinceTs(v) {
  const ui = uiState(v), blocking = v.state === 'question' || v.state === 'permission';
  if (ui === 'needs' && v.followUp && !blocking) return v.followUp.since;
  if (ui === 'paused') return v.lastAssistantAt ?? v.stateSince;
  return v.stateSince;
}

/**
 * The whole fleet in one word, for the beacon on the mark, the tab icon and the tray.
 * Precedence: offline · needs (something waits for you) · working (a session or agent runs) · ready (alive, idle) · empty (nothing running).
 */
export function fleetState(snap, connected = true) {
  if (!connected) return { state: 'offline', label: 'Connection lost, reconnecting…' };
  const live = (snap?.sessions ?? []).filter((v) => v.alive);
  if (!live.length) return { state: 'empty', label: 'No session running. Start one with claude.' };
  const needs = live.filter((v) => v.needsYou).length;
  const working = live.filter((v) => !v.needsYou && (v.state === 'working' || v.runningAgents > 0)).length;
  const ready = live.length - needs - working;
  if (needs) return { state: 'needs', label: `${needs} need${needs === 1 ? 's' : ''} you${working ? ` · ${working} working` : ''}` };
  if (working) return { state: 'working', label: `${working} working${ready ? ` · ${ready} ready` : ''}` };
  return { state: 'ready', label: `${live.length} session${live.length === 1 ? '' : 's'}, all ready for a prompt` };
}

export function stateLabel(s) { return STATE_LABEL[s] ?? s; }

export function activityLine(v) {
  const a = v.activity ?? {};
  if (v.state === 'question') return a.label || v.stateMessage || 'Waiting for your answer';
  if (v.state === 'permission') return v.stateMessage || 'Waiting for permission';
  if (v.followUp && (v.state === 'done' || v.state === 'idle')) return (v.followUp.seen ? 'Asked you: ' : '') + clip(plain(v.followUp.reason), 90);
  if (v.state === 'done' || v.state === 'idle') return clip(plain(v.summary?.now || v.lastAssistantText) || 'Waiting for your next prompt', 90);
  if (v.state === 'exited') return 'Session ended';
  if (a.kind === 'tool') return `${a.tool}: ${a.label || ''}`;
  if (a.kind === 'thinking') return a.label || 'Thinking';
  if (a.kind === 'responding') return 'Writing a reply';
  return a.label || '';
}

export function modelShort(m) {
  if (!m) return '';
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export function shortModelName(m) {
  const s = modelShort(m);
  const mm = s.match(/^(opus|sonnet|haiku|fable|mythos)-?(\d+(?:-\d+)?)?/);
  return mm ? `${mm[1]}${mm[2] ? ' ' + mm[2].replace('-', '.') : ''}` : s;
}

/** Text width guess for SVG layout without measuring (Plex Sans at 13px). */
export function fit(text, maxPx, px = 13) {
  const per = px * 0.56;
  const max = Math.floor(maxPx / per);
  return clip(text, max);
}

export function shortPath(p, max = 36) {
  let s = String(p ?? '').replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');
  if (s.length > max) s = '…' + s.slice(s.length - (max - 1));
  return s;
}
