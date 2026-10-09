import { esc, ago, tokens, duration, stateLabel, activityLine, shortModelName, clip, shortPath, plain, uiState, UI_RANK } from './format.js';
import { buildScene, renderScene } from './graph.js';
import { StreamView, renderMarkdown } from './stream.js';

const $ = (id) => document.getElementById(id);
const api = async (path, opts) => { try { const r = await fetch(path, opts); return r.ok ? r.json() : null; } catch { return null; } };
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const ICON = {
  copy: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  history: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.4h2.4M8 5v3.2l2.2 1.3"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l5-5 5 5"/></svg>',
};
const SESSION_LABEL = { working: 'working', needs: 'needs you', paused: 'ready for a new prompt', exited: 'ended' };
const SESSION_CLASS = { working: 'working', needs: 'needs', paused: 'ready', exited: 'ended' };
const AGENT_CLASS = { running: 'running', done: 'finished', exited: 'ended' };

const state = {
  snap: null, mode: 'active', selectedProjects: new Set(), selected: null, expanded: new Set(), showExited: false,
  zoom: 1, pan: { x: 0, y: 0 }, lastStates: new Map(), changedAt: new Map(), arrivedAt: new Map(), toasts: new Map(), prevAttention: null,
  hashApplied: false, scene: null, renderCache: { sig: '', nodes: new Map() }, transcriptOpen: false, drawerView: 'summary', popSeen: new Set(),
};

const stream = new StreamView({ listEl: $('stream-list'), scrollEl: $('stream'), earlierBtn: $('load-earlier'), api, onOpenAgent: (agentId) => open(state.selected.sessionId, agentId) });

/* ---------- data ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (ev) => { onSnapshot(JSON.parse(ev.data)); setConnected(true); });
  es.onerror = () => setConnected(false);
}
function setConnected(on) {
  const b = $('brand');
  b.classList.toggle('live-on', on); b.classList.toggle('live-off', !on);
  b.title = on ? 'Live' : 'Connection lost, reconnecting…';
}

function onSnapshot(snap) {
  state.snap = snap;
  for (const v of snap.sessions) { const byId = new Map(v.agents.map((a) => [a.id, 0])); for (const a of v.agents) if (a.parentAgentId && byId.has(a.parentAgentId)) byId.set(a.parentAgentId, byId.get(a.parentAgentId) + 1); for (const a of v.agents) a.children = byId.get(a.id) ?? 0; }
  document.title = (snap.unseen ? `(${snap.unseen}) ` : '') + 'Claude Radar';
  $('summaries-mode').value = snap.summaries.mode;
  $('summaries-refresh').value = String(snap.summaries.refreshMinutes ?? 4);
  const sp = snap.summaries.spend;
  $('spend').textContent = sp && sp.count ? `Haiku via your claude login. Today: ${sp.todayCount} summar${sp.todayCount === 1 ? 'y' : 'ies'}, $${sp.todayUsd.toFixed(2)} · all time: ${sp.count}, $${sp.usd.toFixed(2)}.` : 'Written by Haiku through your own claude login, about a fifth of a cent each.';
  renderStatus(snap); renderHooksRow(snap); detectTransitions(snap);
  if (!state.hashApplied) { state.hashApplied = true; selectFromHash(); }
  renderRail(snap); renderGraph(); if (state.selected) renderDrawer();
  if (!$('attention-pop').hidden) renderAttentionPop();
}

function detectTransitions(snap) {
  const now = Date.now();
  for (const v of snap.sessions) {
    const key = uiState(v) + ':' + v.state + (v.followUp ? ':fu' : '');
    const prev = state.lastStates.get(v.id);
    state.lastStates.set(v.id, key);
    if (prev === undefined || prev === key) continue;
    state.changedAt.set(v.id, now);
    const seen = snap.attention.find((a) => a.sessionId === v.id)?.seen;
    if (v.needsYou && !seen) { toast(v); if (!prev.startsWith('needs')) state.arrivedAt.set(v.id, now); }
    else if (v.state === 'done' && prev.startsWith('working')) toast(v, true);
    else dismissToast(v.id);
  }
  for (const v of snap.sessions) for (const a of v.agents) {
    const k = 'a:' + a.id, prev = state.lastStates.get(k);
    state.lastStates.set(k, a.state);
    if (prev !== undefined && prev !== a.state) state.changedAt.set(a.id, now);
  }
}

/* ---------- top bar ---------- */
function renderStatus(snap) {
  const live = snap.sessions.filter((s) => s.alive);
  const n = (st) => live.filter((s) => uiState(s) === st).length;
  const agents = live.reduce((k, s) => k + s.runningAgents, 0);
  const parts = [];
  if (n('working')) parts.push(`<span class="st"><span class="dot working"></span>${n('working')} working${agents ? ` <small>+${agents} agent${agents === 1 ? '' : 's'}</small>` : ''}</span>`);
  if (n('paused')) parts.push(`<span class="st"><span class="dot hollow"></span>${n('paused')} ready</span>`);
  const total = snap.attention.length, unseen = snap.attention.filter((a) => !a.seen).length;
  const open = !$('attention-pop').hidden;
  if (total) parts.push(`<button class="needs ${unseen ? 'unseen' : ''} ${open ? 'open' : ''}" id="attention-badge" aria-haspopup="true" aria-expanded="${open}" title="${unseen ? `${unseen} new` : 'Sessions that need you'}"><span class="dot"></span>${total} need${total === 1 ? 's' : ''} you <span class="caret">⌄</span></button>`);
  $('status').innerHTML = live.length ? parts.join('<span class="sep">·</span>') : '<span class="st"><span class="dot hollow"></span>no sessions running</span>';
  $('attention-badge')?.addEventListener('click', () => togglePop('attention-pop'));
  if (state.prevAttention != null && unseen > state.prevAttention) { const b = $('attention-badge'); if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } }
  state.prevAttention = unseen;
  if (!total) $('attention-pop').hidden = true;
  if (open) positionPop();
}

