'use strict';

const aiGateway = require('./aiGateway');
const eventBus = require('./eventBus');
const logger = require('./logger');
const learningAuthority = require('./learningPreferenceAuthority').singleton;
const { singleton: repository } = require('../repositories/platformCoreRepository');
const { sha256 } = require('./domainEventLogService');

const AUTHORITY = 'LearningSynthesisSchedulerAuthority';
const SCHEMA_VERSION = 1;

function clean(value) { return String(value == null ? '' : value).trim(); }
function parseSynthesisResult(result = {}) {
  const source = result.json && typeof result.json === 'object' ? result.json : (() => {
    try { return JSON.parse(clean(result.text)); } catch (_) { return null; }
  })();
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    const error = new Error('学习综合模型没有返回有效 JSON。');
    error.code = 'LEARNING_SYNTHESIS_SCHEMA_INVALID';
    throw error;
  }
  const preference = source.preference && typeof source.preference === 'object' && !Array.isArray(source.preference)
    ? source.preference
    : source;
  const confidence = Number(source.confidence ?? preference.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    const error = new Error('学习综合模型返回的 confidence 无效。');
    error.code = 'LEARNING_SYNTHESIS_CONFIDENCE_INVALID';
    throw error;
  }
  return { preference, confidence };
}
function buildMessages(context = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是言策的学习综合器。只返回 JSON，不解释。',
        '根据完整合格证据提炼稳定偏好，不得发明事实，不得把应急模型结果写入长期学习。',
        '输出格式：{"preference":{...},"confidence":0到1之间的数字}。',
        context.toLevel === 'L3' ? 'L3 只总结跨联系人稳定的表达偏好，不包含任何客户私人事实。' : 'L2 只总结当前客户/关系范围内稳定有效的沟通偏好。'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify(context) }
  ];
}

class LearningSynthesisScheduler {
  constructor(options = {}) {
    this.aiGateway = options.aiGateway || aiGateway;
    this.eventBus = options.eventBus || eventBus;
    this.logger = options.logger || logger;
    this.learning = options.learning || learningAuthority;
    this.repository = options.repository || repository;
    this.started = false;
    this.timer = null;
    this.debounce = null;
    this.running = false;
    this.pending = false;
    this.lastRun = null;
    this.listener = () => this.requestRun('learning-signal');
    this.intervalMs = Math.max(60_000, Number(options.intervalMs || process.env.YANCE_LEARNING_SYNTHESIS_INTERVAL_MS || 15 * 60_000));
  }

