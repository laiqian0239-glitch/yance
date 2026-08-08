'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const LITELLM_VERSION = 'v1.95.0';
const LITELLM_COMMIT = '72a4a55f43ea7266de589f005d0d33624fe5d555';
const LITELLM_TREE = 'cb54d17e6ce0a0ad98c992f9642957faa998bbca';
const LITELLM_UV_LOCK_BLOB = '08d10667fb1fde67211a74ad1d4c747c0fb84cf3';

const repoPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repoPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing sealed Model Brain runtime file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}
function readJson(relativePath) { return JSON.parse(readText(relativePath)); }

test('upstream descriptor pins LiteLLM base SDK source/lock and excludes open-core proxy/enterprise workspaces', () => {
  const upstream = readJson('config/upstreams/v21-model-brain-p0.json');
  const encoded = JSON.stringify(upstream);
  assert.match(encoded, new RegExp(LITELLM_VERSION.replace('.', '\\.'), 'u'));
  assert.match(encoded, new RegExp(LITELLM_COMMIT, 'u'));
  assert.match(encoded, new RegExp(LITELLM_TREE, 'u'));
  assert.match(encoded, new RegExp(LITELLM_UV_LOCK_BLOB, 'u'));
  assert.match(encoded, /MIT/iu);
  assert.match(encoded, /litellm\//u);
  assert.match(encoded, /enterprise/iu, 'descriptor must record the excluded enterprise boundary');
  assert.match(encoded, /proxy/iu, 'descriptor must record the excluded proxy boundary');
  assert.doesNotMatch(encoded, /litellm\[proxy\]/u, 'proxy extra may only appear in an explicit forbidden list, never as an install target');
});

test('Python worker uses upstream LiteLLM Router/ComplexityRouter directly with strict hard-tag semantics', () => {
  const worker = readText('runtime/model-brain/yance_litellm_worker.py');
  assert.match(worker, /from\s+litellm\s+import\s+Router|litellm\.Router/u, 'worker must instantiate upstream LiteLLM Router');
  assert.match(worker, /ComplexityRouter/u, 'complexity routing must use upstream LiteLLM ComplexityRouter');
  assert.match(worker, /enable_tag_filtering\s*=\s*True|["']enable_tag_filtering["']\s*:\s*True/u, 'tag filtering must be enabled');
  assert.match(worker, /tag_filtering_match_any\s*=\s*False|["']tag_filtering_match_any["']\s*:\s*False/u, 'mandatory tags require AND semantics');
  assert.doesNotMatch(worker, /familyQuality|qualityTier|roleScore|rankForRole|selectionScore|preferredRoute|frontierCandidate/iu, 'worker must not copy Yance routing/scoring algorithms');
  assert.doesNotMatch(worker, /class\s+(?:Yance|ModelBrain).*(?:Router|Gateway)|def\s+(?:rank|score)_provider/iu, 'no second Yance router/gateway may be implemented in Python');
});

test('persistent child secret transport is private stdio memory only, never environment or command line', () => {
  const runtime = readText('backend/services/modelBrainRuntime.js');
  const worker = readText('runtime/model-brain/yance_litellm_worker.py');
  const combined = `${runtime}\n${worker}`;
  assert.match(runtime, /stdin|stdio/iu);
  assert.match(runtime, /JSON\.stringify|NDJSON|newline/iu);
  assert.doesNotMatch(runtime, /OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|apiKey\s*:\s*process\.env/iu, 'provider secrets must not be injected through persistent child env');
  assert.doesNotMatch(combined, /console\.log\([^\n]*(?:apiKey|token|secret)|print\([^\n]*(?:api_key|token|secret)/iu, 'worker/runtime must not log secrets');
  assert.match(worker, /api_key|credential/iu, 'worker must accept in-memory credential material from the trusted parent');
});

test('runtime and build scripts forbid runtime dependency resolution and enterprise/proxy installation', () => {
  const runtime = readText('backend/services/modelBrainRuntime.js');
  const worker = readText('runtime/model-brain/yance_litellm_worker.py');
  const build = readText('tools/model-brain/build-windows-runtime.ps1');
  const allRuntime = `${runtime}\n${worker}`;
  assert.doesNotMatch(allRuntime, /\b(?:pip|uv)\s+(?:install|sync)|subprocess[^\n]*(?:pip|uv)|git\s+clone|curl\s+http|Invoke-WebRequest/iu, 'application runtime must never resolve dependencies online');
  assert.doesNotMatch(build, /litellm\[proxy\]|litellm-enterprise|litellm-proxy-extras/iu, 'build must never install proxy/enterprise distributions');
  assert.match(build, /uv\.lock|08d10667fb1fde67211a74ad1d4c747c0fb84cf3/iu, 'build must bind dependency materialization to the exact upstream lock authority');
  assert.match(build, /--no-dev|--no-group|--no-default-groups|--no-install-workspace|--no-emit-workspace|--no-install-project|--no-emit-project/iu, 'build must exclude dev/workspace/root project installation');
});

test('sealed runtime evidence includes deterministic CycloneDX SBOM and enterprise-absence assertions', () => {
  const sbom = readText('runtime/model-brain/generate_runtime_sbom.py');
  const workflow = readText('.github/workflows/v21-model-brain-p0-windows.yml');
  assert.match(sbom, /CycloneDX|cyclonedx/iu);
  assert.match(sbom, /1\.7/u);
  assert.match(sbom, /sha256/iu);
  assert.match(workflow, /windows-latest/iu);
  assert.match(workflow, /offline|proxy|network/iu, 'Windows closure must include an offline/dead-proxy runtime proof');
  assert.match(workflow, /litellm-enterprise|litellm-proxy-extras|enterprise/iu, 'Windows closure must prove forbidden open-core modules/distributions are absent');
  assert.match(workflow, /Router|ComplexityRouter|tag_filtering/iu, 'Windows closure must exercise the actual mature OSS routing path');
});
