import { esc, ago, tokens, duration, stateLabel, activityLine, shortModelName, clip, shortPath, plain } from './format.js';
import { buildScene, renderScene } from './graph.js';
import { StreamView } from './stream.js';

const $ = (id) => document.getElementById(id);
const api = async (path, opts) => { try { const r = await fetch(path, opts); return r.ok ? r.json() : null; } catch { return null; } };
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const state = {
  snap: null, selectedProjects: new Set(), autoSelect: true, selected: null, expanded: new Set(), showExited: false, openedHistory: new Set(),
  zoom: 1, pan: { x: 0, y: 0 }, lastStates: new Map(), toasts: new Map(), connected: false, hooksNoteDismissed: false,
};

const stream = new StreamView({ listEl: $('stream-list'), scrollEl: $('stream'), earlierBtn: $('load-earlier'), api, onOpenAgent: (agentId) => select(state.selected.sessionId, agentId) });

/* ---------- data ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (ev) => { onSnapshot(JSON.parse(ev.data)); setConnected(true); });
  es.onerror = () => setConnected(false);
}

function setConnected(on) {
  state.connected = on;
  $('live-dot').className = 'brand-dot ' + (on ? 'on' : 'off');
  $('live-dot').title = on ? 'Live' : 'Reconnecting…';
  if (!on) $('brand-sub').textContent = 'reconnecting…';
}

function onSnapshot(snap) {
  state.snap = snap;
  const live = snap.sessions.filter((s) => s.alive).length;
  const agents = snap.sessions.reduce((n, s) => n + s.runningAgents, 0);
  $('brand-sub').textContent = `${live} live session${live === 1 ? '' : 's'}${agents ? ` · ${agents} agent${agents === 1 ? '' : 's'} running` : ''}`;
  document.title = (snap.attention.length ? `(${snap.attention.length}) ` : '') + 'Claude Radar';
  $('summaries-mode').value = snap.summaries.mode;
  $('ack-all').hidden = !snap.attention.some((a) => a.state === 'done');
  renderHooks(snap);
  detectTransitions(snap);
  if (!state.hashApplied) { state.hashApplied = true; selectFromHash(); }
  if (state.autoSelect && !state.selectedProjects.size && snap.projects.length) state.selectedProjects.add(snap.projects[0].id);
  for (const id of state.selectedProjects) if (!snap.projects.some((p) => p.id === id)) state.selectedProjects.delete(id);
  renderAttention(snap); renderProjects(snap); renderGraph(); renderDetail();
}

function detectTransitions(snap) {
  for (const v of snap.sessions) {
    const prev = state.lastStates.get(v.id);
    state.lastStates.set(v.id, v.state);
    if (prev === undefined || prev === v.state) continue;
    if (v.needsYou) toast(v);
    else dismissToast(v.id);
  }
}

/* ---------- toasts (in-page only) ---------- */
function toast(v) {
  dismissToast(v.id);
  const el = document.createElement('div');
  el.className = `toast ${v.state}`;
  const msg = v.state === 'done' ? clip(plain(v.lastAssistantText) || 'Finished its turn', 140) : (v.stateMessage || activityLine(v));
  el.innerHTML = `<div class="t"><span>${esc(v.name || v.id.slice(0, 8))} ${esc(stateLabel(v.state))}</span><button class="x" title="Dismiss">×</button></div><div class="m">${esc(v.title)}</div><div class="m">${esc(msg)}</div>`;
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('x')) { dismissToast(v.id); return; }
    focusSession(v.id); dismissToast(v.id);
  });
  $('toasts').appendChild(el);
  state.toasts.set(v.id, el);
  if (v.state === 'done') setTimeout(() => dismissToast(v.id), 20_000);
}
function dismissToast(id) { const el = state.toasts.get(id); if (el) { el.remove(); state.toasts.delete(id); } }

/* ---------- sidebar ---------- */
function renderAttention(snap) {
  const el = $('attention');
  if (!snap.attention.length) { el.innerHTML = ''; return; }
  const now = Date.now();
  el.innerHTML = `<div class="section-head"><span>Needs you · ${snap.attention.length}</span></div>` + snap.attention.map((a) => `
    <button class="att-item ${a.state}" data-focus="${esc(a.sessionId)}">
      <div class="t"><span>${esc(a.projectName)} · ${esc(stateLabel(a.state))}</span><span class="age">${ago(a.since, now)}</span></div>
      <div class="m">${esc(a.title)}${a.message ? ' — ' + esc(plain(a.message)) : ''}</div>
    </button>`).join('');
}