function positionPop() {
  const b = $('attention-badge'), pop = $('attention-pop'); if (!b) return;
  const r = b.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${Math.min(r.left, window.innerWidth - 336)}px`; pop.style.right = 'auto';
}

function renderAttentionPop() {
  const snap = state.snap, now = Date.now();
  const before = state.popSeen;
  $('attention-pop').innerHTML = `<div class="pop-head"><span>Needs you</span><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>` + (snap.attention.map((a) => `
    <button class="att-item ${a.state} ${a.seen ? 'seen' : ''} ${!a.seen && !before.has(a.sessionId + ':' + a.since) ? 'new' : ''}" data-focus="${esc(a.sessionId)}">
      <span class="g">${a.state === 'permission' ? '◆' : '?'}</span>
      <span class="body"><span class="t">${esc(a.projectName)} · ${esc(a.state === 'followup' ? 'in the last reply' : stateLabel(a.state))}</span><span class="m">${esc(plain(a.message || a.title))}</span></span>
      <span class="age">${ago(a.since, now)}</span>
    </button>`).join('') || '<p class="hint" style="padding:8px 12px">Nothing needs you right now.</p>');
  state.popSeen = new Set(snap.attention.map((a) => a.sessionId + ':' + a.since));
  $('attention-pop').querySelector('[data-close]').addEventListener('click', () => { $('attention-pop').hidden = true; renderStatus(snap); });
  positionPop();
}

function renderHooksRow(snap) {
  $('hooks-row').innerHTML = snap.hooksInstalled
    ? `<span class="dot ready"></span>Hooks installed: exact “needs you” signals.`
    : `Install Claude Code hooks for exact “needs you” signals. <button class="btn primary" id="hooks-install" style="margin-left:8px">Install hooks</button>`;
  $('hooks-install')?.addEventListener('click', async () => { const r = await post('/api/hooks/install'); $('hooks-row').innerHTML = r?.installed ? `<span class="dot ready"></span>Installed. ${esc(r.note)}` : 'Could not install hooks.'; });
}

/* ---------- filter row ---------- */
function listedProjects(snap = state.snap) {
  return snap.projects.filter((p) => state.showExited || p.live > 0 || snap.sessions.some((v) => v.cwd === p.id && v.pinned));
}
function visibleProjects(snap = state.snap) {
  const listed = listedProjects(snap);
  if (state.mode === 'all') return new Set(listed.map((p) => p.id));
  if (state.mode === 'active') { const act = listed.filter((p) => p.active); return new Set((act.length ? act : listed).map((p) => p.id)); }
  return state.selectedProjects;
}
function renderRail(snap) {
  const pick = state.mode === 'pick';
  const chips = listedProjects(snap).map((p, i) => {
    const worst = snap.sessions.filter((v) => v.cwd === p.id && v.alive).map((v) => uiState(v)).sort((a, b) => UI_RANK[a] - UI_RANK[b])[0];
    const dot = worst ? SESSION_CLASS[worst] : 'ended';
    return `<button class="chip ${pick && state.selectedProjects.has(p.id) ? 'selected' : ''}" data-project="${esc(p.id)}" title="${esc(p.headline ? p.headline + '\n' : '')}${esc(shortPath(p.path, 60))}\nclick: only this project · shift-click: add · key ${i + 1}"><span class="dot ${dot}"></span><span class="label">${esc(p.name)}</span></button>`;
  }).join('');
  $('rail').innerHTML = `<div class="seg"><button class="seg-btn ${state.mode === 'active' ? 'on' : ''}" data-project="active" title="Projects with something going on, or used in the last hour (0)">Active</button><button class="seg-btn ${state.mode === 'all' ? 'on' : ''}" data-project="*" title="Every project with a live session">All</button></div><span class="rail-sep"></span>${chips}<span class="spacer"></span><button class="chip ${state.showExited ? 'on' : ''}" id="show-exited" title="Show ended sessions (e)"><span class="dot ${state.showExited ? 'ended' : 'hollow'}"></span>ended</button>`;
}

/* ---------- graph ---------- */
function renderGraph() {
  const snap = state.snap; if (!snap) return;
  const now = Date.now();
  const changed = new Set([...state.changedAt].filter(([, t]) => now - t < 1500).map(([id]) => id));
  const arrived = new Set([...state.arrivedAt].filter(([, t]) => now - t < 700).map(([id]) => id));
  const scene = buildScene(snap, visibleProjects(snap), { expanded: state.expanded, showExited: state.showExited });
  state.scene = scene;
  renderScene(scene, { selected: state.selected, now, changed, arrived }, $('viewport'), state.renderCache);
  const empty = $('empty');
  if (!snap.sessions.some((s) => s.alive || s.pinned)) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>No Claude Code session is running</h2><p>Start one with <code>claude</code> in any project and it appears here within a second.</p><p class="faint">Radar watches ~/.claude for you. Nothing leaves this machine.</p></div>`;
  } else if (!scene.nodes.length) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>Nothing running in this project</h2><p>Pick another project above, or turn on “ended”.</p></div>`;
  } else empty.hidden = true;
}

function applyTransform() { $('viewport').setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`); }

