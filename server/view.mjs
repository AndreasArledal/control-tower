import { basename } from 'node:path';
import { resolveState, resolveAgentState } from './model.mjs';

/**
 * Pure view builders over the store's records: what the page renders. Nothing here mutates the store;
 * everything is a function of the records, the seen map, the summaries and the clock.
 */
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

/** Which agent (or null for the main transcript) issued a given tool_use id. */
export function agentOwningTool(s, toolUseId) {
  if (!toolUseId) return null;
  if (s.model.toolUseIds.has(toolUseId)) return null;
  for (const a of s.agents.values()) if (a.model.toolUseIds.has(toolUseId)) return a.id;
  return null;
}

export function agentView(store, s, a) {
  const toolUseId = a.meta.toolUseId ?? null;
  const parentAgentId = agentOwningTool(s, toolUseId);
  const parentModel = parentAgentId ? s.agents.get(parentAgentId)?.model : s.model;
  // a background agent's tool_use resolves immediately with "launched", so only a foreground result means finished
  const background = a.meta.requestShape === 'background';
  const parentHasResult = !background && Boolean(toolUseId && parentModel?.resultIds.has(toolUseId));
  const stopped = a.state === 'done' || s.hooks.stoppedAgents.has(a.id) || Boolean(parentModel?.agentNotices.has(a.id));
  const state = resolveAgentState({ model: a.model, parentHasResult, stopped, sessionAlive: s.alive });
  if (state === 'done') a.endedAt = Math.max(a.endedAt ?? 0, a.model.lastActivityAt ?? 0) || store._now();
  const spawn = parentModel?.agentSpawns.get(toolUseId);
  const act = a.model.activity();
  return {
    id: a.id, parentAgentId, toolUseId,
    description: a.meta.description || spawn?.description || a.model.title,
    type: a.meta.agentType || spawn?.type || 'agent', isFork: Boolean(a.meta.isFork), depth: a.meta.spawnDepth ?? 1,
    background: a.meta.requestShape === 'background', model: a.model.model || (a.meta.model && a.meta.model !== 'inherit' ? a.meta.model : null), effort: a.model.effort,
    state, activity: state === 'running' ? act : { kind: 'idle', label: '', since: a.endedAt },
    startedAt: a.startedAt, endedAt: a.endedAt, lastActivityAt: a.model.lastActivityAt,
    toolCalls: a.model.toolCalls, turns: a.model.turns, contextTokens: a.model.contextTokens, errors: a.model.errors,
    lastText: clip(a.model.lastAssistantText, 300), entryCount: a.entries.length,
  };
}

/** One state for a session from everything we know; shared by the view and the change fingerprint. */
export function resolve(s, now) {
  const m = s.model;
  let attention = s.hooks.attention && s.alive ? s.hooks.attention : null;
  // a notification without a tool name can arrive while the transcript already shows the pending question
  if (attention?.kind === 'permission' && m.pendingQuestion) attention = { ...attention, kind: 'question', message: m.pendingQuestion.text };
  const doneAt = s.hooks.doneAt ?? s.flipDoneAt;
  return resolveState({ alive: s.alive, busy: s.busy, doneAt, lastPromptAt: Math.max(m.lastPromptAt ?? 0, s.hooks.lastPromptAt ?? 0) || null, attention, pendingQuestion: m.pendingQuestion, lastActivityAt: m.lastActivityAt, now });
}

