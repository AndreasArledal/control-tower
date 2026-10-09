import { esc, ago, clip, plain } from './format.js';

const ARG_MAX = 900, RESULT_MAX = 1500;

/** One line that says what a tool call did, from the user's point of view. */
function stepLabel(e) {
  const t = e.tool, i = t.input ?? {};
  const tail = (p) => String(p ?? '').split('/').filter(Boolean).slice(-2).join('/');
  switch (t.name) {
    case 'Bash': return i.description || String(i.command ?? '').split('\n')[0];
    case 'Read': return `read ${tail(i.file_path)}`;
    case 'Write': return `wrote ${tail(i.file_path)}`;
    case 'Edit': return `edited ${tail(i.file_path)}`;
    case 'Grep': return `searched for ${i.pattern ?? ''}${i.path ? ' in ' + tail(i.path) : ''}`;
    case 'Glob': return `listed ${i.pattern ?? ''}`;
    case 'Agent': return `${i.description ?? 'spawned an agent'}${i.subagent_type ? ' (' + i.subagent_type + ')' : ''}`;
    case 'Skill': return `used skill ${i.skill ?? ''}`;
    case 'WebFetch': { try { return `fetched ${new URL(i.url).host}`; } catch { return `fetched ${i.url ?? ''}`; } }
    case 'WebSearch': return `searched the web for ${i.query ?? ''}`;
    case 'AskUserQuestion': return `asked: ${i.questions?.[0]?.question ?? ''}`;
    case 'TodoWrite': return 'updated the task list';
    default: { const s = Object.values(i).find((v) => typeof v === 'string'); return s ? clip(s, 90) : t.name; }
  }
}

function rawArgs(e) {
  const t = e.tool, i = t.input ?? {};
  let arg;
  switch (t.name) {
    case 'Bash': arg = i.command ?? ''; break;
    case 'Read': case 'Write': case 'Edit': arg = i.file_path ?? ''; if (t.name === 'Edit') arg += `\n--- old\n${i.old_string ?? ''}\n--- new\n${i.new_string ?? ''}`; if (t.name === 'Write') arg += `\n${i.content ?? ''}`; break;
    case 'Agent': arg = `${i.description ?? ''}\n${i.prompt ?? ''}`; break;
    case 'AskUserQuestion': arg = (i.questions ?? []).map((q) => '? ' + q.question).join('\n'); break;
    default: arg = JSON.stringify(i, null, 1);
  }
  return clip(String(arg), ARG_MAX);
}

