'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const systemRouter = require('../../backend/routes/system');

test('legacy policy route rejects operating mode mutation atomically', async () => {
  const app = express(); app.use(express.json()); app.use('/api/r32/system', systemRouter); app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok:false, reasonCode:error.reasonCode || error.code, message:error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/r32/system/policy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ privacyMode: true, safeMode: true }) });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.reasonCode || body.code, 'OPERATING_MODE_API_V2_REQUIRED');
  } finally { await new Promise(r => server.close(r)); }
});
