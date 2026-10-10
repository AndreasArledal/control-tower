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
