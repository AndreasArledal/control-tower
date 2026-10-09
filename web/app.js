import { esc, ago, tokens, duration, stateLabel, activityLine, shortModelName, clip, shortPath, plain } from './format.js';
import { buildScene, renderScene } from './graph.js';
import { StreamView } from './stream.js';

const $ = (id) => document.getElementById(id);
const api = async (path, opts) => { try { const r = await fetch(path, opts); return r.ok ? r.json() : null; } catch { return null; } };
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const ICON = {
  terminal: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4l4 4-4 4M8.5 12H13"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  history: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.4h2.4M8 5v3.2l2.2 1.3"/></svg>',
  summary: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
};

const state = {
  snap: null, mode: 'active', selectedProjects: new Set(), selected: null, expanded: new Set(), showExited: false,
  zoom: 1, pan: { x: 0, y: 0 }, lastStates: new Map(), changedAt: new Map(), toasts: new Map(), prevAttention: null, hashApplied: false, scene: null,
};

const stream = new StreamView({ listEl: $('stream-list'), scrollEl: $('stream'), earlierBtn: $('load-earlier'), api, onOpenAgent: (agentId) => open(state.selected.sessionId, agentId) });

/* ---------- data ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (ev) => { onSnapshot(JSON.parse(ev.data)); setConnected(true); });
  es.onerror = () => setConnected(false);
}
function setConnected(on) {
  $('live-dot').className = 'live-dot ' + (on ? 'on' : 'off');
  $('live-dot').title = on ? 'Live' : 'Reconnecting…';
  if (!on) $('status').innerHTML = '<span class="st idle">reconnecting…</span>';
}

function onSnapshot(snap) {
  state.snap = snap;
  for (const v of snap.sessions) { const byId = new Map(v.agents.map((a) => [a.id, 0])); for (const a of v.agents) if (a.parentAgentId && byId.has(a.parentAgentId)) byId.set(a.parentAgentId, byId.get(a.parentAgentId) + 1); for (const a of v.agents) a.children = byId.get(a.id) ?? 0; }
  renderStatus(snap);
  document.title = (snap.unseen ? `(${snap.unseen}) ` : '') + 'Claude Radar';
  $('summaries-mode').value = snap.summaries.mode;
  renderBadge(snap); renderHooksRow(snap); detectTransitions(snap);
  if (!state.hashApplied) { state.hashApplied = true; selectFromHash(); }
  renderRail(snap); renderGraph(); if (state.selected) renderDrawer();
  if (!$('attention-pop').hidden) renderAttentionPop();
}

function detectTransitions(snap) {
  const now = Date.now();
  for (const v of snap.sessions) {
    const prev = state.lastStates.get(v.id);
    state.lastStates.set(v.id, v.state);
    if (prev === undefined || prev === v.state) continue;
    state.changedAt.set(v.id, now);
    if (v.needsYou && !snap.attention.find((a) => a.sessionId === v.id)?.seen) toast(v); else dismissToast(v.id);
  }
  for (const v of snap.sessions) for (const a of v.agents) {
    const k = 'a:' + a.id, prev = state.lastStates.get(k);
    state.lastStates.set(k, a.state);
    if (prev !== undefined && prev !== a.state) state.changedAt.set(a.id, now);
  }
}

/* ---------- top bar: status line, attention badge, settings ---------- */
function renderStatus(snap) {
  const live = snap.sessions.filter((s) => s.alive);
  const n = (st) => live.filter((s) => s.state === st).length;
  const agents = live.reduce((k, s) => k + s.runningAgents, 0);
  const parts = [];
  const waiting = n('question') + n('permission');
  if (n('working')) parts.push(`<span class="st working"><i></i>${n('working')} working${agents ? ` <small>+${agents} agent${agents === 1 ? '' : 's'}</small>` : ''}</span>`);
  if (waiting) parts.push(`<span class="st blocking"><i></i>${waiting} waiting for you</span>`);
  if (n('done')) parts.push(`<span class="st done"><i></i>${n('done')} finished</span>`);
  if (n('idle')) parts.push(`<span class="st idle"><i></i>${n('idle')} idle</span>`);
  $('status').innerHTML = live.length ? parts.join('') : '<span class="st idle">no sessions running</span>';
}

function markSeen(id) { const a = state.snap?.attention.find((x) => x.sessionId === id); if (a && !a.seen) { a.seen = true; post(`/api/session/${encodeURIComponent(id)}/seen`); renderBadge(state.snap); dismissToast(id); } }

