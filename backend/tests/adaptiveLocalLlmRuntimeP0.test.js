'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function feature(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    assert.fail(`adaptive local runtime feature is missing at ${modulePath}: ${error.code || error.message}`);
  }
}

test('adaptive planner does not reduce a low-VRAM machine to small-model-only when measured hybrid evidence is usable', () => {
  const { classifyCandidate } = feature('../services/adaptiveLocalRuntimePlanner');
  const result = classifyCandidate({
    hardware: {
      platform: 'win32',
      cpuThreads: 12,
      memoryTotalBytes: 16 * 1024 ** 3,
      memoryFreeBytes: 13 * 1024 ** 3,
      diskFreeBytes: 160 * 1024 ** 3,
      gpus: [{ name: 'low-vram-gpu', vramBytes: 2 * 1024 ** 3 }]
    },
    runtime: {
      id: 'llama.cpp',
      supportsCpuGpuHybrid: true,
      provenance: { upstreamCommit: 'f401bb139016c7994298d21ebb1d07b8f9e4d50b' }
    },
    model: {
      id: 'larger-q4-model',
      parameterCountB: 14,
      quantizedBytes: 9 * 1024 ** 3
    },
    benchmark: {
      measured: true,
      tokensPerSecond: 7.2,
      firstTokenMs: 1800,
      residentRamBytes: 11 * 1024 ** 3
    }
  });
  assert.equal(result.capabilityClass, 'usable');
  assert.equal(result.executionMode, 'cpu-gpu-hybrid');
  assert.equal(result.blockedByVramOnly, false);
  assert.equal(result.evidence.measured, true);
});

test('planner distinguishes interactive, usable, background, extreme and incompatible from evidence rather than parameter count', () => {
  const { classifyCandidate, CAPABILITY_CLASSES } = feature('../services/adaptiveLocalRuntimePlanner');
  assert.deepEqual(CAPABILITY_CLASSES, ['interactive', 'usable', 'background', 'extreme', 'incompatible']);
  const base = {
    hardware: { platform: 'win32', cpuThreads: 8, memoryTotalBytes: 16 * 1024 ** 3, memoryFreeBytes: 12 * 1024 ** 3, diskFreeBytes: 100 * 1024 ** 3, gpus: [{ vramBytes: 2 * 1024 ** 3 }] },
    runtime: { id: 'llama.cpp', supportsCpuGpuHybrid: true, provenance: { upstreamCommit: 'f401bb139016c7994298d21ebb1d07b8f9e4d50b' } },
    model: { id: 'q4', parameterCountB: 14, quantizedBytes: 8 * 1024 ** 3 }
  };
  assert.equal(classifyCandidate({ ...base, benchmark: { measured: true, tokensPerSecond: 20, firstTokenMs: 500, residentRamBytes: 10 * 1024 ** 3 } }).capabilityClass, 'interactive');
  assert.equal(classifyCandidate({ ...base, benchmark: { measured: true, tokensPerSecond: 5, firstTokenMs: 2500, residentRamBytes: 10 * 1024 ** 3 } }).capabilityClass, 'usable');
  assert.equal(classifyCandidate({ ...base, benchmark: { measured: true, tokensPerSecond: 1.5, firstTokenMs: 9000, residentRamBytes: 10 * 1024 ** 3 } }).capabilityClass, 'background');
  assert.equal(classifyCandidate({ ...base, runtime: { id: 'airllm', supportsLayerStreaming: true, provenance: { upstreamCommit: 'cfe456e5e1c28ea046f16cc835743f141e8ac9b8' } }, benchmark: { measured: true, tokensPerSecond: 0.15, firstTokenMs: 65000, residentRamBytes: 8 * 1024 ** 3 } }).capabilityClass, 'extreme');
  assert.equal(classifyCandidate({ ...base, hardware: { ...base.hardware, memoryFreeBytes: 2 * 1024 ** 3 }, benchmark: { measured: true, tokensPerSecond: 0, firstTokenMs: 0, residentRamBytes: 10 * 1024 ** 3 } }).capabilityClass, 'incompatible');
});

test('execution spec admits credentialless local OpenAI-compatible runtimes only on loopback', () => {
  const { resolveModelExecutionSpec } = require('../services/modelExecutionSpecResolver');
  const llama = resolveModelExecutionSpec({ id: 'llama-local', provider: 'llama.cpp', endpoint: 'http://127.0.0.1:8081', name: 'qwen-q4' });
  assert.equal(llama.provider, 'llama.cpp');
  assert.equal(llama.transport, 'openai-compatible-local');
  assert.equal(llama.credential, undefined);
  const kt = resolveModelExecutionSpec({ id: 'kt-local', provider: 'ktransformers', endpoint: 'http://localhost:10002/v1', name: 'deepseek-moe' });
  assert.equal(kt.transport, 'openai-compatible-local');
  assert.throws(
    () => resolveModelExecutionSpec({ id: 'unsafe-local', provider: 'llama.cpp', endpoint: 'http://192.168.1.9:8081', name: 'qwen-q4' }),
    error => error.code === 'LOCAL_OPENAI_ENDPOINT_NOT_LOOPBACK'
  );
});

