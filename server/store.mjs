import { EventEmitter } from 'node:events';
import { readdir, readFile, stat, unlink, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from './registry.mjs';
import { TranscriptTailer } from './transcript.mjs';
import { SessionModel } from './model.mjs';
import { normalizeHookEvent, applyHookEvent, emptyHookState } from './hook-events.mjs';
import { hasTowerHooks } from './hooks-install.mjs';
import { transcriptPathFor, towerDir } from './paths.mjs';
import { buildDigest, buildProjectDigest } from './summarizer.mjs';
import { focusProcess } from './focus.mjs';
import { agentOwningTool, agentView, resolve, sessionView, buildSnapshot } from './view.mjs';
import { history, openHistory } from './history.mjs';

const ATTENTION = new Set(['question', 'permission', 'done']);
const EXITED_TTL_MS = 6 * 60 * 60 * 1000;
const SUMMARY_COOLDOWN_MS = 20_000;
const DEFAULT_REFRESH_MIN = 4;

const MAX_ENTRIES = 8000, KEEP_ENTRIES = 6000;
const SEEN_MAX = 200;
const HOOKS_CHECK_MS = 10_000;

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
    this.summarizedForState = null; this.pinned = false; this.summaryWanted = null;
  }
}

/**
 * The in-memory picture of every Claude Code session on this machine. tick() pulls from the
 * registry, transcripts, subagent dirs and the hook spool; snapshot() is what the UI renders.
 */
export class TowerStore extends EventEmitter {
  constructor({ home, summarizer = null, settings = {} }) {
    super();
    this.home = home; this.summarizer = summarizer;
    this.settings = { summaries: 'auto', summaryRefreshMinutes: DEFAULT_REFRESH_MIN, ...settings }; // summaries: auto | manual | off
    this.sessions = new Map();
    this.spoolDir = join(towerDir(home), 'events');
    this.stateFile = join(towerDir(home), 'state.json');
    this.projectSummaries = new Map(); // cwd -> { headline, at, key }
    this.seen = new Map(); // sessionId -> stateSince the user has looked at
    this._now = () => Date.now();
    this._timer = null; this._version = ''; this._fp = null; this.hooksSeen = false; this.ticking = false; this.lastTickAt = null;
    this._hooksInstalled = false; this._hooksCheckedAt = 0;
  }

