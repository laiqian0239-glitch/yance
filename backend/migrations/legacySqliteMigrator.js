'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { stableId, parseJson } = require('../lib/r32SqliteStore');
const { assertMigrationAuthority } = require('../services/migrationAuthority');
const { PATHS } = require('../config');

const DB_NAMES = new Set([
  'chat-engine.db', 'workbuddy.db', 'database.db', 'yance.db', 'yance26.db',
  'yance27.db', 'messages.db', 'app.db'
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'backups', 'migration-backups', 'legacy-json', 'logs', 'cache', 'tmp']);
const TASK_LABELS = Object.freeze({
  translation: ['TR', '翻译', '文本与媒体翻译'],
  understanding: ['UN', '会话理解', '意图、证据与关系上下文'],
  relationship: ['RL', '关系分析', '轨迹、机会与风险'],
  director: ['DR', 'AI导演', '规则与策略编排'],
  quick_reply: ['QR', '快速回复', '低延迟候选生成'],
  deep_reply: ['DP', '深度回复', '复杂上下文候选'],
  quality_review: ['QA', '内容质检', '事实、人设与风险检查'],
  summary: ['SM', '摘要', '会话与媒体摘要'],
  fact_extraction: ['FX', '事实提取', '客户事实候选'],
  material_analysis: ['MA', '材料分析', '学习材料治理'],
  speech_transcription: ['ST', '语音转写', '语音识别与翻译']
});

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function truthy(value) { return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'; }
function json(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  return parseJson(value, fallback);
}
function normalizePhone(value) { return clean(value).replace(/[^0-9+]/g, '').replace(/^00/, '+'); }
function normalizeIdentity(value) {
  return clean(value).toLowerCase().replace(/@(?:s\.whatsapp\.net|c\.us)$/i, '').replace(/[^a-z0-9+]/g, '');
}
function compact(values) { return values.filter(value => value !== undefined && value !== null && clean(value)); }
function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter(row => { const key = keyFn(row); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
function fileLooksSqlite(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch (_) { return false; }
}
function walkLegacyDatabases(root, options = {}) {
  const target = path.resolve(root);
  const skip = new Set((options.skipFiles || []).map(file => path.resolve(file)));
  const result = [];
  function visit(directory, depth) {
    if (depth > Number(options.maxDepth || 6)) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(lower)) visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || skip.has(path.resolve(full))) continue;
      if (!(DB_NAMES.has(lower) || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3') || /(?:yance|workbuddy|chat|message).+\.db$/i.test(lower))) continue;
      if (fileLooksSqlite(full)) result.push(path.resolve(full));
    }
  }
  visit(target, 0);
  return [...new Set(result)].sort();
}
function hashFile(hash, file, options = {}) {
  const stat = fs.statSync(file);
  hash.update(path.basename(file));
  hash.update(String(stat.size));
  if (options.includeMtime === true) hash.update(String(Math.trunc(stat.mtimeMs)));
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    let position = 0;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, position)) > 0) {
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally { fs.closeSync(fd); }
}
function hashSqlValue(hash, value) {
  if (value === null || value === undefined) { hash.update('\0'); return; }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) { hash.update(Buffer.from(value)); return; }
  hash.update(String(value));
  hash.update('\u001e');
}
function hashDatabaseTables(hash, db, tables = null) {
  const names = [...(tables || tableSet(db))].sort();
  for (const name of names) {
    hash.update(name); hash.update('\u001f');
    let statement;
    try { statement = db.prepare(`SELECT * FROM "${name}"`); } catch (_) { continue; }
    for (const row of statement.iterate()) {
      for (const key of Object.keys(row).sort()) {
        hash.update(key); hash.update('='); hashSqlValue(hash, row[key]);
      }
      hash.update('\u001d');
    }
  }
}
function databaseFingerprint(file, db = null, tables = null) {
  const hash = crypto.createHash('sha256');
  hash.update(path.basename(file));
  hash.update('\u001f');
  if (!db) {
    hashFile(hash, file);
    return `legacy-sqlite:${hash.digest('hex')}`;
  }
  hashDatabaseTables(hash, db, tables);
  return `legacy-sqlite:${hash.digest('hex')}`;
}
function legacyPathBoundDatabaseFingerprint(pathSeed, currentFile, db = null, tables = null) {
  const hash = crypto.createHash('sha256');
  hash.update(path.resolve(pathSeed));
  if (!db) {
    hashFile(hash, currentFile, { includeMtime: true });
    return `legacy-sqlite:${hash.digest('hex')}`;
  }
  hashDatabaseTables(hash, db, tables);
  return `legacy-sqlite:${hash.digest('hex')}`;
}
function completedDatabaseMigration(targetStore, fingerprint, sourceFile, sourceDb, tables) {
  const direct = targetStore.findCompletedMigration(fingerprint);
  if (direct) return direct;
  if (typeof targetStore.listCompletedMigrations !== 'function') return null;
  for (const receipt of targetStore.listCompletedMigrations() || []) {
    const historicalPath = clean(receipt?.sourceRoot);
    const historicalFingerprint = clean(receipt?.sourceFingerprint);
    if (!historicalPath || !historicalFingerprint || !historicalFingerprint.startsWith('legacy-sqlite:')) continue;
    if (legacyPathBoundDatabaseFingerprint(historicalPath, sourceFile, sourceDb, tables) === historicalFingerprint) return receipt;
  }
  return null;
}
function tableSet(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name));
}
function rows(db, tables, name) {
  if (!tables.has(name)) return [];
  try { return [...db.prepare(`SELECT * FROM "${name}"`).iterate()]; } catch (_) { return []; }
}
function latestBy(rowsValue, keyFn, timeFn) {
  const map = new Map();
  for (const row of rowsValue) {
    const key = keyFn(row);
    if (!key) continue;
    const current = map.get(key);
    if (!current || String(timeFn(row) || '') >= String(timeFn(current) || '')) map.set(key, row);
  }
  return map;
}
function mergeObject(base, patch) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) result[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) result[key] = mergeObject(result[key], value);
    else result[key] = value;
  }
  return result;
}
function defaultProfile() {
  return { health: 0, temperature: 0, openness: 0, risk: 0, activity: 0, next: '等待真实互动与人工确认后生成建议。', updated: '', confirmed: [], inferences: [], commitments: [], boundaries: [], milestones: [] };
}
function factLabel(key) {
  const labels = {
    age: '年龄', birthday: '生日', address: '地址', city: '城市', country: '国家', job: '职业', occupation: '职业',
    languages: '语言', language: '语言', family: '家庭', stage: '关系阶段', interests: '兴趣', interest: '兴趣',
    note: '备注', company: '公司', email: '邮箱', phone: '电话', relationship: '关系状态'
  };
  return labels[clean(key).toLowerCase()] || clean(key);
}
function normalizeFactKey(key) {
  const source = clean(key).toLowerCase();
  const map = { occupation: 'job', language: 'languages', interest: 'interests', location: 'address', relation_stage: 'stage', relationship_stage: 'stage' };
  return map[source] || source;
}
function sourcePriority(row) {
  const status = clean(row.status).toLowerCase();
  const source = clean(row.source).toLowerCase();
  if (status.includes('confirm') || status.includes('approve') || source === 'manual' || truthy(row.locked)) return 3;
  if (status.includes('accept') || number(row.confidence) >= 85) return 2;
  return 1;
}
function mergeFact(profileDoc, row) {
  const key = normalizeFactKey(row.fact_key ?? row.field_key ?? row.key);
  const value = clean(row.fact_value ?? row.field_value ?? row.value);
  if (!key || !value) return;
  const confidence = Math.round(number(row.confidence, row.source === 'manual' ? 100 : 70));
  const source = clean(row.source, '旧版本迁移');
  const status = clean(row.status, sourcePriority(row) >= 2 ? 'confirmed' : 'pending');
  const item = { key, label: factLabel(key), text: `${factLabel(key)}：${value}`, value, confidence, source, status, legacy: true };
  const confirmed = sourcePriority(row) >= 2;
  const target = confirmed ? profileDoc.profile.confirmed : profileDoc.profile.inferences;
  const existing = target.find(entry => entry.key === key && clean(entry.value) === value);
  if (!existing) target.push(item);
  if (confirmed) {
    const standard = new Set(['age', 'birthday', 'address', 'city', 'country', 'job', 'languages', 'family', 'stage', 'interests', 'note']);
    if (standard.has(key)) profileDoc.facts[key] = value;
    else profileDoc.extraFacts[key] = value;
  }
}
function chooseSessionKey({ channel, conversation, identity, accountId, customerId, dbTag }) {
  return clean(channel?.stable_chat_id || conversation?.external_conversation_id || identity?.chat_jid || identity?.contact_id || identity?.phone)
    || `legacy:${dbTag}:${clean(accountId, 'account')}:${clean(customerId, 'customer')}`;
}
function routeShape(row) {
  const id = clean(row.task_type || row.route_name || row.id).toLowerCase().replace(/[\s-]+/g, '_');
  if (!id) return null;
  const meta = TASK_LABELS[id] || [id.slice(0, 2).toUpperCase(), clean(row.route_name, id), clean(row.route_name, id)];
  const fallback = json(row.fallback_json, []);
  return {
    id, code: meta[0], name: meta[1], desc: meta[2],
    main: clean(row.model_name || row.primary || 'auto') || 'auto',
    backup: clean(Array.isArray(fallback) ? fallback[0] : row.fallback || 'auto') || 'auto',
    limit: Math.max(256, number(row.max_tokens || row.timeout_ms ? 1800 : 1800, 1800)),
    enabled: clean(row.status, 'active') !== 'disabled',
    provider: clean(row.provider), legacyRouteName: clean(row.route_name), migrated: true
  };
}
function migrateOneDatabase(sourceFile, targetStore, sourceRoot, options = {}) {
  const sourceDb = new DatabaseSync(sourceFile, { readOnly: true });
  try { sourceDb.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;'); } catch (_) {}
  const tables = tableSet(sourceDb);
  const fingerprint = databaseFingerprint(sourceFile, sourceDb, tables);
  const previous = completedDatabaseMigration(targetStore, fingerprint, sourceFile, sourceDb, tables);
  const report = {
    ok: false, sourceFile, sourceRoot, sourceFingerprint: fingerprint,
    imported: { accounts: 0, contacts: 0, conversations: 0, messages: 0, profiles: 0, facts: 0, relationshipEvents: 0, drafts: 0, rules: 0, materials: 0, routes: 0, preferences: 0 },
    skipped: {}, warnings: [], startedAt: new Date().toISOString(), completedAt: ''
  };
  if (previous && !options.force) {
    try { sourceDb.close(); } catch (_) {}
    return { ...report, ok: true, mode: 'already-imported', completedAt: new Date().toISOString(), previousRunId: previous.id };
  }

  const dbTag = crypto.createHash('sha1').update(path.resolve(sourceFile)).digest('hex').slice(0, 10);
  const runId = targetStore.createMigrationRun({ sourceRoot: sourceFile, sourceFingerprint: fingerprint, status: 'running', report });
  try {
    targetStore.transaction(() => {
      const customers = rows(sourceDb, tables, 'customers');
      const customerById = new Map(customers.map(row => [String(row.id), row]));
      const identities = rows(sourceDb, tables, 'customer_identities');
      const identityByCustomer = latestBy(identities, row => clean(row.customer_id), row => row.updated_at || row.created_at);
      const oldAccounts = rows(sourceDb, tables, 'wb_accounts');
      const accountMap = new Map();
      for (const row of oldAccounts) {
        const platform = clean(row.platform, 'whatsapp').toLowerCase();
        const id = `legacy-acct:${dbTag}:${row.id}`;
        targetStore.upsertAccount({
          id, platform, adapterAccountId: clean(row.account_external_id || row.id), displayName: clean(row.label, `旧版${platform}账号`),
          state: truthy(row.active) ? 'migrated' : 'disabled', canSend: null, canReceive: null,
          metadata: json(row.metadata_json, {}), source: 'legacy-sqlite', legacyId: row.id, migratedFrom: sourceFile,
          createdAt: row.created_at, updatedAt: row.updated_at
        });
        accountMap.set(String(row.id), id);
        report.imported.accounts += 1;
      }

      const channels = rows(sourceDb, tables, 'wb_conversation_channels');
      const channelByConversation = latestBy(channels, row => clean(row.conversation_id), row => row.updated_at || row.created_at);
      const conversations = rows(sourceDb, tables, 'wb_conversations');
      const conversationMap = new Map();
      const customerSessions = new Map();
      for (const row of conversations) {
        const customer = customerById.get(String(row.customer_id)) || {};
        const identity = identityByCustomer.get(String(row.customer_id)) || {};
        const channel = channelByConversation.get(String(row.id)) || {};
        const accountId = accountMap.get(String(row.account_id)) || `legacy-acct:${dbTag}:${clean(row.account_id, 'unknown')}`;
        const platform = clean(channel.channel || identity.platform || 'whatsapp').toLowerCase();
        const sessionKey = chooseSessionKey({ channel, conversation: row, identity, accountId, customerId: row.customer_id, dbTag });
        const contactId = `legacy-contact:${dbTag}:${clean(row.customer_id, row.id)}`;
        const displayName = clean(identity.display_name || customer.name || channel.display_title || sessionKey, '旧版联系人');
        targetStore.upsertContact({
          id: contactId, platform, externalId: clean(identity.chat_jid || identity.contact_id || channel.stable_chat_id || identity.phone),
          displayName, phone: clean(identity.phone || customer.phone), source: 'legacy-sqlite', legacyCustomerId: row.customer_id,
          migratedFrom: sourceFile, createdAt: customer.created_at || row.created_at, updatedAt: identity.updated_at || row.updated_at
        });
        targetStore.upsertConversation({
          sessionKey, accountId, contactId, platform, title: displayName, lastMessageAt: row.last_message_at || row.updated_at,
          routeState: clean(row.status), source: 'legacy-sqlite', legacyConversationId: row.id, chatJid: clean(channel.stable_chat_id || identity.chat_jid),
          externalId: clean(row.external_conversation_id), migratedFrom: sourceFile, createdAt: row.created_at, updatedAt: row.updated_at
        });
        conversationMap.set(String(row.id), sessionKey);
        const list = customerSessions.get(String(row.customer_id)) || [];
        list.push(sessionKey); customerSessions.set(String(row.customer_id), list);
        report.imported.contacts += 1;
        report.imported.conversations += 1;
      }

      // Some older databases contain customers/identities but no wb_conversations.
      for (const customer of customers) {
        const customerId = String(customer.id);
        if (customerSessions.has(customerId)) continue;
        const identity = identityByCustomer.get(customerId) || {};
        const platform = clean(identity.platform, 'whatsapp').toLowerCase();
        const sessionKey = chooseSessionKey({ identity, customerId, accountId: identity.account_external_id, dbTag });
        const contactId = `legacy-contact:${dbTag}:${customerId}`;
        targetStore.upsertContact({ id: contactId, platform, externalId: clean(identity.chat_jid || identity.contact_id || identity.phone), displayName: clean(identity.display_name || customer.name, '旧版联系人'), phone: clean(identity.phone || customer.phone), source: 'legacy-sqlite', legacyCustomerId: customer.id, migratedFrom: sourceFile, createdAt: customer.created_at, updatedAt: identity.updated_at });
        customerSessions.set(customerId, [sessionKey]);
        report.imported.contacts += 1;
      }

      for (const row of rows(sourceDb, tables, 'wb_messages')) {
        const sessionKey = conversationMap.get(String(row.conversation_id)) || customerSessions.get(String(row.customer_id))?.[0];
        if (!sessionKey) { report.skipped.messages = (report.skipped.messages || 0) + 1; continue; }
        const metadata = json(row.metadata_json, {}) || {};
        targetStore.touchConversationFromMessage({ sessionKey, accountId: accountMap.get(String(row.account_id)) || '', text: row.text, sentAt: row.sent_at || row.received_at || row.created_at, platform: metadata.platform || 'whatsapp' });
        targetStore.upsertMessage({
          id: stableId('legacy_msg', [dbTag, row.id]), sessionKey, accountId: accountMap.get(String(row.account_id)) || '',
          senderId: clean(metadata.senderId || metadata.sender || row.customer_id), role: clean(row.role), direction: clean(row.direction),
          messageType: clean(row.message_type, 'text'), text: clean(row.text), mediaUrl: clean(metadata.mediaUrl || metadata.media_url),
          mediaPath: clean(metadata.localFile || metadata.mediaPath || metadata.media_path), quotedMessageId: clean(metadata.quotedMessageId || metadata.quoted_message_id),
          deliveryStatus: clean(metadata.deliveryStatus || metadata.status), sentAt: row.sent_at || row.received_at || row.created_at,
          externalMessageId: clean(row.external_message_id), language: clean(row.language), sourceHash: clean(row.source_hash),
          legacyMessageId: row.id, migratedFrom: sourceFile, metadata
        });
        report.imported.messages += 1;
      }

      const profileRecords = [];
      const factsByCustomer = new Map();
      function profileFor(customerId) {
        const key = String(customerId);
        if (!factsByCustomer.has(key)) {
          const customer = customerById.get(key) || {};
          const vars = json(customer.variables, {}) || {};
          const doc = { facts: {}, extraFacts: {}, note: clean(vars.note), profile: defaultProfile(), legacy: { customerId: key, sourceFile } };
          for (const [factKey, factValue] of Object.entries(vars)) {
            if (factKey === 'note' || factValue == null || typeof factValue === 'object') continue;
            mergeFact(doc, { fact_key: factKey, fact_value: factValue, source: 'legacy-customer-variables', status: 'confirmed', confidence: 95 });
          }
          factsByCustomer.set(key, doc);
        }
        return factsByCustomer.get(key);
      }
      const factTables = [
        ['customer_profile_facts', row => row.customer_id],
        ['wb_v191_profile_fields', row => row.customer_id],
        ['wb_v233_customer_facts', row => row.customer_id],
        ['wb_fact_registry', row => row.customer_id]
      ];
      for (const [table, getCustomer] of factTables) {
        for (const row of rows(sourceDb, tables, table)) {
          const customerId = clean(getCustomer(row));
          if (!customerId) continue;
          mergeFact(profileFor(customerId), row);
          report.imported.facts += 1;
        }
      }
      for (const customer of customers) profileFor(customer.id);

      const communicationByCustomer = new Map(rows(sourceDb, tables, 'wb_v209_customer_communication_profiles').map(row => [String(row.customer_id), json(row.profile_json, {}) || {}]));
      for (const [customerId, doc] of factsByCustomer) {
        const customer = customerById.get(customerId) || {};
        const identity = identityByCustomer.get(customerId) || {};
        const communication = communicationByCustomer.get(customerId) || {};
        if (Object.keys(communication).length) {
          doc.profile = mergeObject(doc.profile, {
            openness: communication.openness,
            temperature: communication.temperature,
            activity: communication.activity,
            next: communication.next || communication.nextAction
          });
          doc.legacy.communicationProfile = communication;
        }
        const sessionKeys = customerSessions.get(customerId) || [];
        for (const sessionKey of sessionKeys) {
          const existing = targetStore.getSetting('customer-profile', sessionKey, {});
          targetStore.setSetting('customer-profile', sessionKey, mergeObject(doc, existing));
          report.imported.profiles += 1;
        }
        profileRecords.push({
          id: `legacy-profile:${dbTag}:${customerId}`, name: clean(identity.display_name || customer.name), phone: normalizePhone(identity.phone || customer.phone),
          chatJid: clean(identity.chat_jid), externalId: clean(identity.contact_id || identity.chat_jid), platform: clean(identity.platform, 'whatsapp'),
          matchKeys: uniqueBy(compact([normalizeIdentity(identity.chat_jid), normalizeIdentity(identity.contact_id), normalizePhone(identity.phone || customer.phone), clean(customer.name).toLowerCase()]).map(value => ({ value })), row => row.value).map(row => row.value),
          sessionKeys, document: doc, sourceFile
        });
      }
      const oldLegacyIndex = targetStore.getSetting('legacy-customer-profiles', 'document', { records: [] }) || { records: [] };
      const records = uniqueBy([...(oldLegacyIndex.records || []), ...profileRecords], row => row.id);
      targetStore.setSetting('legacy-customer-profiles', 'document', { records, updatedAt: new Date().toISOString() });

      const relationshipBySession = new Map();
      for (const row of rows(sourceDb, tables, 'wb_relationship_events')) {
        const sessionKey = conversationMap.get(String(row.conversation_id)) || customerSessions.get(String(row.customer_id))?.[0];
        if (!sessionKey) continue;
        const list = relationshipBySession.get(sessionKey) || [];
        list.push([clean(row.created_at), clean(row.event_type, '关系事件'), clean(row.summary), clean(row.direction), clean(row.source_message_id), json(row.metadata_json, {}) || {}]);
        relationshipBySession.set(sessionKey, list);
        report.imported.relationshipEvents += 1;
      }
      for (const row of rows(sourceDb, tables, 'wb_relationship_decisions')) {
        const sessionKey = conversationMap.get(String(row.conversation_id)) || customerSessions.get(String(row.customer_id))?.[0];
        if (!sessionKey) continue;
        const list = relationshipBySession.get(sessionKey) || [];
        const summary = compact([
          row.core_need && `核心需要：${row.core_need}`,
          row.relationship_action && `关系动作：${row.relationship_action}`,
          row.emotion_action && `情绪动作：${row.emotion_action}`,
          row.information_action && `信息动作：${row.information_action}`,
          row.rhythm_action && `节奏动作：${row.rhythm_action}`
        ]).join('；');
        list.push([clean(row.updated_at || row.created_at), 'relationship_decision', summary, clean(row.processing_path), '', { mustRespond: json(row.must_respond_json, []), constraints: json(row.fact_constraints_json, []), risks: json(row.risk_boundaries_json, []), avoid: json(row.avoid_json, []), rationale: json(row.rationale_json, {}) }]);
        relationshipBySession.set(sessionKey, list);
        report.imported.relationshipEvents += 1;
      }
      for (const [sessionKey, events] of relationshipBySession) {
        const existing = targetStore.getSetting('relationship-trajectory', sessionKey, {}) || {};
        const mergedEvents = uniqueBy([...(existing.events || []), ...events], row => `${row[0]}|${row[1]}|${row[2]}`).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 1000);
        targetStore.setSetting('relationship-trajectory', sessionKey, { ...existing, events: mergedEvents, updated: mergedEvents[0]?.[0] || existing.updated || '', migratedFrom: sourceFile });
      }

      const latestDrafts = latestBy(rows(sourceDb, tables, 'wb_drafts').filter(row => clean(row.status) !== 'sent'), row => clean(row.conversation_id), row => row.updated_at || row.created_at);
      for (const [conversationId, row] of latestDrafts) {
        const sessionKey = conversationMap.get(conversationId) || customerSessions.get(String(row.customer_id))?.[0];
        if (!sessionKey || !clean(row.text)) continue;
        targetStore.setSetting('conversation-drafts', sessionKey, { text: clean(row.text), status: clean(row.status), sourceMessageIds: json(row.source_message_ids_json, []), updatedAt: row.updated_at || row.created_at, migratedFrom: sourceFile });
        report.imported.drafts += 1;
      }

      const aiState = targetStore.getSetting('ai-workbench', 'state', { templates: [], contactRules: {}, materials: [], routes: [], activity: [] }) || {};
      const templates = Array.isArray(aiState.templates) ? [...aiState.templates] : [];
      for (const row of rows(sourceDb, tables, 'wb_strategy_rules')) {
        const body = compact([
          row.scene && `场景：${row.scene}`,
          row.relationship_stage && `关系阶段：${row.relationship_stage}`,
          row.relationship_action && `关系动作：${row.relationship_action}`,
          row.expression_direction && `表达方向：${row.expression_direction}`,
          row.avoid_text && `避免：${row.avoid_text}`
        ]).join('；');
        templates.push({ id: `legacy-rule:${dbTag}:${row.id}`, name: clean(row.name, '旧版导演规则'), body, priority: Math.max(1, 100 - number(row.id, 50)), enabled: truthy(row.active), scope: clean(row.scope, 'global'), version: number(row.version, 1), source: '早期言策规则迁移', migratedFrom: sourceFile, createdAt: row.created_at, updatedAt: row.updated_at });
        report.imported.rules += 1;
      }

      const materials = Array.isArray(aiState.materials) ? [...aiState.materials] : [];
      for (const row of rows(sourceDb, tables, 'wb_v200_learning_assets')) {
        materials.push({
          id: clean(row.asset_uuid, `legacy-asset:${dbTag}:${row.id}`), title: clean(row.title || row.summary, '旧版学习资产'),
          text: clean(row.selected_text || row.source_text), translation: clean(row.chinese_translation), kind: clean(row.asset_kind, 'learning'),
          status: clean(row.lifecycle_status, truthy(row.active) ? 'active' : 'disabled'), scope: clean(row.scope_type, 'workspace'),
          summary: clean(row.summary), tags: json(row.tags_json, []), principles: json(row.principles_json, []), avoidConditions: json(row.avoid_conditions_json, []),
          notes: clean(row.user_notes), confidence: number(row.confidence, 70), confirmed: truthy(row.user_confirmed), source: '早期言策学习资产迁移', migratedFrom: sourceFile,
          createdAt: row.created_at, updatedAt: row.updated_at
        });
        report.imported.materials += 1;
      }
      const importById = new Map(rows(sourceDb, tables, 'wb_v207_material_imports').map(row => [String(row.id), row]));
      const segmentsByImport = new Map();
      for (const row of rows(sourceDb, tables, 'wb_v207_material_segments')) {
        const list = segmentsByImport.get(String(row.import_id)) || [];
        list.push(row); segmentsByImport.set(String(row.import_id), list);
      }
      for (const [importId, row] of importById) {
        const segments = (segmentsByImport.get(importId) || []).sort((a, b) => number(a.segment_index) - number(b.segment_index));
        materials.push({ id: `legacy-material:${dbTag}:${importId}`, title: clean(row.original_filename, '旧版导入材料'), kind: clean(row.file_format, 'document'), status: clean(row.status, 'imported'), scope: clean(row.scope_type, 'workspace'), summary: json(row.summary_json, {}), text: segments.map(segment => clean(segment.original_text)).filter(Boolean).join('\n\n'), translation: segments.map(segment => clean(segment.translation_cn)).filter(Boolean).join('\n\n'), segments: segments.map(segment => ({ index: segment.segment_index, type: segment.segment_type, stage: segment.stage_label, speaker: segment.speaker, direction: segment.direction, language: segment.language_code, text: segment.original_text, translation: segment.translation_cn, metadata: json(segment.metadata_json, {}) })), source: '早期言策材料导入迁移', migratedFrom: sourceFile, createdAt: row.created_at, updatedAt: row.completed_at || row.created_at });
        report.imported.materials += 1;
      }
      for (const row of rows(sourceDb, tables, 'script_phrases')) {
        materials.push({ id: `legacy-phrase:${dbTag}:${row.id}`, title: clean(row.category, '旧版常用表达'), kind: 'phrase', status: 'active', scope: 'workspace', text: clean(row.content), translation: clean(row.chinese_translation), summary: clean(row.psychological_hint), source: '早期言策表达库迁移', migratedFrom: sourceFile, createdAt: row.created_at });
        report.imported.materials += 1;
      }

      for (const row of rows(sourceDb, tables, 'wb_learning_profiles')) {
        const value = json(row.value_json, {}) || {};
        materials.push({ id: `legacy-learning-profile:${dbTag}:${row.id}`, title: `旧版学习画像 · ${clean(row.profile_key, row.level)}`, kind: 'learning-profile', status: clean(row.status, 'active'), scope: clean(row.level, 'workspace'), text: typeof value === 'string' ? value : JSON.stringify(value, null, 2), summary: `${number(row.evidence_count)} 条证据 · 置信度 ${Math.round(number(row.confidence, .5) * 100)}%`, confidence: Math.round(number(row.confidence, .5) * 100), protected: truthy(row.protected_core), source: '早期言策学习画像迁移', migratedFrom: sourceFile, createdAt: row.created_at, updatedAt: row.updated_at });
        report.imported.materials += 1;
      }
      for (const row of rows(sourceDb, tables, 'wb_learning_events')) {
        materials.push({ id: `legacy-learning-event:${dbTag}:${row.id}`, title: '旧版已确认表达样本', kind: 'confirmed-sample', status: clean(row.status, 'confirmed'), scope: clean(row.scope, 'workspace'), text: clean(row.sample_text), summary: clean(row.engine_version), metadata: json(row.metadata_json, {}), source: '早期言策学习事件迁移', migratedFrom: sourceFile, createdAt: row.created_at });
        report.imported.materials += 1;
      }
      for (const row of rows(sourceDb, tables, 'wb_learning_deltas')) {
        materials.push({ id: `legacy-learning-delta:${dbTag}:${row.id}`, title: '旧版候选修改学习样本', kind: 'revision-sample', status: clean(row.status, 'classified'), scope: 'workspace', text: clean(row.final_text), originalText: clean(row.ai_draft_text), changeTypes: json(row.change_types_json, []), metrics: json(row.metrics_json, {}), source: '早期言策修改学习迁移', migratedFrom: sourceFile, createdAt: row.created_at });
        report.imported.materials += 1;
      }
      const scripts = rows(sourceDb, tables, 'scripts');
      const scriptMessages = rows(sourceDb, tables, 'script_messages');
      const messagesByScript = new Map();
      for (const message of scriptMessages) {
        const list = messagesByScript.get(String(message.script_id)) || [];
        list.push(message); messagesByScript.set(String(message.script_id), list);
      }
      for (const script of scripts) {
        const messages = (messagesByScript.get(String(script.id)) || []).sort((a, b) => number(a.day_number) - number(b.day_number) || number(a.order_index) - number(b.order_index));
        const scriptText = messages.map(message => {
          const heading = `[Day ${number(message.day_number, 1)} · ${clean(message.role, 'bot')}]`;
          const translation = clean(message.translation);
          return `${heading} ${clean(message.content)}${translation ? `\n译文：${translation}` : ''}`;
        }).join('\n\n');
        materials.push({ id: `legacy-script:${dbTag}:${script.id}`, title: clean(script.name, '旧版对话材料'), kind: 'conversation-script', status: 'active', scope: 'workspace', text: scriptText, summary: clean(script.description), botName: clean(script.bot_name), messageCount: messages.length, source: '早期言策剧本资产迁移', migratedFrom: sourceFile, createdAt: script.created_at, updatedAt: script.updated_at });
        report.imported.materials += 1;
      }

      const contactRules = { ...(aiState.contactRules || {}) };
      for (const row of rows(sourceDb, tables, 'wb_v209_style_dna')) {
        const customerId = clean(row.customer_id || (clean(row.scope_type).toLowerCase() === 'customer' ? row.scope_id : ''));
        const sessionKeys = customerSessions.get(customerId) || [];
        const profile = json(row.profile_json, {}) || {};
        const body = Object.entries(profile).filter(([, value]) => value !== '' && value != null).slice(0, 30).map(([key, value]) => `${key}：${typeof value === 'object' ? JSON.stringify(value) : value}`).join('；');
        for (const sessionKey of sessionKeys) {
          const list = Array.isArray(contactRules[sessionKey]) ? [...contactRules[sessionKey]] : [];
          list.push({ id: `legacy-style-dna:${dbTag}:${row.id}`, name: '旧版联系人表达风格', body, priority: 85, enabled: true, scope: 'contact', sampleCount: number(row.sample_count), source: '早期言策风格DNA迁移', migratedFrom: sourceFile, createdAt: row.created_at, updatedAt: row.updated_at });
          contactRules[sessionKey] = uniqueBy(list, item => item.id);
          report.imported.rules += 1;
        }
      }

      const routes = Array.isArray(aiState.routes) ? [...aiState.routes] : [];
      const routeObjects = {};
      for (const row of rows(sourceDb, tables, 'wb_model_routes')) {
        const route = routeShape(row);
        if (!route) continue;
        routes.push(route);
        routeObjects[route.id] = { primary: route.main === 'auto' ? '' : route.main, fallback: route.backup === 'auto' ? '' : route.backup, maxTokens: route.limit, enabled: route.enabled, provider: route.provider, migratedFrom: sourceFile };
        report.imported.routes += 1;
      }
      const nextAiState = {
        ...aiState,
        templates: uniqueBy(templates, row => row.id),
        materials: uniqueBy(materials, row => row.id),
        routes: uniqueBy(routes, row => row.id),
        contactRules,
        activity: [{ time: new Date().toISOString(), text: `已从旧版本迁移 ${report.imported.rules} 条规则、${report.imported.materials} 份学习资产和 ${report.imported.routes} 条模型路由` }, ...(aiState.activity || [])].slice(0, 100),
        updatedAt: new Date().toISOString()
      };
      targetStore.setSetting('ai-workbench', 'state', nextAiState);
      if (Object.keys(routeObjects).length) {
        const modelState = targetStore.getSetting('model-registry', 'document', { schemaVersion: 1, models: [], routes: {}, history: [] }) || {};
        targetStore.setSetting('model-registry', 'document', { ...modelState, routes: { ...(modelState.routes || {}), ...routeObjects }, routesUpdatedAt: new Date().toISOString() });
      }

      const preferences = {};
      const protectedKeys = [];
      for (const table of ['user_preferences', 'system_config']) {
        for (const row of rows(sourceDb, tables, table)) {
          const key = clean(row.key);
          if (!key) continue;
          if (/(?:api[_-]?key|token|secret|password|credential|private[_-]?key|access[_-]?key)/i.test(key)) {
            protectedKeys.push({ key, sourceTable: table, sourceFile, action: 'requires-secure-reentry' });
            continue;
          }
          preferences[key] = json(row.value, row.value);
        }
      }
      if (Object.keys(preferences).length) {
        const existing = targetStore.getSetting('legacy-preferences', 'document', {}) || {};
        targetStore.setSetting('legacy-preferences', 'document', { ...existing, ...preferences, migratedFrom: sourceFile, updatedAt: new Date().toISOString() });
        report.imported.preferences = Object.keys(preferences).length;
      }
      if (protectedKeys.length) {
        const existingInventory = targetStore.getSetting('legacy-secret-inventory', 'document', { items: [] }) || { items: [] };
        targetStore.setSetting('legacy-secret-inventory', 'document', { items: uniqueBy([...(existingInventory.items || []), ...protectedKeys], item => `${item.sourceFile}|${item.sourceTable}|${item.key}`), updatedAt: new Date().toISOString() });
        report.warnings.push(`${protectedKeys.length} 个旧版敏感配置未写入普通SQLite，需要通过安全凭据恢复或重新输入。`);
      }

      targetStore.setMeta(`legacySqlite:${fingerprint}`, { sourceFile, sourceRoot, importedAt: new Date().toISOString(), tables: [...tables].sort(), imported: report.imported });
    });
    report.ok = true;
    report.mode = 'transactional-import';
    report.completedAt = new Date().toISOString();
    targetStore.finishMigrationRun(runId, 'completed', report);
    return report;
  } catch (error) {
    report.error = error.stack || error.message || String(error);
    report.completedAt = new Date().toISOString();
    try { targetStore.finishMigrationRun(runId, 'failed', report); } catch (_) {}
    throw error;
  } finally {
    try { sourceDb.close(); } catch (_) {}
  }
}

