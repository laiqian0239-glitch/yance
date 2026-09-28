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

test('projected policy contains only user intent and derived eligibility, never physical route bindings', () => {
  const projected = policy.project(state);
  assert.equal(projected.authority, 'User intent → Model Brain → LiteLLM');
  assert.equal(projected.tasks.quick_reply.logicalModel.length > 0, true);
  assert.equal(projected.tasks.quick_reply.eligibleModelCount, 2);
  assert.equal('mode' in projected.tasks.quick_reply, false);
  assert.equal('primaryModel' in projected.tasks.quick_reply, false);
  assert.equal('fallbackModel' in projected.tasks.quick_reply, false);
  assert.equal(typeof policy.setTaskPolicy, 'undefined');
  assert.equal(typeof policy.resolve, 'undefined');
});

test('Model Brain worker delegates physical selection retry and fallback to LiteLLM Router', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'runtime', 'model-brain', 'yance_litellm_worker.py'), 'utf8');
  assert.match(source, /Router\(/u);
  assert.match(source, /routing_strategy="latency-based-routing"/u);
  assert.match(source, /router\.acompletion\(/u);
  assert.doesNotMatch(source, /primaryModelId|fallbackModelId|fallbacks=fallbacks|max_fallbacks/u);
  const routerConfig = source.slice(source.indexOf("router = Router("), source.indexOf("complexity = ", source.indexOf("router = Router(")));
  assert.doesNotMatch(routerConfig, /num_retries|max_fallbacks/u);
  assert.match(source, /"retryCount": int\(hidden\.get\("retry_count", hidden\.get\("num_retries", 0\)\)/u);
});

test('normal product execution still routes by logical task rather than accepting a physical model override', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'r32StoreBridge.js'), 'utf8');
  const start = source.indexOf("if (action === 'validate-logical-task')");
  const end = source.indexOf("if (action === 'discover-compatible-cloud')", start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /modelId/u);
  assert.match(block, /\/api\/r32\/models\/execute/u);
});
