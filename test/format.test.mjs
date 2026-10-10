import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetState } from '../web/format.js';

const session = (o) => ({ alive: true, state: 'done', needsYou: false, runningAgents: 0, ...o });

test('fleetState: no live session reads empty, with a nudge to start one', () => {
  assert.equal(fleetState({ sessions: [] }).state, 'empty');
  assert.equal(fleetState({ sessions: [session({ alive: false })] }).state, 'empty');
  assert.match(fleetState({ sessions: [] }).label, /No session running/);
  assert.equal(fleetState(null).state, 'empty');
});

test('fleetState: needs you outranks working, working outranks ready', () => {
  const ready = fleetState({ sessions: [session(), session()] });
  assert.equal(ready.state, 'ready'); assert.equal(ready.label, '2 sessions, all ready for a prompt');
  const working = fleetState({ sessions: [session({ state: 'working' }), session()] });
  assert.equal(working.state, 'working'); assert.equal(working.label, '1 working · 1 ready');
  assert.equal(fleetState({ sessions: [session({ runningAgents: 2 })] }).state, 'working', 'a running agent counts as working');
  const needs = fleetState({ sessions: [session({ state: 'question', needsYou: true }), session({ state: 'working' })] });
  assert.equal(needs.state, 'needs'); assert.equal(needs.label, '1 needs you · 1 working');
});

test('fleetState: a lost connection outranks everything', () => {
  const off = fleetState({ sessions: [session({ needsYou: true })] }, false);
  assert.equal(off.state, 'offline'); assert.match(off.label, /Connection lost/);
});

test('sinceTs picks the timestamp a node and the drawer both show for a state', async () => {
  const { sinceTs, AGENT_CLASS } = await import('../web/format.js');
  assert.equal(sinceTs({ alive: true, state: 'question', stateSince: 5, lastAssistantAt: 9 }), 5, 'blocking: when it started asking');
  assert.equal(sinceTs({ alive: true, state: 'idle', followUp: { since: 7, seen: false }, stateSince: 5, lastAssistantAt: 9 }), 7, 'unseen follow-up: when it asked');
  assert.equal(sinceTs({ alive: true, state: 'done', stateSince: 5, lastAssistantAt: 9 }), 9, 'ready: the last reply');
  assert.equal(sinceTs({ alive: true, state: 'working', stateSince: 5, lastAssistantAt: 9 }), 5);
  assert.deepEqual(AGENT_CLASS, { running: 'running', done: 'finished', exited: 'ended' });
});

test('glyphSvg draws one symbol per state, nudging only while unseen', async () => {
  const { glyphSvg } = await import('../web/format.js');
  for (const [kind, part] of [['working', 'arc'], ['question', 'bubble'], ['permission', 'lock'], ['followup', 'bubble hollow'], ['ready', 'cursor'], ['finished', 'check'], ['ended', 'stop']]) {
    const svg = glyphSvg(kind, 14);
    assert.match(svg, /^<svg class="g g-\w+/, kind);
    assert.ok(svg.includes(`class="${part}`), `${kind} draws a ${part}`);
    assert.ok(svg.includes('width="14"'));
  }
  assert.ok(glyphSvg('followup', 12, { still: true }).includes('still'), 'a seen follow-up keeps still');
  assert.ok(!glyphSvg('followup', 12).includes('still'));
});
