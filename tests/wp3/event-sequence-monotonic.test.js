'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { command, createApiHarness, request, token } = require('./helpers');
test('event sequence is SQLite persisted and strictly monotonic across commands and restart', async () => {
  const h1 = await createApiHarness(); let snap = (await request(h1.port, { token: h1.token })).body;
  for (let i = 0; i < 2; i += 1) {
    const result = await request(h1.port, { token: h1.token, method: 'POST', path: '/api/app/v2/commands', body: command(snap, { commandId: `33333333-3333-4333-8333-33333333333${i}` }) });
    assert.equal(result.statusCode, 200); snap = (await request(h1.port, { token: h1.token })).body;
  }
  const listed = (await request(h1.port, { token: h1.token, path: '/api/app/v2/events?afterSequence=0&limit=500' })).body;
  const sequences = listed.events.map(event => event.eventSequence);
  assert.ok(sequences.length >= 2); assert.ok(sequences.every((value, index) => index === 0 || value > sequences[index - 1]));
  const lastBefore = listed.lastAvailableSequence;
  h1.runtime.store.db.prepare('DELETE FROM runtime_event WHERE event_sequence < ?').run(lastBefore);
  const gap = await request(h1.port, { token: h1.token, path: '/api/app/v2/events?afterSequence=1&limit=500' });
  assert.equal(gap.statusCode, 409); assert.equal(gap.body.reasonCode, 'EVENT_SEQUENCE_GAP');
  const root = h1.root; await h1.close({ removeRoot: false });
  const h2 = await createApiHarness({ root, token: token('b') }); const after = (await request(h2.port, { token: h2.token, path: '/api/app/v2/events?afterSequence=0&limit=500' })).body;
  assert.ok(after.lastAvailableSequence > lastBefore); await h2.close();
});