function migrateLegacySqlite(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || PATHS.root);
  const targetDbPath = path.resolve(options.dbPath || PATHS.sqlite);
  const files = options.files || walkLegacyDatabases(sourceRoot, { skipFiles: [targetDbPath] });
  const report = { ok: true, sourceRoot, targetDbPath, mode: files.length ? 'sqlite-import' : 'nothing-to-import', files: [], imported: {}, warnings: [], startedAt: new Date().toISOString(), completedAt: '' };
  if (!files.length) { report.completedAt = new Date().toISOString(); return report; }
  const migrationAuthority = assertMigrationAuthority(options.migrationAuthority);
  if (migrationAuthority.authority !== 'AuthorityWriteHostMigrationAuthority') {
    throw Object.assign(new Error('Legacy SQLite import requires AuthorityWriteHostMigrationAuthority'), { code: 'MIGRATION_AUTHORITY_INVALID' });
  }
  migrationAuthority.assertTargetDbPath(targetDbPath);
  const targetStore = migrationAuthority.targetStore();
  for (const sourceFile of files) {
      try {
        const item = migrateOneDatabase(sourceFile, targetStore, sourceRoot, options);
        report.files.push(item);
        for (const [key, value] of Object.entries(item.imported || {})) report.imported[key] = number(report.imported[key]) + number(value);
      } catch (error) {
        report.ok = false;
        report.files.push({ ok: false, sourceFile, error: error.message, code: error.code || 'LEGACY_SQLITE_IMPORT_FAILED' });
        report.warnings.push({ sourceFile, error: error.message, code: error.code || 'LEGACY_SQLITE_IMPORT_FAILED' });
        if (options.stopOnError) throw error;
      }
  }
  report.completedAt = new Date().toISOString();
  report.mode = report.files.every(item => item.mode === 'already-imported') ? 'already-imported' : (report.ok ? 'completed' : 'completed-with-warnings');
  return report;
}

module.exports = {
  DB_NAMES,
  walkLegacyDatabases,
  databaseFingerprint,
  migrateLegacySqlite,
  migrateOneDatabase,
  normalizeIdentity,
  normalizePhone
};
