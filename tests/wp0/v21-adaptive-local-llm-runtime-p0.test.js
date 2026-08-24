'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const exists = relative => fs.existsSync(path.join(ROOT, relative));

const AUTHORIZATION_MERGE = '7ad15ec69b9d1fcba1eb1d2d590f48ddaad4bd44';
const LLAMA_COMMIT = 'f401bb139016c7994298d21ebb1d07b8f9e4d50b';
const KTRANSFORMERS_COMMIT = '95009ea6856c0799e517e93cb12be5e8494bc7ce';
const AIRLLM_COMMIT = 'cfe456e5e1c28ea046f16cc835743f141e8ac9b8';
const LLAMA_CUDA_SHA256 = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6';

test('adaptive runtime production modules, pinned manifests and user-facing catalog exist', () => {
  const required = [
    'backend/services/adaptiveLocalRuntimePlanner.js',
    'backend/services/localAiHardwareProfile.js',
    'backend/services/localAiModelCatalog.js',
    'backend/services/localAiRuntimeAssetService.js',
    'backend/services/llamaCppRuntimeAdapter.js',
    'backend/services/airllmRuntimeAdapter.js',
    'config/local-ai/adaptive-local-model-catalog-v1.json',
    'config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json',
    'runtime/local-ai/airllm/yance_airllm_worker.py',
    'tools/local-ai/materialize-adaptive-runtimes.js'
  ];
  for (const relative of required) assert.equal(exists(relative), true, `${relative} must exist`);
});

test('upstream manifest pins exact admitted OSS provenance and does not claim unsupported native Windows KTransformers', () => {
  const manifest = json('config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json');
  assert.equal(manifest.schemaVersion, 1);
  const byId = new Map(manifest.runtimes.map(row => [row.id, row]));
  assert.equal(byId.get('llama.cpp').repository, 'ggml-org/llama.cpp');
  assert.equal(byId.get('llama.cpp').tag, 'b10336');
  assert.equal(byId.get('llama.cpp').commit, LLAMA_COMMIT);
  assert.equal(byId.get('llama.cpp').license, 'MIT');
  assert.equal(byId.get('llama.cpp').artifacts.some(row => row.sha256 === LLAMA_CUDA_SHA256), true);
  assert.equal(byId.get('ktransformers').repository, 'kvcache-ai/ktransformers');
  assert.equal(byId.get('ktransformers').commit, KTRANSFORMERS_COMMIT);
  assert.equal(byId.get('ktransformers').license, 'Apache-2.0');
  assert.equal(byId.get('ktransformers').nativeWindowsSupported, false);
  assert.equal(byId.get('ktransformers').wslOrUserManaged, true);
  assert.equal(byId.get('airllm').repository, 'lyogavin/airllm');
  assert.equal(byId.get('airllm').commit, AIRLLM_COMMIT);
  assert.equal(byId.get('airllm').packageVersion, '3.1.0');
  assert.equal(byId.get('airllm').license, 'Apache-2.0');
  assert.deepEqual(byId.get('airllm').allowedCapabilityClasses, ['background', 'extreme']);
});

test('catalog expresses downloadable lifecycle and larger-model recommendations without VRAM-only censorship', () => {
  const catalog = json('config/local-ai/adaptive-local-model-catalog-v1.json');
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.lowResourceDoesNotMeanSmallModelOnly, true);
  assert.equal(Array.isArray(catalog.models) && catalog.models.length > 0, true);
  assert.equal(catalog.models.some(model => Number(model.parameterCountB || 0) >= 14 && model.runtimeCandidates.includes('llama.cpp')), true);
  for (const model of catalog.models) {
    assert.equal(typeof model.download?.requiresExplicitConsent, 'boolean');
    assert.equal(model.download?.requiresExplicitConsent, true);
    assert.equal(model.download?.progress, true);
    assert.equal(model.download?.cancellable, true);
    assert.equal(model.download?.diskPreflight, true);
  }
});

