import { open, stat } from 'node:fs/promises';

const MAX_RESULT_CHARS = 4000;

function ts(line) {
  const t = Date.parse(line.timestamp);
  return Number.isFinite(t) ? t : null;
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
}

function entryBase(line, i, kind) {
  return { i, ts: ts(line), kind, uuid: line.uuid ?? null, parentUuid: line.parentUuid ?? null, agentId: line.agentId ?? null };
}

/**
 * Normalise one raw transcript line into zero or more entries.
 * Entries are the unit the UI renders: prompt, thinking, text, tool_use, tool_result, title, notice, system, summary.
 */
export function parseLine(raw, i) {
  let line;
  try { line = JSON.parse(raw); } catch { return []; }
  if (!line || typeof line !== 'object') return [];

  switch (line.type) {
    case 'ai-title':
      return [{ ...entryBase(line, i, 'title'), text: line.aiTitle ?? '' }];
    case 'summary':
      return [{ ...entryBase(line, i, 'summary'), text: line.summary ?? '' }];
    case 'system': {
      if (!line.content || typeof line.content !== 'string') return [];
      return [{ ...entryBase(line, i, 'system'), text: line.content, subtype: line.subtype ?? null }];
    }
    case 'user':
      return parseUser(line, i);
    case 'assistant':
      return parseAssistant(line, i);
    default:
      return [];
  }
}

function parseUser(line, i) {
  const content = line.message?.content;
  const out = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === 'tool_result') {
        let text = blockText(b.content);
        if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + '\n…';
        out.push({ ...entryBase(line, i, 'tool_result'), result: { toolUseId: b.tool_use_id, text, isError: Boolean(b.is_error) } });
      }
    }
    if (out.length) return out;
  }
  const text = blockText(content);
  if (!text) return [];
  const injected = line.isMeta || line.origin?.kind === 'system' || line.isCompactSummary
    || /^\s*<(task-notification|system-reminder|local-command|command-name|bash-input|bash-stdout)/.test(text);
  return [{ ...entryBase(line, i, injected ? 'notice' : 'prompt'), text }];
}

function parseAssistant(line, i) {
  const msg = line.message ?? {};
  const content = Array.isArray(msg.content) ? msg.content : [];
  const u = msg.usage ?? null;
  const usage = u ? {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    context: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
  } : null;
  const common = { messageId: msg.id ?? null, model: msg.model ?? null, stopReason: msg.stop_reason ?? null, usage };
  const out = [];
  for (const b of content) {
    if (b?.type === 'thinking') { if ((b.thinking ?? '').trim()) out.push({ ...entryBase(line, i, 'thinking'), ...common, text: b.thinking }); }
    else if (b?.type === 'text') out.push({ ...entryBase(line, i, 'text'), ...common, text: b.text ?? '' });
    else if (b?.type === 'tool_use') out.push({ ...entryBase(line, i, 'tool_use'), ...common, tool: { id: b.id, name: b.name, input: b.input ?? {} } });
  }
  return out;
}

/**
 * Incrementally reads a JSONL transcript. Keeps a byte offset and a carry buffer so a line that is
 * still being written is parsed only once it is complete.
 */
export class TranscriptTailer {
  constructor(path) {
    this.path = path;
    this.offset = 0;
    this.lineIndex = 0;
    this.carry = Buffer.alloc(0);
    this.size = 0;
  }

  /** @returns {Promise<Array>} entries parsed from bytes appended since the last poll */
  async poll() {
    let st;
    try { st = await stat(this.path); } catch { return []; }
    if (st.size < this.offset) { // truncated/rotated: start over
      this.offset = 0; this.lineIndex = 0; this.carry = Buffer.alloc(0);
    }
    if (st.size === this.offset) return [];
    this.size = st.size;
    let fh;
    try { fh = await open(this.path, 'r'); } catch { return []; }
    try {
      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, this.offset);
      this.offset += bytesRead;
      // keep the unfinished tail as bytes, so a multibyte character split across reads survives
      const data = this.carry.length ? Buffer.concat([this.carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const nl = data.lastIndexOf(10);
      if (nl < 0) { this.carry = Buffer.from(data); return []; }
      this.carry = Buffer.from(data.subarray(nl + 1));
      const lines = data.subarray(0, nl).toString('utf8').split('\n');
      const out = [];
      for (const raw of lines) {
        if (raw.trim()) out.push(...parseLine(raw, this.lineIndex));
        this.lineIndex++;
      }
      return out;
    } finally {
      await fh.close();
    }
  }
}
