'use strict';

const { getStore } = require('../repositories/storeProvider');
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');
const replyLearningScopeAuthority = require('./replyLearningScopeAuthority');
const replyLearningQualityService = require('./replyLearningQualityService');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertMutableScopeType(scopeType) {
  const normalized = clean(scopeType).toLowerCase();
  if (!['contact', 'platform', 'global'].includes(normalized)) {
    const error = new Error('该学习范围不能通过此接口直接修改');
    error.code = 'LEARNING_GOVERNANCE_SCOPE_UNSUPPORTED';
    error.status = 409;
    throw error;
  }
  return normalized;
}

function preferenceRows(profile = {}) {
  return Object.entries(object(profile.effective)).map(([key, row]) => ({
    key,
    value: clean(row?.value),
    confidence: Number(row?.confidence || 0),
    evidenceCount: Number(row?.evidenceCount || 0),
    updatedAt: clean(row?.updatedAt),
    disabled: row?.disabled === true,
    disabledAt: clean(row?.disabledAt),
    disabledBy: clean(row?.disabledBy)
  })).filter(row => row.value);
}

function layerSummary(scope, id, profile = {}, version = 0, updatedAt = '') {
  const preferences = preferenceRows(profile);
  return {
    scope,
    id: clean(id),
    version: Number(version || profile.version || 0),
    updatedAt: clean(updatedAt || profile.updatedAt),
    activeCount: preferences.filter(row => !row.disabled).length,
    disabledCount: preferences.filter(row => row.disabled).length,
    evidenceCount: Array.isArray(profile.evidence) ? profile.evidence.length : 0,
    exampleCount: Array.isArray(profile.recentExamples) ? profile.recentExamples.length : 0,
    preferences,
    recentExamples: Array.isArray(profile.recentExamples) ? profile.recentExamples.slice(-8).reverse() : []
  };
}

function identityForContact(storeManager, contactId) {
  const customer = storeManager.select(state => state.customers.byId[contactId] || null) || {};
  const platform = clean(customer.platform).toLowerCase();
  const sourceAccountId = clean(customer.accountId);
  return {
    platform,
    sourceAccountId,
    platformContactIdentity: clean(customer.externalId || customer.phone || customer.platformContactIdentity),
    canonicalContactId: clean(customer.canonicalContactId || customer.customerProfileId || contactId),
    platformScopeId: replyLearningScopeAuthority.platformScopeId(platform, sourceAccountId)
  };
}

