import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toolLabel } from './model.mjs';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'At most 10 words, present tense, what the session is doing or just did' },
    goal: { type: 'string', description: 'One sentence: what the user ultimately wants from this session' },
    done: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short bullets of what has been accomplished so far, most recent last' },
    now: { type: 'string', description: 'One sentence: what is happening right now, or what it ended with' },
    next: { type: 'string', description: 'One sentence: what comes next, or what the user must decide or provide; empty if nothing' },
    progress: { type: 'string', description: 'For project digests only: leave empty' },
    needs: { type: 'string', description: 'Leave empty' },
  },
  required: ['headline', 'goal', 'done', 'now', 'next'],
};

export const SYSTEM_PROMPT = 'You write status-board summaries of AI coding sessions for the engineer who runs them, who has several running at once and wants to know what is going on and how far along each one is. Be concrete: name files, features, decisions, numbers. Plain language, no filler, never mention that you are summarizing. Answer only with the requested JSON.';

/** Compact, bounded text digest of one session for the summarizer model. */
export function buildDigest(view, entries, agentEntries = []) {
  const prompts = entries.filter((e) => e.kind === 'prompt').slice(-5).map((e) => '- ' + clip(e.text, 400));
  const replies = entries.filter((e) => e.kind === 'text' && e.text?.trim()).slice(-3).map((e) => '- ' + clip(e.text, 700));
  const tools = entries.filter((e) => e.kind === 'tool_use').slice(-20).map((e) => `- ${e.tool.name}: ${clip(toolLabel(e.tool.name, e.tool.input), 110)}`);
  const agents = (view.agents ?? []).map((a) => `- ${clip(a.description || a.type || a.id, 100)} (${a.type ?? 'agent'}, ${a.state})${a.lastText ? ': ' + clip(a.lastText, 200) : ''}`);
  const parts = [
    `Title: ${clip(view.title, 120)}`,
    `Directory: ${view.cwd}`,
    `Current state: ${view.state}${view.stateMessage ? ' — ' + clip(view.stateMessage, 200) : ''}`,
    `Turns: ${view.turns}, tool calls: ${view.toolCalls}`,
    `First request from the user:\n${clip(view.firstPrompt, 600)}`,
    prompts.length ? `Most recent requests from the user:\n${prompts.join('\n')}` : '',
    replies.length ? `Most recent replies from the assistant (oldest first):\n${replies.join('\n')}` : '',
    view.activity?.label ? `Right now: ${view.activity.kind === 'tool' ? view.activity.tool + ' — ' : ''}${clip(view.activity.label, 160)}` : '',
    tools.length ? `Recent tool calls:\n${tools.join('\n')}` : '',
    agents.length ? `Subagents:\n${agents.join('\n')}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

/** Digest for a whole project: what its live sessions are up to. */
export function buildProjectDigest(project, sessions) {
  const lines = sessions.map((v) => `- ${clip(v.title, 100)} (${v.state})${v.summary?.headline ? ': ' + clip(v.summary.headline, 120) : v.lastPrompt ? ': ' + clip(v.lastPrompt, 160) : ''}`);
  return `Project directory: ${project.path}\nSessions in it:\n${lines.join('\n')}\n\nIn the headline, say in at most 10 words what this project is working on overall. Put one sentence in goal; leave done empty, now and next empty.`;
}

export function parseSummary(out) {
  if (!out || out.is_error) return null;
  let obj = out.structured_output;
  if (!obj && typeof out.result === 'string') {
    try { obj = JSON.parse(out.result); } catch { return null; }
  }
  if (!obj || typeof obj.headline !== 'string') return null;
  const str = (k) => String(obj[k] ?? '').trim();
  const done = Array.isArray(obj.done) ? obj.done.map((d) => String(d).trim()).filter(Boolean).slice(0, 6) : [];
  return { headline: obj.headline.trim(), goal: str('goal'), done, now: str('now'), next: str('next') || str('needs'), progress: str('progress') };
}

/** Strip the variables Claude Code sets inside a session so the summarizer runs as a plain child. */
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^CLAUDE(CODE|_CODE|_PID|_EFFORT)/.test(k)) env[k] = v;
  return env;
}

/** Run `claude -p` stripped of every setting source so it is cheap and fast. */
export async function runClaude(prompt, { model = 'haiku', cwd, timeoutMs = 90_000, bin = 'claude' } = {}) {
  if (cwd) await mkdir(cwd, { recursive: true });
  const args = ['-p', '--no-session-persistence', '--output-format', 'json', '--model', model, '--effort', 'low', '--max-turns', '1',
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '',
    '--system-prompt', SYSTEM_PROMPT, '--json-schema', JSON.stringify(SUMMARY_SCHEMA), prompt];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('summarizer timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`)); }
    });
  });
}

