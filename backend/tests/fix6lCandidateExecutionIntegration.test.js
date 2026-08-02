'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../services/modelRegistry');
const { AiGateway } = require('../services/aiGateway');
const { CandidateExecutionService } = require('../services/candidateExecutionService');
const { ProductionExecutionService } = require('../services/productionExecutionService');
const traceAuthority = require('../services/aiExecutionTraceAuthority');

function conditionalModel(id = 'cloud-conditional') {
  return {
    id,
    name: 'anthropic/claude-opus-5',
    provider: 'openrouter',
    available: true,
    userDisabled: false,
    qualification: 'verified',
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    lastSuccessfulInvocation: { requestId: 'gen-smoke' },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', status: 'REPLY_BRAIN_CONDITIONAL', completed: true, pass: false, score: 97,
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'english_whatsapp', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 24, issues: [] },
        { id: 'director_schema', pass: true, weight: 20, score: 20, issues: [] },
        { id: 'latency', pass: false, weight: 15, score: 13, issues: [] }
      ]
    }
  };
}

test('AiGateway resolves the diagnostic conditional model only for candidate-only execution', t => {
  const model = conditionalModel();
  t.mock.method(registry, 'read', () => ({ models: [model], routes: {} }));
  const gateway = new AiGateway();
  const routeOverride = { enabled: true, primary: model.id, fallback: '', allowConditional: true, humanReviewRequired: true };
  const candidate = gateway.resolveRoute('quick_reply', '', { executionMode: 'candidate-only', routeOverride });
  assert.equal(candidate.primary?.id, model.id);
  assert.equal(candidate.qualityPlan.state, 'conditional');
  assert.equal(candidate.executionMode, 'candidate-only');
  const production = gateway.resolveRoute('quick_reply', '', { executionMode: 'production', routeOverride });
  assert.equal(production.primary, null);
  assert.equal(production.qualityPlan.state, 'blocked');
  assert.equal(production.executionMode, 'production');
});

test('CandidateExecutionService preserves routeTestId and enforces non-deliverable human-reviewed output', async () => {
  traceAuthority.clearForTests();
  const calls = [];
  const fakeGateway = {
    execute: async payload => {
      calls.push(payload);
      return { modelId: 'cloud-conditional', model: 'anthropic/claude-opus-5', text: 'Danke, das ist lieb von dir.', attempts: [], qualityRouteReceipt: { receiptHash: 'candidate' } };
    }
  };
  const service = new CandidateExecutionService({ gateway: fakeGateway, traceAuthority });
  const result = await service.execute({
    task: 'quick_reply',
    routeTestId: 'route-test-123',
    route: { enabled: true, primary: 'cloud-conditional', allowConditional: true },
    messages: [{ role: 'user', content: 'secret' }],
    options: { maxTokens: 220 }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.executionMode, 'candidate-only');
  assert.equal(result.routeTestId, 'route-test-123');
  assert.equal(result.executionMode, 'candidate-only');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.deliveryEligible, false);
  assert.equal(result.learningEligible, false);
  assert.equal(result.formalReceiptEligible, false);
  assert.equal(traceAuthority.get('route-test-123').status, 'completed');
});

test('ProductionExecutionService always forces production mode', async () => {
  const calls = [];
  const service = new ProductionExecutionService({ gateway: { execute: async payload => { calls.push(payload); return { text: 'ok' }; } } });
  const result = await service.execute({ task: 'quick_reply', messages: [], options: { executionMode: 'candidate-only' } });
  assert.equal(calls[0].options.executionMode, 'production');
  assert.equal(result.executionMode, 'production');
});

test('candidate execution trace records route, worker, and provider boundaries without message content', async () => {
  traceAuthority.clearForTests();
  const model = conditionalModel('cloud-traced');
  const fakeRegistry = {
    read: () => ({ models: [model], routes: {} }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const gateway = new AiGateway({
    registry: fakeRegistry,
    executeModel: async () => ({
      text: 'Gern, das passt für mich.',
      requestId: 'gen-provider-123',
      providerRequestId: 'gen-provider-123',
      promptTokens: 4,
      completionTokens: 6
    })
  });
  const service = new CandidateExecutionService({ gateway, traceAuthority });
  const result = await service.execute({
    task: 'quick_reply',
    routeTestId: 'route-test-boundaries',
    route: {
      enabled: true,
      primary: model.id,
      fallback: '',
      allowConditional: true,
      humanReviewRequired: true
    },
    messages: [{ role: 'user', content: 'PRIVATE_MESSAGE_MUST_NOT_ENTER_TRACE' }],
    options: { timeoutMs: 180000, maxTokens: 220 }
  });
  assert.equal(result.routeTestId, 'route-test-boundaries');
  const trace = traceAuthority.get('route-test-boundaries');
  const stages = trace.stages.map(row => row.stage);
  assert.deepEqual(stages, [
    'route-test-started',
    'route-draft-validated',
    'durable-execution-claimed',
    'gateway-route-resolved',
    'worker-started',
    'provider-result',
    'route-test-completed'
  ]);
  const worker = trace.stages.find(row => row.stage === 'worker-started');
  assert.equal(worker.evidence.modelId, model.id);
  assert.equal(worker.evidence.workerStarted, true);
  const provider = trace.stages.find(row => row.stage === 'provider-result');
  assert.equal(provider.evidence.providerRequestId, 'gen-provider-123');
  assert.equal(JSON.stringify(trace).includes('PRIVATE_MESSAGE_MUST_NOT_ENTER_TRACE'), false);
});