  async start({ intervalMs = 1000 } = {}) {
    await mkdir(this.spoolDir, { recursive: true });
    await this._loadState();
    try { await this.tick(); } catch (e) { this.emit('error', e); }
    this._timer = setInterval(() => this.tick().catch((e) => this.emit('error', e)), intervalMs);
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  /** Hook status is a file read, so it is cached: refreshed every few seconds in tick() and on demand after install/uninstall. */
  async refreshHooks() {
    this._hooksCheckedAt = this._now();
    let installed = false;
    try { installed = hasTowerHooks(JSON.parse(await readFile(join(this.home, 'settings.json'), 'utf8'))); } catch { /* no settings, or unparseable: not installed */ }
    this._hooksInstalled = installed;
  }
  hooksInstalled() { return this._hooksInstalled; }

  /** Force the next tick to rebuild and push a snapshot even if nothing in the records changed (seen, settings, summaries). */
  _dirty() { this._version = ''; this._fp = null; }

  async tick() {
    if (this.ticking) return; this.ticking = true;
    try {
      await this._pollRegistry();
      await this._pollSpool();
      for (const s of this.sessions.values()) {
        await this._pollTranscript(s);
        if (s.alive || !s.loaded) await this._pollAgents(s);
      }
      if (this._now() - this._hooksCheckedAt > HOOKS_CHECK_MS) await this.refreshHooks();
      this._expire();
      this._deriveAndNotify();
      this.lastTickAt = this._now();
    } finally { this.ticking = false; }
  }

  async _pollRegistry() {
    const list = await readRegistry(this.home);
    const seen = new Set();
    for (const r of list) {
      if (r.cwd && r.cwd.startsWith(towerDir(this.home))) continue; // our own summarizer runs
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
      if (e.cwd && e.cwd.startsWith(towerDir(this.home))) continue;
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

  /**
   * Cheap digest of everything a snapshot could differ on, read from the records before any view is built.
   * The minute bucket keeps time-driven changes (active window, summary staleness) flowing at least once a minute.
   */
  _fingerprint() {
    const now = this._now();
    const parts = [Math.floor(now / 60_000), this.settings.summaries, this.settings.summaryRefreshMinutes, this.hooksSeen, this._hooksInstalled];
    for (const s of this.sessions.values()) {
      if (!s.cwd) continue;
      const r = this._resolve(s, now);
      parts.push(s.id, s.alive, s.busy, r.state, s.model.count, r.state === 'working' ? s.model.activity().label : '', s.summary?.at ?? 0, s.summaryError ?? '', Boolean(this.summarizer?.isQueued(s.id)), s.pinned, s.hooks.stoppedAgents.size);
      for (const a of s.agents.values()) parts.push(a.id, a.state, a.model.count, a.model.lastStopReason, a.model.pendingTools.size, a.meta.toolUseId ?? '');
    }
    return JSON.stringify(parts);
  }

  _agentOwningTool(s, toolUseId) { return agentOwningTool(s, toolUseId); }
  _agentView(s, a) { return agentView(this, s, a); }
  _resolve(s, now = this._now()) { return resolve(s, now); }
  _sessionView(s) { return sessionView(this, s); }
  snapshot() { return buildSnapshot(this); }
  /** Recent transcripts for a project dir, for browsing sessions that are no longer running. */
  async history(cwd, limit = 20) { return history(this, cwd, limit); }
  /** Load a finished session on demand so its timeline can be read. */
  async openHistory(cwd, id) { return openHistory(this, cwd, id); }

  _deriveAndNotify() {
    const fp = this._fingerprint();
    if (fp === this._fp) return;
    this._fp = fp;
    const snap = this.snapshot();
    for (const p of snap.projects) this._maybeSummarizeProject(p, snap.sessions.filter((v) => v.cwd === p.id));
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
    const enteredAttention = prevState && prevState !== v.state && (ATTENTION.has(v.state) || v.state === 'idle');
    const firstSight = prevState == null && s.loaded;
    // while a session works, keep its summary fresh so the panel answers "where are we" without reading the transcript
    const refreshMs = Math.max(1, Number(this.settings.summaryRefreshMinutes) || DEFAULT_REFRESH_MIN) * 60_000;
    const stale = v.state === 'working' && (!s.summary || this._now() - (s.summary.at ?? 0) > refreshMs) && s.summaryKey !== this.summaryKey(s);
    if (!enteredAttention && !firstSight && !stale) return;
    this.requestSummary(s.id, { force: false });
  }

  _maybeSummarizeProject(p, mine) {
    if (!this.summarizer || this.settings.summaries !== 'auto' || !this.summarizer.available) return;
    const live = mine.filter((v) => v.alive && v.turns > 0);
    if (!live.length) return;
    const key = `project:${p.id}:` + live.map((v) => `${v.id}@${v.summary?.at ?? 0}`).sort().join(',');
    const have = this.projectSummaries.get(p.id);
    if (have?.key === key) return;
    const cached = this.summarizer.cached(key);
    if (cached) { this.projectSummaries.set(p.id, { ...cached, key }); return; }
    this.summarizer.request(`project:${p.id}`, key, () => buildProjectDigest(p, live));
  }

  summaryKey(s) { return `v2:${s.id}:${s.model.count}:${s.lastState}`; }

  /** afterRun: a run for this session just finished, so the cooldown does not apply. */
  requestSummary(id, { force = false, afterRun = false } = {}) {
    const s = this.sessions.get(id);
    if (!s || !this.summarizer) return false;
    const last = this.summarizer.lastRunAt.get(id) ?? 0;
    if (!force && !afterRun && this._now() - last < SUMMARY_COOLDOWN_MS) return false;
    if (!force && s.summary && s.summaryKey === this.summaryKey(s)) return false;
    const key = this.summaryKey(s);
    const cached = this.summarizer.cached(key);
    if (cached && !force) { s.summary = cached; s.summaryKey = key; return false; }
    // a run for an older state is in flight: the summarizer refuses a second job per session, so remember to come back
    if (this.summarizer.isQueued(id)) { s.summaryWanted = key; return false; }
    return this.summarizer.request(id, key, () => buildDigest(this._sessionView(s), s.entries), { force });
  }

  onSummary(id, summary, key) {
    if (id.startsWith('project:')) { this.projectSummaries.set(id.slice(8), { ...summary, key }); this._dirty(); this.emit('change', this.snapshot()); return; }
    const s = this.sessions.get(id); if (!s) return;
    s.summary = summary; s.summaryKey = key; s.summaryError = null; this._dirty(); this.emit('change', this.snapshot());
    if (s.summaryWanted && s.summaryWanted !== key) { s.summaryWanted = null; this.requestSummary(id, { afterRun: true }); }
  }

  onSummaryError(id, err) {
    const s = this.sessions.get(id); if (!s) return;
    s.summaryError = err.message; this._dirty(); this.emit('change', this.snapshot());
  }

  /** The user has looked at this session's current attention state; it leaves the badge until the state changes again. */
  markSeen(id) {
    const s = this.sessions.get(id); if (!s) return false;
    const v = this._sessionView(s);
    this.seen.set(id, Math.max(v.stateSince ?? 0, v.followUp?.since ?? 0) || this._now());
    while (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.keys().next().value);
    this._dirty(); this._saveState();
    return true;
  }

  /** Bring the terminal running this session to the front (best effort, see focus.mjs). */
  focus(id) {
    const s = this.sessions.get(id);
    if (!s || !s.alive) return { ok: false, reason: 'session is not running' };
    return focusProcess({ pid: s.pid, cwd: s.cwd, custom: this.settings.focusCommand || null });
  }

  setSettings(patch) { this.settings = { ...this.settings, ...patch }; this._saveState(); this._dirty(); }

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

  async _loadState() {
    try {
      const st = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (st.settings) this.settings = { ...this.settings, ...st.settings };
      for (const [id, at] of Object.entries(st.seen ?? {})) this.seen.set(id, at);
    } catch { /* first run */ }
  }

  async _saveState() {
    const seen = Object.fromEntries([...this.seen].slice(-200));
    try { await mkdir(towerDir(this.home), { recursive: true }); await writeFile(this.stateFile, JSON.stringify({ settings: this.settings, seen })); } catch { /* best effort */ }
  }
}

