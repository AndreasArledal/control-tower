import { EventEmitter } from 'node:events';
import { readdir, readFile, stat, unlink, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readRegistry } from './registry.mjs';
import { TranscriptTailer } from './transcript.mjs';
import { SessionModel, resolveState, resolveAgentState } from './model.mjs';
import { normalizeHookEvent, applyHookEvent, emptyHookState } from './hook-events.mjs';
import { hasRadarHooks } from './hooks-install.mjs';
import { transcriptPathFor, projectsDir, radarDir } from './paths.mjs';
import { buildDigest } from './summarizer.mjs';

const ATTENTION = new Set(['question', 'permission', 'done']);
const EXITED_TTL_MS = 6 * 60 * 60 * 1000;
const SUMMARY_COOLDOWN_MS = 20_000;
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

const MAX_ENTRIES = 8000, KEEP_ENTRIES = 6000;

/** Append parsed entries to a record, stamping a stable seq and bounding memory for very long transcripts. */
function pushEntries(rec, fresh) {
  for (const e of fresh) { e.seq = rec.seq++; rec.model.ingest(e); rec.entries.push(e); }
  if (rec.entries.length > MAX_ENTRIES) rec.entries.splice(0, rec.entries.length - KEEP_ENTRIES);
}

class AgentRecord {
  constructor(id, path) {
    this.id = id; this.path = path; this.tailer = new TranscriptTailer(path); this.model = new SessionModel(); this.entries = []; this.seq = 0;
    this.meta = {}; this.parentAgentId = null; this.state = 'running'; this.endedAt = null; this.startedAt = null;
  }
}

class SessionRecord {
  constructor(id) {
    this.id = id; this.pid = null; this.cwd = null; this.name = null; this.startedAt = null; this.kind = null;
    this.alive = false; this.busy = false; this.prevBusy = null; this.flipDoneAt = null; this.lastSeenAliveAt = null;
    this.transcriptPath = null; this.tailer = null; this.model = new SessionModel(); this.entries = []; this.seq = 0;
    this.hooks = emptyHookState(); this.hooksSeen = false; this.attentionCount = null; this.agents = new Map(); this.agentsScanAt = 0;
    this.summary = null; this.summaryKey = null; this.summaryError = null; this.loaded = false; this.lastState = null;
    this.summarizedForState = null; this.pinned = false;
  }
}

/**
 * The in-memory picture of every Claude Code session on this machine. tick() pulls from the
 * registry, transcripts, subagent dirs and the hook spool; snapshot() is what the UI renders.
 */
export class RadarStore extends EventEmitter {
  constructor({ home, summarizer = null, settings = {} }) {
    super();
    this.home = home; this.summarizer = summarizer;
    this.settings = { summaries: 'auto', ...settings }; // auto | manual | off
    this.sessions = new Map();
    this.spoolDir = join(radarDir(home), 'events');
    this.stateFile = join(radarDir(home), 'state.json');
    this._now = () => Date.now();
    this._timer = null; this._version = ''; this.hooksSeen = false; this.ticking = false; this.lastTickAt = null;
  }