test('third-party notice and license custody covers every newly admitted OSS runtime', () => {
  const notice = read('THIRD_PARTY_NOTICES.md');
  for (const token of ['ggml-org/llama.cpp', 'kvcache-ai/ktransformers', 'lyogavin/airllm', LLAMA_COMMIT, KTRANSFORMERS_COMMIT, AIRLLM_COMMIT]) assert.match(notice, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.match(read('third_party/licenses/llama.cpp-MIT.txt'), /MIT License/u);
  assert.match(read('third_party/licenses/ktransformers-Apache-2.0.txt'), /Apache License/u);
  assert.match(read('third_party/licenses/airllm-Apache-2.0.txt'), /Apache License/u);
});

test('models API exposes catalog, plan, materialize/status/remove and Ollama pull lifecycle endpoints', () => {
  const source = read('backend/routes/models.js');
  for (const route of [
    '/adaptive-local/catalog',
    '/adaptive-local/plan',
    '/adaptive-local/materialize',
    '/adaptive-local/status',
    '/adaptive-local/remove',
    '/ollama/pull',
    '/ollama/pull/cancel'
  ]) assert.match(source, new RegExp(route.replaceAll('/', '\\/'), 'u'));
});

test('active Element Product surfaces adaptive runtime state and user-controlled install/remove/download actions', () => {
  const surface = read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');

  assert.match(shell, /ProductSystemSettingsSurface/u);
  for (const token of ['自适应本地', '本地模型', '安装', '取消', '移除', '下载']) {
    assert.match(surface, new RegExp(token, 'u'), `missing active Product token ${token}`);
  }
  for (const action of [
    'plan-adaptive-local',
    'materialize-adaptive-runtime',
    'remove-adaptive-runtime',
    'pull-ollama-model',
    'cancel-ollama-pull'
  ]) assert.match(surface + bridge, new RegExp(action, 'u'));
  for (const channel of [
    'store:product-system-model-runtime-state',
    'store:product-system-model-runtime-mutation'
  ]) assert.match(bridge + preload, new RegExp(channel, 'u'));
  assert.match(bridge, /\/api\/r32\/models\/adaptive-local\/catalog/u);
  assert.match(bridge, /\/api\/r32\/models\/adaptive-local\/plan/u);
  assert.match(bridge, /\/api\/r32\/models\/adaptive-local\/materialize/u);
  assert.match(bridge, /\/api\/r32\/models\/adaptive-local\/remove/u);
});

test('formal quick/deep/director Model Brain authority stays LiteLLM and local runtime cannot become a silent formal fallback', () => {
  const projection = require('../../backend/services/modelBrainProjection');
  for (const task of ['quick_reply', 'deep_reply', 'director']) {
    const view = projection.project({ models: [] }, { task });
    assert.equal(view.authority, 'LiteLLM v1.95.0');
    assert.equal(view.modelBrain, 'Model Brain');
  }
  const gateway = read('backend/services/aiGateway.js');
  assert.equal(/airllm[^\n]{0,120}(fallback|retry)|llama\.cpp[^\n]{0,120}(fallback|retry)|ktransformers[^\n]{0,120}(fallback|retry)/iu.test(gateway), false);
});

test('implementation diff does not contain committed model/runtime binaries or oversized runtime archives', () => {
  let changed = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${AUTHORIZATION_MERGE}...HEAD`], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean);
  } catch (error) {
    assert.fail(`git diff against authorization merge must be available: ${error.message}`);
  }

  const forbidden = /\.(?:gguf|ggml|safetensors|bin|onnx|pt|pth|zip|7z|tar|gz|xz|dll|exe|so|dylib)$/iu;
  assert.deepEqual(changed.filter(file => forbidden.test(file)), []);

  const dependencyPolicy = json('governance/dependency-install-policy.json');
  assert.equal(Array.isArray(dependencyPolicy.trustedCacheSeeds), true);
  const trustedSeeds = new Map(dependencyPolicy.trustedCacheSeeds.map(seed => [seed.archivePath, seed]));
  assert.equal(trustedSeeds.size, dependencyPolicy.trustedCacheSeeds.length, 'trusted cache seed archive paths must be unique');

  for (const file of changed) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    if (fs.statSync(absolute).size < 1024 * 1024) continue;

    const seed = trustedSeeds.get(file);
    if (seed) {
      assert.equal(seed.archivePath, file);
      assert.equal(seed.source, 'npm-official-tarball', `${file} must use official npm tarball custody`);
      assert.match(seed.resolved, /^https:\/\/registry\.npmjs\.org\/.+\.tgz$/u, `${file} must bind an official npm registry tarball`);
      assert.match(seed.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `${file} must bind npm SHA-512 integrity`);
      assert.match(seed.archiveSha256, /^[0-9a-f]{64}$/u, `${file} must bind archive SHA-256`);
      const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      assert.equal(actualSha256, seed.archiveSha256, `${file} physical bytes must match trusted cache-seed SHA-256`);
      continue;
    }

    assert.equal(file, 'release/production-dependency-binding.json', `${file} unexpectedly carries a large artifact without exact trusted authority`);
    const binding = json(file);
    assert.equal(binding.documentType, 'YANCE_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING');
    assert.equal(binding.generatedBy, 'tools/wp7/generate-production-dependency-binding.js');
    assert.equal(binding.packageManager, 'npm@10.9.2');
    assert.equal(binding.lockfileVersion, 3);
    assert.deepEqual(binding.platformKeys, ['linux-x64', 'win32-x64']);
    const packageJsonSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package.json'))).digest('hex');
    const packageLockSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
    assert.equal(binding.packageJsonSha256, packageJsonSha256, 'canonical binding must match current package.json SHA-256');
    assert.equal(binding.packageLockSha256, packageLockSha256, 'canonical binding must match current package-lock.json SHA-256');
  }
});