  async prepare() { return { authority: AUTHORITY, ready: true, intervalMs: this.intervalMs }; }
  async start() {
    if (this.started) return this.snapshot();
    this.started = true;
    this.eventBus.on('learning:signal-recorded', this.listener);
    this.timer = setInterval(() => this.requestRun('interval'), this.intervalMs);
    this.timer.unref?.();
    setTimeout(() => this.requestRun('startup'), 5000).unref?.();
    return this.snapshot();
  }
  async stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
    this.eventBus.removeListener('learning:signal-recorded', this.listener);
    return this.snapshot();
  }
  requestRun(reason = 'manual') {
    this.pending = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.run({ reason }).catch(error => this.logger.warn('learning', 'automatic-synthesis-failed', { code: error.code || 'LEARNING_SYNTHESIS_FAILED', error: error.message }));
    }, 750);
    this.debounce.unref?.();
    return { authority: AUTHORITY, scheduled: true, reason };
  }

  async synthesize(context, input = {}) {
    const result = await this.aiGateway.execute({
      task: 'learning_synthesis',
      messages: buildMessages(context),
      options: { json: true, temperature: 0.1, maxTokens: 1600, timeoutMs: Number(input.timeoutMs || 180000), contextReductionBeforeFallback: true },
      background: true,
      priority: 25,
      dedupeKey: `learning-synthesis:${context.fromLevel}:${context.toLevel}:${context.scope.type}:${context.scope.id}`,
      fingerprint: sha256({ context, evidence: (context.eligibleSignals || []).map(row => row.signalId) })
    });
    const parsed = parseSynthesisResult(result);
    return { ...parsed, qualityRouteReceipt: result.qualityRouteReceipt, modelId: result.modelId, attempts: result.attempts || [] };
  }

  targetForL2(scope, context) {
    const contacts = [...new Set((context.eligibleSignals || []).map(row => clean(row.contactId)).filter(Boolean))];
    const personIds = [...new Set(contacts.map(contactId => clean(this.repository.getActivePersonForContact?.(contactId)?.person_id)).filter(Boolean))];
    if (scope.scopeType === 'contact') return { targetScopeType: 'contact', targetScopeId: scope.scopeId, contactId: scope.scopeId, personId: personIds[0] || '' };
    if (contacts.length === 1) return { targetScopeType: 'contact', targetScopeId: contacts[0], contactId: contacts[0], personId: personIds[0] || '' };
    if (personIds.length === 1) return { targetScopeType: 'relationship', targetScopeId: personIds[0], contactId: contacts[0] || '', personId: personIds[0] };
    return { targetScopeType: 'relationship', targetScopeId: scope.scopeId, contactId: contacts[0] || '', personId: '' };
  }

  async runL1Scope(scope) {
    const context = this.learning.synthesisContext({ scopeType: scope.scopeType, scopeId: scope.scopeId, fromLevel: 'L1', toLevel: 'L2' });
    if ((context.eligibleSignals || []).length < 5) return { skipped: true, reasonCode: 'L2_SAMPLE_INSUFFICIENT', scope };
    const synthesis = await this.synthesize(context);
    const target = this.targetForL2(scope, context);
    return this.learning.applySynthesis({
      synthesisId: `auto-l2:${scope.scopeType}:${scope.scopeId}:${sha256(context.eligibleSignals.map(row => row.signalId).sort())}`,
      fromLevel: 'L1', toLevel: 'L2',
      sourceScopeType: scope.scopeType, sourceScopeId: scope.scopeId,
      targetScopeType: target.targetScopeType, targetScopeId: target.targetScopeId,
      contactId: target.contactId,
      personId: target.personId,
      aggregationScopeId: 'owner',
      preference: synthesis.preference,
      confidence: synthesis.confidence,
      evidenceSignalIds: context.eligibleSignals.map(row => row.signalId),
      sourceVersions: [],
      qualityRouteReceipt: synthesis.qualityRouteReceipt,
      actor: 'learning-synthesis-scheduler',
      reason: 'L1 合格反馈达到门槛后自动综合为客户/关系级偏好。'
    });
  }

  async runL3Proposal() {
    const context = this.learning.synthesisContext({ scopeType: 'owner', scopeId: 'owner', fromLevel: 'L2', toLevel: 'L3' });
    const underlyingSamples = (context.eligibleSignals || []).reduce((sum, row) => sum + Math.max(1, Array.isArray(row.signal?.evidenceSignalIds) ? row.signal.evidenceSignalIds.length : 0), 0);
    const contacts = new Set((context.eligibleSignals || []).map(row => clean(row.contactId)).filter(Boolean));
    if (underlyingSamples < 25 || contacts.size < 3) return { skipped: true, reasonCode: 'L3_SAMPLE_OR_CONTACT_INSUFFICIENT', underlyingSamples, distinctContacts: contacts.size };
    const synthesis = await this.synthesize(context);
    if (synthesis.confidence < 0.75) return { skipped: true, reasonCode: 'L3_CONFIDENCE_INSUFFICIENT', confidence: synthesis.confidence };
    return this.learning.createL3Proposal({
      synthesisId: `auto-l3:owner:${sha256(context.eligibleSignals.map(row => row.signalId).sort())}`,
      sourceScopeType: 'owner', sourceScopeId: 'owner', targetScopeType: 'persona', targetScopeId: 'owner',
      preference: synthesis.preference,
      confidence: synthesis.confidence,
      evidenceSignalIds: context.eligibleSignals.map(row => row.signalId),
      qualityRouteReceipt: synthesis.qualityRouteReceipt,
      actor: 'learning-synthesis-scheduler',
      reason: '跨联系人稳定偏好已自动综合为待人工批准的 L3 Persona 提案。'
    });
  }

  async run(input = {}) {
    if (this.running) { this.pending = true; return { authority: AUTHORITY, alreadyRunning: true }; }
    this.running = true;
    this.pending = false;
    const report = { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, reason: clean(input.reason) || 'manual', startedAt: new Date().toISOString(), l2: [], l3: null, errors: [] };
    try {
      const scopes = this.repository.listLearningSignalScopes({ learningLevel: 'L1' });
      for (const scope of scopes) {
        try { report.l2.push({ scope, result: await this.runL1Scope(scope) }); }
        catch (error) { report.errors.push({ stage: 'L1_TO_L2', scope, code: error.code || 'LEARNING_L2_SYNTHESIS_FAILED', error: error.message }); }
      }
      try { report.l3 = await this.runL3Proposal(); }
      catch (error) { report.errors.push({ stage: 'L2_TO_L3', code: error.code || 'LEARNING_L3_SYNTHESIS_FAILED', error: error.message }); }
      report.completedAt = new Date().toISOString();
      report.ok = report.errors.length === 0;
      this.lastRun = report;
      this.eventBus.publish('learning:automatic-synthesis-complete', report);
      return report;
    } finally {
      this.running = false;
      if (this.pending) this.requestRun('pending-followup');
    }
  }

  snapshot() {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, started: this.started, running: this.running, pending: this.pending, intervalMs: this.intervalMs, lastRun: this.lastRun };
  }
}

const singleton = new LearningSynthesisScheduler();
module.exports = { AUTHORITY, SCHEMA_VERSION, LearningSynthesisScheduler, singleton, parseSynthesisResult, buildMessages };