function renderBadge(snap) {
  const n = snap.attention.filter((a) => !a.seen).length, b = $('attention-badge');
  $('attention-count').textContent = n;
  b.hidden = n === 0;
  if (state.prevAttention != null && n > state.prevAttention) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
  state.prevAttention = n;
  if (n === 0) $('attention-pop').hidden = true;
}

function renderAttentionPop() {
  const snap = state.snap, now = Date.now();
  $('attention-pop').innerHTML = snap.attention.map((a) => `
    <button class="att-item ${a.state} ${a.seen ? 'seen' : ''}" data-focus="${esc(a.sessionId)}">
      <div class="t"><span>${esc(a.projectName)} · ${esc(stateLabel(a.state))}</span><span class="age">${ago(a.since, now)}</span></div>
      <div class="m">${esc(a.title)}${a.message ? ' — ' + esc(plain(a.message)) : ''}</div>
    </button>`).join('') || '<p class="hint" style="padding:8px">Nothing needs you right now.</p>';
}

function renderHooksRow(snap) {
  $('hooks-row').innerHTML = snap.hooksInstalled
    ? `<span class="muted">Hooks installed: exact “needs you” and “finished” signals.</span>`
    : `<span class="muted">Install Claude Code hooks for exact “needs you” and “finished” signals.</span> <button class="primary" id="hooks-install">Install hooks</button>`;
  $('hooks-install')?.addEventListener('click', async () => { const r = await post('/api/hooks/install'); $('hooks-row').innerHTML = r?.installed ? `<span class="muted">Installed. ${esc(r.note)}</span>` : '<span class="muted">Could not install hooks.</span>'; });
}

/* ---------- project rail ---------- */
/** Which projects the canvas shows: an automatic mode (active / all) or an explicit pick. */
function visibleProjects(snap = state.snap) {
  if (state.mode === 'all') return new Set(snap.projects.map((p) => p.id));
  if (state.mode === 'active') { const act = snap.projects.filter((p) => p.active); return new Set((act.length ? act : snap.projects).map((p) => p.id)); }
  return state.selectedProjects;
}

function renderRail(snap) {
  const all = state.mode !== 'pick';
  const chips = snap.projects.map((p) => {
    const c = p.counts, attn = (c.question ?? 0) + (c.permission ?? 0);
    const dot = attn ? 'blocking' : c.working ? 'working' : c.done ? 'done' : p.live ? 'idle' : 'exited';
    return `<button class="chip ${!all && state.selectedProjects.has(p.id) ? 'selected' : ''}" data-project="${esc(p.id)}" title="${esc(p.headline ? p.headline + '\n' : '')}${esc(shortPath(p.path, 60))}\nclick: only this · shift-click: add"><span class="dot ${dot}"></span>${esc(p.name)}<span class="n">${p.live || p.sessions.length}</span>${attn ? `<span class="att">${attn}</span>` : ''}</button>`;
  }).join('');
  const nActive = snap.projects.filter((p) => p.active).length;
  $('rail').innerHTML = `<button class="chip all ${state.mode === 'active' ? 'selected' : ''}" data-project="active" title="Projects that are working, need you, just finished, or were used in the last 30 minutes">Active<span class="n">${nActive}</span></button><button class="chip all ${state.mode === 'all' ? 'selected' : ''}" data-project="*">All</button>` + chips;
}

/* ---------- graph ---------- */
function renderGraph() {
  const snap = state.snap; if (!snap) return;
  const now = Date.now();
  const changed = new Set([...state.changedAt].filter(([, t]) => now - t < 1500).map(([id]) => id));
  const scene = buildScene(snap, visibleProjects(snap), { expanded: state.expanded, showExited: state.showExited });
  state.scene = scene;
  $('viewport').innerHTML = renderScene(scene, { selected: state.selected, now, changed });
  applyTransform();
  const empty = $('empty');
  if (!snap.sessions.some((s) => s.alive || s.pinned)) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>No Claude Code session is running</h2><p>Start one with <code>claude</code> in any project and it appears here within a second.</p><p class="faint">Radar watches ~/.claude for you. Nothing leaves this machine.</p></div>`;
  } else if (!scene.nodes.length) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>Nothing running in this project</h2><p>Pick another project above, or turn on “ended” to see finished sessions.</p></div>`;
  } else empty.hidden = true;
}

