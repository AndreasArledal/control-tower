import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toolLabel } from './model.mjs';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'At most 10 words, present tense, what the session is doing or just did' },
    progress: { type: 'string', description: 'At most two sentences: what has been done and where it stands' },
    needs: { type: 'string', description: 'One sentence on what the user must do now, or empty string' },
  },
  required: ['headline', 'progress', 'needs'],
};

export const SYSTEM_PROMPT = 'You write terse status-board summaries of AI coding sessions for the engineer who runs them. Use plain, specific language. Never mention that you are summarizing. Answer only with the requested JSON.';

/** Compact, bounded text digest of one session for the summarizer model. */
export function buildDigest(view, entries, agentEntries = []) {
  const prompts = entries.filter((e) => e.kind === 'prompt').slice(-3).map((e) => '- ' + clip(e.text, 300));
  const tools = entries.filter((e) => e.kind === 'tool_use').slice(-12).map((e) => `- ${e.tool.name}: ${clip(toolLabel(e.tool.name, e.tool.input), 100)}`);
  const agents = (view.agents ?? []).map((a) => `- ${clip(a.description || a.type || a.id, 100)} (${a.type ?? 'agent'}, ${a.state})`);
  const parts = [
    `Title: ${clip(view.title, 120)}`,
    `Directory: ${view.cwd}`,
    `Current state: ${view.state}${view.stateMessage ? ' — ' + clip(view.stateMessage, 200) : ''}`,
    `Turns: ${view.turns}, tool calls: ${view.toolCalls}`,
    `First request from the user:\n${clip(view.firstPrompt, 600)}`,
    prompts.length ? `Most recent requests from the user:\n${prompts.join('\n')}` : '',
    view.lastAssistantText ? `Most recent reply from the assistant:\n${clip(view.lastAssistantText, 1200)}` : '',
    tools.length ? `Recent tool calls:\n${tools.join('\n')}` : '',
    agents.length ? `Subagents:\n${agents.join('\n')}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function parseSummary(out) {
  if (!out || out.is_error) return null;
  let obj = out.structured_output;
  if (!obj && typeof out.result === 'string') {
    try { obj = JSON.parse(out.result); } catch { return null; }
  }
  if (!obj || typeof obj.headline !== 'string') return null;
  return { headline: obj.headline.trim(), progress: String(obj.progress ?? '').trim(), needs: String(obj.needs ?? '').trim() };
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
  }

  async load() {
    if (!this.cacheFile) return;
    try { for (const [k, v] of Object.entries(JSON.parse(await readFile(this.cacheFile, 'utf8')))) this.cache.set(k, v); } catch { /* fresh */ }
  }

  async persist() {
    if (!this.cacheFile) return;
    const entries = [...this.cache.entries()].slice(-500);
    try { await writeFile(this.cacheFile, JSON.stringify(Object.fromEntries(entries))); } catch { /* best effort */ }
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

  idle() { return this.running || this.queue.length ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }

  async _pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job.id; this.queued.delete(job.id);
    try {
      const prompt = `Session digest:\n\n${job.digestFn()}\n\nWrite the JSON status summary.`;
      const out = await this.runner(prompt, this.runOptions);
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
