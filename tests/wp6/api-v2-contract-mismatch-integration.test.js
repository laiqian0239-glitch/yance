'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createApiV2Router } = require('../../backend/routes/apiV2');

test('API v2 rejects contract mismatch before runtime side effects', async () => {
  let commands = 0;
  const app = express(); app.use(express.json());
  app.use('/api/app/v2', createApiV2Router({ runtimeProvider: () => ({ snapshot: () => ({ ok: true }), events: () => ({ ok: true }), executeCommand: async () => { commands += 1; return { ok: true }; } }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/app/v2/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yance-contract-version': '1' }, body: JSON.stringify({ contractVersion: 1 }) });
    const body = await response.json();
    assert.equal(response.status, 426);
    assert.equal(body.reasonCode, 'API_CONTRACT_MISMATCH');
    assert.equal(commands, 0);
  } finally { await new Promise(r => server.close(r)); }
});