function applyTransform() { $('viewport').setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`); }

function fitView(animate = true) {
  const scene = state.scene; if (!scene?.nodes.length) return;
  const wrap = $('canvas-wrap'), drawerW = $('drawer').hidden ? 0 : $('drawer').offsetWidth;
  const W = wrap.clientWidth - drawerW, H = wrap.clientHeight;
  const z = Math.min(1.15, Math.max(0.5, Math.min((W - 32) / scene.width, (H - 48) / scene.height)));
  animateTo({ zoom: z, pan: { x: 12, y: 12 } }, animate ? 200 : 0);
}

function animateTo(target, ms) {
  const from = { zoom: state.zoom, pan: { ...state.pan } }, t0 = performance.now();
  if (!ms || matchMedia('(prefers-reduced-motion: reduce)').matches) { state.zoom = target.zoom; state.pan = target.pan; applyTransform(); return; }
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    state.zoom = from.zoom + (target.zoom - from.zoom) * e;
    state.pan = { x: from.pan.x + (target.pan.x - from.pan.x) * e, y: from.pan.y + (target.pan.y - from.pan.y) * e };
    applyTransform();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function centerOn(id) {
  const n = state.scene?.nodes.find((x) => (x.kind === 'session' && x.id === id) || (x.kind === 'agent' && x.id === id));
  if (!n) return;
  const wrap = $('canvas-wrap'), drawerW = $('drawer').hidden ? 0 : $('drawer').offsetWidth;
  const W = wrap.clientWidth - drawerW, H = wrap.clientHeight;
  animateTo({ zoom: state.zoom, pan: { x: W / 2 - (n.x + n.w / 2) * state.zoom, y: H / 2 - (n.y + n.h / 2) * state.zoom } }, 200);
}

function setupCanvas() {
  const svg = $('graph');
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, px: state.pan.x, py: state.pan.y, moved: false, node: e.target.closest('.node') }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; svg.classList.add('dragging'); }
    state.pan = { x: drag.px + dx, y: drag.py + dy }; applyTransform();
  });
  svg.addEventListener('pointerup', () => {
    svg.classList.remove('dragging');
    const wasDrag = drag?.moved, node = drag?.node ?? null; drag = null;
    if (wasDrag) return;
    activate(node);
  });
  svg.addEventListener('dblclick', (e) => { if (!e.target.closest('.node')) fitView(); });
  svg.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('node')) { e.preventDefault(); activate(e.target); } });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const nz = Math.min(2, Math.max(0.3, state.zoom * Math.exp(-e.deltaY * 0.01)));
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      state.pan = { x: mx - (mx - state.pan.x) * (nz / state.zoom), y: my - (my - state.pan.y) * (nz / state.zoom) };
      state.zoom = nz;
    } else state.pan = { x: state.pan.x - e.deltaX, y: state.pan.y - e.deltaY };
    applyTransform();
  }, { passive: false });
  $('fit-btn').onclick = () => fitView();
  $('zoom-in').onclick = () => { state.zoom = Math.min(2, state.zoom * 1.2); applyTransform(); };
  $('zoom-out').onclick = () => { state.zoom = Math.max(0.3, state.zoom / 1.2); applyTransform(); };
  $('show-exited').onchange = (e) => { state.showExited = e.target.checked; renderGraph(); fitView(); };
}

function activate(node) {
  if (!node) { close(); return; }
  if (node.dataset.more) { state.expanded.add(node.dataset.more); renderGraph(); return; }
  const sid = node.dataset.session, aid = node.dataset.agent || null;
  if (state.selected && state.selected.sessionId === sid && (state.selected.agentId ?? null) === aid) { close(); return; }
  open(sid, aid);
}

/* ---------- drawer ---------- */
function open(sessionId, agentId = null) {
  state.selected = { sessionId, agentId };
  markSeen(sessionId);
  const h = `#session=${encodeURIComponent(sessionId)}${agentId ? '&agent=' + encodeURIComponent(agentId) : ''}`;
  if (location.hash !== h) history.replaceState(null, '', location.pathname + h);
  $('drawer').hidden = false;
  renderGraph(); renderDrawer();
}

function close() {
  if (!state.selected) return;
  state.selected = null; $('drawer').hidden = true; stream.close();
  history.replaceState(null, '', location.pathname);
  renderGraph();
}

function selectFromHash() {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const id = q.get('session'); if (!id) return false;
  const v = state.snap?.sessions.find((s) => s.id === id); if (!v) return false;
  if (!visibleProjects().has(v.cwd)) { state.mode = 'pick'; state.selectedProjects = new Set([v.cwd]); renderRail(state.snap); }
  open(id, q.get('agent'));
  return true;
}

