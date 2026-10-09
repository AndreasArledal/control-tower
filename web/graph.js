import { esc, ago, fit, activityLine, stateLabel, tokens, shortModelName } from './format.js';

export const SESSION_W = 300, SESSION_H = 80, AGENT_W = 236, AGENT_H = 58, COL_GAP = 64, ROW_GAP = 14, SESSION_GAP = 36, GROUP_GAP = 56;
const RECENT_FINISHED = 4;

/**
 * Build the node tree for one session: running agents always, the most recently finished few, the rest folded.
 */
function agentTree(session, expanded) {
  const byParent = new Map();
  for (const a of session.agents) {
    const k = a.parentAgentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  const build = (parentId, depth) => {
    const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const running = kids.filter((a) => a.state === 'running');
    const finished = kids.filter((a) => a.state !== 'running');
    let shown = running.concat(finished);
    let folded = 0;
    if (!expanded.has(session.id + ':' + (parentId ?? 'root')) && finished.length > RECENT_FINISHED) {
      const keep = finished.slice(-RECENT_FINISHED);
      folded = finished.length - keep.length;
      shown = running.concat(keep);
    }
    shown.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const nodes = shown.map((a) => ({ kind: 'agent', id: a.id, data: a, w: AGENT_W, h: AGENT_H, children: build(a.id, depth + 1) }));
    if (folded) nodes.unshift({ kind: 'more', id: `${session.id}:${parentId ?? 'root'}`, count: folded, w: AGENT_W, h: 34, children: [] });
    return nodes;
  };
  return build(null, 1);
}

/** Tidy-ish tree layout: leaves get rows, parents centre on their children, columns by depth. */
function layoutTree(root, x0, y0) {
  let cursor = y0;
  const place = (n, depth, x) => {
    n.x = x;
    if (!n.children.length) { n.y = cursor; cursor += n.h + ROW_GAP; return; }
    const childX = x + n.w + COL_GAP;
    for (const c of n.children) place(c, depth + 1, childX);
    const first = n.children[0], last = n.children[n.children.length - 1];
    const mid = (first.y + last.y + last.h) / 2;
    n.y = Math.max(mid - n.h / 2, y0);
    cursor = Math.max(cursor, n.y + n.h + ROW_GAP);
  };
  place(root, 0, x0);
  return cursor - ROW_GAP;
}

export function buildScene(snapshot, selectedProjects, { expanded, showExited, openedHistory }) {
  const groups = snapshot.projects.filter((p) => selectedProjects.has(p.id));
  const nodes = [], edges = [], labels = [];
  let y = 24;
  const multi = groups.length > 1;
  for (const p of groups) {
    const sessions = snapshot.sessions.filter((v) => v.cwd === p.id && (v.alive || showExited || openedHistory.has(v.id)));
    if (!sessions.length) continue;
    if (multi) { labels.push({ x: 24, y: y + 4, name: p.name, path: p.path, n: sessions.length }); y += 28; }
    const rank = { question: 0, permission: 0, done: 1, working: 2, idle: 3, exited: 4 };
    sessions.sort((a, b) => rank[a.state] - rank[b.state] || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    for (const v of sessions) {
      const root = { kind: 'session', id: v.id, data: v, w: SESSION_W, h: SESSION_H, children: agentTree(v, expanded) };
      const bottom = layoutTree(root, 24, y);
      const walk = (n, parent) => {
        nodes.push(n);
        if (parent) edges.push({ from: parent, to: n, state: n.kind === 'agent' ? n.data.state : 'folded' });
        for (const c of n.children) walk(c, n);
      };
      walk(root, null);
      y = bottom + SESSION_GAP;
    }
    y += multi ? GROUP_GAP - SESSION_GAP : 0;
  }
  const width = Math.max(600, ...nodes.map((n) => n.x + n.w + 40));
  return { nodes, edges, labels, width, height: y + 24 };
}

function edgePath(e) {
  const x1 = e.from.x + e.from.w, y1 = e.from.y + e.from.h / 2;
  const x2 = e.to.x, y2 = e.to.y + e.to.h / 2;
  const c = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}

function sessionNode(n, selected, now) {
  const v = n.data;
  const title = fit(v.title, n.w - 26, 13);
  const name = v.name ? v.name : v.id.slice(0, 8);
  const act = fit(activityLine(v), n.w - 26, 12);
  const since = v.stateSince ? ago(v.stateSince, now) : '';
  const pct = v.contextTokens ? Math.min(1, v.contextTokens / contextWindow(v.contextTokens)) : 0;
  const barW = 44, nameW = Math.min(90, name.length * 6.6 + 4);
  const barX = n.w - 12 - nameW - 10 - barW;
  const by = n.h - 15;
  return `<g class="node session ${v.state} ${selected ? 'selected' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(v.id)}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}" rx="6"></rect>
    <text class="title" x="14" y="21">${esc(title)}</text>
    <text class="sub" x="14" y="40">${esc(act)}</text>
    <text class="state" x="14" y="${n.h - 11}">${esc(fit(stateLabel(v.state) + (since ? ` · ${since}` : ''), barX - 60, 11.5))}</text>
    ${v.contextTokens ? `<text class="mono" x="${barX - 5}" y="${n.h - 11}" text-anchor="end">${tokens(v.contextTokens)}</text><rect class="ctx-bar" x="${barX}" y="${by}" width="${barW}" height="3" rx="1.5"></rect><rect class="ctx-fill ${pct > 0.8 ? 'warn' : ''}" x="${barX}" y="${by}" width="${Math.max(2, barW * pct)}" height="3" rx="1.5"></rect>` : ''}
    <text class="mono" x="${n.w - 12}" y="${n.h - 11}" text-anchor="end">${esc(name)}</text>
  </g>`;
}

function agentNode(n, selected, now) {
  const a = n.data;
  const desc = fit(a.description || a.type, n.w - 26, 13);
  const line = a.state === 'running'
    ? (a.activity?.kind === 'tool' ? `${a.activity.tool}: ${a.activity.label || ''}` : a.activity?.label || 'Running')
    : a.state === 'done' ? `finished${a.endedAt ? ' · ' + ago(a.endedAt, now) : ''}` : 'ended with session';
  const meta = [String(a.type).split(':').pop(), a.toolCalls ? `${a.toolCalls} tool${a.toolCalls === 1 ? '' : 's'}` : null, a.background ? 'background' : null].filter(Boolean).join(' · ');
  return `<g class="node agent ${a.state} ${selected ? 'selected' : ''}" transform="translate(${n.x},${n.y})" data-session="${esc(a.sessionId)}" data-agent="${esc(a.id)}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <rect class="rail" width="4" height="${n.h}" rx="6"></rect>
    <text class="title" x="14" y="19">${esc(desc)}</text>
    <text class="sub" x="14" y="35">${esc(fit(line, n.w - 26, 12))}</text>
    <text class="mono" x="14" y="${n.h - 9}">${esc(fit(meta, n.w - 26, 11.5))}</text>
  </g>`;
}

function moreNode(n) {
  return `<g class="node more" transform="translate(${n.x},${n.y})" data-more="${esc(n.id)}">
    <rect class="box" width="${n.w}" height="${n.h}"></rect>
    <text x="14" y="22">${n.count} more finished agent${n.count === 1 ? '' : 's'} · show</text>
  </g>`;
}

export function renderScene(scene, { selected, now }) {
  const parts = [];
  for (const l of scene.labels) parts.push(`<text class="group-label" x="${l.x}" y="${l.y + 12}"><tspan class="n">${esc(l.name)}</tspan>  ${esc(l.path)}  ·  ${l.n} session${l.n === 1 ? '' : 's'}</text>`);
  for (const e of scene.edges) parts.push(`<path class="edge ${e.state}" d="${edgePath(e)}"></path>`);
  for (const n of scene.nodes) {
    if (n.kind === 'session') parts.push(sessionNode(n, selected?.sessionId === n.id && !selected?.agentId, now));
    else if (n.kind === 'agent') { n.data.sessionId = n.data.sessionId ?? findSession(scene, n); parts.push(agentNode(n, selected?.agentId === n.id, now)); }
    else parts.push(moreNode(n));
  }
  return parts.join('\n');
}

function findSession(scene, n) {
  for (const e of scene.edges) if (e.to === n) return e.from.kind === 'session' ? e.from.id : findSession(scene, e.from);
  return null;
}

/** Transcripts do not record the window size; anything past 190k must be running on a 1M window. */
export function contextWindow(used) { return used > 190_000 ? 1_000_000 : 200_000; }