function renderProjects(snap) {
  const now = Date.now();
  $('project-list').innerHTML = snap.projects.map((p) => {
    const c = p.counts;
    const attn = (c.question ?? 0) + (c.permission ?? 0);
    const parts = [];
    if (c.working) parts.push(`<span class="c-working"><b>${c.working}</b> working</span>`);
    if (attn) parts.push(`<span class="c-attn"><b>${attn}</b> waiting for you</span>`);
    if (c.done) parts.push(`<span class="c-done"><b>${c.done}</b> finished</span>`);
    if (c.idle) parts.push(`<span><b>${c.idle}</b> idle</span>`);
    if (p.runningAgents) parts.push(`<span class="c-working"><b>${p.runningAgents}</b> agents</span>`);
    if (!parts.length) parts.push(`<span>${c.exited ?? 0} ended</span>`);
    return `<li><button class="project ${state.selectedProjects.has(p.id) ? 'selected' : ''}" data-project="${esc(p.id)}" title="${esc(p.path)}\nClick to view · shift-click to add">
      <div class="name"><span class="dot ${p.state}"></span><span>${esc(p.name)}</span><span class="faint" style="margin-left:auto;font-size:12px">${p.lastActivityAt ? ago(p.lastActivityAt, now) : ''}</span></div>
      <div class="path">${esc(shortPath(p.path))}</div>
      <div class="counts">${parts.join('')}</div>
    </button></li>`;
  }).join('');
}

function renderHooks(snap) {
  const note = $('hooks-note'), btn = $('hooks-btn');
  btn.hidden = snap.hooksInstalled;
  if (snap.hooksInstalled || state.hooksNoteDismissed) { note.hidden = true; return; }
  note.hidden = false;
  note.innerHTML = `<span>Radar can see your sessions already. Install its hooks and it also learns the exact moment a session asks you something, waits for a permission, or finishes.</span><button class="primary" id="hooks-install">Install hooks</button><button class="link" id="hooks-later">later</button>`;
  $('hooks-install').onclick = installHooks;
  $('hooks-later').onclick = () => { state.hooksNoteDismissed = true; note.hidden = true; };
}

async function installHooks() {
  const r = await post('/api/hooks/install');
  const note = $('hooks-note');
  note.hidden = false;
  note.innerHTML = r?.installed ? `<span>Hooks installed in <code>${esc(r.settingsPath)}</code> (backup kept next to it). ${esc(r.note)}</span><button class="link" id="hooks-later">ok</button>` : `<span>Could not install hooks.</span>`;
  $('hooks-later')?.addEventListener('click', () => { note.hidden = true; state.hooksNoteDismissed = true; });
}

/* ---------- graph ---------- */
function renderGraph() {
  const snap = state.snap; if (!snap) return;
  const scene = buildScene(snap, state.selectedProjects, { expanded: state.expanded, showExited: state.showExited, openedHistory: state.openedHistory });
  state.scene = scene;
  $('viewport').innerHTML = renderScene(scene, { selected: state.selected, now: Date.now() });
  applyTransform();
  const empty = $('empty');
  if (!snap.sessions.some((s) => s.alive) && !state.openedHistory.size) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>No Claude Code session is running</h2><p>Start one with <code>claude</code> in any project and it appears here within a second.</p><p class="faint">Radar watches ~/.claude for you. Nothing leaves this machine.</p></div>`;
  } else if (!scene.nodes.length) {
    empty.hidden = false;
    empty.innerHTML = `<div><h2>Nothing to show for this selection</h2><p>Pick a project on the left, or turn on “show finished sessions”.</p></div>`;
  } else empty.hidden = true;
}

function applyTransform() { $('viewport').setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`); }

