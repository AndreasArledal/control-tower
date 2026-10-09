import { esc, ago, agoCoarse, fit, activityLine, stateLabel, plain, shortModelName, uiState, UI_RANK } from './format.js';

export const SESSION_W = 300, SESSION_H = 110, AGENT_W = 224, AGENT_H = 62, FOLD_H = 32, COL_GAP = 36, ROW_GAP = 10, SESSION_GAP = 24, GROUP_GAP_Y = 36, LABEL_H = 30, WRAP_ROWS = 8, WRAP_GAP = 12;
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
  return { p, nodes, edges, w, h: y - SESSION_GAP, label: { name: p.name, headline: p.headline, n: sessions.length, state: p.state } };
}

/** Projects stack top to bottom in urgency order, one per row. */
export function buildScene(snapshot, visibleProjects, { expanded, showExited }) {
  const groups = [];
  for (const p of snapshot.projects.filter((p) => visibleProjects.has(p.id))) {
    const sessions = snapshot.sessions.filter((v) => v.cwd === p.id && (v.alive || v.pinned || showExited));
    if (sessions.length) groups.push(layoutGroup(p, sessions, expanded));
  }
  const nodes = [], edges = [], labels = [];
  const M = 36;
  let y = 20;
  for (const g of groups) {
    for (const n of g.nodes) { n.x += M; n.y += y; nodes.push(n); }
    edges.push(...g.edges);
    labels.push({ ...g.label, x: M, y, w: Math.max(g.w, 440), h: g.h });
    y += g.h + GROUP_GAP_Y;
  }
  const width = Math.max(300, ...nodes.map((n) => n.x + n.w + 20));
  return { nodes, edges, labels, width, height: y - GROUP_GAP_Y + 20 };
}

const anchorIn = (n) => ({ x: n.x, y: n.y + Math.min(n.h / 2, 31) });
const edgeState = (n) => (n.kind === 'agent' ? n.data.state : n.kind);

/**
 * Orthogonal bus per parent: a neutral stub out and a neutral vertical trunk at the gap midpoint,
 * then one short state-coloured stub into each child. Wrapped columns hang off a secondary trunk.
 */
