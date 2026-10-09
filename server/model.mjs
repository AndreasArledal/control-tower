const TITLE_MAX = 60;
const WORKING_GRACE_MS = 4000;

export function shortTitle(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX);
  const sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut) + '…';
}

/** Human-friendly one-liner for a tool call. */
export function toolLabel(name, input = {}) {
  if (!input || typeof input !== 'object') return name;
  if (input.description) return String(input.description);
  switch (name) {
    case 'Bash': return String(input.command ?? '').split('\n')[0].slice(0, 80);
    case 'Read': return String(input.file_path ?? '');
    case 'Write': return String(input.file_path ?? '');
    case 'Edit': return String(input.file_path ?? '');
    case 'Grep': return `${input.pattern ?? ''}${input.path ? ' in ' + input.path : ''}`;
    case 'Glob': return String(input.pattern ?? '');
    case 'Agent': return String(input.description ?? input.subagent_type ?? '');
    case 'Skill': return String(input.skill ?? '');
    case 'WebFetch': return String(input.url ?? '');
    case 'WebSearch': return String(input.query ?? '');
    case 'AskUserQuestion': return String(input.questions?.[0]?.question ?? 'Question');
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string');
      return first ? String(first).slice(0, 80) : '';
    }
  }
}

/**
 * Incrementally derived facts about one transcript (a session or a subagent).
 * Feed it entries in order; read the getters any time.
 */
export class SessionModel {
  constructor() {
    this.count = 0;
    this.aiTitle = null;
    this.summaryTitle = null;
    this.firstPrompt = null;
    this.lastPrompt = null;
    this.lastPromptAt = null;
    this.lastAssistantText = null;
    this.lastAssistantAt = null;
    this.lastActivityAt = null;
    this.firstActivityAt = null;
    this.turns = 0;
    this.toolCalls = 0;
    this.thinkingChars = 0;
    this.contextTokens = 0;
    this.outputTokens = 0;
    this.model = null;
    this.lastStopReason = null;
    this.lastKind = null;
    this.pendingTools = new Map(); // toolUseId -> { name, input, ts, i }
    this.toolUseIds = new Set();
    this.resultIds = new Set();
    this.agentSpawns = new Map(); // toolUseId -> { description, type, ts }
    this.errors = 0;
  }

  get title() {
    return this.aiTitle || this.summaryTitle || shortTitle(this.firstPrompt) || 'Untitled session';
  }

  get pendingQuestion() {
    for (const [id, t] of this.pendingTools) {
      if (t.name === 'AskUserQuestion') return { id, text: toolLabel(t.name, t.input), ts: t.ts };
    }
    return null;
  }

  ingest(e) {
    this.count++;
    if (e.ts != null) {
      this.lastActivityAt = e.ts;
      if (this.firstActivityAt == null) this.firstActivityAt = e.ts;
    }
    this.lastKind = e.kind;
    if (e.usage?.context) this.contextTokens = e.usage.context;
    if (e.usage?.output) this.outputTokens += e.usage.output;
    if (e.model) this.model = e.model;
    if (e.stopReason !== undefined && e.stopReason !== null) this.lastStopReason = e.stopReason;
    switch (e.kind) {
      case 'title': this.aiTitle = e.text || this.aiTitle; break;
      case 'summary': this.summaryTitle = e.text || this.summaryTitle; break;
      case 'prompt':
        if (this.firstPrompt == null) this.firstPrompt = e.text;
        this.lastPrompt = e.text; this.lastPromptAt = e.ts; this.turns++;
        this.lastStopReason = null;
        break;
      case 'thinking': this.thinkingChars += (e.text || '').length; break;
      case 'text':
        if (e.text?.trim()) { this.lastAssistantText = e.text; this.lastAssistantAt = e.ts; }
        break;
      case 'tool_use':
        this.toolCalls++;
        this.toolUseIds.add(e.tool.id);
        this.pendingTools.set(e.tool.id, { name: e.tool.name, input: e.tool.input, ts: e.ts, i: e.i });
        if (e.tool.name === 'Agent') this.agentSpawns.set(e.tool.id, { description: e.tool.input?.description ?? '', type: e.tool.input?.subagent_type ?? null, ts: e.ts });
        break;
      case 'tool_result':
        this.pendingTools.delete(e.result.toolUseId);
        this.resultIds.add(e.result.toolUseId);
        if (e.result.isError) this.errors++;
        break;
      default: break;
    }
  }

  /** What is this transcript doing right now, judged from its tail. */
  activity() {
    const q = this.pendingQuestion;
    if (q) return { kind: 'question', label: q.text, since: q.ts, tool: 'AskUserQuestion' };
    let latest = null;
    for (const [id, t] of this.pendingTools) if (!latest || t.i > latest.i) latest = { id, ...t };
    if (latest) return { kind: 'tool', tool: latest.name, label: toolLabel(latest.name, latest.input), since: latest.ts, toolId: latest.id };
    if (this.lastKind === 'thinking') return { kind: 'thinking', label: 'Thinking', since: this.lastActivityAt };
    if (this.lastKind === 'text') return { kind: 'responding', label: 'Writing a reply', since: this.lastActivityAt };
    if (this.lastKind === 'prompt') return { kind: 'thinking', label: 'Reading your prompt', since: this.lastActivityAt };
    return { kind: 'idle', label: '', since: this.lastActivityAt };
  }
}

/**
 * Collapse every signal about a live session into one state.
 * States: exited | permission | question | done | working | idle
 */
export function resolveState({ alive, busy, doneAt, lastPromptAt, attention, pendingQuestion, lastActivityAt, now }) {
  if (!alive) return { state: 'exited', since: null };
  if (attention) return { state: attention.kind, since: attention.at, message: attention.message };
  if (pendingQuestion) return { state: 'question', since: pendingQuestion.ts ?? null, message: pendingQuestion.text };
  if (doneAt && doneAt >= (lastPromptAt ?? 0)) return { state: 'done', since: doneAt };
  if (busy || (lastActivityAt && now - lastActivityAt < WORKING_GRACE_MS)) return { state: 'working', since: lastPromptAt ?? lastActivityAt };
  return { state: 'idle', since: lastActivityAt };
}

/** running | done | exited */
export function resolveAgentState({ model, parentHasResult, stopped, sessionAlive }) {
  if (stopped || parentHasResult) return 'done';
  if (model.lastStopReason === 'end_turn' && model.pendingTools.size === 0 && model.lastKind === 'text') return 'done';
  if (!sessionAlive) return 'exited';
  return 'running';
}