function fitView() {
  const scene = state.scene; if (!scene?.nodes.length) return;
  const wrap = $('canvas-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const z = Math.min(1.1, Math.max(0.6, Math.min((W - 40) / scene.width, (H - 60) / scene.height)));
  state.zoom = z; state.pan = { x: 16, y: 16 };
  applyTransform();
}

function setupCanvas() {
  const svg = $('graph');
  let drag = null;
  // pointer capture retargets pointerup to the svg, so remember what was hit on the way down
  svg.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, px: state.pan.x, py: state.pan.y, moved: false, node: e.target.closest('.node') }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; svg.classList.add('dragging'); }
    state.pan = { x: drag.px + dx, y: drag.py + dy }; applyTransform();
  });
  svg.addEventListener('pointerup', (e) => {
    svg.classList.remove('dragging');
    const wasDrag = drag?.moved; const node = drag?.node ?? null; drag = null;
    if (wasDrag) return;
    if (!node) { select(null); return; }
    if (node.dataset.more) { state.expanded.add(node.dataset.more); renderGraph(); return; }
    select(node.dataset.session, node.dataset.agent || null);
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.01);
      const nz = Math.min(2, Math.max(0.3, state.zoom * f));
      const r = svg.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      state.pan = { x: mx - (mx - state.pan.x) * (nz / state.zoom), y: my - (my - state.pan.y) * (nz / state.zoom) };
      state.zoom = nz;
    } else state.pan = { x: state.pan.x - e.deltaX, y: state.pan.y - e.deltaY };
    applyTransform();
  }, { passive: false });
  $('fit-btn').onclick = fitView;
  $('zoom-in').onclick = () => { state.zoom = Math.min(2, state.zoom * 1.2); applyTransform(); };
  $('zoom-out').onclick = () => { state.zoom = Math.max(0.3, state.zoom / 1.2); applyTransform(); };
  $('show-exited').onchange = (e) => { state.showExited = e.target.checked; renderGraph(); };
}

/* ---------- selection & detail ---------- */
function select(sessionId, agentId = null) {
  state.selected = sessionId ? { sessionId, agentId } : null;
  const h = sessionId ? `#session=${encodeURIComponent(sessionId)}${agentId ? '&agent=' + encodeURIComponent(agentId) : ''}` : '';
  if (location.hash !== h) history.replaceState(null, '', location.pathname + h);
  renderGraph(); renderDetail();
}

function selectFromHash() {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const id = q.get('session'); if (!id) return false;
  const v = state.snap?.sessions.find((s) => s.id === id); if (!v) return false;
  if (!state.selectedProjects.has(v.cwd)) { state.autoSelect = false; state.selectedProjects = new Set([v.cwd]); renderProjects(state.snap); }
  select(id, q.get('agent'));
  return true;
}

function focusSession(id) {
  const v = state.snap?.sessions.find((s) => s.id === id);
  if (v && !state.selectedProjects.has(v.cwd)) { state.selectedProjects = new Set([v.cwd]); renderProjects(state.snap); }
  select(id, null);
  const n = state.scene?.nodes.find((x) => x.kind === 'session' && x.id === id);
  if (n) { const wrap = $('canvas-wrap'); state.pan = { x: wrap.clientWidth / 2 - (n.x + n.w / 2) * state.zoom, y: wrap.clientHeight / 2 - (n.y + n.h / 2) * state.zoom }; applyTransform(); }
}

function renderDetail() {
  const snap = state.snap, sel = state.selected;
  const v = sel && snap?.sessions.find((s) => s.id === sel.sessionId);
  if (!v) { $('detail-empty').hidden = false; $('detail-body').hidden = true; stream.close(); return; }
  $('detail-empty').hidden = true; $('detail-body').hidden = false;
  const a = sel.agentId ? v.agents.find((x) => x.id === sel.agentId) : null;
  if (sel.agentId && !a) { select(v.id, null); return; }
  const now = Date.now();
  stream.setAgentIndex(v.agents);
  if (a) renderAgentHead(v, a, now); else renderSessionHead(v, now);
  stream.open(v.id, a ? a.id : null);
}

