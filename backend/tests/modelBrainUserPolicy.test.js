'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-model-user-policy-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { createSqliteConnectionBroker, resetSqliteConnectionBrokerForTests } = require('../lib/sqliteConnectionBroker');
const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({ dbPath, instanceId: `model-user-policy-${process.pid}` });
createSqliteConnectionBroker({ dbPath, authorityWriteHostCapability: authorityWriteHost.capability });

const policy = require('../services/modelBrainUserPolicy');
const { closeR32Store } = require('../lib/r32StoreSingleton');

const state = { models: [
  { id: 'primary', name: 'primary-model', provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', qualification: 'verified', allowedTasks: ['quick_reply'] },
  { id: 'fallback', name: 'fallback-model', provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', qualification: 'verified', allowedTasks: ['quick_reply'] },
  { id: 'untested', name: 'untested-model', provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', qualification: 'untested', allowedTasks: ['quick_reply'] }
] };

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('user policy persists reasoning level and fast routing preference', async () => {
  const updated = await policy.updatePreferences({ reasoningLevel: 'high', fastMode: true });
  assert.equal(updated.reasoningLevel, 'high');
  assert.equal(updated.fastMode, true);
  const options = policy.requestOptions('quick_reply', {}, updated);
  assert.equal(options.fastMode, true);
  assert.equal(options.reasoningLevel, 'high');
  assert.ok(options.maxTokens <= 220);
  assert.ok(options.timeoutMs >= 180000);
});

test('manual policy accepts only formally qualified task-capable deployments', async () => {
  await policy.setTaskPolicy('quick_reply', {
    mode: 'manual', primaryModelId: 'primary', fallbackModelId: 'fallback'
  }, state);
  const resolved = policy.resolve('quick_reply', state);
  assert.equal(resolved.taskPolicy.mode, 'manual');
  assert.deepEqual(resolved.candidates.map(row => row.id), ['primary', 'fallback']);
  assert.equal(resolved.primary.id, 'primary');
  assert.equal(resolved.fallback.id, 'fallback');
});
test('manual policy rejects an untested physical model instead of bypassing qualification', async () => {
  await assert.rejects(
    policy.setTaskPolicy('quick_reply', { mode: 'manual', primaryModelId: 'untested' }, state),
    error => error.code === 'MODEL_BRAIN_USER_POLICY_PRIMARY_INELIGIBLE' && error.status === 409
  );
});

test('projected policy exposes main/fallback binding without becoming physical execution authority', () => {
  const projected = policy.project(state);
  assert.equal(projected.authority, 'User preference → Model Brain → LiteLLM');
  assert.equal(projected.tasks.quick_reply.mode, 'manual');
  assert.equal(projected.tasks.quick_reply.primaryModel.id, 'primary');
  assert.equal(projected.tasks.quick_reply.fallbackModel.id, 'fallback');
});

test('Model Brain worker keeps user choice inside LiteLLM Router authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'runtime', 'model-brain', 'yance_litellm_worker.py'), 'utf8');
  assert.match(source, /routePreference/u);
  assert.match(source, /routing_strategy="latency-based-routing"/u);
  assert.match(source, /fallbacks=fallbacks/u);
  assert.match(source, /router\.acompletion\(/u);
});

test('normal product execution still routes by logical task rather than accepting a physical model override', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'r32StoreBridge.js'), 'utf8');
  const start = source.indexOf("if (action === 'validate-logical-task')");
  const end = source.indexOf("if (action === 'discover-compatible-cloud')", start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /modelId/u);
  assert.match(block, /\/api\/r32\/models\/execute/u);
});