/**
 * Serial job queue with a key cache. request() is cheap to call often; the digest is built lazily
 * right before the run so it reflects the newest transcript.
 */
export class Summarizer {
  constructor({ runner = runClaude, onResult = () => {}, onError = () => {}, cacheFile = null, runOptions = {} } = {}) {
    this.runner = runner; this.onResult = onResult; this.onError = onError; this.cacheFile = cacheFile; this.runOptions = runOptions;
    this.cache = new Map(); // key -> summary
    this.queue = []; this.queued = new Set(); this.running = null; this.waiters = [];
    this.lastRunAt = new Map(); this.lastError = null; this.available = true;
    this.spend = { count: 0, usd: 0, today: '', todayCount: 0, todayUsd: 0 };
  }

  async load() {
    if (!this.cacheFile) return;
    try {
      const raw = JSON.parse(await readFile(this.cacheFile, 'utf8'));
      if (raw.__spend) this.spend = { ...this.spend, ...raw.__spend };
      for (const [k, v] of Object.entries(raw)) if (k !== '__spend') this.cache.set(k, v);
    } catch { /* fresh */ }
  }

  async persist() {
    if (!this.cacheFile) return;
    const entries = [...this.cache.entries()].slice(-500);
    try { await writeFile(this.cacheFile, JSON.stringify({ __spend: this.spend, ...Object.fromEntries(entries) })); } catch { /* best effort */ }
  }

  cached(key) { return this.cache.get(key) ?? null; }
  isQueued(id) { return this.queued.has(id) || this.running === id; }

  request(id, key, digestFn, { force = false } = {}) {
    if (!force && this.cache.has(key)) { this.onResult(id, this.cache.get(key), key); return false; }
    if (this.queued.has(id) || this.running === id) return false;
    this.queued.add(id);
    this.queue.push({ id, key, digestFn });
    this._pump();
    return true;
  }

  /** Running total of what summaries have cost, from claude's own accounting. */
  recordSpend(out) {
    const usd = Number(out?.total_cost_usd) || 0;
    const today = new Date().toISOString().slice(0, 10);
    if (this.spend.today !== today) { this.spend.today = today; this.spend.todayCount = 0; this.spend.todayUsd = 0; }
    this.spend.count++; this.spend.usd += usd; this.spend.todayCount++; this.spend.todayUsd += usd;
  }

  idle() { return this.running || this.queue.length ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }

  async _pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job.id; this.queued.delete(job.id);
    try {
      const prompt = `Session digest:\n\n${job.digestFn()}\n\nWrite the JSON status summary.`;
      const out = await this.runner(prompt, this.runOptions);
      this.recordSpend(out);
      const sum = parseSummary(out);
      if (!sum) throw new Error(out?.result ? String(out.result).slice(0, 200) : 'empty summary');
      const stamped = { ...sum, at: Date.now() };
      this.cache.set(job.key, stamped); this.lastRunAt.set(job.id, Date.now()); this.lastError = null;
      this.onResult(job.id, stamped, job.key);
      this.persist();
    } catch (err) {
      this.lastError = err.message;
      if (/not logged in|ENOENT/i.test(err.message)) this.available = false;
      this.onError(job.id, err);
    } finally {
      this.running = null;
      if (!this.queue.length) { for (const w of this.waiters.splice(0)) w(); }
      this._pump();
    }
  }
}
