'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = '../services/productAiWorkspaceService';

function fixture() {
  const meta = new Map();
  const store = {
    getMeta(key, fallback = null) { return meta.has(key) ? structuredClone(meta.get(key)) : fallback; },
    setMeta(key, value) { meta.set(key, structuredClone(value)); }
  };
  const contexts = {
    c1: {
      contact: { id: 'c1', name: 'Alice', displayName: 'Alice' },
      insights: { summary: '最近互动稳定', relationshipStage: '熟悉互动', momentum: 'stable', openLoops: [{ id: 'loop-1', text: '待确认周末安排' }], evidence: [{ messageId: 'm1' }] },
      conversations: [{ sessionKey: 'conv-1', conversationId: 'conv-1', title: 'Alice' }]
    },
    c2: {
      contact: { id: 'c2', name: 'Bob', displayName: 'Bob' },
      insights: { summary: '近期互动升温', relationshipStage: '关系升温', momentum: 'improving', openLoops: [], evidence: [{ messageId: 'm2' }] },
      conversations: [{ sessionKey: 'conv-2', conversationId: 'conv-2', title: 'Bob' }]
    }
  };
  const messages = {
    'conv-1': [{ id: 'm1', sourceText: '周末一起吃饭吗？', sentAt: '2026-09-24T08:00:00.000Z', fromMe: false }],
    'conv-2': [{ id: 'm2', sourceText: '今天聊得很开心。', sentAt: '2026-09-24T09:00:00.000Z', fromMe: false }]
  };
  const workspaceData = {
    listContacts() { return [{ id: 'c1', displayName: 'Alice' }, { id: 'c2', displayName: 'Bob' }]; },
    getContactContext(id) { return structuredClone(contexts[id]); },
    latestMessages(sessionKey) { return structuredClone(messages[sessionKey] || []); }
  };
  const gatewayCalls = [];
  const aiGateway = {
    async execute(payload) {
      gatewayCalls.push(structuredClone(payload));
      return {
        modelId: 'verified-model', model: 'Verified Model',
        structured: {
          summary: 'Bob 的关系趋势更积极。',
          ranked: [
            { contactId: 'c2', reason: '最近互动升温', signals: ['关系升温'], evidenceRefs: ['m2'] },
            { contactId: 'ghost', reason: '不存在', signals: ['伪造'], evidenceRefs: ['fake'] }
          ]
        }
      };
    }
  };
  return { store, workspaceData, aiGateway, gatewayCalls, meta };
}

test('AI Workspace tasks persist through the mature R32 metadata seam and keep auto-send disabled', () => {
  const { createProductAiWorkspaceService, META_KEY } = require(servicePath);
  const f = fixture();
  let tick = 0;
  const service = createProductAiWorkspaceService({
    store: f.store, workspaceData: f.workspaceData, aiGateway: f.aiGateway,
    clock: () => `2026-09-25T06:00:0${tick++}.000Z`, idFactory: () => `task-${tick}`
  });
  const created = service.createTask({ title: '关系机会', prompt: '找出最近值得继续投入的关系', contactIds: ['c1','c2'] });
  assert.equal(created.saved, false);
  assert.equal(created.autoSend, false);
  assert.deepEqual(created.contactIds, ['c1','c2']);
  assert.ok(f.meta.has(META_KEY));
  const saved = service.updateTask(created.id, { saved: true, resultLimit: 3, timeRangeDays: 7 });
  assert.equal(saved.saved, true);
  assert.equal(saved.resultLimit, 3);
  assert.throws(() => service.updateTask(created.id, { autoSend: true }), error => error.code === 'AI_WORKSPACE_AUTO_SEND_FORBIDDEN');
  assert.equal(service.listTasks().length, 1);
});

test('AI Workspace run uses real scoped messages and filters model output back to canonical contacts and evidence', async () => {
  const { createProductAiWorkspaceService } = require(servicePath);
  const f = fixture();
  const service = createProductAiWorkspaceService({
    store: f.store, workspaceData: f.workspaceData, aiGateway: f.aiGateway,
    clock: () => '2026-09-25T06:10:00.000Z', idFactory: () => 'task-real'
  });
  service.createTask({ id: 'task-real', title: '比较', prompt: '比较最近关系趋势', contactIds: ['c1','c2'], modelId: 'verified-model', timeRangeDays: 7 });
  const result = await service.runTask('task-real');
  assert.equal(f.gatewayCalls.length, 1);
  assert.equal(f.gatewayCalls[0].task, 'relationship');
  assert.equal(f.gatewayCalls[0].modelId, 'verified-model');
  assert.match(JSON.stringify(f.gatewayCalls[0].messages), /m1/u);
  assert.match(JSON.stringify(f.gatewayCalls[0].messages), /m2/u);
  assert.deepEqual(result.ranked.map(row => row.contactId), ['c2']);
  assert.deepEqual(result.ranked[0].evidenceRefs, ['m2']);
  assert.equal(result.boundary.autoSend, false);
  assert.equal(result.boundary.promotesAnalysisToFact, false);
});

test('AI Workspace fails closed on untrusted model output and preserves the last good result', async () => {
  const { createProductAiWorkspaceService } = require(servicePath);
  const f = fixture();
  let invalid = false;
  const gateway = {
    async execute(payload) {
      if (!invalid) return f.aiGateway.execute(payload);
      return { modelId: 'verified-model', structured: { summary: '伪造结果', ranked: [{ contactId: 'ghost', reason: '不存在', evidenceRefs: ['fake'] }] } };
    }
  };
  const service = createProductAiWorkspaceService({
    store: f.store, workspaceData: f.workspaceData, aiGateway: gateway,
    clock: () => '2026-09-25T06:20:00.000Z', idFactory: () => 'task-safe'
  });
  service.createTask({ id: 'task-safe', title: '可信比较', prompt: '比较关系', contactIds: ['c1','c2'] });
  const good = await service.runTask('task-safe');
  invalid = true;
  await assert.rejects(() => service.runTask('task-safe'), error => error.code === 'AI_WORKSPACE_RESULT_UNTRUSTED');
  const task = service.getTask('task-safe');
  assert.equal(task.lastResult.summary, good.summary);
  assert.equal(task.lastRunStatus, 'failed');
});

test('AI Workspace default scope is canonical active contacts and time window filters old messages', async () => {
  const { createProductAiWorkspaceService } = require(servicePath);
  const f = fixture();
  f.workspaceData.latestMessages = sessionKey => [
    { id: `${sessionKey}-old`, sourceText: '很久以前', sentAt: '2025-01-01T00:00:00.000Z', fromMe: false },
    ...(sessionKey === 'conv-1' ? [{ id:'m1', sourceText:'昨天', sentAt:'2026-09-24T08:00:00.000Z', fromMe:false }] : [{ id:'m2', sourceText:'昨天', sentAt:'2026-09-24T09:00:00.000Z', fromMe:false }])
  ];
  const service = createProductAiWorkspaceService({
    store: f.store, workspaceData: f.workspaceData, aiGateway: f.aiGateway,
    clock: () => '2026-09-25T06:30:00.000Z', idFactory: () => 'task-all'
  });
  service.createTask({ id:'task-all', title:'全部关系', prompt:'比较全部', contactIds:[], timeRangeDays:7 });
  await service.runTask('task-all');
  const userMessage = f.gatewayCalls[0].messages.find(message => message.role === 'user');
  const prompt = JSON.parse(String(userMessage?.content || '{}'));
  assert.deepEqual(prompt.contacts.map(row => row.contactId), ['c1', 'c2']);
  assert.doesNotMatch(JSON.stringify(prompt), /很久以前/u);
});
