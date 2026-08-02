'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtimeAuthority = require('../services/modelRuntimeAuthority');

function project(name, capabilities = []) {
  return runtimeAuthority.projectModel({
    id: `id:${name}`,
    name,
    provider: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1',
    credentialRef: 'credential',
    configured: true,
    available: true,
    qualification: 'untested',
    capabilities,
    catalogMetadata: { endpointType: /:batch$/u.test(name) ? 'batch' : 'chat' }
  }, {}, { credentialReady: () => true, routeAssignments: [] });
}

test('runtime projection gives Batch-only models a non-interactive purpose', () => {
  const batch = project('anthropic/claude-opus-5:batch');
  const chat = project('anthropic/claude-opus-5');
  assert.equal(batch.modelPurpose, 'batch-only');
  assert.equal(batch.interactiveReplyVisible, false);
  assert.equal(batch.batchOnly, true);
  assert.equal(chat.modelPurpose, 'interactive-reply');
  assert.equal(chat.interactiveReplyVisible, true);
});

test('AI workbench renders Batch-only models outside the reply model grid', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /interactiveServices/u);
  assert.match(source, /batchServices/u);
  assert.match(source, /Batch 与后台模型/u);
  assert.match(source, /interactiveReplyVisible/u);
});