function renderSessionHead(v, now) {
  const resume = `cd ${shellQuote(v.cwd)} && claude --resume ${v.id}`;
  const msg = v.state === 'question' ? `Asks: ${v.stateMessage || v.activity.label || ''}` : v.state === 'permission' ? (v.stateMessage || 'Waiting for a permission decision in the terminal') : v.state === 'done' ? clip(plain(v.lastAssistantText) || 'Finished its turn.', 400) : '';
  $('detail-head').innerHTML = `
    <h2>${esc(v.title)}</h2>
    <div class="meta"><span class="pill ${v.state}">${esc(stateLabel(v.state))}${v.stateSince ? ' · ' + ago(v.stateSince, now) : ''}</span><span>${esc(v.name || v.id.slice(0, 8))}</span>${v.pid ? `<span>pid ${v.pid}</span>` : ''}<code title="${esc(v.cwd)}">${esc(shortPath(v.cwd, 48))}</code></div>
    ${msg ? `<div class="state-msg ${v.state}">${esc(msg)}</div>` : ''}
    ${v.state === 'working' ? `<div class="muted" style="margin-top:8px">${esc(activityLine(v))}</div>` : ''}
    <div class="actions">
      ${v.state === 'done' ? `<button class="primary" data-act="ack">Mark as seen</button>` : ''}
      ${state.snap.summaries.mode !== 'off' ? `<button class="ghost" data-act="summarize" ${v.summarizing ? 'disabled' : ''}>${v.summarizing ? 'Summarizing…' : (v.summary ? 'Refresh summary' : 'Summarize')}</button>` : ''}
      <button class="ghost" data-act="copy" title="${esc(resume)}">Copy resume command</button>
      <button class="ghost" data-act="history">Recent sessions here</button>
    </div>`;
  const s = v.summary;
  $('detail-summary').innerHTML = s
    ? `<div class="h">${esc(s.headline)}</div><div class="p">${esc(s.progress)}</div>${s.needs ? `<div class="n">${esc(s.needs)}</div>` : ''}<div class="when">summary from ${ago(s.at, now)} ago${v.summaryError ? ` · last attempt failed: ${esc(v.summaryError)}` : ''}</div>`
    : state.snap.summaries.mode === 'off' ? `<div class="p">Summaries are off. Turn them on in the top bar to get a one-line status written by a small model.</div>`
    : v.summaryError ? `<div class="p">Summary failed: ${esc(v.summaryError)}</div>`
    : v.summarizing ? `<div class="p">Writing a summary…</div>`
    : `<div class="p">${v.lastPrompt ? 'Latest request: ' + esc(clip(v.lastPrompt, 220)) : 'No prompt yet.'}</div>`;
  $('detail-stats').innerHTML = `
    <div class="stat"><b>${tokens(v.contextTokens)}</b>context</div>
    <div class="stat"><b>${v.turns}</b>turns</div>
    <div class="stat"><b>${v.toolCalls}</b>tool calls</div>
    <div class="stat"><b>${v.agents.length}</b>agents${v.runningAgents ? ` · ${v.runningAgents} live` : ''}</div>
    <div class="stat"><b>${esc(shortModelName(v.model) || '–')}</b>model</div>
    <div class="stat"><b>${v.startedAt ? duration(now - v.startedAt) : '–'}</b>age</div>
    <div class="stat"><b>${v.errors}</b>tool errors</div>
    <div class="stat"><b>${v.hooksSeen ? 'exact' : 'inferred'}</b>status</div>`;
  $('detail-head').querySelector('[data-act="ack"]')?.addEventListener('click', () => post(`/api/session/${encodeURIComponent(v.id)}/ack`));
  $('detail-head').querySelector('[data-act="summarize"]')?.addEventListener('click', () => post(`/api/session/${encodeURIComponent(v.id)}/summarize`));
  $('detail-head').querySelector('[data-act="copy"]')?.addEventListener('click', (e) => { navigator.clipboard?.writeText(resume); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy resume command'), 1500); });
  $('detail-head').querySelector('[data-act="history"]')?.addEventListener('click', () => showHistory(v.cwd));
}

function renderAgentHead(v, a, now) {
  const line = a.state === 'running' ? activityLine({ state: 'working', activity: a.activity }) : a.state === 'done' ? `Finished${a.endedAt ? ' ' + ago(a.endedAt, now) + ' ago' : ''}${a.startedAt && a.endedAt ? ' after ' + duration(a.endedAt - a.startedAt) : ''}` : 'Ended with its session';
  $('detail-head').innerHTML = `
    <h2>${esc(a.description || a.type)}</h2>
    <div class="meta"><span class="pill ${a.state}">${esc(stateLabel(a.state))}</span><span>${esc(a.type)}${a.isFork ? ' (fork)' : ''}${a.background ? ' · background' : ''}</span><span>in ${esc(v.name || v.title)}</span>${a.parentAgentId ? `<span>spawned by another agent</span>` : ''}</div>
    <div class="muted" style="margin-top:8px">${esc(line)}</div>
    <div class="actions"><button class="ghost" data-act="up">Back to session</button>${a.parentAgentId ? `<button class="ghost" data-act="parent">Parent agent</button>` : ''}</div>`;
  $('detail-summary').innerHTML = a.lastText ? `<div class="p">${esc(a.lastText)}</div>` : `<div class="p">No reply from this agent yet.</div>`;
  $('detail-stats').innerHTML = `
    <div class="stat"><b>${tokens(a.contextTokens)}</b>context</div>
    <div class="stat"><b>${a.toolCalls}</b>tool calls</div>
    <div class="stat"><b>${esc(shortModelName(a.model) || 'inherited')}</b>model</div>
    <div class="stat"><b>${a.startedAt ? duration((a.endedAt ?? now) - a.startedAt) : '–'}</b>runtime</div>`;
  $('detail-head').querySelector('[data-act="up"]').addEventListener('click', () => select(v.id, null));
  $('detail-head').querySelector('[data-act="parent"]')?.addEventListener('click', () => select(v.id, a.parentAgentId));
}

async function showHistory(cwd) {
  const list = await api(`/api/history?cwd=${encodeURIComponent(cwd)}`);
  const now = Date.now();
  $('detail-summary').innerHTML = `<div class="h">Recent sessions in ${esc(cwd.split('/').pop())}</div><ul class="history-list">${(list ?? []).map((h) => `<li><button data-open="${esc(h.id)}"><div>${esc(h.title || h.id.slice(0, 8))}${h.live ? ' <span class="pill working">live</span>' : ''}</div><div class="sub">${ago(h.modified, now)} ago · ${h.turns ?? '?'} turns · ${Math.round(h.size / 1024)} KB</div></button></li>`).join('')}</ul>`;
  $('detail-summary').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.open;
    await post('/api/history/open', { cwd, id });
    state.openedHistory.add(id);
    const snap = await api('/api/state'); if (snap) onSnapshot(snap);
    select(id, null);
  }));
}

