import { toolLabel } from './model.mjs';

/** Turn a raw hook stdin payload into a small normalized event. */
export function normalizeHookEvent(raw, at) {
  if (!raw || typeof raw !== 'object' || !raw.hook_event_name) return null;
  return {
    name: raw.hook_event_name,
    sessionId: raw.session_id ?? null,
    cwd: raw.cwd ?? null,
    transcriptPath: raw.transcript_path ?? null,
    at,
    notificationType: raw.notification_type ?? null,
    message: raw.message ?? null,
    toolName: raw.tool_name ?? null,
    toolInput: raw.tool_input ?? null,
    toolUseId: raw.tool_use_id ?? null,
    agentId: raw.agent_id ?? null,
    agentType: raw.agent_type ?? null,
    lastMessage: raw.last_assistant_message ?? null,
    promptText: raw.prompt_text ?? null,
    reason: raw.reason ?? null,
    source: raw.source ?? null,
  };
}

export function emptyHookState() {
  return { attention: null, doneAt: null, lastMessage: null, lastPromptAt: null, ended: false, stoppedAgents: new Set(), startedAgents: new Map(), lastEventAt: null, lastEvent: null };
}

/** Pure reducer: hook state for one session after one event. */
export function applyHookEvent(prev, e) {
  const s = { ...prev, stoppedAgents: new Set(prev.stoppedAgents), startedAgents: new Map(prev.startedAgents), lastEventAt: e.at, lastEvent: e.name };
  switch (e.name) {
    case 'UserPromptSubmit':
      s.attention = null; s.doneAt = null; s.lastPromptAt = e.at; s.ended = false;
      break;
    case 'Stop':
      s.attention = null; s.doneAt = e.at; if (e.lastMessage) s.lastMessage = e.lastMessage;
      break;
    case 'StopFailure':
      s.attention = { kind: 'permission', message: 'The turn ended with an API error', at: e.at };
      s.doneAt = e.at;
      break;
    case 'Notification':
      if (e.notificationType === 'permission_prompt') s.attention = { kind: 'permission', message: e.message || 'Waiting for permission', at: e.at, toolUseId: e.toolUseId };
      else if (e.notificationType === 'agent_needs_input' || e.notificationType === 'elicitation_dialog') s.attention = { kind: 'question', message: e.message || 'Needs your input', at: e.at };
      break;
    case 'PermissionRequest':
      // Claude Code routes its own question dialog through the permission system
      if (e.toolName === 'AskUserQuestion') s.attention = { kind: 'question', message: toolLabel('AskUserQuestion', e.toolInput), at: e.at, toolUseId: e.toolUseId };
      else s.attention = { kind: 'permission', message: `Allow ${e.toolName ?? 'tool'}? ${toolLabel(e.toolName, e.toolInput)}`.trim(), at: e.at, toolUseId: e.toolUseId };
      break;
    case 'PreToolUse':
      if (e.toolName === 'AskUserQuestion') s.attention = { kind: 'question', message: toolLabel('AskUserQuestion', e.toolInput), at: e.at, toolUseId: e.toolUseId };
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (e.toolName === 'AskUserQuestion') s.attention = null;
      break;
    case 'SubagentStart':
      if (e.agentId) s.startedAgents.set(e.agentId, { type: e.agentType, at: e.at });
      break;
    case 'SubagentStop':
      if (e.agentId) s.stoppedAgents.add(e.agentId);
      break;
    case 'SessionEnd':
      s.ended = true; s.attention = null;
      break;
    case 'SessionStart':
      s.ended = false;
      break;
    default: break;
  }
  return s;
}
