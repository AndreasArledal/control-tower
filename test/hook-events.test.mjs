import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHookEvent, applyHookEvent, emptyHookState } from '../server/hook-events.mjs';

const at = 1_000_000;
const ev = (o) => normalizeHookEvent({ session_id: 's1', cwd: '/p', transcript_path: '/p/t.jsonl', ...o }, at);

test('normalizes raw hook payloads', () => {
  const e = ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow Bash?' });
  assert.deepEqual([e.name, e.sessionId, e.cwd, e.at, e.notificationType], ['Notification', 's1', '/p', at, 'permission_prompt']);
  assert.equal(normalizeHookEvent({ nonsense: true }, at), null);
});

test('permission prompt raises attention; a new prompt clears it and marks working', () => {
  let s = emptyHookState();
  s = applyHookEvent(s, ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow Bash?' }));
  assert.equal(s.attention.kind, 'permission');
  assert.equal(s.attention.message, 'Allow Bash?');
  s = applyHookEvent(s, ev({ hook_event_name: 'UserPromptSubmit', prompt_text: 'yes' }));
  assert.equal(s.attention, null);
  assert.equal(s.doneAt, null);
});

test('PermissionRequest raises attention with the tool name', () => {
  const s = applyHookEvent(emptyHookState(), ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }));
  assert.equal(s.attention.kind, 'permission');
  assert.match(s.attention.message, /Bash/);
});

test('a PermissionRequest for AskUserQuestion is a question, not a permission', () => {
  const s = applyHookEvent(emptyHookState(), ev({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which DB?' }] } }));
  assert.equal(s.attention.kind, 'question');
  assert.equal(s.attention.message, 'Which DB?');
});

test('Stop records doneAt and the last message; AskUserQuestion pre/post toggles question attention', () => {
  let s = applyHookEvent(emptyHookState(), ev({ hook_event_name: 'Stop', last_assistant_message: 'All done.' }));
  assert.equal(s.doneAt, at);
  assert.equal(s.lastMessage, 'All done.');
  s = applyHookEvent(s, ev({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?' }] } }));
  assert.equal(s.attention.kind, 'question');
  assert.equal(s.attention.message, 'Which?');
  s = applyHookEvent(s, ev({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' }));
  assert.equal(s.attention, null);
});

test('SessionEnd marks ended; subagent events are collected by agent id', () => {
  let s = applyHookEvent(emptyHookState(), ev({ hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'Explore' }));
  assert.deepEqual([...s.stoppedAgents], ['ag1']);
  s = applyHookEvent(s, ev({ hook_event_name: 'SessionEnd', reason: 'other' }));
  assert.equal(s.ended, true);
});