function busPaths(e) {
  const p = e.parent;
  const ax = p.x + p.w, ay = p.y + p.h / 2;
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

/** State glyph drawn at (x, y) centre: spinner, ?, ◆, ✓, hollow dot, dashed dot. */
function glyph(state, x, y) {
  const cls = `state-${state}`;
  switch (state) {
    case 'working': case 'running': return `<path class="arc" d="M${x - 4},${y} a4,4 0 1 1 4,4"></path>`;
    case 'question': return `<circle class="${cls}" cx="${x}" cy="${y}" r="5.5"></circle><text x="${x}" y="${y + 3.5}" text-anchor="middle" class="glyph" style="fill:#16120A">?</text>`;
    case 'permission': return `<path class="${cls}" d="M${x},${y - 5.5} L${x + 5.5},${y} L${x},${y + 5.5} L${x - 5.5},${y} Z"></path>`;
    case 'followup': return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="var(--blocking)" stroke-width="1.6"></circle><text x="${x}" y="${y + 3.5}" text-anchor="middle" class="glyph" style="fill:var(--blocking)">?</text>`;
    case 'done': return `<path d="M${x - 4.5},${y} l3,3 l6,-6" fill="none" stroke="var(--ready)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>`;
    case 'exited': return `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="var(--exited)" stroke-width="1.4" stroke-dasharray="2 2"></circle>`;
    default: return `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="var(--idle)" stroke-width="1.4"></circle>`;
  }
}

/** Split a title over at most two lines of a given pixel width. */
function twoLines(text, maxPx, px) {
  const per = px * 0.56, max = Math.floor(maxPx / per);
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return [t];
  let cut = t.lastIndexOf(' ', max);
  if (cut < max * 0.5) cut = max;
  return [t.slice(0, cut).trim(), fit(t.slice(cut).trim(), maxPx, px)];
}

function pill(x, y, text, cls = '') {
  const w = Math.round(text.length * 6.4 + 14);
  return `<g class="pill-g ${cls}"><rect x="${x}" y="${y - 8}" width="${w}" height="16" rx="8"></rect><text class="pill-t" x="${x + w / 2}" y="${y + 3.5}" text-anchor="middle">${esc(text)}</text></g>`;
}

function sessionNode(n, { selected, changed, now }) {
  const v = n.data, blocking = v.state === 'question' || v.state === 'permission';
  const ui = uiState(v);
  const waiting = ui === 'needs' && !blocking;
  const glyphState = blocking ? v.state : waiting ? 'followup' : ui === 'paused' ? 'idle' : ui;
  const footState = ui === 'needs' ? 'followup' : ui === 'paused' ? 'idle' : ui;
  const nAgents0 = v.agents.length, live0 = v.runningAgents;
  const pillText = nAgents0 ? (live0 ? `${live0} of ${nAgents0} agents` : `${nAgents0} agent${nAgents0 === 1 ? '' : 's'}`) : '';
  const pillW = pillText ? Math.round(pillText.length * 6.4 + 14) : 0;
  const lines = twoLines(v.title, n.w - 26 - (pillW ? pillW + 8 : 0), 13);
  if (lines[1]) lines[1] = fit(v.title.replace(/\s+/g, ' ').trim().slice(lines[0].length).trim(), n.w - 26, 13);
  const act = fit(plain(activityLine(v)), n.w - 26, 12);
  const sinceTs = waiting ? v.followUp.since : ui === 'paused' ? (v.lastAssistantAt ?? v.stateSince) : v.stateSince;
  const since = sinceTs ? agoCoarse(sinceTs, now) : '';
  const nAgents = v.agents.length, live = v.runningAgents;
  const fy = n.h - 15, my = n.h - 34; // footer row and the meta row above it
  const pct = v.contextTokens ? Math.min(1, v.contextTokens / contextWindow(v.contextTokens)) : 0;
  const barW = 44, barX = n.w - 12 - 30 - barW;
  const model = [shortModelName(v.model), v.effort ? `${v.effort} effort` : null].filter(Boolean).join(' · ');
  return `<g class="node session ${footState} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(v.id)}" tabindex="0" role="button" aria-label="${esc(v.title)}, ${esc(stateLabel(footState))}">
    ${blocking ? `<rect class="ring" x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}"></rect>` : waiting ? `<rect class="ring soft" x="-2" y="-2" width="${n.w + 4}" height="${n.h + 4}"></rect>` : ''}
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="16" y="22">${esc(lines[0])}</text>
    ${lines[1] ? `<text class="title" x="16" y="39">${esc(lines[1])}</text>` : ''}
    <text class="sub" x="16" y="${lines[1] ? 58 : 42}">${esc(act)}</text>
    ${model ? `<text class="mono model" x="16" y="${my + 3.5}">${esc(fit(model, n.w - 32, 11))}</text>` : ''}
    ${glyph(glyphState, 22, fy)}
    <text class="foot state-${footState}" x="33" y="${fy + 4}">${esc(fit(stateLabel(footState) + (since ? ` · ${since}` : ''), barX - 90, 11.5))}</text>
    ${v.contextTokens ? `<g class="ctx"><title>Context window used: ${Math.round(pct * 100)}% of ${contextWindow(v.contextTokens) / 1000}k tokens</title><text class="mono" x="${barX - 6}" y="${fy + 3.5}" text-anchor="end">context</text><rect class="ctx-bar" x="${barX}" y="${fy - 2}" width="${barW}" height="4" rx="2"></rect><rect class="ctx-fill ${pct > 0.8 ? 'warn' : ''}" x="${barX}" y="${fy - 2}" width="${Math.max(2, barW * pct)}" height="4" rx="2"></rect><text class="mono" x="${n.w - 12}" y="${fy + 3.5}" text-anchor="end">${Math.round(pct * 100)}%</text></g>` : ''}
    ${pillText ? pill(n.w - 12 - pillW, 18, pillText, live ? 'live' : '') : ''}
  </g>`;
}

const TOOL_CLASS = { Bash: 'cat-shell', Read: 'cat-read', Glob: 'cat-read', Grep: 'cat-read', Write: 'cat-write', Edit: 'cat-write', Agent: 'cat-agent', AskUserQuestion: 'cat-ask' };

function agentNode(n, { selected, changed, now }) {
  const a = n.data;
  const title = fit(a.description || a.type, n.w - 24, 12.5);
  const line = a.state === 'running' ? (a.activity?.kind === 'tool' ? `${a.activity.tool}: ${a.activity.label || ''}` : a.activity?.label || 'Running')
    : a.state === 'done' ? `finished${a.endedAt ? ' ' + agoCoarse(a.endedAt, now) : ''}` : 'ended with session';
  const kids = a.children ?? 0;
  const foot = a.toolCalls ? `${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'}` : String(a.type).split(':').pop();
  const model = shortModelName(a.model || n.sessionModel);
  const modelW = model ? model.length * 6.4 + 10 : 0;
  const fy = n.h - 12;
  return `<g class="node agent ${a.state} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(n.sessionId)}" data-agent="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.description || a.type)}, ${esc(stateLabel(a.state))}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="14" y="20">${esc(title)}</text>
    <text class="sub" x="14" y="35">${esc(fit(line, n.w - 24, 11.5))}</text>
    ${glyph(a.state, 19, fy - 1)}
    <text class="mono" x="29" y="${fy + 3}">${esc(fit(foot, n.w - 44 - modelW - (kids ? 36 : 0), 11))}</text>
    ${model ? `<text class="mono model" x="${n.w - 12}" y="${fy + 3}" text-anchor="end">${esc(model)}</text>` : ''}
    ${kids ? `<text class="mono" x="${n.w - 12 - modelW}" y="${fy + 3}" text-anchor="end">${kids} sub</text>` : ''}
  </g>`;
}

function moreNode(n) {
  const less = n.kind === 'less';
  return `<g class="node more" transform="translate(${n.x},${n.y})" data-more="${esc(n.id)}" data-less="${less ? '1' : ''}" tabindex="0" role="button">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <text x="${n.w / 2}" y="20" text-anchor="middle">${less ? 'show less' : `${n.count} more finished · show`}</text>
  </g>`;
}

/**
 * Render into the viewport, touching only what changed: edges/labels are rebuilt when the layout
 * signature changes, and each node <g> is replaced only when its own markup differs. This keeps
 * running animations (spinners, edge flow) from restarting on every refresh and stops the "jump".
 */
export function renderScene(scene, { selected, now, changed }, viewport, cache = { sig: '', nodes: new Map() }) {
  const sig = scene.nodes.map((n) => `${n.kind}:${n.id}:${n.x},${n.y}:${n.kind === 'agent' ? n.data.state : ''}`).join('|') + '#' + scene.labels.map((l) => `${l.x},${l.y},${l.headline},${l.h}`).join('|');
  const nodeHtml = new Map();
  for (const n of scene.nodes) {
    const html = n.kind === 'session' ? sessionNode(n, { selected: selected?.sessionId === n.id && !selected?.agentId, changed: changed.has(n.id), now })
      : n.kind === 'agent' ? agentNode(n, { selected: selected?.agentId === n.id, changed: changed.has(n.id), now }) : moreNode(n);
    nodeHtml.set(n.kind + ':' + n.id, html);
  }
  if (sig !== cache.sig) {
    const parts = [];
    for (const l of scene.labels) parts.push(`<g class="group" transform="translate(${l.x},${l.y})"><line class="spine" x1="-16" y1="4" x2="-16" y2="${l.h}"></line><circle class="gdot ${l.state}" cx="2" cy="9" r="4"></circle><text class="group-label" x="14" y="13"><tspan class="n">${esc(l.name)}</tspan>${l.headline ? `<tspan class="h" dx="10">${esc(fit(l.headline, Math.max(160, l.w - 60 - l.name.length * 7.5), 12))}</tspan>` : ''}</text>${l.n > 1 ? `<text class="group-label c" x="${l.w}" y="13" text-anchor="end">${l.n} sessions</text>` : ''}</g>`);
    for (const e of scene.edges) parts.push(busPaths(e));
    parts.push('<g class="nodes">' + [...nodeHtml.values()].join('\n') + '</g>');
    viewport.innerHTML = parts.join('\n');
    cache.sig = sig; cache.nodes = nodeHtml;
    return;
  }
  // same layout: swap only the nodes whose markup changed, update edge states in place
  const container = viewport.querySelector('.nodes');
  const els = [...container.children];
  let i = 0;
  for (const [key, html] of nodeHtml) {
    const el = els[i++];
    if (cache.nodes.get(key) !== html) { const t = document.createElementNS('http://www.w3.org/2000/svg', 'g'); el.replaceWith(t); t.outerHTML = html; }
  }
  cache.nodes = nodeHtml;
}
export { TOOL_CLASS };
