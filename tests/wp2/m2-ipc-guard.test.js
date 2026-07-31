'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const guard = require('../../electron/m2/ipcGuard');

// ---- inline minimal manifest（不依赖外部契约文件，验证守卫核心机制） ----
const inlineManifest = {
  denylist: [
    { action: 'execute-command', decision: 'DENY', reasonCodeOnFailure: 'M2_IPC_EXECUTE_COMMAND_DENIED' },
    { action: 'kill-process', decision: 'DENY', reasonCodeOnFailure: 'M2_IPC_KILL_PROCESS_DENIED' }
  ],
  handlers: [
    {
      channel: 'app:ping', direction: 'renderer-to-main',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      requiresBackendReady: false, allowedDuringQuitting: true, allowedDuringRestart: true,
      reasonCodeOnFailure: 'X'
    },
    {
      channel: 'app:backend-data', direction: 'renderer-to-main',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      requiresBackendReady: true, allowedDuringQuitting: false, allowedDuringRestart: false,
      reasonCodeOnFailure: 'BACKEND_NOT_READY'
    },
    {
      channel: 'app:restart', direction: 'renderer-to-main',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      requiresBackendReady: false, allowedDuringQuitting: false, allowedDuringRestart: false,
      reasonCodeOnFailure: 'DENIED'
    }
  ]
};

function evalInline(channel, payload, ctx) {
  const index = guard.indexManifest(inlineManifest);
  return guard.evaluateIpc({ index, channel, payload, ctx: ctx || {} });
}

test('denylist channel is denied', () => {
  const r = evalInline('execute-command', {}, {});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reasonCode, 'M2_IPC_DENYLIST');
});

test('normal channel allowed when backend ready not required', () => {
  const r = evalInline('app:ping', {}, {});
  assert.strictEqual(r.allowed, true);
});

test('requiresBackendReady enforced: denied before backend ready', () => {
  const r = evalInline('app:backend-data', { id: 'x' }, { backendReady: false });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reasonCode, 'BACKEND_NOT_READY');
});

test('requiresBackendReady: allowed when backend ready and payload valid', () => {
  const r = evalInline('app:backend-data', { id: 'x' }, { backendReady: true });
  assert.strictEqual(r.allowed, true);
});

test('invalid payload rejected', () => {
  const r = evalInline('app:backend-data', {}, { backendReady: true });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reasonCode, 'M2_IPC_INVALID_PAYLOAD');
});

test('denied during quitting when not allowedDuringQuitting', () => {
  const r = evalInline('app:restart', {}, { quitting: true });
  assert.strictEqual(r.allowed, false);
});

test('unknown channel denied by default', () => {
  const r = evalInline('totally-unknown-channel', {}, {});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reasonCode, 'M2_IPC_UNKNOWN_CHANNEL');
});

test('validateSchema: required + additionalProperties', () => {
  assert.strictEqual(guard.validateSchema({ id: 'x' }, inlineManifest.handlers[1].inputSchema).valid, true);
  assert.strictEqual(guard.validateSchema({}, inlineManifest.handlers[1].inputSchema).valid, false);
  assert.strictEqual(guard.validateSchema({ id: 'x', extra: 1 }, inlineManifest.handlers[1].inputSchema).valid, false);
});

test('validateSchema: enum + integer bounds', () => {
  assert.strictEqual(guard.validateSchema('normal', { type: 'string', enum: ['normal', 'safeMode'] }).valid, true);
  assert.strictEqual(guard.validateSchema('weird', { type: 'string', enum: ['normal', 'safeMode'] }).valid, false);
  assert.strictEqual(guard.validateSchema(5, { type: 'integer', minimum: 1, maximum: 200 }).valid, true);
  assert.strictEqual(guard.validateSchema(999, { type: 'integer', minimum: 1, maximum: 200 }).valid, false);
  assert.strictEqual(guard.validateSchema('notint', { type: 'integer' }).valid, false);
});

// ---- 真实契约 manifest 保真断言（仅当 Phase1 文档存在于工作目录时运行） ----
function findRealManifest() {
  const workRoot = path.resolve(process.cwd(), '..', '..', '..');
  try {
    const entries = fs.readdirSync(workRoot);
    const dir = entries.find((e) => e.startsWith('M2_PHASE1_DOCS'));
    if (!dir) return null;
    const p = path.join(workRoot, dir, 'docs', 'architecture', 'M2_IPC_MANIFEST.json');
    return fs.existsSync(p) ? p : null;
  } catch (_) {
    return null;
  }
}

test('real contract manifest: 9 denylist actions all denied', () => {
  const p = findRealManifest();
  if (!p) return; // 契约文档不在工作目录时跳过（不影响核心守卫测试）
  const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const index = guard.indexManifest(manifest);
  assert.strictEqual(index.denylist.length, 9, 'denylist 必须恰好 9 项');
  const expected = ['execute-command', 'read-arbitrary-file', 'write-arbitrary-file', 'delete-file', 'open-sqlite', 'repair-installation', 'rebuild-native', 'kill-process', 'override-release-contract'];
  for (const action of expected) {
    const r = guard.evaluateIpc({ index, channel: action, payload: {}, ctx: {} });
    assert.strictEqual(r.allowed, false, `denylist ${action} 必须被拒绝`);
    assert.strictEqual(r.reasonCode, 'M2_IPC_DENYLIST');
  }
});

test('real contract manifest: every handler has required fields', () => {
  const p = findRealManifest();
  if (!p) return;
  const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const required = ['channel', 'direction', 'phase', 'inputSchema', 'outputSchema', 'requiresBackendReady', 'allowedDuringQuitting', 'allowedDuringRestart', 'reasonCodeOnFailure', 'sensitiveFields'];
  const handlers = (manifest.handlers || []).filter((h) => h.direction === 'renderer-to-main');
  assert.ok(handlers.length >= 40, `renderer-to-main handlers 应 >= 40，实际 ${handlers.length}`);
  for (const h of handlers) {
    for (const f of required) {
      assert.ok(f in h, `handler ${h.channel} 缺字段 ${f}`);
    }
  }
});

test('real contract manifest: requiresBackendReady channel denied before backend ready', () => {
  const p = findRealManifest();
  if (!p) return;
  const manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const index = guard.indexManifest(manifest);
  const r = guard.evaluateIpc({ index, channel: 'desktop:export-chat', payload: { conversationId: 'c1' }, ctx: { backendReady: false } });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reasonCode, 'DESKTOP_BACKEND_NOT_READY');
});
