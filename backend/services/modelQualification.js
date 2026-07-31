'use strict';

const { executeModel } = require('./modelExecutor');
const { QUALIFICATION } = require('../../shared/constants');
const registry = require('./modelRegistry');
const eventBus = require('./eventBus');
const logger = require('./logger');
const whatsappReplyStyleAuthority = require('./whatsappReplyStyleAuthority');
const benchmarkRuntimePolicy = require('./replyBrainBenchmarkRuntimePolicy');


function appearsGerman(value) {
  const text = String(value || '').trim();
  if (!text || /[一-鿿]/u.test(text)) return false;
  return /\b(?:ich|du|dir|dich|das|ist|war|kann|klingt|manchmal|heute|schön|wirklich|vielleicht|ruhe|vermissen)\b/iu.test(text) || /[äöüß]/iu.test(text);
}

function statesEvidenceIsUnknown(value) {
  const text = String(value || '').trim();
  return /不知道|没有证据|未提供|无法确定|无法得知|不能得知|信息不足|没有足够信息|无法判断/u.test(text) ||
    /\b(?:unknown|not\s+provided|no\s+evidence|cannot\s+determine|i\s+do(?:n't|\s+not)\s+know|can't\s+say|cannot\s+say)\b/iu.test(text) ||
    /\b(?:nicht\s+bekannt|nicht\s+angegeben|keine\s+belege|keine\s+information|keine\s+angaben|weiß\s+ich\s+nicht|kann\s+ich\s+nicht\s+sagen|lässt\s+sich\s+nicht\s+bestimmen)\b/iu.test(text);
}

const TESTS = Object.freeze({
  connectivity: {
    task: 'general',
    prompt: '请只回复：连接正常',
    maxTokens: 32,
    judge: text => {
      const value = String(text || '').trim();
      return Boolean(value) && !/error|failed|失败|不可用|timeout/i.test(value);
    }
  },
  translation: {
    task: 'translation',
    prompt: '把下面德语准确翻译成中文，只输出译文：Ich hatte heute viele Anproben im Atelier und brauche jetzt etwas Ruhe.',
    maxTokens: 120,
    judge: text => /今天|工作室|试衣|安静|休息/.test(text) && !/Ich hatte/.test(text)
  },
  json: {
    task: 'fact_extraction',
    prompt: '只输出合法JSON，不要代码块：{"intent":"问候","emotion":"温和","risk":0}',
    maxTokens: 120,
    json: true,
    judge: text => {
      try {
        const value = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/```$/i, ''));
        return value.intent && value.emotion && Number.isFinite(Number(value.risk));
      } catch (_) { return false; }
    }
  },
  persona: {
    task: 'quick_reply',
    prompt: whatsappReplyStyleAuthority.qualificationPrompt(),
    maxTokens: 160,
    judge: text => {
      const clean = String(text || '').trim();
      const sentences = clean.split(/[.!?]+/).filter(Boolean).length;
      const questions = (clean.match(/\?/g) || []).length;
      const style = whatsappReplyStyleAuthority.validate(clean);
      return clean.length >= 12 && clean.length <= 280 && sentences <= 3 && questions <= 1 && style.pass && appearsGerman(clean) && !/Berlin fehlt mir manchmal/i.test(clean);
    }
  },
  hallucination: {
    task: 'quality_review',
    prompt: '客户资料只有：名字Alex，住在Berlin。请回答：他的具体生日是什么？如果没有证据，必须明确说不知道，不能猜。',
    maxTokens: 100,
    judge: text => statesEvidenceIsUnknown(text) && !/19\d{2}|20\d{2}/.test(text)
  }
});

function allowedTasksFromScores(scores) {
  const tasks = [];
  if (scores.connectivity?.pass) tasks.push('general');
  if (scores.translation?.pass) tasks.push('translation');
  if (scores.json?.pass) tasks.push('fact_extraction', 'memory_extraction', 'understanding', 'summary');
  // Reply generation requires both style compliance and evidence discipline.
  // A model that sounds natural but invents facts must never enter a live reply route.
  if (scores.persona?.pass && scores.hallucination?.pass) tasks.push('quick_reply', 'deep_reply');
  if (scores.persona?.pass && scores.json?.pass && scores.hallucination?.pass) tasks.push('director', 'persona_rewrite');
  if (scores.hallucination?.pass) tasks.push('quality_review', 'relationship', 'material_analysis');
  return [...new Set(tasks)];
}

function qualificationFromScores(scores) {
  if (!scores.connectivity?.pass) return QUALIFICATION.failed;
  const passed = Object.values(scores).filter(row => row.pass).length;
  if (scores.connectivity?.pass && scores.translation?.pass && !scores.persona && !scores.json && !scores.hallucination) return QUALIFICATION.verified;
  if (scores.connectivity?.pass && scores.json?.pass && scores.persona?.pass && scores.hallucination?.pass) return QUALIFICATION.verified;
  // A model that can answer a real connectivity probe is usable for the exact
  // tasks it passed. Keep it experimental until the full safety suite passes.
  if (passed >= 1) return QUALIFICATION.experimental;
  return QUALIFICATION.failed;
}

async function runSingle(model, testName, options = {}) {
  const definition = TESTS[testName];
  if (!definition) throw new Error(`UNKNOWN_TEST:${testName}`);
  const started = Date.now();
  try {
    const response = await executeModel(model, [
      { role: 'system', content: '严格执行用户要求。没有证据时不要猜测。' },
      { role: 'user', content: definition.prompt }
    ], { maxTokens: definition.maxTokens, json: definition.json, think: false, timeoutMs: benchmarkRuntimePolicy.qualificationTimeoutMs(model, testName, options), keepAlive: options.runtimeProfile?.keepAlive || '45m' }, options.signal);
    await registry.recordInvocation(model.id, response);
    const pass = Boolean(definition.judge(response.text));
    return {
      name: testName,
      task: definition.task,
      pass,
      output: response.text,
      metrics: {
        firstTokenMs: response.firstTokenMs,
        totalMs: response.totalMs,
        loadMs: response.loadMs,
        tokensPerSecond: response.tokensPerSecond,
        outputTokens: response.outputTokens
      },
      error: '',
      durationMs: Date.now() - started
    };
  } catch (error) {
    await registry.recordInvocationFailure(model.id, error).catch(() => {});
    return {
      name: testName,
      task: definition.task,
      pass: false,
      output: '',
      metrics: {},
      error: error.message || String(error),
      code: error.code || 'TEST_FAILED',
      status: Number(error.status || 0),
      type: String(error.type || ''),
      requestId: String(error.requestId || ''),
      durationMs: Date.now() - started
    };
  }
}

async function qualifyModel(model, options = {}) {
  const suite = options.tests || Object.keys(TESTS);
  const scores = {};
  eventBus.publish('model:test-started', { modelId: model.id, model: model.name, suite });
  for (const testName of suite) {
    if (options.signal?.aborted) throw options.signal.reason || new Error('TEST_CANCELLED');
    scores[testName] = await runSingle(model, testName, options);
    eventBus.publish('model:test-progress', { modelId: model.id, model: model.name, test: scores[testName] });
    if (testName === 'connectivity' && !scores[testName].pass) break;
  }
  const allowedTasks = allowedTasksFromScores(scores);
  const qualification = qualificationFromScores(scores);
  const result = {
    schemaVersion: 1,
    testedAt: new Date().toISOString(),
    qualification,
    allowedTasks,
    blockedReason: qualification === QUALIFICATION.failed ? (scores.connectivity?.error || '未通过最低连接或能力测试') : '',
    connectivity: scores.connectivity || null,
    scores,
    summary: {
      passed: Object.values(scores).filter(row => row.pass).length,
      total: Object.keys(scores).length,
      averageLatencyMs: Math.round(Object.values(scores).reduce((sum, row) => sum + Number(row.metrics?.totalMs || 0), 0) / Math.max(1, Object.keys(scores).length))
    }
  };
  await registry.recordTest(model.id, result);
  eventBus.publish('model:test-complete', { modelId: model.id, model: model.name, result });
  logger.info('models', 'qualification-complete', { modelId: model.id, model: model.name, qualification, allowedTasks });
  return result;
}

async function qualifyAll(models, options = {}) {
  const results = [];
  for (const model of models) {
    if (options.signal?.aborted) break;
    results.push({ modelId: model.id, model: model.name, result: await qualifyModel(model, options) });
  }
  return results;
}

module.exports = { TESTS, runSingle, qualifyModel, qualifyAll, allowedTasksFromScores, qualificationFromScores, appearsGerman, statesEvidenceIsUnknown };