export function sessionView(store, s) {
  const now = store._now();
  const m = s.model;
  const r = resolve(s, now);
  const agents = [...s.agents.values()].map((a) => agentView(store, s, a)).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const act = r.state === 'working' ? m.activity() : (r.state === 'question' ? { kind: 'question', label: r.message ?? '', since: r.since } : { kind: 'idle', label: '', since: r.since });
  // the summarizer's verdict: the last reply left a question or decision with the user, so this session is not finished even if it looks idle
  const judgedWaiting = s.alive && (r.state === 'idle' || r.state === 'done') && s.summary?.status === 'waiting_for_user' && (s.summary.at ?? 0) >= (m.lastAssistantAt ?? 0) - 1000;
  // a follow-up is a soft signal: once the user has looked at it, it stops counting (blocking prompts never stop counting)
  const followUpSince = m.lastAssistantAt ?? s.summary?.at ?? null;
  const followUp = judgedWaiting ? { reason: s.summary.waitingFor || s.summary.next || 'Waiting for your reply', since: followUpSince, seen: (store.seen.get(s.id) ?? -1) >= (followUpSince ?? 0) } : null;
  return {
    id: s.id, pid: s.pid, name: s.name, title: m.title, cwd: s.cwd, projectId: s.cwd, alive: s.alive, kind: s.kind,
    state: r.state, stateSince: r.since ?? null, stateMessage: r.message ?? null, needsYou: r.state === 'question' || r.state === 'permission' || Boolean(followUp && !followUp.seen), followUp,
    activity: act, lastPrompt: clip(m.lastPrompt, 400), lastPromptAt: m.lastPromptAt, firstPrompt: clip(m.firstPrompt, 400),
    lastAssistantText: clip(s.hooks.lastMessage && r.state === 'done' ? s.hooks.lastMessage : m.lastAssistantText, 600), lastAssistantAt: m.lastAssistantAt,
    lastActivityAt: m.lastActivityAt, startedAt: s.startedAt ?? m.firstActivityAt, turns: m.turns, toolCalls: m.toolCalls, errors: m.errors,
    contextTokens: m.contextTokens, outputTokens: m.outputTokens, model: m.model, effort: m.effort, thinkingChars: m.thinkingChars, entryCount: s.entries.length,
    hooksSeen: s.hooksSeen, pinned: s.pinned, summary: s.summary, summaryError: s.summaryError, summarizing: Boolean(store.summarizer?.isQueued(s.id)),
    agents, runningAgents: agents.filter((a) => a.state === 'running').length,
  };
}

export function buildSnapshot(store) {
  const sessions = [...store.sessions.values()].filter((s) => s.cwd).map((s) => sessionView(store, s))
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  const byProject = new Map();
  for (const v of sessions) {
    let p = byProject.get(v.cwd);
    if (!p) { p = { id: v.cwd, path: v.cwd, name: basename(v.cwd) || v.cwd, sessions: [], counts: {}, live: 0, needsYou: 0, lastActivityAt: 0, state: 'idle' }; byProject.set(v.cwd, p); }
    p.sessions.push(v.id);
    p.counts[v.state] = (p.counts[v.state] ?? 0) + 1;
    if (v.alive) p.live++;
    if (v.needsYou) p.needsYou++;
    p.lastActivityAt = Math.max(p.lastActivityAt, v.lastActivityAt ?? 0);
  }
  const rank = { question: 5, permission: 5, done: 4, working: 3, idle: 2, exited: 1 };
  for (const p of byProject.values()) {
    p.state = Object.keys(p.counts).sort((a, b) => rank[b] - rank[a])[0] ?? 'idle';
    const mine = sessions.filter((v) => v.cwd === p.id);
    p.runningAgents = mine.reduce((n, v) => n + v.runningAgents, 0);
    const ps = store.projectSummaries.get(p.id);
    p.headline = ps?.headline || fallbackHeadline(mine);
    p.headlineSource = ps ? 'summary' : 'titles';
    // active: something is happening, or someone touched it recently
    p.active = mine.some((v) => v.alive && (v.state !== 'idle' || (v.followUp && !v.followUp.seen) || (v.lastActivityAt && store._now() - v.lastActivityAt < ACTIVE_WINDOW_MS)));
  }
  const projects = [...byProject.values()].sort((a, b) => (b.needsYou - a.needsYou) || (b.live - a.live) || (b.lastActivityAt - a.lastActivityAt));
  const attention = sessions.filter((v) => v.needsYou || v.followUp).sort((a, b) => (b.stateSince ?? 0) - (a.stateSince ?? 0))
    .map((v) => { const blocking = v.state === 'question' || v.state === 'permission'; const since = blocking ? v.stateSince : v.followUp.since; return { sessionId: v.id, projectName: basename(v.cwd), sessionName: v.name, title: v.title, state: blocking ? v.state : 'followup', since, message: blocking ? v.stateMessage : v.followUp.reason, seen: (store.seen.get(v.id) ?? -1) >= (since ?? 0) }; });
  const unseen = attention.filter((a) => !a.seen).length;
  return {
    generatedAt: store._now(), hooksSeen: store.hooksSeen, hooksInstalled: store.hooksInstalled(),
    summaries: { mode: store.settings.summaries, available: store.summarizer ? store.summarizer.available : false, lastError: store.summarizer?.lastError ?? null, spend: store.summarizer?.spend ?? null, refreshMinutes: store.settings.summaryRefreshMinutes },
    projects, sessions, attention, unseen,
  };
}

/** Without a model: one title, or "N sessions: a, b". */
export function fallbackHeadline(sessions) {
  const live = sessions.filter((v) => v.alive);
  const pick = (live.length ? live : sessions).slice(0, 3);
  if (!pick.length) return '';
  if (pick.length === 1) return pick[0].title;
  return pick.map((v) => clip(v.title, 40)).join(' · ');
}