function focusSession(id) {
  const v = state.snap?.sessions.find((s) => s.id === id); if (!v) return;
  if (!visibleProjects().has(v.cwd)) { state.mode = 'pick'; state.selectedProjects = new Set([v.cwd]); renderRail(state.snap); }
  open(id, null); centerOn(id);
}

function renderDrawer() {
  const snap = state.snap, sel = state.selected; if (!sel) return;
  const v = snap.sessions.find((s) => s.id === sel.sessionId);
  if (!v) { close(); return; }
  const a = sel.agentId ? v.agents.find((x) => x.id === sel.agentId) : null;
  if (sel.agentId && !a) { open(v.id, null); return; }
  const now = Date.now();
  stream.setAgentIndex(v.agents);
  if (a) renderAgentHead(v, a, now); else renderSessionHead(v, now);
  stream.open(v.id, a ? a.id : null);
}

function iconBtn(act, icon, title) { return `<button class="icon-btn" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}">${ICON[icon]}</button>`; }
function actBtn(act, icon, label, title = label) { return `<button class="act" data-act="${act}" title="${esc(title)}">${ICON[icon]}<span>${esc(label)}</span></button>`; }

function renderSessionHead(v, now) {
  const resume = `cd ${shellQuote(v.cwd)} && claude --resume ${v.id}`;
  const msg = v.state === 'question' ? `Asks: ${v.stateMessage || v.activity.label || ''}` : v.state === 'permission' ? (v.stateMessage || 'Waiting for a permission decision in the terminal') : v.state === 'done' ? clip(plain(v.lastAssistantText) || 'Finished its turn.', 300) : '';
  const stats = [`${tokens(v.contextTokens)} context`, `${v.turns} turn${v.turns === 1 ? '' : 's'}`, `${v.toolCalls} tool call${v.toolCalls === 1 ? '' : 's'}`, v.agents.length ? `${v.agents.length} agent${v.agents.length === 1 ? '' : 's'}` : null, v.errors ? `${v.errors} error${v.errors === 1 ? '' : 's'}` : null, shortModelName(v.model) || null, v.startedAt ? duration(now - v.startedAt) : null].filter(Boolean);
  $('drawer-head').innerHTML = `
    <div class="row"><h2 title="${esc(v.title)}">${esc(v.title)}</h2>${iconBtn('close', 'close', 'Close (Esc)')}</div>
    <div class="meta"><span class="pill ${v.state}">${esc(stateLabel(v.state))}${v.stateSince ? ' · ' + ago(v.stateSince, now) : ''}</span><span class="where" title="${esc(v.cwd)}">${esc(v.name || v.id.slice(0, 8))} · ${esc(shortPath(v.cwd, 36))}</span></div>
    ${msg ? `<div class="state-msg ${v.state}">${esc(msg)}</div>` : v.state === 'working' ? `<div class="now">${esc(plain(activityLine(v)))}</div>` : ''}
    <div class="acts">
      ${v.alive ? actBtn('focus', 'terminal', 'Terminal', 'Jump to the terminal pane running this session') : ''}
      ${actBtn('copy', 'copy', 'Resume', 'Copy: cd … && claude --resume …')}
      ${actBtn('history', 'history', 'Recent', 'Recent sessions in this project')}
      ${state.snap.summaries.mode !== 'off' ? actBtn('summarize', 'summary', v.summarizing ? 'Summarizing…' : 'Summarize', 'Write a fresh summary now') : ''}
    </div>
    <div class="stats">${stats.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
  const s = v.summary;
  const sumEl = $('drawer-summary'); sumEl.className = 'drawer-summary'; sumEl.title = '';
  sumEl.innerHTML = s ? `<div class="headline">${esc(s.headline)}</div>${s.progress ? `<div class="progress">${esc(s.progress)}</div>` : ''}${s.needs ? `<div class="needs">${esc(s.needs)}</div>` : ''}<div class="when">summary · ${ago(s.at, now)} ago</div>`
    : state.snap.summaries.mode === 'off' ? `<div class="progress">Summaries are off. Turn them on in settings to get a few lines on where this session stands.</div>`
    : v.summaryError ? `<div class="progress">Summary failed: ${esc(v.summaryError)}</div>` : v.summarizing ? '<div class="progress">Writing a summary…</div>'
    : (v.lastPrompt ? `<div class="progress"><span class="muted">Latest request</span> ${esc(clip(plain(v.lastPrompt), 240))}</div>` : '<div class="progress">No prompt yet.</div>');
  wireActs(v);
}

function renderAgentHead(v, a, now) {
  const line = a.state === 'running' ? plain(activityLine({ state: 'working', activity: a.activity })) : a.state === 'done' ? `Finished${a.endedAt ? ' ' + ago(a.endedAt, now) + ' ago' : ''}${a.startedAt && a.endedAt && a.endedAt > a.startedAt ? ' after ' + duration(a.endedAt - a.startedAt) : ''}` : 'Ended with its session';
  const stats = [`${tokens(a.contextTokens)} context`, `${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}`, shortModelName(a.model) || 'inherited model', a.startedAt ? duration((a.endedAt ?? now) - a.startedAt) : null].filter(Boolean);
  $('drawer-head').innerHTML = `
    <div class="row"><h2 title="${esc(a.description || a.type)}">${esc(a.description || a.type)}</h2>${iconBtn('close', 'close', 'Close (Esc)')}</div>
    <div class="meta"><span class="pill ${a.state}">${esc(stateLabel(a.state))}</span><span class="where">${esc(String(a.type).split(':').pop())}${a.isFork ? ' · fork' : ''}${a.background ? ' · background' : ''} · in ${esc(v.name || v.title)}</span></div>
    <div class="now">${esc(line)}</div>
    <div class="acts">${actBtn('up', 'up', 'Session', 'Back to the session')}${a.parentAgentId ? actBtn('parent', 'up', 'Parent agent') : ''}</div>
    <div class="stats">${stats.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
  const sumEl = $('drawer-summary'); sumEl.className = 'drawer-summary'; sumEl.title = '';
  sumEl.innerHTML = a.lastText ? `<div class="progress">${esc(clip(plain(a.lastText), 400))}</div>` : '<div class="progress">No reply from this agent yet.</div>';
  wireActs(v, a);
}

function wireActs(v, a = null) {
  const head = $('drawer-head');
  const on = (act, fn) => head.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
  on('close', close);
  on('up', () => open(v.id, null));
  on('parent', () => open(v.id, a.parentAgentId));
  on('summarize', () => post(`/api/session/${encodeURIComponent(v.id)}/summarize`));
  on('copy', (e) => { navigator.clipboard?.writeText(`cd ${shellQuote(v.cwd)} && claude --resume ${v.id}`); note(e.currentTarget, 'Copied'); });
  on('history', () => showHistory(v.cwd));
  on('focus', async (e) => { const btn = e.currentTarget; const r = await post(`/api/session/${encodeURIComponent(v.id)}/focus`); note(btn, r?.ok ? (r.note || 'Focused') : (r?.reason || 'Could not focus the terminal')); });
}

/** Short inline feedback under the action row. */
function note(btn, text) {
  const acts = btn.closest('.acts'); let el = acts.nextElementSibling;
  if (!el?.classList.contains('act-note')) { el = document.createElement('div'); el.className = 'act-note'; acts.after(el); }
  el.textContent = text; el.hidden = false;
  clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 4000);
}

