'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const AUTH_PATH = 'governance/layered-ci/v21-model-brain-p0-authorization.json';
const EXPECTED_SCOPE_SHA256 = '1a27502a3fb1741f16bc6bb795d75c9bd80043e58e182f9229bfec54471099a5';
const EXPECTED_LITELLM_COMMIT = '72a4a55f43ea7266de589f005d0d33624fe5d555';
const EXPECTED_LITELLM_TREE = 'cb54d17e6ce0a0ad98c992f9642957faa998bbca';

const repoPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repoPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing Model Brain P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}
function readJson(relativePath) { return JSON.parse(readText(relativePath)); }
function canonicalPathSetSha256(paths) {
  const normalized = [...new Set(paths.map(value => String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '').trim()).filter(Boolean))].sort();
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

test('V2.1 Model Brain P0 authorization is exact, mature-OSS-first and implementation-bound', () => {
  const auth = readJson(AUTH_PATH);
  assert.equal(auth.workPackage, 'V21-MODEL-BRAIN-P0');
  assert.equal(auth.implementation.branch, 'product/v21-model-brain-p0');
  assert.equal(auth.implementation.approvedChangedFileCount, 21);
  assert.equal(auth.implementation.approvedChangedFileSetSha256, EXPECTED_SCOPE_SHA256);
  assert.equal(canonicalPathSetSha256(auth.implementation.allowedChangedPaths), EXPECTED_SCOPE_SHA256);
  assert.equal(auth.upstreams.liteLLM.release, 'v1.95.0');
  assert.equal(auth.upstreams.liteLLM.commit, EXPECTED_LITELLM_COMMIT);
  assert.equal(auth.upstreams.liteLLM.coreSourceTree, EXPECTED_LITELLM_TREE);
  assert.equal(auth.routingOssFitDecision.secondYanceRouterAllowed, false);
  assert.equal(auth.hardEligibilityAndTagPolicy.liteLLMEnableTagFilteringRequired, true);
  assert.equal(auth.hardEligibilityAndTagPolicy.liteLLMTagFilteringMatchAnyRequired, false);
  assert.equal(auth.hardEligibilityAndTagPolicy.defaultDeploymentFallbackForbiddenForMandatoryTaggedRequests, true);
  for (const forbidden of ['package.json', 'package-lock.json', 'THIRD_PARTY_NOTICES.md', 'backend/services/contextAwareReplyBrain.js']) {
    assert.equal(auth.implementation.allowedChangedPaths.includes(forbidden), false, `${forbidden} must stay outside Model Brain P0`);
  }
});

test('production aiGateway is a logical Model Brain facade and no longer preselects physical provider/model', () => {
  const gateway = readText('backend/services/aiGateway.js');
  const runtime = readText('backend/services/modelBrainRuntime.js');
  const projection = readText('backend/services/modelBrainProjection.js');

  assert.match(gateway, /require\(['"]\.\/modelBrainRuntime['"]\)/u, 'aiGateway must delegate production inference to modelBrainRuntime');
  assert.match(gateway, /modelBrainRuntime/u);
  assert.match(projection, /modelGroup|logicalModel|logical model/iu, 'projection must produce a logical LiteLLM routing target');
  assert.match(projection, /tags/iu, 'projection must carry hard eligibility tags');
  assert.doesNotMatch(projection, /selectionScore|familyQuality|roleScore|rankForRole|preferredRoute|frontierCandidate/iu, 'projection must not revive legacy physical-model scoring');

  assert.doesNotMatch(gateway, /require\(['"]\.\/modelExecutionHost['"]\)|\bstartModelExecution\b/u, 'legacy execution host must be unreachable from production aiGateway');
  assert.doesNotMatch(gateway, /aiQualityRouteAuthority\.routePlan|aiQualityRouteAuthority\.classifyFailure/u, 'legacy quality authority must not choose retries/fallbacks');
  assert.doesNotMatch(gateway, /workloadPlacementAuthority\.rankCandidates|providerDomainAuthority\.providerFailureDomain/u, 'Yance must not pre-rank physical deployments or own provider failure domains');
  assert.doesNotMatch(gateway, /\bthis\.resolveRoute\(task|\broute\.primary\b|\broute\.fallback\b|\broute\.emergency\b/u, 'production execution must not construct primary/fallback/emergency physical candidates');
  assert.doesNotMatch(gateway, /providerKeyForModel\(routeResolution|physicalProviderKey/u, 'JobQueue providerKey must not be derived from a physical model/provider');
  assert.match(runtime, /stdin|stdout|stdio/iu, 'Model Brain runtime must use private child stdio IPC');
});

test('logical task projection preserves product policy while LiteLLM owns physical availability and routing', () => {
  const projection = readText('backend/services/modelBrainProjection.js');
  const runtime = readText('backend/services/modelBrainRuntime.js');
  for (const signal of ['privacy', 'vision', 'audio', 'video', 'language', 'context']) {
    assert.match(projection, new RegExp(signal, 'iu'), `projection must preserve ${signal} eligibility signal`);
  }
  assert.doesNotMatch(projection, /cooldown|consecutiveFailure|circuitOpened|retryAfter|providerHealth/iu, 'transient provider health belongs to LiteLLM');
  assert.doesNotMatch(runtime, /ollamaClient|openAiCompatibleClient|modelExecutionHost/iu, 'new runtime must not fall back to legacy provider executors');
});