/** Minimal markdown for replies: paragraphs, bullets, bold, inline code, fenced code. Everything escaped first. */
export function renderMarkdown(text) {
  const parts = String(text ?? '').split(/```/);
  return parts.map((p, idx) => {
    if (idx % 2 === 1) return `<pre>${esc(p.replace(/^\w*\n/, ''))}</pre>`;
    const lines = p.split('\n');
    const out = []; let list = null; let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const endList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) { flush(); (list ??= []).push(`<li>${inline(li[1])}</li>`); continue; }
      endList();
      if (!l.trim()) { flush(); continue; }
      const h = l.match(/^#{1,6}\s+(.*)$/);
      if (h) { flush(); out.push(`<p><b>${inline(h[1])}</b></p>`); continue; }
      para.push(l);
    }
    flush(); endList();
    return out.join('');
  }).join('');
}
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*([^*]+)\*(?=\s|$|[.,])/g, '$1<i>$2</i>');
}

/** Raw-log rendering of one entry (the "raw" view). */
export function renderEntry(e, now) {
  const age = e.ts ? ago(e.ts, now) : '';
  const k = (label, extra = '') => `<div class="k"><span>${label}${extra}</span><span class="age">${age}</span></div>`;
  switch (e.kind) {
    case 'prompt': return `<div class="entry prompt" data-seq="${e.seq}">${k('you')}<div class="body">${esc(e.text)}</div></div>`;
    case 'thinking': return `<div class="entry thinking" data-seq="${e.seq}">${k('thinking')}<div class="body">${esc(e.text)}</div></div>`;
    case 'text': return `<div class="entry text" data-seq="${e.seq}">${k('claude')}<div class="body">${esc(e.text)}</div></div>`;
    case 'tool_use': return `<div class="entry tool_use" data-seq="${e.seq}">${k(`<span class="name">${esc(e.tool.name)}</span>`, e.tool.input?.description ? ` <span class="muted">· ${esc(clip(e.tool.input.description, 90))}</span>` : '')}<div class="body">${esc(rawArgs(e))}</div></div>`;
    case 'tool_result': return `<div class="entry tool_result ${e.result.isError ? 'error' : ''}" data-seq="${e.seq}">${k(e.result.isError ? 'error' : 'result')}<div class="body">${esc(clip(e.result.text || '(empty)', RESULT_MAX))}</div></div>`;
    case 'notice': return `<div class="entry notice" data-seq="${e.seq}">${k('context')}<div class="body">${esc(clip(e.text, 800))}</div></div>`;
    case 'system': return `<div class="entry system" data-seq="${e.seq}">${k('system')}<div class="body">${esc(clip(e.text, 800))}</div></div>`;
    case 'title': return `<div class="entry title" data-seq="${e.seq}">titled “${esc(e.text)}”</div>`;
    case 'summary': return `<div class="entry title" data-seq="${e.seq}">context compacted: ${esc(clip(e.text, 200))}</div>`;
    default: return '';
  }
}

/**
 * The transcript panel. "story" mode reads like a narrative: your prompts, Claude's replies, and
 * the work in between compressed to one line per step. "raw" mode is the full log.
 */
export class StreamView {
  constructor({ listEl, scrollEl, earlierBtn, api, onOpenAgent }) {
    this.list = listEl; this.scroll = scrollEl; this.earlier = earlierBtn; this.api = api; this.onOpenAgent = onOpenAgent;
    this.key = null; this.entries = []; this.lastSeq = -1; this.firstSeq = null; this.follow = true; this.timer = null;
    this.mode = 'story'; this.showThinking = false; this.agentByTool = new Map(); this.group = null; this.stepByTool = new Map();
    this.earlier.addEventListener('click', () => this.loadEarlier());
    this.list.addEventListener('click', (ev) => {
      const link = ev.target.closest('[data-open-agent]');
      if (link) { this.onOpenAgent(link.dataset.openAgent); return; }
      const step = ev.target.closest('.step');
      if (step) { step.classList.toggle('open'); return; }
      const entry = ev.target.closest('.entry');
      if (entry) entry.classList.toggle('open');
    });
    this.scroll.addEventListener('scroll', () => {
      const atBottom = this.scroll.scrollTop + this.scroll.clientHeight >= this.scroll.scrollHeight - 24;
      if (!atBottom && this.follow) this.setFollow(false, true);
      if (atBottom && !this.follow) this.setFollow(true, true);
    });
  }

  setFollow(v, fromScroll = false) {
    this.follow = v;
    const cb = document.getElementById('follow'); if (cb) cb.checked = v;
    if (v && !fromScroll) this.scroll.scrollTop = this.scroll.scrollHeight;
  }
  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this.render(); } }
  setThinking(on) { if (on !== this.showThinking) { this.showThinking = on; this.render(); } }
  setAgentIndex(agents) { this.agentByTool = new Map(agents.filter((a) => a.toolUseId).map((a) => [a.toolUseId, a.id])); }

  async open(sessionId, agentId) {
    const key = `${sessionId}|${agentId ?? ''}`;
    if (key === this.key) return;
    this.key = key; this.sessionId = sessionId; this.agentId = agentId; this.entries = []; this.lastSeq = -1; this.firstSeq = null;
    this.list.innerHTML = ''; this.earlier.hidden = true; this.group = null; this.stepByTool = new Map();
    await this.pull(true);
    this.setFollow(true);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(false), 1000);
  }

  close() { clearInterval(this.timer); this.timer = null; this.key = null; }

  async pull(initial) {
    if (!this.key) return;
    const q = new URLSearchParams({ session: this.sessionId, limit: initial ? 200 : 400 });
    if (this.agentId) q.set('agent', this.agentId);
    if (!initial) q.set('after', String(this.lastSeq));
    const r = await this.api(`/api/timeline?${q}`);
    if (!r || !r.entries) return;
    const fresh = r.entries.filter((e) => e.seq > this.lastSeq);
    if (initial) { this.firstSeq = r.entries.length ? r.entries[0].seq : 0; this.earlier.hidden = !r.hasMore; }
    if (!fresh.length) return;
    for (const e of fresh) this.lastSeq = Math.max(this.lastSeq, e.seq);
    this.entries.push(...fresh);
    this.append(fresh);
  }

  async loadEarlier() {
    if (this.firstSeq == null || this.firstSeq <= 0) { this.earlier.hidden = true; return; }
    const q = new URLSearchParams({ session: this.sessionId, before: String(this.firstSeq), limit: 200 });
    if (this.agentId) q.set('agent', this.agentId);
    const r = await this.api(`/api/timeline?${q}`);
    if (!r?.entries?.length) { this.earlier.hidden = true; return; }
    const keep = this.scroll.scrollHeight;
    this.entries.unshift(...r.entries); this.firstSeq = r.entries[0].seq; this.earlier.hidden = !r.hasMore;
    this.render();
    this.scroll.scrollTop += this.scroll.scrollHeight - keep;
  }

  /** Full re-render from this.entries (mode switch, load earlier). */
  render() {
    this.list.innerHTML = ''; this.group = null; this.stepByTool = new Map();
    this.append(this.entries);
    if (this.follow) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  append(entries) {
    if (!entries.length) return;
    const now = Date.now();
    if (this.mode === 'raw') {
      const html = entries.map((e) => renderEntry(e, now)).join('');
      this.list.insertAdjacentHTML('beforeend', html);
    } else {
      for (const e of entries) this.storyAppend(e, now);
    }
    if (this.follow) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  storyAppend(e, now) {
    const age = e.ts ? ago(e.ts, now) : '';
    const block = (cls, label, body) => { this.group = null; this.list.insertAdjacentHTML('beforeend', `<div class="story ${cls}" data-seq="${e.seq}"><div class="k"><span>${label}</span><span class="age">${age}</span></div><div class="body">${body}</div></div>`); };
    switch (e.kind) {
      case 'prompt': return block('prompt', 'you', renderMarkdown(e.text));
      case 'text': return block('text', 'claude', renderMarkdown(e.text));
      case 'summary': return block('note', 'context compacted', esc(clip(e.text, 300)));
      case 'tool_use': {
        const g = this.ensureGroup(e, now);
        const agent = e.tool.name === 'Agent' ? (this.agentByTool.get(e.tool.id) ?? null) : null;
        const el = document.createElement('div');
        el.className = 'step'; el.dataset.seq = e.seq;
        el.innerHTML = `<div class="line"><span class="tool">${esc(e.tool.name)}</span><span class="what">${esc(clip(stepLabel(e), 140))}</span>${agent ? `<span class="agentlink" data-open-agent="${esc(agent)}">open agent</span>` : ''}<span class="age">${age}</span></div><div class="detail"><pre class="args">${esc(rawArgs(e))}</pre><pre class="res muted">…</pre></div>`;
        g.list.appendChild(el); g.count++; g.tools.set(e.tool.name, (g.tools.get(e.tool.name) ?? 0) + 1);
        this.stepByTool.set(e.tool.id, el);
        this.updateGroupHead(g);
        return;
      }
      case 'tool_result': {
        const el = this.stepByTool.get(e.result.toolUseId); if (!el) return;
        const res = el.querySelector('.res'); res.textContent = clip(e.result.text || '(no output)', RESULT_MAX);
        if (e.result.isError) { el.classList.add('error'); const g = this.group; if (g && g.list.contains(el)) { g.errors++; this.updateGroupHead(g); } }
        return;
      }
      case 'thinking': {
        if (!this.showThinking) return;
        const g = this.ensureGroup(e, now);
        g.list.insertAdjacentHTML('beforeend', `<div class="thought" data-seq="${e.seq}">${esc(clip(plain(e.text), 400))}</div>`);
        return;
      }
      default: return;
    }
  }

  ensureGroup(e, now) {
    if (this.group) return this.group;
    const el = document.createElement('div');
    el.className = 'story work'; el.dataset.seq = e.seq;
    el.innerHTML = `<div class="k"><span class="head"></span><span class="age">${e.ts ? ago(e.ts, now) : ''}</span></div><div class="steps"></div>`;
    this.list.appendChild(el);
    this.group = { el, list: el.querySelector('.steps'), head: el.querySelector('.head'), count: 0, errors: 0, tools: new Map() };
    this.updateGroupHead(this.group);
    return this.group;
  }

  updateGroupHead(g) {
    const top = [...g.tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
    g.head.textContent = `${g.count} step${g.count === 1 ? '' : 's'}${top ? ' · ' + top : ''}${g.errors ? ` · ${g.errors} error${g.errors === 1 ? '' : 's'}` : ''}`;
    g.el.classList.toggle('has-error', g.errors > 0);
  }
}
