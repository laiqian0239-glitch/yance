'use strict';

const { getR32Store } = require('../lib/r32StoreSingleton');
const { parseJson } = require('../lib/r32SqliteStore');
const runtimeMode = require('../services/runtimeMode');

const CLEANROOM_VERSION = 1;
const EXACT_FAKE_ACCOUNT_NAMES = new Set([
  'whatsapp 主账号',
  'whatsapp 主账号（未登录）',
  'whatsapp 主账号(未登录)'
]);
const DEMO_PREFIX = /^(?:demo|mock|sample|seed)(?:[-_:]|$)/i;
const DEMO_SOURCE = /^(?:demo|mock|sample|seed|fixture|preview)$/i;

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function isExplicitDemoRecord(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.isDemo === true || value.demo === true || value.mock === true || value.seeded === true) return true;
  if (DEMO_PREFIX.test(clean(value.id))) return true;
  if (DEMO_SOURCE.test(clean(value.source))) return true;
  if (/[/\\](?:demo|mock|fixtures?|previews?)(?:[/\\]|$)/i.test(clean(value.migratedFrom))) return true;
  return false;
}

function sanitizeArray(list) {
  return Array.isArray(list) ? list.filter(item => !isExplicitDemoRecord(item)) : [];
}

function sanitizeAiWorkbench(document) {
  const source = document && typeof document === 'object' ? document : {};
  const contactRules = {};
  for (const [contactId, rules] of Object.entries(source.contactRules || {})) {
    if (DEMO_PREFIX.test(contactId)) continue;
    const next = sanitizeArray(rules);
    if (next.length) contactRules[contactId] = next;
  }
  return {
    ...source,
    templates: sanitizeArray(source.templates),
    materials: sanitizeArray(source.materials),
    services: sanitizeArray(source.services),
    routes: sanitizeArray(source.routes),
    activity: sanitizeArray(source.activity),
    contactRules
  };
}

function isKnownFakeAccount(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  const displayName = normalize(row.display_name || payload.displayName || payload.name);
  const identity = normalize(row.identity_label || payload.identityLabel);
  const state = normalize(row.state || payload.state || payload.status);
  const source = clean(payload.source);
  const explicitDemo = isExplicitDemoRecord(payload) || DEMO_PREFIX.test(clean(row.id)) || DEMO_SOURCE.test(source);
  const exactLegacySeed = EXACT_FAKE_ACCOUNT_NAMES.has(displayName)
    && /(?:尚未登录|未登录|尚未验证)/.test(identity)
    && !/(?:connected|online|ready)/.test(state)
    && Number(row.can_send || 0) !== 1
    && Number(row.can_receive || 0) !== 1;
  return explicitDemo || exactLegacySeed;
}

function runProductionDataGuard(options = {}) {
  if (!runtimeMode.isProduction && options.force !== true) {
    return { ok: true, executed: false, mode: runtimeMode.mode, reason: 'not-production' };
  }

  const store = options.store || getR32Store();
  const previous = Number(store.getMeta('productionCleanroomVersion', 0) || 0);
  const report = {
    ok: true,
    executed: true,
    mode: runtimeMode.mode,
    cleanroomVersion: CLEANROOM_VERSION,
    previousVersion: previous,
    removedAccounts: [],
    skippedAccountsWithData: [],
    removedAiAssets: 0,
    at: new Date().toISOString()
  };

  store.transaction(() => {
    const accounts = store.db.prepare(`
      SELECT id, platform, adapter_account_id, display_name, identity_label, state,
             can_send, can_receive, payload_json
      FROM r32_accounts
    `).all();

    for (const row of accounts) {
      if (!isKnownFakeAccount(row)) continue;
      const usage = store.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM r32_conversations WHERE account_id = ?) AS conversations,
          (SELECT COUNT(*) FROM r32_messages WHERE account_id = ?) AS messages,
          (SELECT COUNT(*) FROM r32_send_queue WHERE account_id = ?) AS queued
      `).get(row.id, row.id, row.id);
      const hasUserData = Number(usage.conversations || 0) > 0 || Number(usage.messages || 0) > 0 || Number(usage.queued || 0) > 0;
      if (hasUserData) {
        report.skippedAccountsWithData.push({ id: row.id, displayName: row.display_name, ...usage });
        continue;
      }
      store.db.prepare('DELETE FROM r32_accounts WHERE id = ?').run(row.id);
      report.removedAccounts.push({ id: row.id, displayName: row.display_name, platform: row.platform });
    }

    const accountState = store.getSetting('accounts-state', 'document', null);
    if (accountState && typeof accountState === 'object') {
      const removedIds = new Set(report.removedAccounts.map(item => item.id));
      const defaults = { ...(accountState.defaults || {}) };
      for (const platform of Object.keys(defaults)) if (removedIds.has(defaults[platform])) defaults[platform] = '';
      const bindings = {};
      for (const [conversationId, binding] of Object.entries(accountState.bindings || {})) {
        if (!removedIds.has(binding?.accountId)) bindings[conversationId] = binding;
      }
      store.setSetting('accounts-state', 'document', { ...accountState, defaults, bindings, updatedAt: report.at });
    }

    const aiState = store.getSetting('ai-workbench', 'state', null);
    if (aiState && typeof aiState === 'object') {
      const before = JSON.stringify(aiState);
      const after = sanitizeAiWorkbench(aiState);
      const afterText = JSON.stringify(after);
      if (afterText !== before) {
        report.removedAiAssets = Math.max(0,
          (Array.isArray(aiState.templates) ? aiState.templates.length : 0)
          + (Array.isArray(aiState.materials) ? aiState.materials.length : 0)
          + (Array.isArray(aiState.services) ? aiState.services.length : 0)
          + (Array.isArray(aiState.routes) ? aiState.routes.length : 0)
          + (Array.isArray(aiState.activity) ? aiState.activity.length : 0)
          - (after.templates.length + after.materials.length + after.services.length + after.routes.length + after.activity.length)
        );
        store.setSetting('ai-workbench', 'state', { ...after, updatedAt: report.at });
      }
    }

    store.setMeta('productionCleanroomVersion', CLEANROOM_VERSION);
    store.setMeta('lastProductionCleanroomReport', report);
  });

  return report;
}

module.exports = {
  CLEANROOM_VERSION,
  isExplicitDemoRecord,
  isKnownFakeAccount,
  sanitizeAiWorkbench,
  runProductionDataGuard
};
