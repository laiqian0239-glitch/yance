'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ollamaClient = require('../../backend/services/ollamaClient');

async function expectIncompletePull(body) {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' }
  });
  try {
    await assert.rejects(
      ollamaClient.pull('http://127.0.0.1:11434', 'qwen-test:latest'),
      error => error?.code === 'OLLAMA_PULL_INCOMPLETE'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

test('Ollama pull requires a terminal success record before reporting completion', async () => {
  await expectIncompletePull('');
  await expectIncompletePull('{malformed ndjson}\n');
  await expectIncompletePull(`${JSON.stringify({
    status: 'downloading',
    digest: 'sha256:partial',
    total: 100,
    completed: 60
  })}\n`);
});
