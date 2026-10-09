import { esc, ago, agoCoarse, fit, activityLine, stateLabel, plain, shortModelName, uiState, UI_RANK } from './format.js';

export const SESSION_W = 300, SESSION_H = 104, AGENT_W = 224, AGENT_H = 64, FOLD_H = 28, COL_GAP = 40, ROW_GAP = 8, SESSION_GAP = 24, GROUP_GAP_Y = 40, LABEL_H = 28, WRAP_ROWS = 8, WRAP_GAP = 12;
const RECENT_FINISHED = 3;


/** Transcripts do not record the window size; anything past 190k must be running on a 1M window. */
export function contextWindow(used) { return used > 190_000 ? 1_000_000 : 200_000; }

/**
 * Node tree for one session. Per parent: running agents first (oldest first), then the most recent
 * finished ones (newest first), then one fold node for the rest, or a "show less" node when expanded.
 */
function agentTree(session, expanded) {
  const byParent = new Map();
  for (const a of session.agents) {
    const k = a.parentAgentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  const build = (parentId) => {
    const kids = byParent.get(parentId) ?? [];
    const running = kids.filter((a) => a.state === 'running').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const finished = kids.filter((a) => a.state !== 'running').sort((a, b) => (b.endedAt ?? b.lastActivityAt ?? 0) - (a.endedAt ?? a.lastActivityAt ?? 0));
    const foldKey = `${session.id}:${parentId ?? 'root'}`;
    const isOpen = expanded.has(foldKey);
    const shownFinished = isOpen ? finished : finished.slice(0, RECENT_FINISHED);
    const folded = finished.length - shownFinished.length;
    const nodes = running.concat(shownFinished).map((a) => ({ kind: 'agent', id: a.id, sessionId: session.id, sessionModel: session.model, data: a, w: AGENT_W, h: AGENT_H, children: build(a.id) }));
    if (folded) nodes.push({ kind: 'more', id: foldKey, count: folded, w: AGENT_W, h: FOLD_H, children: [] });
    else if (isOpen && finished.length > RECENT_FINISHED) nodes.push({ kind: 'less', id: foldKey, w: AGENT_W, h: FOLD_H, children: [] });
    return nodes;
  };
  return build(null);
}

/** Height of a node's whole subtree: its children stack below its top edge, in columns of WRAP_ROWS. */
function subtreeHeight(n) {
  if (!n.children.length) return n.h;
  const cols = chunk(n.children, WRAP_ROWS);
  const colH = cols.map((c) => c.reduce((h, k, i) => h + subtreeHeight(k) + (i ? ROW_GAP : 0), 0));
  return Math.max(n.h, ...colH);
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/**
 * Top-pinned layout: a node sits at (x, y); its children start at the same y in the next column and
 * stack downward; nothing is centred, so a session's position never depends on how many agents it has.
 * Past WRAP_ROWS children the column wraps to a tighter second column at the same depth.
 */
function place(n, x, y) {
  n.x = x; n.y = y;
  const cols = chunk(n.children, WRAP_ROWS);
  cols.forEach((col, ci) => {
    let cy = y;
    const cx = x + n.w + COL_GAP + ci * (AGENT_W + WRAP_GAP);
    for (const k of col) { k.col = ci; place(k, cx, cy); cy += subtreeHeight(k) + ROW_GAP; }
  });
}

/** Lay out one project as a block at (0,0): label row, then its sessions stacked. */
function layoutGroup(p, sessions, expanded) {
  const nodes = [], edges = [];
  let y = LABEL_H;
  sessions.sort((a, b) => UI_RANK[uiState(a)] - UI_RANK[uiState(b)] || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  for (const v of sessions) {
    const root = { kind: 'session', id: v.id, sessionId: v.id, data: v, w: SESSION_W, h: SESSION_H, children: agentTree(v, expanded) };
    place(root, 0, y);
    const walk = (n) => { nodes.push(n); if (n.children.length) edges.push({ parent: n, children: n.children }); n.children.forEach(walk); };
    walk(root);
    y += subtreeHeight(root) + SESSION_GAP;
  }
  const w = Math.max(SESSION_W, ...nodes.map((n) => n.x + n.w));
  const worst = sessions.map((v) => uiState(v)).sort((a, b) => UI_RANK[a] - UI_RANK[b])[0];
  return { p, nodes, edges, w, h: y - SESSION_GAP, label: { name: p.name, headline: p.headline, n: sessions.length, worst } };
}

/** Projects stack top to bottom in urgency order, one per row. */
export function buildScene(snapshot, visibleProjects, { expanded, showExited }) {
  const groups = [];
  for (const p of snapshot.projects.filter((p) => visibleProjects.has(p.id))) {
    const sessions = snapshot.sessions.filter((v) => v.cwd === p.id && (v.alive || v.pinned || showExited));
    if (sessions.length) groups.push(layoutGroup(p, sessions, expanded));
  }
  const nodes = [], edges = [], labels = [];
  const M = 24;
  let y = 24;
  for (const g of groups) {
    for (const n of g.nodes) { n.x += M; n.y += y; nodes.push(n); }
    edges.push(...g.edges);
    labels.push({ ...g.label, x: M, y, w: Math.max(g.w, 440), h: g.h });
    y += g.h + GROUP_GAP_Y;
  }
  const width = Math.max(300, ...nodes.map((n) => n.x + n.w + 20));
  return { nodes, edges, labels, width, height: y - GROUP_GAP_Y + 20 };
}

const anchorIn = (n) => ({ x: n.x, y: n.y + Math.min(n.h / 2, 32) });
const edgeState = (n) => (n.kind === 'agent' ? AGENT_CLASS[n.data.state] ?? n.data.state : n.kind);

/**
 * Orthogonal bus per parent: a neutral stub out and a neutral vertical trunk at the gap midpoint,
 * then one short state-coloured stub into each child. Wrapped columns hang off a secondary trunk.
 */
function busPaths(e) {
  const p = e.parent;
  const ax = p.x + p.w, ay = p.y + Math.min(p.h / 2, 32);
  const trunkX = ax + COL_GAP / 2;
  const r = 6;
  const parts = [];
  const cols = chunk(e.children, WRAP_ROWS);
  cols.forEach((col, ci) => {
    const tx = ci === 0 ? trunkX : col[0].x - WRAP_GAP / 2;
    const ys = col.map((k) => anchorIn(k).y);
    const top = Math.min(ci === 0 ? ay : ys[0], ...ys), bottom = Math.max(ci === 0 ? ay : ys[0], ...ys);
    if (ci === 0) parts.push(`<path class="bus" d="M${ax},${ay} H${tx} M${tx},${top} V${bottom}"></path>`);
    else { const prev = cols[ci - 1], lastPrev = prev[prev.length - 1]; const fy = lastPrev.y + subtreeHeight(lastPrev) + ROW_GAP / 2; parts.push(`<path class="bus secondary" d="M${trunkX},${fy} H${tx} M${tx},${Math.min(fy, top)} V${bottom}"></path>`); }
    for (const k of col) {
      const { x: kx, y: ky } = anchorIn(k);
      const cls = `edge ${edgeState(k)}`;
      const above = ky < ay - 0.5, below = ky > ay + 0.5;
      const corner = above ? `M${tx},${ky + r} Q${tx},${ky} ${tx + r},${ky}` : below ? `M${tx},${ky - r} Q${tx},${ky} ${tx + r},${ky}` : `M${tx},${ky}`;
      parts.push(`<path class="${cls}" d="${corner} H${kx}" data-edge="${esc(k.kind + ':' + k.id)}"></path>`);
    }
  });
  return parts.join('');
}

const AGENT_CLASS = { running: 'running', done: 'finished', exited: 'ended' };
const AGENT_LABEL = { running: 'running', finished: 'finished', ended: 'ended' };

/** State glyph centred at (x, y), 12px: spinner, filled ? , ◆, hollow ?, hollow ring, ✓, dashed ring. */
function glyph(kind, x, y) {
  switch (kind) {
    case 'working': case 'running': return `<path class="arc" d="M${x - 5},${y} a5,5 0 1 1 5,5"></path>`;
    case 'question': return `<circle cx="${x}" cy="${y}" r="6" fill="var(--needs)"></circle><text x="${x}" y="${y + 3}" text-anchor="middle" class="glyph" style="fill:var(--on-needs)">?</text>`;
    case 'permission': return `<path d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} Z" fill="var(--needs)"></path>`;
    case 'followup': return `<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="var(--needs)" stroke-width="1.5"></circle><text x="${x}" y="${y + 3}" text-anchor="middle" class="glyph" style="fill:var(--needs)">?</text>`;
    case 'finished': return `<path d="M${x - 5},${y} l3.5,3.5 l6.5,-7" fill="none" stroke="var(--ready)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>`;
    case 'ready': return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="var(--ready)" stroke-width="1.5"></circle>`;
    case 'ended': return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="var(--ended)" stroke-width="1.5" stroke-dasharray="2.5 2.5"></circle>`;
    default: return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="var(--text-3)" stroke-width="1.5"></circle>`;
  }
}

function contextBar(v, x, y, w) {
  if (!v.contextTokens) return '';
  const win = contextWindow(v.contextTokens), pct = Math.min(1, v.contextTokens / win);
  return `<g class="ctx"><title>${Math.round(pct * 100)}% of the ${win / 1000}k context window used</title><text class="lbl" x="${x - 8}" y="${y + 4}" text-anchor="end">context</text><rect class="ctx-bar" x="${x}" y="${y - 2}" width="${w}" height="4" rx="2"></rect><rect class="ctx-fill ${pct > 0.8 ? 'warn' : ''}" x="${x}" y="${y - 2}" width="${Math.max(2, Math.round(w * pct))}" height="4" rx="2"></rect><text class="pct" x="${x + w + 8}" y="${y + 4}">${Math.round(pct * 100)}%</text></g>`;
}

function sessionNode(n, { selected, changed, arrived, now }) {
  const v = n.data, ui = uiState(v);
  const cls = ui === 'exited' ? 'ended' : ui;
  const blocking = v.state === 'question' || v.state === 'permission';
  const glyphKind = ui === 'needs' ? (blocking ? v.state : 'followup') : cls;
  const nAgents = v.agents.length, live = v.runningAgents;
  const count = nAgents ? (live ? `${live} of ${nAgents}` : `${nAgents} agent${nAgents === 1 ? '' : 's'}`) : '';
  const countW = count ? count.length * 6.2 + 12 : 0;
  const title = fit(v.title, n.w - 32 - countW, 13);
  const sinceTs = ui === 'needs' && v.followUp && !blocking ? v.followUp.since : ui === 'paused' ? (v.lastAssistantAt ?? v.stateSince) : v.stateSince;
  const since = sinceTs ? agoCoarse(sinceTs, now) : '';
  const label = ui === 'needs' ? 'needs you' : ui === 'paused' ? 'ready' : ui === 'exited' ? 'ended' : 'working';
  const act = cls === 'ended' ? `Ended${since ? ' ' + since + ' ago' : ''}` : cls === 'ready' && v.summary?.headline ? v.summary.headline : plain(activityLine(v));
  const meta = [shortModelName(v.model), v.effort ? `${v.effort} effort` : null].filter(Boolean).join(' · ');
  return `<g class="node session ${cls} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''} ${arrived ? 'arrived' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(v.id)}" tabindex="0" role="button" aria-label="${esc(v.title)}, ${esc(label)}">
    ${selected || arrived ? `<rect class="ring" x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}"></rect>` : ''}
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="${cls === 'working' ? 6 : 4}" height="${n.h}"></rect>
    <text class="title" x="16" y="24">${esc(title)}</text>
    ${count ? `<text class="count" x="${n.w - 16}" y="24" text-anchor="end">${esc(count)}</text>` : ''}
    <text class="sub" x="16" y="44">${esc(fit(act, n.w - 32, 12))}</text>
    ${meta ? `<text class="meta" x="16" y="66">${esc(fit(meta, n.w - 32, 11))}</text>` : ''}
    ${glyph(glyphKind, 22, 86)}
    <text class="foot ${cls}" x="34" y="90">${esc(fit(label + (since ? ` · ${since}` : ''), 110, 11))}</text>
    ${contextBar(v, 212, 86, 56)}
  </g>`;
}

function agentNode(n, { selected, changed, now }) {
  const a = n.data, cls = AGENT_CLASS[a.state] ?? 'ended';
  const title = fit(a.description || a.type, n.w - 28, 13);
  const line = cls === 'running' ? (a.activity?.kind === 'tool' ? `${a.activity.tool}: ${a.activity.label || ''}` : a.activity?.label || 'Running')
    : cls === 'finished' ? `finished${a.endedAt ? ' · ' + agoCoarse(a.endedAt, now) : ''}` : 'ended with session';
  const kids = a.children ?? 0;
  const model = shortModelName(a.model || n.sessionModel);
  const modelW = model ? model.length * 6.2 + 8 : 0;
  const foot = a.toolCalls ? `${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}` : String(a.type).split(':').pop();
  return `<g class="node agent ${cls} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(n.sessionId)}" data-agent="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.description || a.type)}, ${esc(AGENT_LABEL[cls])}">
    ${selected ? `<rect class="ring" x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}"></rect>` : ''}
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="14" y="20">${esc(title)}</text>
    <text class="sub" x="14" y="38">${esc(fit(line, n.w - 28, 12))}</text>
    ${glyph(cls, 19, 51)}
    <text class="foot ${cls}" x="30" y="55">${esc(fit(foot, n.w - 46 - modelW - (kids ? 30 : 0), 11))}</text>
    ${kids ? `<text class="count" x="${n.w - 14 - modelW}" y="55" text-anchor="end">⑂${kids}</text>` : ''}
    ${model ? `<text class="meta" x="${n.w - 14}" y="55" text-anchor="end">${esc(model)}</text>` : ''}
  </g>`;
}

function moreNode(n) {
  const less = n.kind === 'less';
  return `<g class="node more" transform="translate(${n.x},${n.y})" data-more="${esc(n.id)}" data-less="${less ? '1' : ''}" tabindex="0" role="button">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <text x="${n.w / 2}" y="18" text-anchor="middle">${less ? 'show less' : `${n.count} more finished · show`}</text>
  </g>`;
}

const GROUP_DOT = { needs: 'needs', working: 'working', paused: 'ready', exited: 'ended' };

/**
 * Render into the viewport, touching only what changed: edges/labels are rebuilt when the layout
 * signature changes, and each node <g> is replaced only when its own markup differs, so running
 * animations never restart on a refresh and nothing jumps.
 */
export function renderScene(scene, { selected, now, changed, arrived = new Set() }, viewport, cache = { sig: '', nodes: new Map() }) {
  const sig = scene.nodes.map((n) => `${n.kind}:${n.id}:${n.x},${n.y}:${n.kind === 'agent' ? n.data.state : ''}`).join('|') + '#' + scene.labels.map((l) => `${l.x},${l.y},${l.headline},${l.h}`).join('|');
  const nodeHtml = new Map();
  for (const n of scene.nodes) {
    const html = n.kind === 'session' ? sessionNode(n, { selected: selected?.sessionId === n.id && !selected?.agentId, changed: changed.has(n.id), arrived: arrived.has(n.id), now })
      : n.kind === 'agent' ? agentNode(n, { selected: selected?.agentId === n.id, changed: changed.has(n.id), now }) : moreNode(n);
    nodeHtml.set(n.kind + ':' + n.id, html);
  }
  if (sig !== cache.sig) {
    const parts = [];
    for (const l of scene.labels) parts.push(`<g class="group" transform="translate(${l.x},${l.y})"><circle class="gdot ${GROUP_DOT[l.worst] ?? ''}" cx="4" cy="10" r="4"></circle><text class="group-label" x="16" y="14"><tspan class="n">${esc(l.name)}</tspan>${l.headline ? `<tspan dx="12">${esc(fit(l.headline, Math.max(160, l.w - 80 - l.name.length * 7.5), 13))}</tspan>` : ''}</text>${l.n > 1 ? `<text class="group-label c" x="${l.w}" y="14" text-anchor="end">${l.n} sessions</text>` : ''}</g>`);
    for (const e of scene.edges) parts.push(busPaths(e));
    parts.push('<g class="nodes">' + [...nodeHtml.values()].join('\n') + '</g>');
    viewport.innerHTML = parts.join('\n');
    cache.sig = sig; cache.nodes = nodeHtml;
    return;
  }
  const container = viewport.querySelector('.nodes');
  const els = [...container.children];
  let i = 0;
  for (const [key, html] of nodeHtml) {
    const el = els[i++];
    if (cache.nodes.get(key) !== html) { const t = document.createElementNS('http://www.w3.org/2000/svg', 'g'); el.replaceWith(t); t.outerHTML = html; }
  }
  cache.nodes = nodeHtml;
}