function shellQuote(s) { return /^[\w\/.~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`; }

/* ---------- wiring ---------- */
function setupSidebar() {
  $('project-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-project]'); if (!b) return;
    const id = b.dataset.project;
    state.autoSelect = false;
    if (e.metaKey || e.ctrlKey || e.shiftKey) { if (state.selectedProjects.has(id)) state.selectedProjects.delete(id); else state.selectedProjects.add(id); }
    else state.selectedProjects = new Set([id]);
    renderProjects(state.snap); renderGraph(); fitView();
  });
  $('select-all').onclick = () => { state.autoSelect = false; state.selectedProjects = new Set(state.snap.projects.map((p) => p.id)); renderProjects(state.snap); renderGraph(); fitView(); };
  $('attention').addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); if (b) focusSession(b.dataset.focus); });
  $('ack-all').onclick = () => post('/api/ack-all');
  $('hooks-btn').onclick = installHooks;
  $('summaries-mode').onchange = (e) => post('/api/settings', { summaries: e.target.value });
  document.querySelectorAll('[data-filter]').forEach((cb) => cb.addEventListener('change', () => $('stream').classList.toggle('hide-' + cb.dataset.filter, !cb.checked)));
  $('follow').addEventListener('change', (e) => stream.setFollow(e.target.checked));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') select(null);
    if (e.key === 'n' && state.snap?.attention.length) {
      const ids = state.snap.attention.map((a) => a.sessionId);
      const i = ids.indexOf(state.selected?.sessionId);
      focusSession(ids[(i + 1) % ids.length]);
    }
    if (e.key === 'f') fitView();
  });
}

/* refresh relative times every few seconds without waiting for a snapshot */
setInterval(() => { if (state.snap) { renderAttention(state.snap); renderProjects(state.snap); } }, 5000);

setupCanvas(); setupSidebar(); connect();
window.addEventListener('hashchange', () => selectFromHash());
let fitted = false;
const fitOnce = setInterval(() => { if (state.scene?.nodes.length && !fitted) { fitView(); fitted = true; clearInterval(fitOnce); } }, 200);
