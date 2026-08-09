'use strict';

const qualification = require('./modelQualification');
const registry = require('./modelRegistry');
const eventBus = require('./eventBus');
const logger = require('./logger');

let running = false;
let queued = false;
let lastRun = null;
let currentModel = '';
let currentSuite = [];
let promise = null;

function clean(value) { return String(value == null ? '' : value).trim(); }
function modelName(model = {}) { return clean(model.name || model.id).toLowerCase(); }
function isCoder(model = {}) { return /(?:coder|codeqwen|starcoder|deepseek-coder)/iu.test(modelName(model)); }
function isEmbedding(model = {}) { return /(?:embed|bge-|nomic-embed|e5-)/iu.test(modelName(model)); }
function isTranslation(model = {}) { return /(?:translate|translation|translategemma)/iu.test(modelName(model)); }
function isRecentlyUsable(model = {}, maxAgeMs = 7 * 86400000) {
  if (!['verified', 'experimental'].includes(clean(model.qualification))) return false;
  if (!Array.isArray(model.allowedTasks) || !model.allowedTasks.length) return false;
  const tested = Date.parse(model.testedAt || model.lastTest?.testedAt || '');
  return Number.isFinite(tested) && Date.now() - tested < maxAgeMs;
}
function testsFor(model = {}) {
  const tests = ['connectivity', 'json'];
  if (isTranslation(model)) tests.push('translation');
  else tests.push('persona', 'hallucination');
  const capabilities = new Set(Array.isArray(model.capabilities) ? model.capabilities.map(value => clean(value).toLowerCase()) : []);
  if (capabilities.has('vision')) tests.push('vision');
  return [...new Set(tests)];
}
function chooseCandidates(models = []) {
  return (Array.isArray(models) ? models : [])
    .filter(model => model.available !== false && model.userDisabled !== true && !isEmbedding(model) && !isCoder(model))
    .map(model => ({ model, tests: testsFor(model) }));
}
function status() {
  const state = registry.read();
  const models = Array.isArray(state.models) ? state.models : [];
  return {
    authority: 'Model Brain hard qualification',
    running,
    queued,
    currentModel,
    currentSuite: [...currentSuite],
    catalogCount: models.length,
    verifiedCount: models.filter(model => model.qualification === 'verified').length,
    experimentalCount: models.filter(model => model.qualification === 'experimental').length,
    lastRun: lastRun ? { ...lastRun } : null
  };
}
async function run(options = {}) {
  if (running) { queued = true; return promise; }
  running = true;
  queued = false;
  const startedAt = new Date().toISOString();
  const results = [];
  promise = (async () => {
    try {
      const candidates = chooseCandidates(registry.read().models || []);
      eventBus.publish('models:auto-activation-started', { candidateCount: candidates.length, authority: 'model-brain-hard-qualification' });
      for (const candidate of candidates) {
        const state = registry.read();
        const latest = (state.models || []).find(row => row.id === candidate.model.id) || candidate.model;
        if (options.force !== true && isRecentlyUsable(latest)) {
          results.push({ modelId: latest.id, model: latest.name, skipped: true, reason: 'recently-qualified' });
          continue;
        }
        currentModel = clean(latest.name || latest.id);
        currentSuite = candidate.tests;
        eventBus.publish('models:auto-activation-progress', { modelId: latest.id, model: currentModel, tests: candidate.tests });
        const result = await qualification.qualifyModel(latest, { tests: candidate.tests, timeoutMs: Number(options.timeoutMs || 180000) });
        results.push({ modelId: latest.id, model: latest.name, result });
      }
      const state = registry.read();
      const models = state.models || [];
      lastRun = {
        ok: true,
        startedAt,
        completedAt: new Date().toISOString(),
        tested: results.length,
        verified: models.filter(model => model.qualification === 'verified').length,
        results
      };
      eventBus.publish('models:auto-activation-complete', lastRun);
      logger.info('models', 'auto-activation-complete', { count: results.length, verified: lastRun.verified });
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

module.exports = { chooseCandidates, status, run, schedule, isRecentlyUsable, isTranslation, isCoder };
