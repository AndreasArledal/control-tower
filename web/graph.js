import { esc, ago, fit, activityLine, stateLabel, tokens, plain } from './format.js';

export const SESSION_W = 256, SESSION_H = 96, AGENT_W = 192, AGENT_H = 60, FOLD_H = 32, COL_GAP = 36, ROW_GAP = 8, SESSION_GAP = 24, GROUP_GAP = 36;
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

/** Tidy-ish tree layout: leaves take rows, parents centre on their children, depth sets the column. */
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

export function buildScene(snapshot, visibleProjects, { expanded, showExited }) {
  const groups = snapshot.projects.filter((p) => visibleProjects.has(p.id));
  const nodes = [], edges = [], labels = [];
  const multi = groups.length > 1;
  let y = 20;
  for (const p of groups) {
    const sessions = snapshot.sessions.filter((v) => v.cwd === p.id && (v.alive || v.pinned || showExited));
    if (!sessions.length) continue;
    if (multi || p.headline) { labels.push({ x: 20, y, name: p.name, headline: p.headline, n: sessions.length, state: p.state }); y += 28; }
    sessions.sort((a, b) => RANK[a.state] - RANK[b.state] || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    for (const v of sessions) {
      const root = { kind: 'session', id: v.id, sessionId: v.id, data: v, w: SESSION_W, h: SESSION_H, children: agentTree(v, expanded) };
      const bottom = layoutTree(root, 20, y);
      const walk = (n, parent) => {
        nodes.push(n);
        if (parent) edges.push({ from: parent, to: n, state: n.kind === 'agent' ? n.data.state : 'folded' });
        for (const c of n.children) walk(c, n);
      };
      walk(root, null);
      y = bottom + SESSION_GAP;
    }
    if (multi) y += GROUP_GAP - SESSION_GAP;
  }
  return { nodes, edges, labels, width: Math.max(300, ...nodes.map((n) => n.x + n.w + 20)), height: y + 20 };
}

function edgePath(e) {
  const x1 = e.from.x + e.from.w, y1 = e.from.y + e.from.h / 2, x2 = e.to.x, y2 = e.to.y + e.to.h / 2, c = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}

/** State glyph drawn at (x, y) centre: spinner, ?, ◆, ✓, hollow dot, dashed dot. */
function glyph(state, x, y) {
  const cls = `state-${state}`;
  switch (state) {
    case 'working': case 'running': return `<path class="arc" d="M${x - 4},${y} a4,4 0 1 1 4,4"></path>`;
    case 'question': return `<circle class="${cls}" cx="${x}" cy="${y}" r="5.5"></circle><text x="${x}" y="${y + 3.5}" text-anchor="middle" class="glyph" fill="#16120A" style="fill:#16120A">?</text>`;
    case 'permission': return `<path class="${cls}" d="M${x},${y - 5.5} L${x + 5.5},${y} L${x},${y + 5.5} L${x - 5.5},${y} Z"></path>`;
    case 'done': return `<path d="M${x - 4.5},${y} l3,3 l6,-6" fill="none" stroke="var(--ready)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>`;
    case 'exited': return `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="var(--exited)" stroke-width="1.4" stroke-dasharray="2 2"></circle>`;
    default: return `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="var(--idle)" stroke-width="1.4"></circle>`;
  }
}

function contextBar(v, x, y, w) {
  if (!v.contextTokens) return '';
  const pct = Math.min(1, v.contextTokens / contextWindow(v.contextTokens));
  return `<rect class="ctx-bar" x="${x}" y="${y - 2}" width="${w}" height="4" rx="2"></rect><rect class="ctx-fill ${pct > 0.8 ? 'warn' : ''}" x="${x}" y="${y - 2}" width="${Math.max(2, w * pct)}" height="4" rx="2"></rect><text class="mono" x="${x + w + 5}" y="${y + 3.5}">${Math.round(pct * 100)}%</text>`;
}

function sessionNode(n, { selected, changed, now }) {
  const v = n.data, blocking = v.state === 'question' || v.state === 'permission';
  const title = fit(v.title, n.w - 24, 13);
  const act = fit(v.state === 'done' && v.summary?.headline ? v.summary.headline : plain(activityLine(v)), n.w - 24, 12);
  const since = v.stateSince ? ago(v.stateSince, now) : '';
  const nAgents = v.agents.length, live = v.runningAgents;
  const fy = n.h - 14;
  return `<g class="node session ${v.state} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(v.id)}" tabindex="0" role="button" aria-label="${esc(v.title)}, ${esc(stateLabel(v.state))}">
    ${blocking ? `<rect class="ring" x="-3" y="-3" width="${n.w + 6}" height="${n.h + 6}"></rect>` : v.state === 'done' ? `<rect class="ring ready" x="-2" y="-2" width="${n.w + 4}" height="${n.h + 4}"></rect>` : ''}
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}"></rect>
    <text class="title" x="14" y="22">${esc(title)}</text>
    <text class="sub" x="14" y="41">${esc(act)}</text>
    ${glyph(v.state, 20, fy)}
    <text class="foot state-${v.state}" x="31" y="${fy + 4}">${esc(stateLabel(v.state))}${since ? ` · ${since}` : ''}</text>
    ${contextBar(v, 136, fy, 36)}
    ${nAgents ? `<text class="mono" x="${n.w - 12}" y="${fy + 4}" text-anchor="end" fill="${live ? 'var(--working)' : ''}">⑂ ${live ? `${live}/` : ''}${nAgents}</text>` : ''}
  </g>`;
}

function agentNode(n, { selected, changed, now }) {
  const a = n.data;
  const title = fit(a.description || a.type, n.w - 22, 12.5);
  const line = a.state === 'running' ? (a.activity?.kind === 'tool' ? `${a.activity.tool}: ${a.activity.label || ''}` : a.activity?.label || 'Running')
    : a.state === 'done' ? `finished${a.endedAt ? ' ' + ago(a.endedAt, now) + ' ago' : ''}` : 'ended with session';
  const kids = a.children ?? 0;
  const foot = [String(a.type).split(':').pop(), a.toolCalls ? `${a.toolCalls} tool${a.toolCalls === 1 ? '' : 's'}` : null, a.isFork ? 'fork' : null].filter(Boolean).join(' · ');
  const fy = n.h - 11;
  return `<g class="node agent ${a.state} ${selected ? 'selected' : ''} ${changed ? 'changed' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(n.sessionId)}" data-agent="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.description || a.type)}, ${esc(stateLabel(a.state))}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="3" height="${n.h}"></rect>
    <text class="title" x="12" y="19">${esc(title)}</text>
    <text class="sub" x="12" y="34">${esc(fit(line, n.w - 22, 11.5))}</text>
    ${glyph(a.state, 17, fy - 1)}
    <text class="mono" x="27" y="${fy + 3}">${esc(fit(foot, n.w - 40 - (kids ? 24 : 0), 11))}</text>
    ${kids ? `<text class="mono" x="${n.w - 10}" y="${fy + 3}" text-anchor="end">⑂ ${kids}</text>` : ''}
  </g>`;
}

function moreNode(n) {
  return `<g class="node more" transform="translate(${n.x},${n.y})" data-more="${esc(n.id)}" tabindex="0" role="button">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <text x="12" y="20">${n.count} more finished · show</text>
  </g>`;
}

export function renderScene(scene, { selected, now, changed }) {
  const parts = [];
  for (const l of scene.labels) parts.push(`<text class="group-label" x="${l.x}" y="${l.y + 14}"><tspan class="n">${esc(l.name)}</tspan>${l.headline ? `<tspan class="h" dx="10">${esc(fit(l.headline, 520, 12))}</tspan>` : ''}${l.n > 1 ? `<tspan class="c" dx="10">${l.n} sessions</tspan>` : ''}</text>`);
  for (const e of scene.edges) parts.push(`<path class="edge ${e.state}" d="${edgePath(e)}"></path>`);
  const kidCount = new Map();
  for (const n of scene.nodes) if (n.kind === 'agent' && n.data.parentAgentId) kidCount.set(n.data.parentAgentId, (kidCount.get(n.data.parentAgentId) ?? 0) + 1);
  for (const n of scene.nodes) {
    if (n.kind === 'session') parts.push(sessionNode(n, { selected: selected?.sessionId === n.id && !selected?.agentId, changed: changed.has(n.id), now }));
    else if (n.kind === 'agent') { n.data.children = n.data.children ?? kidCount.get(n.id) ?? 0; parts.push(agentNode(n, { selected: selected?.agentId === n.id, changed: changed.has(n.id), now })); }
    else parts.push(moreNode(n));
  }
  return parts.join('\n');
}
