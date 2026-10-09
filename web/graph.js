import { esc, ago, fit, activityLine, stateLabel, plain } from './format.js';

export const SESSION_W = 288, SESSION_H = 100, AGENT_W = 212, AGENT_H = 62, FOLD_H = 32, COL_GAP = 36, ROW_GAP = 10, SESSION_GAP = 22, GROUP_GAP_X = 44, GROUP_GAP_Y = 36, LABEL_H = 30;
const RECENT_FINISHED = 3;
const RANK = { question: 0, permission: 0, done: 1, working: 2, idle: 3, exited: 4 };

/** Transcripts do not record the window size; anything past 190k must be running on a 1M window. */
export function contextWindow(used) { return used > 190_000 ? 1_000_000 : 200_000; }

/** Node tree for one session: running agents always, the most recent finished few, the rest folded. */
function agentTree(session, expanded) {
  const byParent = new Map();
  for (const a of session.agents) {
    const k = a.parentAgentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  const build = (parentId) => {
    const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const running = kids.filter((a) => a.state === 'running');
    const finished = kids.filter((a) => a.state !== 'running');
    const foldKey = `${session.id}:${parentId ?? 'root'}`;
    let shown = kids, folded = 0;
    if (!expanded.has(foldKey) && finished.length > RECENT_FINISHED) {
      const keep = finished.slice(-RECENT_FINISHED);
      folded = finished.length - keep.length;
      shown = running.concat(keep).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    }
    const nodes = shown.map((a) => ({ kind: 'agent', id: a.id, sessionId: session.id, data: a, w: AGENT_W, h: AGENT_H, children: build(a.id) }));
    if (folded) nodes.unshift({ kind: 'more', id: foldKey, count: folded, w: AGENT_W, h: FOLD_H, children: [] });
    return nodes;
  };
  return build(null);
}

/** Tidy-ish tree layout: leaves take rows, parents centre on their children, depth sets the column. Returns the bottom edge. */
function layoutTree(root, x0, y0) {
  let cursor = y0;
  const place = (n, x) => {
    n.x = x;
    if (!n.children.length) { n.y = cursor; cursor += n.h + ROW_GAP; return; }
    for (const c of n.children) place(c, x + n.w + COL_GAP);
    const first = n.children[0], last = n.children[n.children.length - 1];
    n.y = Math.max((first.y + last.y + last.h) / 2 - n.h / 2, y0);
    cursor = Math.max(cursor, n.y + n.h + ROW_GAP);
  };
  place(root, x0);
  return cursor - ROW_GAP;
}

/** Lay out one project as a block at (0,0): label row, then its sessions stacked. */
function layoutGroup(p, sessions, expanded) {
  const nodes = [], edges = [];
  let y = LABEL_H;
  sessions.sort((a, b) => RANK[a.state] - RANK[b.state] || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  for (const v of sessions) {
    const root = { kind: 'session', id: v.id, sessionId: v.id, data: v, w: SESSION_W, h: SESSION_H, children: agentTree(v, expanded) };
    const bottom = layoutTree(root, 0, y);
    const walk = (n, parent, idx, count) => {
      nodes.push(n);
      if (parent) edges.push({ from: parent, to: n, idx, count, state: n.kind === 'agent' ? n.data.state : 'folded' });
      n.children.forEach((c, i) => walk(c, n, i, n.children.length));
    };
    walk(root, null, 0, 1);
    y = bottom + SESSION_GAP;
  }
  const w = Math.max(SESSION_W, ...nodes.map((n) => n.x + n.w));
  return { p, nodes, edges, w, h: y - SESSION_GAP, label: { name: p.name, headline: p.headline, n: sessions.length, state: p.state } };
}

/**
 * Projects are packed on shelves: left to right while they fit the available width, then a new row.
 * Urgent projects come first in reading order.
 */
export function buildScene(snapshot, visibleProjects, { expanded, showExited, availWidth = 960 }) {
  const groups = [];
  for (const p of snapshot.projects.filter((p) => visibleProjects.has(p.id))) {
    const sessions = snapshot.sessions.filter((v) => v.cwd === p.id && (v.alive || v.pinned || showExited));
    if (sessions.length) groups.push(layoutGroup(p, sessions, expanded));
  }
  const nodes = [], edges = [], labels = [];
  const M = 20, usable = Math.max(SESSION_W, availWidth - 2 * M);
  let x = M, y = M, rowH = 0;
  for (const g of groups) {
    if (x > M && x + g.w > M + usable) { x = M; y += rowH + GROUP_GAP_Y; rowH = 0; }
    for (const n of g.nodes) { n.x += x; n.y += y; nodes.push(n); }
    edges.push(...g.edges);
    labels.push({ ...g.label, x, y, w: g.w });
    x += g.w + GROUP_GAP_X; rowH = Math.max(rowH, g.h);
  }
  const width = Math.max(300, ...nodes.map((n) => n.x + n.w + M));
  return { nodes, edges, labels, width, height: y + rowH + M };
}

function edgePath(e) {
  const spread = Math.min(6, 28 / Math.max(1, e.count - 1));
  const y1 = e.from.y + e.from.h / 2 + (e.idx - (e.count - 1) / 2) * spread;
  const x1 = e.from.x + e.from.w, x2 = e.to.x, y2 = e.to.y + e.to.h / 2, c = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}

/** State glyph drawn at (x, y) centre: spinner, ?, ◆, ✓, hollow dot, dashed dot. */
function glyph(state, x, y) {
  const cls = `state-${state}`;
  switch (state) {
    case 'working': case 'running': return `<path class="arc" d="M${x - 4},${y} a4,4 0 1 1 4,4"></path>`;
    case 'question': return `<circle class="${cls}" cx="${x}" cy="${y}" r="5.5"></circle><text x="${x}" y="${y + 3.5}" text-anchor="middle" class="glyph" style="fill:#16120A">?</text>`;
    case 'permission': return `<path class="${cls}" d="M${x},${y - 5.5} L${x + 5.5},${y} L${x},${y + 5.5} L${x - 5.5},${y} Z"></path>`;
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
  const nAgents0 = v.agents.length, live0 = v.runningAgents;
  const pillText = nAgents0 ? (live0 ? `${live0} of ${nAgents0} agents` : `${nAgents0} agent${nAgents0 === 1 ? '' : 's'}`) : '';
  const pillW = pillText ? Math.round(pillText.length * 6.4 + 14) : 0;
  const lines = twoLines(v.title, n.w - 26 - (pillW ? pillW + 8 : 0), 13);
  if (lines[1]) lines[1] = fit(v.title.replace(/\s+/g, ' ').trim().slice(lines[0].length).trim(), n.w - 26, 13);
  const act = fit(v.state === 'done' && v.summary?.headline ? v.summary.headline : plain(activityLine(v)), n.w - 26, 12);
  const since = v.stateSince ? ago(v.stateSince, now) : '';
  const nAgents = v.agents.length, live = v.runningAgents;
  const fy = n.h - 15;
  const pct = v.contextTokens ? Math.min(1, v.contextTokens / contextWindow(v.contextTokens)) : 0;
  const barX = 150, barW = 40;
  return `<g class="node session ${v.state} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(v.id)}" tabindex="0" role="button" aria-label="${esc(v.title)}, ${esc(stateLabel(v.state))}">
    ${blocking ? `<rect class="ring" x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}"></rect>` : v.state === 'done' ? `<rect class="ring ready" x="-2" y="-2" width="${n.w + 4}" height="${n.h + 4}"></rect>` : ''}
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="16" y="22">${esc(lines[0])}</text>
    ${lines[1] ? `<text class="title" x="16" y="39">${esc(lines[1])}</text>` : ''}
    <text class="sub" x="16" y="${lines[1] ? 58 : 42}">${esc(act)}</text>
    ${glyph(v.state, 22, fy)}
    <text class="foot state-${v.state}" x="33" y="${fy + 4}">${esc(fit(stateLabel(v.state) + (since ? ` · ${since}` : ''), barX - 40, 11.5))}</text>
    ${v.contextTokens ? `<rect class="ctx-bar" x="${barX}" y="${fy - 2}" width="${barW}" height="4" rx="2"></rect><rect class="ctx-fill ${pct > 0.8 ? 'warn' : ''}" x="${barX}" y="${fy - 2}" width="${Math.max(2, barW * pct)}" height="4" rx="2"></rect><text class="mono" x="${barX + barW + 6}" y="${fy + 3.5}">${Math.round(pct * 100)}%</text>` : ''}
    ${pillText ? pill(n.w - 12 - pillW, 18, pillText, live ? 'live' : '') : ''}
  </g>`;
}

const TOOL_CLASS = { Bash: 'cat-shell', Read: 'cat-read', Glob: 'cat-read', Grep: 'cat-read', Write: 'cat-write', Edit: 'cat-write', Agent: 'cat-agent', AskUserQuestion: 'cat-ask' };

function agentNode(n, { selected, changed, now }) {
  const a = n.data;
  const title = fit(a.description || a.type, n.w - 24, 12.5);
  const line = a.state === 'running' ? (a.activity?.kind === 'tool' ? `${a.activity.tool}: ${a.activity.label || ''}` : a.activity?.label || 'Running')
    : a.state === 'done' ? `finished${a.endedAt ? ' ' + ago(a.endedAt, now) + ' ago' : ''}` : 'ended with session';
  const kids = a.children ?? 0;
  const foot = [String(a.type).split(':').pop(), a.toolCalls ? `${a.toolCalls} tool${a.toolCalls === 1 ? '' : 's'}` : null, a.isFork ? 'fork' : null].filter(Boolean).join(' · ');
  const fy = n.h - 12;
  return `<g class="node agent ${a.state} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(n.sessionId)}" data-agent="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.description || a.type)}, ${esc(stateLabel(a.state))}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="14" y="20">${esc(title)}</text>
    <text class="sub" x="14" y="35">${esc(fit(line, n.w - 24, 11.5))}</text>
    ${glyph(a.state, 19, fy - 1)}
    <text class="mono" x="29" y="${fy + 3}">${esc(fit(foot, n.w - 44 - (kids ? 44 : 0), 11))}</text>
    ${kids ? `<text class="mono" x="${n.w - 12}" y="${fy + 3}" text-anchor="end">${kids} sub</text>` : ''}
  </g>`;
}

function moreNode(n) {
  return `<g class="node more" transform="translate(${n.x},${n.y})" data-more="${esc(n.id)}" tabindex="0" role="button">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <text x="14" y="20">${n.count} more finished · show</text>
  </g>`;
}

export function renderScene(scene, { selected, now, changed }) {
  const parts = [];
  for (const l of scene.labels) {
    parts.push(`<g class="group" transform="translate(${l.x},${l.y})"><circle class="gdot ${l.state}" cx="5" cy="9" r="4"></circle><text class="group-label" x="16" y="13"><tspan class="n">${esc(l.name)}</tspan>${l.headline ? `<tspan class="h" dx="10">${esc(fit(l.headline, Math.max(120, l.w - 90 - l.name.length * 7.5), 12))}</tspan>` : ''}</text>${l.n > 1 ? `<text class="group-label c" x="${l.w}" y="13" text-anchor="end">${l.n} sessions</text>` : ''}</g>`);
  }
  for (const e of scene.edges) parts.push(`<path class="edge ${e.state}" d="${edgePath(e)}"></path>`);
  for (const n of scene.nodes) {
    if (n.kind === 'session') parts.push(sessionNode(n, { selected: selected?.sessionId === n.id && !selected?.agentId, changed: changed.has(n.id), now }));
    else if (n.kind === 'agent') parts.push(agentNode(n, { selected: selected?.agentId === n.id, changed: changed.has(n.id), now }));
    else parts.push(moreNode(n));
  }
  return parts.join('\n');
}
export { TOOL_CLASS };
