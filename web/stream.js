import { esc, ago, clip } from './format.js';

const TOOL_ARG_MAX = 600;

function toolBody(e) {
  const t = e.tool, i = t.input ?? {};
  let arg;
  switch (t.name) {
    case 'Bash': arg = i.command ?? ''; break;
    case 'Read': case 'Write': case 'Edit': arg = i.file_path ?? ''; break;
    case 'Grep': arg = `${i.pattern ?? ''}${i.path ? '  ' + i.path : ''}`; break;
    case 'Glob': arg = i.pattern ?? ''; break;
    case 'Agent': arg = `${i.subagent_type ? '[' + i.subagent_type + '] ' : ''}${i.description ?? ''}\n${clip(i.prompt ?? '', 400)}`; break;
    case 'Skill': arg = i.skill ?? ''; break;
    case 'AskUserQuestion': arg = (i.questions ?? []).map((q) => '? ' + q.question).join('\n'); break;
    default: arg = JSON.stringify(i, null, 1);
  }
  return clip(String(arg), TOOL_ARG_MAX);
}

export function renderEntry(e, now) {
  const age = e.ts ? ago(e.ts, now) : '';
  const k = (label, extra = '') => `<div class="k"><span>${label}${extra}</span><span class="age">${age}</span></div>`;
  switch (e.kind) {
    case 'prompt': return `<div class="entry prompt" data-seq="${e.seq}">${k('you')}<div class="body">${esc(e.text)}</div></div>`;
    case 'thinking': return `<div class="entry thinking" data-seq="${e.seq}">${k('thinking')}<div class="body">${esc(e.text)}</div></div>`;
    case 'text': return `<div class="entry text" data-seq="${e.seq}">${k('claude')}<div class="body">${esc(e.text)}</div></div>`;
    case 'tool_use': {
      const desc = e.tool.input?.description ? ` <span class="muted">· ${esc(clip(e.tool.input.description, 90))}</span>` : '';
      const agent = e.tool.name === 'Agent' && e.agentLink ? ` <span class="agentlink" data-open-agent="${esc(e.agentLink)}">open agent</span>` : '';
      return `<div class="entry tool_use" data-seq="${e.seq}">${k(`<span class="name">${esc(e.tool.name)}</span>`, desc + agent)}<div class="body">${esc(toolBody(e))}</div></div>`;
    }
    case 'tool_result': return `<div class="entry tool_result ${e.result.isError ? 'error' : ''}" data-seq="${e.seq}">${k(e.result.isError ? 'error' : 'result')}<div class="body">${esc(clip(e.result.text || '(empty)', 1500))}</div></div>`;
    case 'notice': return `<div class="entry notice" data-seq="${e.seq}">${k('context')}<div class="body">${esc(clip(e.text, 800))}</div></div>`;
    case 'system': return `<div class="entry system" data-seq="${e.seq}">${k('system')}<div class="body">${esc(clip(e.text, 800))}</div></div>`;
    case 'title': return `<div class="entry title" data-seq="${e.seq}">titled “${esc(e.text)}”</div>`;
    case 'summary': return `<div class="entry title" data-seq="${e.seq}">context compacted: ${esc(clip(e.text, 200))}</div>`;
    default: return '';
  }
}

/** Keeps one transcript view in sync with the server by polling for entries after the last seen one. */
export class StreamView {
  constructor({ listEl, scrollEl, earlierBtn, api, onOpenAgent }) {
    this.list = listEl; this.scroll = scrollEl; this.earlier = earlierBtn; this.api = api; this.onOpenAgent = onOpenAgent;
    this.key = null; this.lastSeq = -1; this.firstSeq = null; this.total = 0; this.follow = true; this.timer = null; this.agentByTool = new Map();
    this.earlier.addEventListener('click', () => this.loadEarlier());
    this.list.addEventListener('click', (ev) => {
      const link = ev.target.closest('[data-open-agent]');
      if (link) { this.onOpenAgent(link.dataset.openAgent); return; }
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

  setAgentIndex(agents) {
    this.agentByTool = new Map(agents.filter((a) => a.toolUseId).map((a) => [a.toolUseId, a.id]));
  }

  async open(sessionId, agentId) {
    const key = `${sessionId}|${agentId ?? ''}`;
    if (key === this.key) return;
    this.key = key; this.sessionId = sessionId; this.agentId = agentId; this.lastSeq = -1; this.firstSeq = null; this.total = 0;
    this.list.innerHTML = ''; this.earlier.hidden = true;
    await this.pull(true);
    this.setFollow(true);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(false), 1000);
  }

  close() { clearInterval(this.timer); this.timer = null; this.key = null; }

  async pull(initial) {
    if (!this.key) return;
    const q = new URLSearchParams({ session: this.sessionId, limit: initial ? 150 : 400 });
    if (this.agentId) q.set('agent', this.agentId);
    if (!initial) q.set('after', String(this.lastSeq));
    const r = await this.api(`/api/timeline?${q}`);
    if (!r || !r.entries) return;
    this.total = r.total;
    if (initial) { this.firstSeq = r.entries.length ? r.entries[0].seq : 0; this.earlier.hidden = !r.hasMore; }
    this.append(r.entries);
  }

  append(entries) {
    if (!entries.length) return;
    const now = Date.now();
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      if (e.seq <= this.lastSeq) continue;
      if (e.kind === 'tool_use' && e.tool.name === 'Agent') e.agentLink = this.agentByTool.get(e.tool.id) ?? null;
      const html = renderEntry(e, now);
      if (!html) continue;
      const t = document.createElement('template'); t.innerHTML = html.trim();
      frag.appendChild(t.content.firstChild);
      this.lastSeq = Math.max(this.lastSeq, e.seq);
    }
    this.list.appendChild(frag);
    if (this.follow) this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  async loadEarlier() {
    if (this.firstSeq == null || this.firstSeq <= 0) { this.earlier.hidden = true; return; }
    const q = new URLSearchParams({ session: this.sessionId, before: String(this.firstSeq), limit: 150 });
    if (this.agentId) q.set('agent', this.agentId);
    const r = await this.api(`/api/timeline?${q}`);
    if (!r?.entries?.length) { this.earlier.hidden = true; return; }
    const keepHeight = this.scroll.scrollHeight;
    const now = Date.now();
    const html = r.entries.map((e) => { if (e.kind === 'tool_use' && e.tool.name === 'Agent') e.agentLink = this.agentByTool.get(e.tool.id) ?? null; return renderEntry(e, now); }).join('');
    this.list.insertAdjacentHTML('afterbegin', html);
    this.firstSeq = r.entries[0].seq;
    this.earlier.hidden = !r.hasMore;
    this.scroll.scrollTop += this.scroll.scrollHeight - keepHeight;
  }
}