function fitView(animate = true) {
  const scene = state.scene; if (!scene?.nodes.length) return;
  const wrap = $('canvas-wrap'), W = wrap.clientWidth, H = wrap.clientHeight;
  const z = Math.min(1, Math.max(0.75, Math.min((W - 32) / scene.width, (H - 48) / scene.height)));
  animateTo({ zoom: z, pan: { x: 0, y: 0 } }, animate ? 200 : 0);
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

function nodeInView(id) {
  const n = state.scene?.nodes.find((x) => x.kind === 'session' && x.id === id); if (!n) return false;
  const wrap = $('canvas-wrap'), W = wrap.clientWidth - ($('drawer').hidden ? 0 : $('drawer').offsetWidth), H = wrap.clientHeight;
  const x = n.x * state.zoom + state.pan.x, y = n.y * state.zoom + state.pan.y;
  return x >= 0 && y >= 0 && x + n.w * state.zoom <= W && y + n.h * state.zoom <= H;
}
function centerOn(id) {
  const n = state.scene?.nodes.find((x) => x.kind === 'session' && x.id === id); if (!n) return;
  const wrap = $('canvas-wrap'), W = wrap.clientWidth - ($('drawer').hidden ? 0 : $('drawer').offsetWidth), H = wrap.clientHeight;
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
  svg.addEventListener('pointerup', () => { svg.classList.remove('dragging'); const wasDrag = drag?.moved, node = drag?.node ?? null; drag = null; if (!wasDrag) activate(node); });
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
}

function activate(node) {
  if (!node) { close(); return; }
  if (node.dataset.more) { if (node.dataset.less) state.expanded.delete(node.dataset.more); else state.expanded.add(node.dataset.more); renderGraph(); return; }
  const sid = node.dataset.session, aid = node.dataset.agent || null;
  if (state.selected && state.selected.sessionId === sid && (state.selected.agentId ?? null) === aid) { close(); return; }
  open(sid, aid);
}

/* ---------- selection, seen ---------- */
function markSeen(id) { const a = state.snap?.attention.find((x) => x.sessionId === id); if (a && !a.seen) { a.seen = true; post(`/api/session/${encodeURIComponent(id)}/seen`); renderStatus(state.snap); dismissToast(id); } }

function open(sessionId, agentId = null) {
  state.selected = { sessionId, agentId }; state.drawerView = 'summary';
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
/** Open a session from a notification. Moves the canvas only if the node is out of view. */
function focusSession(id) {
  const v = state.snap?.sessions.find((s) => s.id === id); if (!v) return;
  let moved = false;
  if (!visibleProjects().has(v.cwd)) { state.mode = 'pick'; state.selectedProjects = new Set([v.cwd]); renderRail(state.snap); moved = true; }
  open(id, null);
  if (moved || !nodeInView(id)) centerOn(id);
}

/* ---------- drawer ---------- */
function renderDrawer() {
  const snap = state.snap, sel = state.selected; if (!sel) return;
  if (state.drawerView === 'history') return;
  const v = snap.sessions.find((s) => s.id === sel.sessionId);
  if (!v) { close(); return; }
  const a = sel.agentId ? v.agents.find((x) => x.id === sel.agentId) : null;
  if (sel.agentId && !a) { open(v.id, null); return; }
  const now = Date.now();
  stream.setAgentIndex(v.agents);
  $('drawer-head').querySelector?.('.stats')?.removeAttribute('hidden');
  if (a) renderAgentHead(v, a, now); else renderSessionHead(v, now);
  if (state.transcriptOpen) stream.open(v.id, a ? a.id : null);
}

const actBtn = (act, icon, label, title = label, cls = '') => `<button class="act ${cls}" data-act="${act}" title="${esc(title)}">${ICON[icon]}<span>${esc(label)}</span></button>`;
const stat = (n, l) => `<b>${esc(n)}</b> ${esc(l)}`;

function renderSessionHead(v, now) {
  const ui = uiState(v), cls = SESSION_CLASS[ui];
  const blocking = v.state === 'question' || v.state === 'permission';
  const sinceTs = ui === 'needs' && v.followUp && !blocking ? v.followUp.since : ui === 'paused' ? (v.lastAssistantAt ?? v.stateSince) : v.stateSince;
  const pct = v.contextTokens ? Math.round(100 * Math.min(1, v.contextTokens / (v.contextTokens > 190_000 ? 1_000_000 : 200_000))) : null;
  const stats = [pct != null ? stat(`${pct}%`, 'context') : null, stat(String(v.turns), v.turns === 1 ? 'turn' : 'turns'), stat(String(v.toolCalls), 'tools'), v.agents.length ? stat(String(v.agents.length), v.agents.length === 1 ? 'agent' : 'agents') : null, v.startedAt ? stat(duration(now - v.startedAt), '') : null].filter(Boolean).join(' · ') + (v.errors ? ` · <span class="err">${v.errors} error${v.errors === 1 ? '' : 's'}</span>` : '');
  const msg = v.state === 'question' ? `Asks: ${v.stateMessage || v.activity.label || ''}` : v.state === 'permission' ? (v.stateMessage || 'Waiting for a permission decision in the terminal') : v.followUp && ui === 'needs' ? plain(v.followUp.reason) : '';
  $('drawer-head').innerHTML = `
    <div class="row"><h2 title="${esc(v.title)}">${esc(v.title)}</h2><button class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>
    <div class="state-row"><span class="st ${cls}">${cls === 'working' ? '<span class="spinner"></span>' : `<span class="dot ${cls}"></span>`}${esc(blocking ? stateLabel(v.state) : SESSION_LABEL[ui])}${sinceTs ? ' · ' + ago(sinceTs, now) : ''}</span>${v.model ? `<span>· ${esc(shortModelName(v.model))}${v.effort ? ' · ' + esc(v.effort) + ' effort' : ''}</span>` : ''}</div>
    <div class="where" title="${esc(v.cwd)}">${esc(v.name || v.id.slice(0, 8))} · ${esc(shortPath(v.cwd, 40))}</div>
    ${msg ? `<div class="state-msg">${esc(msg)}</div>` : ''}
    <div class="stats">${stats}</div>`;
  const s = v.summary, mode = state.snap.summaries.mode;
  const sumEl = $('drawer-summary'); sumEl.className = 'drawer-summary';
  const refresh = mode === 'off' ? '' : `<button class="link" data-act="summarize">${v.summarizing ? 'writing…' : (s ? 'refresh' : 'write one now')}</button>`;
  const live = ui === 'working' ? `<div class="live"><span class="spinner"></span>${esc(plain(activityLine(v)))}</div>` : '';
  const agentsBlock = v.agents.length ? `<section class="sec"><h3>agents${v.runningAgents ? ` · ${v.runningAgents} of ${v.agents.length} running` : ` · ${v.agents.length}`}</h3><ul class="agents">${v.agents.slice().sort((a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).map((a) => `<li><button data-agent="${esc(a.id)}"><span class="dot ${AGENT_CLASS[a.state] ?? 'ended'}"></span><span class="t">${esc(a.description || a.type)}</span><span class="age">${a.state === 'running' ? 'running' : ago(a.endedAt ?? a.lastActivityAt, now)}</span></button></li>`).join('')}</ul></section>` : '';
  if (s) {
    const done = s.done ?? [];
    sumEl.innerHTML = `
      <div class="headline">${esc(s.headline)}</div>
      ${s.now || live ? `<section class="sec now"><h3>now</h3>${s.now ? `<p>${esc(s.now)}</p>` : ''}${live}</section>` : ''}
      ${s.next ? `<section class="sec next ${ui === 'needs' ? 'attn' : ''}"><h3>${ui === 'needs' ? 'needs you' : 'next'}</h3><p>${esc(s.next)}</p></section>` : ''}
      ${done.length ? `<section class="sec"><h3>done so far</h3><ul class="done">${done.slice(0, state.doneAll ? 99 : 4).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>${done.length > 4 && !state.doneAll ? `<button class="link" data-act="more-done" style="font-size:11px;margin-top:4px">+${done.length - 4} more</button>` : ''}</section>` : s.progress ? `<section class="sec"><h3>so far</h3><p>${esc(s.progress)}</p></section>` : ''}
      ${s.goal ? `<section class="sec"><h3>goal</h3><p>${esc(s.goal)}</p></section>` : ''}
      ${agentsBlock}
      <div class="when">summary from ${ago(s.at, now)} ago${v.summarizing ? ' · updating…' : ''} ${refresh}</div>`;
  } else {
    sumEl.innerHTML = `
      ${v.lastPrompt ? `<section class="sec" style="margin-top:0"><h3>latest request</h3><p>${esc(clip(plain(v.lastPrompt), 300))}</p></section>` : '<p class="muted">No prompt yet.</p>'}
      ${v.lastAssistantText ? `<section class="sec"><h3>latest reply</h3><div class="md">${renderMarkdown(clip(v.lastAssistantText, 600))}</div></section>` : ''}
      ${live ? `<section class="sec now"><h3>now</h3>${live}</section>` : ''}${agentsBlock}
      <div class="when">${mode === 'off' ? 'Summaries are off (settings).' : v.summaryError ? 'Summary failed: ' + esc(v.summaryError) : v.summarizing ? 'Writing a summary…' : 'No summary yet.'} ${refresh}</div>`;
  }
  $('drawer-foot').innerHTML = `${actBtn('copy', 'copy', 'Copy resume', 'Copy: cd … && claude --resume …')}${actBtn('history', 'history', 'Recent', 'Recent sessions in this project')}${actBtn('transcript', 'list', state.transcriptOpen ? 'Hide transcript' : 'Transcript', 'Prompts, replies and the work in between', 'right')}`;
  wireActs(v);
}

function renderAgentHead(v, a, now) {
  const cls = AGENT_CLASS[a.state] ?? 'ended';
  const line = cls === 'running' ? plain(activityLine({ state: 'working', activity: a.activity })) : cls === 'finished' ? `Finished${a.endedAt ? ' ' + ago(a.endedAt, now) + ' ago' : ''}${a.startedAt && a.endedAt && a.endedAt > a.startedAt ? ' after ' + duration(a.endedAt - a.startedAt) : ''}` : 'Ended with its session';
  $('drawer-head').innerHTML = `
    <div class="row"><h2 title="${esc(a.description || a.type)}">${esc(a.description || a.type)}</h2><button class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>
    <div class="state-row"><span class="st ${cls}">${cls === 'running' ? '<span class="spinner"></span>' : `<span class="dot ${cls}"></span>`}${cls}</span><span>· ${esc(String(a.type).split(':').pop())}${a.isFork ? ' · fork' : ''}${a.background ? ' · background' : ''}</span></div>
    <div class="where">in ${esc(v.name || v.title)}</div>
    <div class="stats">${[stat(tokens(a.contextTokens), 'context'), stat(String(a.toolCalls), 'tools'), stat(shortModelName(a.model || v.model) || '–', ''), a.startedAt ? stat(duration((a.endedAt ?? now) - a.startedAt), '') : null].filter(Boolean).join(' · ')}</div>`;
  const sumEl = $('drawer-summary'); sumEl.className = 'drawer-summary';
  sumEl.innerHTML = `${cls === 'running' ? `<section class="sec now" style="margin-top:0"><h3>now</h3><div class="live"><span class="spinner"></span>${esc(line)}</div></section>` : ''}<section class="sec" ${cls !== 'running' ? 'style="margin-top:0"' : ''}><h3>${cls === 'running' ? 'latest reply' : 'result'}</h3>${a.lastText ? `<div class="md">${renderMarkdown(clip(a.lastText, 1500))}</div>` : `<p class="muted">${cls === 'running' ? 'No reply from this agent yet.' : esc(line)}</p>`}</section>`;
  $('drawer-foot').innerHTML = `${actBtn('up', 'back', 'Session', 'Back to the session')}${a.parentAgentId ? actBtn('parent', 'up', 'Parent') : ''}${actBtn('transcript', 'list', state.transcriptOpen ? 'Hide transcript' : 'Transcript', 'This agent\'s transcript', 'right')}`;
  wireActs(v, a);
}

function wireActs(v, a = null) {
  const on = (act, fn) => document.querySelectorAll(`#drawer-head [data-act="${act}"], #drawer-summary [data-act="${act}"], #drawer-foot [data-act="${act}"]`).forEach((b) => b.addEventListener('click', fn));
  on('close', close);
  on('up', () => open(v.id, null));
  on('parent', () => open(v.id, a.parentAgentId));
  on('summarize', () => post(`/api/session/${encodeURIComponent(v.id)}/summarize`));
  on('more-done', () => { state.doneAll = true; renderDrawer(); });
  on('copy', (e) => { navigator.clipboard?.writeText(`cd ${shellQuote(v.cwd)} && claude --resume ${v.id}`); note(e.currentTarget, 'Copied'); });
  on('history', () => showHistory(v));
  on('transcript', () => { state.transcriptOpen = !state.transcriptOpen; try { localStorage.setItem('radar.transcript', state.transcriptOpen ? '1' : '0'); } catch { /* optional */ } applyTranscript(); renderDrawer(); });
  $('drawer-summary').querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', () => open(v.id, b.dataset.agent)));
}
function note(btn, text) { const label = btn.querySelector('span'); const old = label.textContent; label.textContent = text; clearTimeout(btn._t); btn._t = setTimeout(() => { label.textContent = old; }, 2000); }

function applyTranscript() {
  const on = state.transcriptOpen && state.drawerView !== 'history';
  $('stream-tools').hidden = !on; $('stream').hidden = !on;
  $('drawer').classList.toggle('transcript-open', on);
  if (on && state.selected) { const v = state.snap?.sessions.find((s) => s.id === state.selected.sessionId); if (v) stream.open(v.id, state.selected.agentId); }
  else stream.close();
}

function formatBytes(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B'; }

async function showHistory(v) {
  const cwd = v.cwd;
  const list = await api(`/api/history?cwd=${encodeURIComponent(cwd)}`);
  const now = Date.now(), el = $('drawer-summary');
  state.drawerView = 'history'; applyTranscript();
  $('drawer-head').innerHTML = `<div class="row history"><button class="icon-btn" data-act="back" title="Back" aria-label="Back">${ICON.back}</button><h2>Recent in ${esc(cwd.split('/').pop())}</h2><button class="icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">${ICON.close}</button></div>`;
  el.className = 'drawer-summary history';
  el.innerHTML = `<ul class="history-list">${(list ?? []).map((h) => `<li><button data-open="${esc(h.id)}"><span class="t">${esc(h.title || h.id.slice(0, 8))}${h.live ? ' <span class="live"><span class="dot working"></span>live</span>' : ''}</span><span class="sub">${ago(h.modified, now)} ago · ${h.turns ?? '?'} turns · ${formatBytes(h.size)}</span></button></li>`).join('') || '<li class="muted">No sessions recorded here.</li>'}</ul>`;
  $('drawer-foot').innerHTML = actBtn('back', 'back', 'Back');
  const back = () => { state.drawerView = 'summary'; applyTranscript(); renderDrawer(); };
  document.querySelectorAll('#drawer-head [data-act="back"], #drawer-foot [data-act="back"]').forEach((b) => b.addEventListener('click', back));
  $('drawer-head').querySelector('[data-act="close"]').addEventListener('click', close);
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.open;
    await post('/api/history/open', { cwd, id });
    const snap = await api('/api/state'); if (snap) onSnapshot(snap);
    state.drawerView = 'summary'; applyTranscript(); open(id, null); if (!nodeInView(id)) centerOn(id);
  }));
}
function shellQuote(s) { return /^[\w\/.~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`; }

/* ---------- toasts (in-page only) ---------- */
function toast(v, quiet = false) {
  dismissToast(v.id);
  const el = document.createElement('div');
  el.className = `toast ${quiet ? 'quiet' : ''}`;
  const fu = v.followUp && !(v.state === 'question' || v.state === 'permission');
  const msg = quiet ? clip(plain(v.lastAssistantText) || 'Ready for a new prompt', 120) : fu ? plain(v.followUp.reason) : plain(v.stateMessage || activityLine(v));
  el.innerHTML = `<div class="t"><span>${esc(v.name || v.id.slice(0, 8))} · ${quiet ? 'ready for a new prompt' : esc(stateLabel(fu ? 'followup' : v.state))}</span><button class="x" title="Dismiss">×</button></div><div class="m" title="${esc(msg)}">${esc(msg)}</div>`;
  el.addEventListener('click', (e) => { if (!e.target.classList.contains('x')) focusSession(v.id); markSeen(v.id); dismissToast(v.id); });
  $('toasts').appendChild(el);
  state.toasts.set(v.id, el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  if (quiet) setTimeout(() => dismissToast(v.id), 15_000);
}
function dismissToast(id) { const el = state.toasts.get(id); if (el) { el.remove(); state.toasts.delete(id); } }

/* ---------- wiring ---------- */
function setMode(mode) {
  document.querySelectorAll('#stream-tools .seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('thinking-toggle').hidden = mode === 'raw';
  stream.setMode(mode);
}
function toggleThinking() { const on = !$('thinking-toggle').classList.contains('on'); $('thinking-toggle').classList.toggle('on', on); stream.setThinking(on); }
function togglePop(id) {
  const pop = $(id), other = id === 'attention-pop' ? 'settings-pop' : 'attention-pop';
  $(other).hidden = true;
  pop.hidden = !pop.hidden;
  if (id === 'attention-pop') { if (!pop.hidden) renderAttentionPop(); renderStatus(state.snap); }
}
function closePops() { const was = !$('attention-pop').hidden; $('attention-pop').hidden = true; $('settings-pop').hidden = true; if (was) renderStatus(state.snap); }
function pickProject(id, additive) {
  if (id === '*' || id === 'active') state.mode = id === '*' ? 'all' : 'active';
  else if (additive) {
    if (state.mode !== 'pick') state.selectedProjects = new Set(visibleProjects());
    state.mode = 'pick';
    if (state.selectedProjects.has(id)) state.selectedProjects.delete(id); else state.selectedProjects.add(id);
    if (!state.selectedProjects.size) state.mode = 'active';
  } else { state.mode = 'pick'; state.selectedProjects = new Set([id]); for (const a of state.snap.attention) if (state.snap.sessions.find((v) => v.id === a.sessionId)?.cwd === id) markSeen(a.sessionId); }
  try { localStorage.setItem('radar.mode', state.mode); } catch { /* optional */ }
  renderRail(state.snap); renderGraph(); fitView();
}
function toggleExited() { state.showExited = !state.showExited; renderRail(state.snap); renderGraph(); fitView(); }

function setupUI() {
  $('rail').addEventListener('click', (e) => {
    if (e.target.closest('#show-exited')) { toggleExited(); return; }
    const b = e.target.closest('[data-project]'); if (!b) return;
    pickProject(b.dataset.project, e.shiftKey || e.metaKey || e.ctrlKey);
  });
  $('settings-btn').onclick = () => togglePop('settings-pop');
  $('settings-close').onclick = () => { $('settings-pop').hidden = true; };
  $('attention-pop').addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); if (b) { focusSession(b.dataset.focus); $('attention-pop').hidden = true; renderStatus(state.snap); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.popover, #attention-badge, #settings-btn')) closePops(); });
  window.addEventListener('resize', () => { if (!$('attention-pop').hidden) positionPop(); });
  $('summaries-mode').onchange = (e) => post('/api/settings', { summaries: e.target.value });
  $('theme-mode').onchange = (e) => applyTheme(e.target.value);
  $('summaries-refresh').onchange = (e) => post('/api/settings', { summaryRefreshMinutes: Number(e.target.value) });
  document.querySelectorAll('#stream-tools .seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('thinking-toggle').addEventListener('click', toggleThinking);
  $('follow').addEventListener('click', () => stream.setFollow(!stream.follow));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const openDrawer = !$('drawer').hidden;
    if (/^[1-9]$/.test(e.key)) { const p = listedProjects()[Number(e.key) - 1]; if (p) pickProject(p.id, false); e.preventDefault(); return; }
    switch (e.key) {
      case 'Escape': if (!$('attention-pop').hidden || !$('settings-pop').hidden) closePops(); else close(); break;
      case 'f': fitView(); break;
      case 'F': if (openDrawer && state.transcriptOpen) stream.setFollow(!stream.follow); break;
      case 'n': { const next = state.snap?.attention.find((a) => !a.seen) ?? state.snap?.attention[0]; if (next) focusSession(next.sessionId); break; }
      case '0': pickProject('active', false); break;
      case 'e': toggleExited(); break;
      case '+': case '=': $('zoom-in').click(); break;
      case '-': $('zoom-out').click(); break;
      case 't': if (openDrawer && state.transcriptOpen) toggleThinking(); break;
      case 'r': if (openDrawer && state.transcriptOpen) setMode(stream.mode === 'raw' ? 'story' : 'raw'); break;
      default: return;
    }
    e.preventDefault();
  });
  window.addEventListener('hashchange', () => selectFromHash());
  window.addEventListener('resize', () => fitView(false));
}

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode; else delete document.documentElement.dataset.theme;
  $('theme-mode').value = mode;
  try { localStorage.setItem('radar.theme', mode); } catch { /* optional */ }
}
try { applyTheme(localStorage.getItem('radar.theme') || 'auto'); } catch { applyTheme('auto'); }

setInterval(() => { if (state.snap && !$('attention-pop').hidden) renderAttentionPop(); }, 5000);
try { const m = localStorage.getItem('radar.mode'); if (m === 'all' || m === 'active') state.mode = m; state.transcriptOpen = localStorage.getItem('radar.transcript') === '1'; } catch { /* optional */ }
applyTranscript();
setupCanvas(); setupUI(); connect();
let fitted = false;
const fitOnce = setInterval(() => { if (state.scene?.nodes.length && !fitted) { fitView(false); fitted = true; clearInterval(fitOnce); } }, 150);
