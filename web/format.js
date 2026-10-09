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

export const STATE_LABEL = { working: 'working', question: 'has a question', permission: 'needs permission', done: 'finished', idle: 'idle', exited: 'exited', running: 'running' };

export function stateLabel(s) { return STATE_LABEL[s] ?? s; }

export function activityLine(v) {
  const a = v.activity ?? {};
  if (v.state === 'question') return a.label || v.stateMessage || 'Waiting for your answer';
  if (v.state === 'permission') return v.stateMessage || 'Waiting for permission';
  if (v.state === 'done') return clip(plain(v.lastAssistantText) || 'Finished', 90);
  if (v.state === 'idle') return 'Waiting for your next prompt';
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