async function showHistory(cwd) {
  const list = await api(`/api/history?cwd=${encodeURIComponent(cwd)}`);
  const now = Date.now(), el = $('drawer-summary');
  el.className = 'drawer-summary history';
  el.innerHTML = `<div class="headline">Recent sessions in ${esc(cwd.split('/').pop())}</div><ul class="history-list">${(list ?? []).map((h) => `<li><button data-open="${esc(h.id)}"><div>${esc(h.title || h.id.slice(0, 8))}${h.live ? ' <span class="pill working">live</span>' : ''}</div><div class="sub">${ago(h.modified, now)} ago · ${h.turns ?? '?'} turns · ${Math.round(h.size / 1024)} KB</div></button></li>`).join('')}</ul>`;
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.open;
    await post('/api/history/open', { cwd, id });
    const snap = await api('/api/state'); if (snap) onSnapshot(snap);
    open(id, null); centerOn(id);
  }));
}

function shellQuote(s) { return /^[\w\/.~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`; }

/* ---------- toasts (in-page only) ---------- */
function toast(v) {
  dismissToast(v.id);
  const el = document.createElement('div');
  el.className = `toast ${v.state}`;
  const msg = v.state === 'done' ? clip(plain(v.lastAssistantText) || 'Finished its turn', 120) : plain(v.stateMessage || activityLine(v));
  el.innerHTML = `<div class="t"><span>${esc(v.name || v.id.slice(0, 8))} ${esc(stateLabel(v.state))}</span><button class="x" title="Dismiss">×</button></div><div class="m" title="${esc(msg)}">${esc(msg)}</div>`;
  el.addEventListener('click', (e) => { if (!e.target.classList.contains('x')) focusSession(v.id); markSeen(v.id); dismissToast(v.id); });
  $('toasts').appendChild(el);
  state.toasts.set(v.id, el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  if (v.state === 'done') setTimeout(() => dismissToast(v.id), 20_000);
}
function dismissToast(id) { const el = state.toasts.get(id); if (el) { el.remove(); state.toasts.delete(id); } }

/* ---------- wiring ---------- */
function setMode(mode) {
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('thinking-toggle').hidden = mode === 'raw';
  stream.setMode(mode);
}
function toggleThinking() {
  const on = !$('thinking-toggle').classList.contains('on');
  $('thinking-toggle').classList.toggle('on', on);
  stream.setThinking(on);
}

function togglePop(id) {
  const pop = $(id), other = id === 'attention-pop' ? 'settings-pop' : 'attention-pop';
  $(other).hidden = true;
  pop.hidden = !pop.hidden;
  if (!pop.hidden && id === 'attention-pop') renderAttentionPop();
}

function setupUI() {
  $('rail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-project]'); if (!b) return;
    const id = b.dataset.project;
    if (id === '*' || id === 'active') { state.mode = id === '*' ? 'all' : 'active'; }
    else if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (state.mode !== 'pick') state.selectedProjects = new Set(visibleProjects());
      state.mode = 'pick';
      if (state.selectedProjects.has(id)) state.selectedProjects.delete(id); else state.selectedProjects.add(id);
      if (!state.selectedProjects.size) state.mode = 'active';
    } else { state.mode = 'pick'; state.selectedProjects = new Set([id]); for (const a of state.snap.attention) if (state.snap.sessions.find((v) => v.id === a.sessionId)?.cwd === id) markSeen(a.sessionId); }
    try { localStorage.setItem('radar.mode', state.mode); } catch { /* optional */ }
    renderRail(state.snap); renderGraph(); fitView();
  });
  $('attention-badge').onclick = () => togglePop('attention-pop');
  $('settings-btn').onclick = () => togglePop('settings-pop');
  $('attention-pop').addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); if (b) { focusSession(b.dataset.focus); $('attention-pop').hidden = true; } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.popover, #attention-badge, #settings-btn')) { $('attention-pop').hidden = true; $('settings-pop').hidden = true; } });
  $('summaries-mode').onchange = (e) => post('/api/settings', { summaries: e.target.value });
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('thinking-toggle').addEventListener('click', toggleThinking);
  $('follow').addEventListener('change', (e) => stream.setFollow(e.target.checked));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const openDrawer = !$('drawer').hidden;
    switch (e.key) {
      case 'Escape': if (!$('attention-pop').hidden || !$('settings-pop').hidden) { $('attention-pop').hidden = true; $('settings-pop').hidden = true; } else close(); break;
      case 'f': if (openDrawer) stream.setFollow(!stream.follow); else fitView(); break;
      case 'n': { const ids = state.snap?.attention.map((a) => a.sessionId) ?? []; if (!ids.length) break; const i = ids.indexOf(state.selected?.sessionId); focusSession(ids[(i + 1) % ids.length]); break; }
      case '+': case '=': $('zoom-in').click(); break;
      case '-': $('zoom-out').click(); break;
      case 't': if (openDrawer) toggleThinking(); break;
      case 'r': if (openDrawer) setMode(stream.mode === 'raw' ? 'story' : 'raw'); break;
      default: return;
    }
    e.preventDefault();
  });
  window.addEventListener('hashchange', () => selectFromHash());
  window.addEventListener('resize', () => fitView(false));
}

setInterval(() => { if (state.snap) { renderRail(state.snap); if (!$('attention-pop').hidden) renderAttentionPop(); } }, 5000);
try { const m = localStorage.getItem('radar.mode'); if (m === 'all' || m === 'active') state.mode = m; } catch { /* optional */ }
setupCanvas(); setupUI(); connect();
let fitted = false;
const fitOnce = setInterval(() => { if (state.scene?.nodes.length && !fitted) { fitView(false); fitted = true; clearInterval(fitOnce); } }, 150);