test('isolated physical execution dispatches llama.cpp/KTransformers through the local OpenAI seam and AirLLM through its background worker', async () => {
  const { executeIsolatedModel } = require('../services/isolatedModelExecutor');
  const localCalls = [];
  const airCalls = [];
  const clients = {
    cloud: { async chat() { throw new Error('cloud must not be used'); } },
    ollama: { async streamChat() { throw new Error('ollama must not be used'); } },
    localOpenAi: { async chat(input) { localCalls.push(input); return { text: 'local-ok' }; } },
    airllm: { async execute(input) { airCalls.push(input); return { text: 'air-ok', executionClass: 'extreme' }; } }
  };
  assert.deepEqual(
    await executeIsolatedModel({ provider: 'llama.cpp', endpoint: 'http://127.0.0.1:8081', modelName: 'qwen-q4', modelId: 'llama-1' }, [{ role: 'user', content: 'hi' }], { timeoutMs: 2000 }, null, clients),
    { text: 'local-ok' }
  );
  assert.deepEqual(
    await executeIsolatedModel({ provider: 'ktransformers', endpoint: 'http://localhost:10002/v1', modelName: 'moe', modelId: 'kt-1' }, [], {}, null, clients),
    { text: 'local-ok' }
  );
  assert.deepEqual(
    await executeIsolatedModel({ provider: 'airllm', modelName: 'large-model', modelId: 'air-1', runtime: { workerPath: 'runtime/local-ai/airllm/yance_airllm_worker.py' } }, [], {}, null, clients),
    { text: 'air-ok', executionClass: 'extreme' }
  );
  assert.equal(localCalls.length, 2);
  assert.equal(localCalls[0].apiKey, '');
  assert.equal(airCalls.length, 1);
});

test('ModelRuntimeAuthority treats admitted loopback runtimes as local identities without inventing credential requirements', () => {
  const authority = require('../services/modelRuntimeAuthority');
  for (const provider of ['ollama', 'llama.cpp', 'ktransformers', 'airllm']) assert.equal(authority.isLocalProvider(provider), true);
  const projected = authority.projectModel({
    id: 'llama-local',
    provider: 'llama.cpp',
    endpoint: 'http://127.0.0.1:8081',
    name: 'qwen-q4',
    available: true,
    qualification: 'verified',
    lastInvocationStatus: 'success',
    lastSuccessfulInvocation: { at: '2026-08-21T00:00:00.000Z', latencyMs: 1000 }
  }, { localRuntimeOnline: { 'llama.cpp': true } });
  assert.equal(projected.configured, true);
  assert.equal(projected.credentialReady, true);
  assert.equal(projected.discovered, true);
  assert.equal(projected.reachable, true);
  assert.equal(projected.runtimeAvailable, true);
});

test('Ollama pull exposes progress and uses the caller abort signal', async () => {
  const ollama = require('../services/ollamaClient');
  const progress = [];
  const controller = new AbortController();
  let captured;
  const encoder = new TextEncoder();
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(stream) {
          stream.enqueue(encoder.encode('{"status":"pulling manifest"}\n'));
          stream.enqueue(encoder.encode('{"status":"downloading","digest":"sha256:abc","total":100,"completed":40}\n'));
          stream.enqueue(encoder.encode('{"status":"success"}\n'));
          stream.close();
        }
      }),
      async text() { return ''; }
    };
  };
  const result = await ollama.pullModel({ endpoint: 'http://127.0.0.1:11434', model: 'qwen:14b', signal: controller.signal, onProgress: row => progress.push(row), fetchImpl });
  assert.equal(captured.url, 'http://127.0.0.1:11434/api/pull');
  assert.equal(captured.init.signal, controller.signal);
  assert.deepEqual(JSON.parse(captured.init.body), { model: 'qwen:14b', stream: true });
  assert.equal(progress.some(row => row.completed === 40 && row.total === 100), true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
});

test('local artifact preflight is fail-closed on consent, disk and SHA-256 provenance', () => {
  const asset = feature('../services/localAiRuntimeAssetService');
  const good = asset.validateMaterializationRequest({
    consent: true,
    localAssetPath: 'C:/Users/me/Downloads/llama-runtime.zip',
    expectedSha256: 'a'.repeat(64),
    actualSha256: 'a'.repeat(64),
    requiredBytes: 1024,
    freeDiskBytes: 4096
  });
  assert.equal(good.ok, true);
  assert.throws(() => asset.validateMaterializationRequest({ ...good, consent: false }), error => error.code === 'LOCAL_RUNTIME_CONSENT_REQUIRED');
  assert.throws(() => asset.validateMaterializationRequest({ ...good, consent: true, actualSha256: 'b'.repeat(64) }), error => error.code === 'LOCAL_RUNTIME_ASSET_HASH_MISMATCH');
  assert.throws(() => asset.validateMaterializationRequest({ ...good, consent: true, actualSha256: 'a'.repeat(64), requiredBytes: 8192, freeDiskBytes: 4096 }), error => error.code === 'LOCAL_RUNTIME_DISK_PREFLIGHT_FAILED');
});