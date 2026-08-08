'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const repoPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repoPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing Model Brain retirement target: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('legacy direct provider executors are removed from every authorized production inference entry', () => {
  const executor = readText('backend/services/modelExecutor.js');
  const media = readText('backend/services/mediaIntelligenceService.js');
  const bilingual = readText('backend/services/bilingualUnderstandingService.js');

  assert.doesNotMatch(executor, /require\(['"]\.\/ollamaClient['"]\)|require\(['"]\.\/openAiCompatibleClient['"]\)/u, 'modelExecutor may not dispatch providers directly');
  assert.doesNotMatch(executor, /provider\s*===\s*['"]ollama['"]|openai-compatible|cloud\.chat\(|ollama\.streamChat\(/u, 'modelExecutor may not keep a provider switch');
  assert.match(executor, /modelBrainRuntime|aiGateway/iu, 'qualification/verification inference must traverse Model Brain');

  assert.doesNotMatch(media, /require\(['"]\.\/ollamaClient['"]\)|\bstreamChat\s*\(/u, 'media intelligence must not bypass Model Brain for vision inference');
  assert.match(media, /aiGateway|modelBrainRuntime/iu, 'media inference must traverse the Model Brain facade');

  assert.doesNotMatch(bilingual, /\.resolveRoute\s*\(/u, 'translation repair must not preselect a fallback physical model');
  assert.doesNotMatch(bilingual, /route\?\.fallback|fallbackId/u, 'translation repair may retry a logical group but not pick the physical fallback');
});

test('model registry and auto-activation retain facts/qualification but cannot repair or write authoritative physical routes', () => {
  const registry = readText('backend/services/modelRegistry.js');
  const activation = readText('backend/services/modelAutoActivationService.js');

  assert.doesNotMatch(activation, /registry\.repairRoutes\(|modelHasRoute\(|configuredRoutes|primary|fallback/iu, 'auto activation must not select or repair production routes');
  assert.doesNotMatch(registry, /repairRegistryDocument\([^\n]*autoSelectVerified|rebalanceAutoRoutes\s*:\s*true/iu, 'registry discovery/benchmark updates must not auto-select or rebalance physical routes');
  assert.doesNotMatch(registry, /current\.routes\[[^\]]+\]\s*=|routes\?\.[^\n]*(?:primary|fallback)/iu, 'registry lifecycle changes must not mutate authoritative primary/fallback routes');
  assert.match(registry, /models|capabilities|qualification/iu, 'registry must continue to hold catalog/capability/qualification facts');
});

test('OpenRouter onboarding is catalog/capability discovery only and cannot pre-rank the LiteLLM deployment pool', () => {
  const source = readText('backend/services/openRouterAutoConfigurationService.js');
  for (const legacyAuthority of [
    'familyQuality',
    'qualityTier',
    'usagePolicy',
    'roleScore',
    'rankForRole',
    'buildSelections',
    'selectionScore',
    'preferredRoute',
    'frontierCandidateAuthority'
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${legacyAuthority}\\b`, 'u'), `${legacyAuthority} must leave production onboarding authority`);
  }
  assert.match(source, /models\/user|catalog/iu, 'OpenRouter catalog discovery remains allowed');
  assert.match(source, /capabilit/iu, 'normalized capability facts remain allowed');
  assert.doesNotMatch(source, /sort\([^\n]*(?:score|quality|cost|speed|context)|\.slice\(0,\s*REGISTER_LIMIT\)/iu, 'registration may not be a score-ranked physical-model shortlist');
});

test('models API no longer advertises legacy champion/workload/budget routing as production authority', () => {
  const routes = readText('backend/routes/models.js');
  assert.doesNotMatch(routes, /replyChampionAuthority\.decide|workloadPlacementAuthority\.rankCandidates|aiQualityRouteAuthority\.routePlan/iu, 'API must not compute legacy production route decisions');
  assert.match(routes, /model.?brain|litellm/iu, 'models API must expose the effective Model Brain/LiteLLM authority');
});