function getGovernance(contactId, options = {}) {
  const id = clean(contactId);
  const storeManager = options.storeManager;
  if (!id || !storeManager?.select) {
    const error = new Error('联系人学习治理上下文无效');
    error.code = 'LEARNING_GOVERNANCE_CONTEXT_INVALID';
    throw error;
  }
  const customer = storeManager.select(state => state.customers.byId[id] || null);
  if (!customer) {
    const error = new Error('客户不存在');
    error.code = 'CUSTOMER_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const store = options.store || getStore();
  const repository = options.repository || new ReplyFeedbackRepository(store);
  const contactProfile = storeManager.select(state => state.memories.byContactId[id]?.feedbackLearning || {}) || {};
  const identity = identityForContact(storeManager, id);
  const platform = identity.platform;
  const platformRow = identity.platformScopeId ? replyLearningScopeAuthority.read('platform', identity.platformScopeId, store) : { profile: {}, version: 0, updatedAt: '' };
  const globalRow = replyLearningScopeAuthority.read('global', 'owner', store);
  const layered = replyLearningScopeAuthority.layered({
    contactId: id,
    platform,
    sourceAccountId: identity.sourceAccountId,
    contactProfile
  }, { store });
  const events = repository.listEvents({ contactId: id, limit: options.eventLimit || 100 });
  const lifecycleEvents = repository.listLifecycleEvents({ contactId: id, limit: options.eventLimit || 100 });
  const learningMaterials = lifecycleEvents.filter(row => ['generated', 'accepted', 'edited', 'rejected', 'sent', 'failed'].includes(row.stage));
  return {
    contactId: id,
    contactName: clean(customer.displayName || customer.name || customer.phone || customer.externalId),
    platform,
    sourceAccountId: identity.sourceAccountId,
    platformContactIdentity: identity.platformContactIdentity,
    canonicalContactId: identity.canonicalContactId,
    layered,
    layers: {
      contact: layerSummary('contact', id, contactProfile, contactProfile.version, contactProfile.updatedAt),
      platform: layerSummary('platform', identity.platformScopeId, platformRow.profile, platformRow.version, platformRow.updatedAt),
      global: layerSummary('global', 'owner', globalRow.profile, globalRow.version, globalRow.updatedAt)
    },
    versions: {
      contact: repository.listVersions('contact', id, { limit: options.versionLimit || 30 }),
      platform: identity.platformScopeId ? replyLearningScopeAuthority.listVersions('platform', identity.platformScopeId, { limit: options.versionLimit || 30 }, store) : [],
      global: replyLearningScopeAuthority.listVersions('global', 'owner', { limit: options.versionLimit || 30 }, store)
    },
    events,
    lifecycleEvents,
    learningMaterials,
    quality: replyLearningQualityService.summarize(events),
    truth: {
      contactProfileSource: 'store-manager-memory',
      platformProfileSource: 'sqlite-ai-reply-learning-scopes',
      globalProfileSource: 'sqlite-ai-reply-learning-scopes',
      effectivePreferenceCount: Object.keys(object(layered.effective)).length,
      appliedScopeOrder: ['global', 'platformAccount', 'contact'],
      platformScopeIncludesSourceAccountId: true,
      lifecycleProjectionSource: 'sqlite-store-event-log',
      actualLearningSource: 'sqlite-ai-reply-feedback-events'
    }
  };
}

async function mutatePreference(input = {}, options = {}) {
  const contactId = clean(input.contactId);
  const scopeType = assertMutableScopeType(input.scopeType);
  const key = clean(input.key);
  const action = clean(input.action).toLowerCase();
  const actor = clean(input.actor) || 'user';
  const storeManager = options.storeManager;
  const store = options.store || getStore();
  if (scopeType === 'contact') {
    const result = await storeManager.dispatch({
      type: 'AI_REPLY_FEEDBACK_PREFERENCE_UPDATED',
      source: 'learning-governance-api',
      payload: { contactId, key, action, actor }
    });
    return { scopeType, scopeId: contactId, ...result.result };
  }
  const scopeId = scopeType === 'platform' ? identityForContact(storeManager, contactId).platformScopeId : 'owner';
  if (!scopeId) {
    const error = new Error('当前联系人没有可用平台学习范围');
    error.code = 'LEARNING_PLATFORM_SCOPE_UNAVAILABLE';
    throw error;
  }
  const row = replyLearningScopeAuthority.mutatePreference(scopeType, scopeId, key, action, { store, actor });
  return { scopeType, scopeId, row };
}

async function restore(input = {}, options = {}) {
  const contactId = clean(input.contactId);
  const scopeType = assertMutableScopeType(input.scopeType);
  const version = Number(input.version || 0);
  const actor = clean(input.actor) || 'user';
  const storeManager = options.storeManager;
  const store = options.store || getStore();
  if (scopeType === 'contact') {
    const repository = options.repository || new ReplyFeedbackRepository(store);
    const row = repository.getVersion('contact', contactId, version);
    if (!row) {
      const error = new Error('指定的联系人学习版本不存在');
      error.code = 'REPLY_FEEDBACK_VERSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const result = await storeManager.dispatch({
      type: 'AI_REPLY_FEEDBACK_RESTORED',
      source: 'learning-governance-api',
      payload: { contactId, profile: row.profile, sourceVersion: version, restoredBy: actor }
    });
    return { scopeType, scopeId: contactId, ...result.result };
  }
  const scopeId = scopeType === 'platform' ? identityForContact(storeManager, contactId).platformScopeId : 'owner';
  if (!scopeId) {
    const error = new Error('当前联系人没有可用平台学习范围');
    error.code = 'LEARNING_PLATFORM_SCOPE_UNAVAILABLE';
    throw error;
  }
  const row = replyLearningScopeAuthority.restoreVersion(scopeType, scopeId, version, { store, actor });
  return { scopeType, scopeId, row };
}

async function forget(input = {}, options = {}) {
  const contactId = clean(input.contactId);
  const storeManager = options.storeManager;
  const store = options.store || getStore();
  if (input.confirmForget !== true) {
    const error = new Error('永久忘记学习需要明确确认');
    error.code = 'REPLY_FEEDBACK_FORGET_CONFIRMATION_REQUIRED';
    throw error;
  }
  const result = await storeManager.dispatch({
    type: 'AI_REPLY_FEEDBACK_FORGOTTEN',
    source: 'learning-governance-api',
    payload: {
      contactId,
      confirmForget: true,
      forgottenBy: clean(input.actor) || 'user'
    }
  });
  const scopes = replyLearningScopeAuthority.forgetContact(contactId, {
    store,
    updatedAt: new Date().toISOString()
  });
  return { ...result.result, scopes };
}

module.exports = {
  getGovernance,
  mutatePreference,
  restore,
  forget,
  preferenceRows,
  layerSummary,
  identityForContact,
  assertMutableScopeType
};
