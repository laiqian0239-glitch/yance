'use strict';

const qualification = require('./modelQualification');
const registry = require('./modelRegistry');
const routingIntegrity = require('./modelRoutingIntegrityService');
const eventBus = require('./eventBus');
const logger = require('./logger');
const replyBrainAuthority = require('./replyBrainModelAuthority');

let running = false;
let queued = false;
let lastRun = null;
let currentModel = '';
let currentSuite = [];
let promise = null;

function modelName(model = {}) { return String(model.name || model.id || '').toLowerCase(); }
function isCoder(model = {}) { return routingIntegrity.isCoderModel(model); }
function isEmbedding(model = {}) { return /(?:embed|bge-|nomic-embed|e5-)/i.test(modelName(model)); }
function isTranslation(model = {}) { return routingIntegrity.isTranslationModel(model); }
function isRecentlyUsable(model = {}, maxAgeMs = 7 * 86400000) {
  if (!['verified', 'experimental'].includes(String(model.qualification || ''))) return false;
  if (!Array.isArray(model.allowedTasks) || !model.allowedTasks.length) return false;
  const tested = Date.parse(model.testedAt || model.lastTest?.testedAt || '');
  return Number.isFinite(tested) && Date.now() - tested < maxAgeMs;
}
function candidateScore(model = {}, role = 'general') {
  let score = 0;
  const name = modelName(model);
  const billions = routingIntegrity.parseParameterBillions(model);
  if (model.provider === 'ollama') score += 100;
  if (model.available !== false) score += 50;
  if (role === 'translation' && isTranslation(model)) score += 500;
  if (role === 'general' && !isTranslation(model)) score += 60;
  if (role === 'general') score += replyBrainAuthority.replyBrainScore(model) * 6;
  if (/ministral|mistral-small|qwen.*(?:9b|14b|30b)|gemma.*12b/i.test(name)) score += role === 'general' ? 260 : 0;
  if (/qwen.*4b/i.test(name)) score += role === 'general' ? 40 : 0;
  if (isCoder(model)) score -= 1000;
  if (isEmbedding(model)) score -= 2000;
  if (isRecentlyUsable(model)) score += 80;
  if (role === 'general' && billions > 0 && billions < 6) score -= 180;
  if (role === 'general' && billions >= 12 && billions <= 35) score += 140;
  const bytes = Number(model.sizeBytes || model.size || 0);
  if (Number.isFinite(bytes) && bytes > 0) score += Math.min(25, Math.log10(bytes));
  return score;
}
function chooseCandidates(models = [], options = {}) {
  const eligible = models.filter(model => model.provider === 'ollama' && model.available !== false && !isEmbedding(model) && !isCoder(model));
  const generalLimit = Math.max(2, Number(options.generalLimit || 4));
  const general = [...eligible]
    .filter(model => !isTranslation(model))
    .sort((a, b) => candidateScore(b, 'general') - candidateScore(a, 'general'))
    .slice(0, generalLimit);
  const translation = [...eligible]
    .filter(isTranslation)
    .sort((a, b) => candidateScore(b, 'translation') - candidateScore(a, 'translation'))[0] || null;
  const selected = general.map((model, index) => ({
    model,
    role: index === 0 ? 'general' : (routingIntegrity.parseParameterBillions(model) >= 10 ? 'deep-general' : 'general-fallback'),
    tests: ['connectivity', 'json', 'persona', 'hallucination']
  }));
  if (translation) selected.push({ model: translation, role: 'translation', tests: ['connectivity', 'translation'] });
  return selected;
}
function status() {
  const routeState = registry.read();
  return {
    running,
    queued,
    currentModel,
    currentSuite: [...currentSuite],
    configuredRoutes: routingIntegrity.configuredRouteCount(routeState.routes || {}),
    lastRun: lastRun ? { ...lastRun } : null
  };
}
function modelHasRoute(state, modelId) {
  return Object.values(state.routes || {}).some(route => route?.primary === modelId || route?.fallback === modelId);
}
async function run(options = {}) {
  if (running) { queued = true; return promise; }
  running = true;
  queued = false;
  const startedAt = new Date().toISOString();
  const results = [];
  promise = (async () => {
    try {
      await registry.repairRoutes({ autoSelectVerified: true });
      let state = registry.read();
      const candidates = chooseCandidates(state.models || [], options);
      eventBus.publish('models:auto-activation-started', {
        candidates: candidates.map(row => ({ id: row.model.id, name: row.model.name, role: row.role, tests: row.tests })),
        configuredRoutes: routingIntegrity.configuredRouteCount(state.routes || {})
      });
      for (const candidate of candidates) {
        state = registry.read();
        const latest = (state.models || []).find(row => row.id === candidate.model.id) || candidate.model;
        const alreadyRouted = modelHasRoute(state, latest.id);
        if (options.force !== true && isRecentlyUsable(latest) && alreadyRouted) {
          results.push({ modelId: latest.id, model: latest.name, role: candidate.role, skipped: true, reason: 'recently-qualified-and-routed' });
          continue;
        }
        currentModel = latest.name || latest.id;
        currentSuite = candidate.tests;
        eventBus.publish('models:auto-activation-progress', { modelId: latest.id, model: currentModel, role: candidate.role, tests: candidate.tests });
        const result = await qualification.qualifyModel(latest, {
          tests: candidate.tests,
          timeoutMs: Number(options.timeoutMs || 180000)
        });
        results.push({ modelId: latest.id, model: latest.name, role: candidate.role, result });
        await registry.repairRoutes({ autoSelectVerified: true });
      }
      await registry.repairRoutes({ autoSelectVerified: true });
      state = registry.read();
      const configuredRoutes = routingIntegrity.configuredRouteCount(state.routes || {});
      lastRun = { ok: true, startedAt, completedAt: new Date().toISOString(), configuredRoutes, results };
      eventBus.publish('models:auto-activation-complete', lastRun);
      logger.info('models', 'auto-activation-complete', {
        count: results.length,
        configuredRoutes,
        routedModels: (state.models || []).filter(row => modelHasRoute(state, row.id)).map(row => row.name)
      });
      return lastRun;
    } catch (error) {
      lastRun = { ok: false, startedAt, completedAt: new Date().toISOString(), error: error.message, code: error.code || 'MODEL_AUTO_ACTIVATION_FAILED', results };
      eventBus.publish('models:auto-activation-failed', lastRun);
      logger.warn('models', 'auto-activation-failed', { error: error.message, code: error.code || '' });
      return lastRun;
    } finally {
      running = false;
      currentModel = '';
      currentSuite = [];
      promise = null;
      if (queued) { queued = false; setImmediate(() => run(options).catch(() => {})); }
    }
  })();
  return promise;
}
function schedule(options = {}) {
  if (running) { queued = true; return { scheduled: false, alreadyRunning: true, status: status() }; }
  setImmediate(() => run(options).catch(() => {}));
  return { scheduled: true, alreadyRunning: false, status: status() };
}

module.exports = { chooseCandidates, candidateScore, status, run, schedule, isRecentlyUsable, isTranslation, isCoder };