  async start({ intervalMs = 1000 } = {}) {
    await mkdir(this.spoolDir, { recursive: true });
    await this._loadState();
    try { await this.tick(); } catch (e) { this.emit('error', e); }
    this._timer = setInterval(() => this.tick().catch((e) => this.emit('error', e)), intervalMs);
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  hooksInstalled() {
    try { return hasRadarHooks(JSON.parse(require_sync(join(this.home, 'settings.json')))); } catch { return false; }
  }

  async tick() {
    if (this.ticking) return; this.ticking = true;
    try {
      await this._pollRegistry();
      await this._pollSpool();
      for (const s of this.sessions.values()) {
        await this._pollTranscript(s);
        if (s.alive || !s.loaded) await this._pollAgents(s);
      }
      this._expire();
      this._deriveAndNotify();
      this.lastTickAt = this._now();
    } finally { this.ticking = false; }
  }

  async _pollRegistry() {
    const list = await readRegistry(this.home);
    const seen = new Set();
    for (const r of list) {
      if (r.cwd && r.cwd.startsWith(radarDir(this.home))) continue; // our own summarizer runs
      seen.add(r.sessionId);
      const s = this._session(r.sessionId);
      s.pid = r.pid; s.cwd = r.cwd; s.name = r.name ?? s.name; s.startedAt = r.startedAt ?? s.startedAt; s.kind = r.kind;
      s.alive = r.alive;
      if (r.alive) s.lastSeenAliveAt = this._now();
      if (s.prevBusy === true && !r.busy && r.alive) s.flipDoneAt = this._now();
      if (r.busy) s.flipDoneAt = null;
      s.prevBusy = r.busy; s.busy = r.busy;
      if (!s.transcriptPath) s.transcriptPath = transcriptPathFor(this.home, r.cwd, r.sessionId);
    }
    for (const s of this.sessions.values()) if (!seen.has(s.id) && s.pid) s.alive = false;
  }

  _session(id) {
    let s = this.sessions.get(id);
    if (!s) { s = new SessionRecord(id); this.sessions.set(id, s); }
    return s;
  }

  async _pollSpool() {
    let names = [];
    try { names = (await readdir(this.spoolDir)).filter((f) => f.endsWith('.json')); } catch { return; }
    if (!names.length) return;
    // several events can land between two ticks; apply them in the order they were written
    const files = [];
    for (const f of names) {
      const p = join(this.spoolDir, f);
      let raw = null, at = this._now();
      try { const st = await stat(p); at = Math.min(at, Math.round(st.mtimeMs)); raw = JSON.parse(await readFile(p, 'utf8')); } catch { /* skip malformed */ }
      try { await unlink(p); } catch { /* ignore */ }
      files.push({ f, raw, at });
    }
    files.sort((a, b) => a.at - b.at || (a.f < b.f ? -1 : 1));
    for (const { raw, at } of files) {
      const e = raw && normalizeHookEvent(raw, at);
      if (!e || !e.sessionId) continue;
      if (e.cwd && e.cwd.startsWith(radarDir(this.home))) continue;
      this.hooksSeen = true;
      const s = this._session(e.sessionId);
      s.hooksSeen = true;
      if (!s.cwd && e.cwd) s.cwd = e.cwd;
      if (!s.transcriptPath && e.transcriptPath) s.transcriptPath = e.transcriptPath;
      if (e.name === 'SessionStart' && !s.pid) s.alive = true;
      s.hooks = applyHookEvent(s.hooks, e);
      if (s.hooks.attention && s.attentionCount == null) s.attentionCount = s.model.count;
      if (!s.hooks.attention) s.attentionCount = null;
      if (e.name === 'SessionEnd') s.alive = false;
      if (e.name === 'Stop' || e.name === 'UserPromptSubmit') s.flipDoneAt = null;
      if (e.name === 'SubagentStart' && e.agentId) {
        const a = s.agents.get(e.agentId);
        if (a) { a.startedAt ??= e.at; a.meta.agentType ??= e.agentType; }
      }
      if (e.name === 'SubagentStop' && e.agentId) {
        const a = s.agents.get(e.agentId);
        if (a) { a.state = 'done'; a.endedAt ??= e.at; }
      }
    }
  }

  async _pollTranscript(s) {
    if (!s.transcriptPath) return;
    if (!s.tailer) s.tailer = new TranscriptTailer(s.transcriptPath);
    const fresh = await s.tailer.poll();
    pushEntries(s, fresh);
    if (!s.loaded && (existsSync(s.transcriptPath) || !s.alive)) s.loaded = true;
    if (fresh.length) {
      // a permission prompt blocks everything, so any new line after it means it was answered
      if (s.hooks.attention?.kind === 'permission' && s.attentionCount != null && s.model.count > s.attentionCount + 0) {
        const lastTs = s.entries[s.entries.length - 1].ts;
        if (lastTs > s.hooks.attention.at) { s.hooks = { ...s.hooks, attention: null }; s.attentionCount = null; }
      }
    }
  }

  async _pollAgents(s) {
    if (!s.transcriptPath) return;
    const now = this._now();
    if (now - s.agentsScanAt < 2000 && s.loaded) { for (const a of s.agents.values()) await this._pollAgent(s, a); return; }
    s.agentsScanAt = now;
    const dir = join(s.transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
    let files = [];
    try { files = await readdir(dir); } catch { return; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      if (!s.agents.has(id)) {
        const a = new AgentRecord(id, join(dir, f));
        try { a.meta = JSON.parse(await readFile(join(dir, `agent-${id}.meta.json`), 'utf8')); } catch { a.meta = {}; }
        s.agents.set(id, a);
      }
    }
    for (const a of s.agents.values()) {
      if (!Object.keys(a.meta).length) { try { a.meta = JSON.parse(await readFile(join(dir, `agent-${a.id}.meta.json`), 'utf8')); } catch { /* not yet */ } }
      await this._pollAgent(s, a);
    }
  }

  async _pollAgent(s, a) {
    const fresh = await a.tailer.poll();
    pushEntries(a, fresh);
    if (a.startedAt == null && a.model.firstActivityAt) a.startedAt = a.model.firstActivityAt;
  }

  _expire() {
    const now = this._now();
    for (const [id, s] of this.sessions) {
      if (!s.alive && s.lastSeenAliveAt && now - s.lastSeenAliveAt > EXITED_TTL_MS) this.sessions.delete(id);
      if (!s.alive && !s.lastSeenAliveAt && !s.hooksSeen && !s.pid) this.sessions.delete(id);
    }
  }

  /** Which agent (or null for the main transcript) issued a given tool_use id. */
  _agentOwningTool(s, toolUseId) {
    if (!toolUseId) return null;
    if (s.model.toolUseIds.has(toolUseId)) return null;
    for (const a of s.agents.values()) if (a.model.toolUseIds.has(toolUseId)) return a.id;
    return null;
  }

  _agentView(s, a) {
    const toolUseId = a.meta.toolUseId ?? null;
    const parentAgentId = this._agentOwningTool(s, toolUseId);
    const parentModel = parentAgentId ? s.agents.get(parentAgentId)?.model : s.model;
    // a background agent's tool_use resolves immediately with "launched", so only a foreground result means finished
    const background = a.meta.requestShape === 'background';
    const parentHasResult = !background && Boolean(toolUseId && parentModel?.resultIds.has(toolUseId));
    const stopped = a.state === 'done' || s.hooks.stoppedAgents.has(a.id);
    const state = resolveAgentState({ model: a.model, parentHasResult, stopped, sessionAlive: s.alive });
    if (state === 'done') a.endedAt = Math.max(a.endedAt ?? 0, a.model.lastActivityAt ?? 0) || this._now();
    const spawn = parentModel?.agentSpawns.get(toolUseId);
    const act = a.model.activity();
    return {
      id: a.id, parentAgentId, toolUseId,
      description: a.meta.description || spawn?.description || a.model.title,
      type: a.meta.agentType || spawn?.type || 'agent', isFork: Boolean(a.meta.isFork), depth: a.meta.spawnDepth ?? 1,
      background: a.meta.requestShape === 'background', model: a.model.model || (a.meta.model && a.meta.model !== 'inherit' ? a.meta.model : null),
      state, activity: state === 'running' ? act : { kind: 'idle', label: '', since: a.endedAt },
      startedAt: a.startedAt, endedAt: a.endedAt, lastActivityAt: a.model.lastActivityAt,
      toolCalls: a.model.toolCalls, turns: a.model.turns, contextTokens: a.model.contextTokens, errors: a.model.errors,
      lastText: clip(a.model.lastAssistantText, 300), entryCount: a.entries.length,
    };
  }

  _sessionView(s) {
    const now = this._now();
    const m = s.model;
    const attention = s.hooks.attention && s.alive ? s.hooks.attention : null;
    const doneAt = s.hooks.doneAt ?? s.flipDoneAt;
    const r = resolveState({ alive: s.alive, busy: s.busy, doneAt, lastPromptAt: Math.max(m.lastPromptAt ?? 0, s.hooks.lastPromptAt ?? 0) || null, attention, pendingQuestion: m.pendingQuestion, lastActivityAt: m.lastActivityAt, now });
    const agents = [...s.agents.values()].map((a) => this._agentView(s, a)).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const act = r.state === 'working' ? m.activity() : (r.state === 'question' ? { kind: 'question', label: r.message ?? '', since: r.since } : { kind: 'idle', label: '', since: r.since });
    return {
      id: s.id, pid: s.pid, name: s.name, title: m.title, cwd: s.cwd, projectId: s.cwd, alive: s.alive, kind: s.kind,
      state: r.state, stateSince: r.since ?? null, stateMessage: r.message ?? null, needsYou: ATTENTION.has(r.state),
      activity: act, lastPrompt: clip(m.lastPrompt, 400), lastPromptAt: m.lastPromptAt, firstPrompt: clip(m.firstPrompt, 400),
      lastAssistantText: clip(s.hooks.lastMessage && r.state === 'done' ? s.hooks.lastMessage : m.lastAssistantText, 600), lastAssistantAt: m.lastAssistantAt,
      lastActivityAt: m.lastActivityAt, startedAt: s.startedAt ?? m.firstActivityAt, turns: m.turns, toolCalls: m.toolCalls, errors: m.errors,
      contextTokens: m.contextTokens, outputTokens: m.outputTokens, model: m.model, thinkingChars: m.thinkingChars, entryCount: s.entries.length,
      hooksSeen: s.hooksSeen, pinned: s.pinned, summary: s.summary, summaryError: s.summaryError, summarizing: Boolean(this.summarizer?.isQueued(s.id)),
      agents, runningAgents: agents.filter((a) => a.state === 'running').length,
    };
  }

  snapshot() {
    const sessions = [...this.sessions.values()].filter((s) => s.cwd).map((s) => this._sessionView(s))
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
      p.runningAgents = sessions.filter((v) => v.cwd === p.id).reduce((n, v) => n + v.runningAgents, 0);
    }
    const projects = [...byProject.values()].sort((a, b) => (b.needsYou - a.needsYou) || (b.live - a.live) || (b.lastActivityAt - a.lastActivityAt));
    const attention = sessions.filter((v) => v.needsYou).sort((a, b) => (b.stateSince ?? 0) - (a.stateSince ?? 0))
      .map((v) => ({ sessionId: v.id, projectName: basename(v.cwd), sessionName: v.name, title: v.title, state: v.state, since: v.stateSince, message: v.stateMessage ?? (v.state === 'done' ? clip(v.lastAssistantText, 200) : null) }));
    return {
      generatedAt: this._now(), hooksSeen: this.hooksSeen, hooksInstalled: this.hooksInstalled(),
      summaries: { mode: this.settings.summaries, available: this.summarizer ? this.summarizer.available : false, lastError: this.summarizer?.lastError ?? null },
      projects, sessions, attention,
    };
  }

  _deriveAndNotify() {
    const snap = this.snapshot();
    for (const v of snap.sessions) {
      const s = this.sessions.get(v.id);
      const prev = s.lastState; s.lastState = v.state;
      if (prev && prev !== v.state) this.emit('transition', { session: v, from: prev, to: v.state });
      this._maybeSummarize(s, v, prev);
    }
    const version = JSON.stringify(snap.sessions.map((v) => [v.id, v.state, v.entryCount, v.activity.label, v.summary?.at, v.summarizing, v.agents.map((a) => [a.id, a.state, a.entryCount])]));
    if (version !== this._version) { this._version = version; this.emit('change', snap); }
  }

  _maybeSummarize(s, v, prevState) {
    if (!this.summarizer || this.settings.summaries !== 'auto' || !this.summarizer.available) return;
    if (!v.alive || s.model.turns === 0) return;
    const enteredAttention = prevState && prevState !== v.state && ATTENTION.has(v.state);
    const firstSight = prevState == null && s.loaded;
    if (!enteredAttention && !firstSight) return;
    this.requestSummary(s.id, { force: false });
  }

  summaryKey(s) { return `${s.id}:${s.model.count}:${s.lastState}`; }

  requestSummary(id, { force = false } = {}) {
    const s = this.sessions.get(id);
    if (!s || !this.summarizer) return false;
    const last = this.summarizer.lastRunAt.get(id) ?? 0;
    if (!force && this._now() - last < SUMMARY_COOLDOWN_MS) return false;
    if (!force && s.summary && s.summaryKey === this.summaryKey(s)) return false;
    const key = this.summaryKey(s);
    const cached = this.summarizer.cached(key);
    if (cached && !force) { s.summary = cached; s.summaryKey = key; return false; }
    return this.summarizer.request(id, key, () => buildDigest(this._sessionView(s), s.entries), { force });
  }

  onSummary(id, summary, key) {
    const s = this.sessions.get(id); if (!s) return;
    s.summary = summary; s.summaryKey = key; s.summaryError = null; this._version = ''; this.emit('change', this.snapshot());
  }

  onSummaryError(id, err) {
    const s = this.sessions.get(id); if (!s) return;
    s.summaryError = err.message; this._version = ''; this.emit('change', this.snapshot());
  }

  setSettings(patch) { this.settings = { ...this.settings, ...patch }; this._saveState(); this._version = ''; }

  timeline(sessionId, agentId, { after = -1, limit = 200, before = null } = {}) {
    const s = this.sessions.get(sessionId); if (!s) return null;
    const rec = agentId ? s.agents.get(agentId) : s;
    if (!rec) return null;
    const all = rec.entries;
    let entries;
    if (before != null) { const end = all.findIndex((e) => e.seq >= before); const stop = end < 0 ? all.length : end; entries = all.slice(Math.max(0, stop - limit), stop); }
    else if (after < 0) entries = all.slice(Math.max(0, all.length - limit));
    else { const start = all.findIndex((e) => e.seq > after); entries = start < 0 ? [] : all.slice(start, start + limit); }
    return { total: rec.seq, entries, hasMore: entries.length ? entries[0].seq > (all[0]?.seq ?? 0) : false };
  }

  /** Recent transcripts for a project dir, for browsing sessions that are no longer running. */
  async history(cwd, limit = 20) {
    const dir = join(projectsDir(this.home), cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
    const out = [];
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      let st; try { st = await stat(join(dir, f)); } catch { continue; }
      out.push({ id, modified: st.mtimeMs, size: st.size, live: this.sessions.get(id)?.alive ?? false });
    }
    out.sort((a, b) => b.modified - a.modified);
    const top = out.slice(0, limit);
    for (const h of top) {
      const known = this.sessions.get(h.id);
      if (known) { h.title = known.model.title; h.turns = known.model.turns; continue; }
      const m = await peekTranscript(join(dir, `${h.id}.jsonl`));
      Object.assign(h, m);
    }
    return top;
  }

  /** Load a finished session on demand so its timeline can be read. */
  async openHistory(cwd, id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const s = this._session(id);
    s.cwd = cwd; s.transcriptPath = transcriptPathFor(this.home, cwd, id); s.alive = false; s.lastSeenAliveAt = this._now(); s.pinned = true;
    await this._pollTranscript(s); await this._pollAgents(s); s.loaded = true;
    this._version = '';
    return s;
  }

  async _loadState() {
    try {
      const st = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (st.settings) this.settings = { ...this.settings, ...st.settings };
    } catch { /* first run */ }
  }

  async _saveState() {
    try { await mkdir(radarDir(this.home), { recursive: true }); await writeFile(this.stateFile, JSON.stringify({ settings: this.settings })); } catch { /* best effort */ }
  }
}

import { readFileSync } from 'node:fs';
function require_sync(p) { return readFileSync(p, 'utf8'); }

async function peekTranscript(path) {
  const { parseLine } = await import('./transcript.mjs');
  const m = new SessionModel();
  try {
    const fh = await (await import('node:fs/promises')).open(path, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const lines = buf.toString('utf8', 0, bytesRead).split('\n');
      lines.pop();
      lines.forEach((raw, i) => { for (const e of parseLine(raw, i)) m.ingest(e); });
      const st = await stat(path);
      if (st.size > buf.length) { // titles land at the end; peek the tail too
        const tail = Buffer.alloc(64 * 1024);
        const r = await fh.read(tail, 0, tail.length, st.size - tail.length);
        for (const raw of tail.toString('utf8', 0, r.bytesRead).split('\n')) { if (raw.includes('"ai-title"')) for (const e of parseLine(raw, 0)) if (e.kind === 'title') m.ingest(e); }
      }
    } finally { await fh.close(); }
  } catch { /* unreadable */ }
  return { title: m.title, firstPrompt: clip(m.firstPrompt, 200), turns: m.turns, created: m.firstActivityAt };
}
