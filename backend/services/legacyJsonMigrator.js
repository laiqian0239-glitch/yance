'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableId } = require('../lib/r32SqliteStore');
const { assertMigrationAuthority } = require('./migrationAuthority');
const { PATHS } = require('../config');

const LEGACY_NAMES = Object.freeze([
  'accounts.json',
  'contacts.json',
  'conversations.json',
  'messages.json',
  'notification-settings.json',
  'system-policy.json',
  'feature-flags.json',
  'desktop-settings.json',
  'system-health-history.json',
  'registry.json',
  'ai-memory.json',
  'ai-memories.json',
  'memory.json',
  'memories.json',
  'knowledge-base.json',
  'knowledge.json',
  'knowledge-assets.json',
  'learning-materials.json',
  'media-index.json',
  'media-library.json',
  'media-cache-index.json',
  'customer-profiles.json',
  'relationship-timeline.json',
  'conversation-drafts.json',
  'ai-workbench.json',
  'task-routes.json'
]);

function clean(value) { return value == null ? '' : String(value).trim(); }
function first(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return fallback;
}
function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }

function walk(root, maxDepth = 6) {
  const wanted = new Set(LEGACY_NAMES);
  const results = [];
  function visit(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (['node_modules', 'dist', 'build', '.git', 'backups', 'legacy-json'].includes(entry.name.toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (wanted.has(entry.name.toLowerCase())) results.push(full);
    }
  }
  visit(path.resolve(root), 0);
  return [...new Set(results)].sort();
}

function commonRoot(files) {
  const absolute = files.map(file => path.resolve(file));
  if (!absolute.length) return process.cwd();
  let root = path.dirname(absolute[0]);
  for (const file of absolute.slice(1)) {
    const directory = path.dirname(file);
    while (directory !== root && !directory.startsWith(`${root}${path.sep}`)) {
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
  }
  return root;
}

function relativeIdentityPath(file, sourceRoot) {
  const absolute = path.resolve(file);
  const root = path.resolve(sourceRoot || path.dirname(absolute));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return path.basename(absolute);
  return relative.split(path.sep).join('/');
}

function fingerprint(files, sourceRoot = '') {
  const root = path.resolve(sourceRoot || commonRoot(files));
  const entries = files.map(file => ({ file: path.resolve(file), relative: relativeIdentityPath(file, root) }))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    const stat = fs.statSync(entry.file);
    hash.update(entry.relative);
    hash.update('\u001f');
    hash.update(String(stat.size));
    hash.update('\u001e');
    hash.update(fs.readFileSync(entry.file));
    hash.update('\u001d');
  }
  return hash.digest('hex');
}

function legacyPathBoundFingerprint(files, currentRoot, historicalRoot) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const absolute = path.resolve(file);
    let relative = path.relative(path.resolve(currentRoot), absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) relative = path.basename(absolute);
    const historicalPath = path.resolve(historicalRoot, relative);
    const stat = fs.statSync(absolute);
    hash.update(historicalPath);
    hash.update(String(stat.size));
    hash.update(fs.readFileSync(absolute));
  }
  return hash.digest('hex');
}

function completedJsonMigration(store, sourceFingerprint, files, sourceRoot) {
  const direct = store.findCompletedMigration(sourceFingerprint);
  if (direct) return direct;
  if (typeof store.listCompletedMigrations !== 'function') return null;
  for (const receipt of store.listCompletedMigrations() || []) {
    const historicalRoot = clean(receipt?.sourceRoot);
    const historicalFingerprint = clean(receipt?.sourceFingerprint);
    if (!historicalRoot || !historicalFingerprint) continue;
    if (legacyPathBoundFingerprint(files, sourceRoot, historicalRoot) === historicalFingerprint) return receipt;
  }
  return null;
}

function normalizeConversation(row = {}, fallbackKey = '') {
  const sessionKey = clean(first(row, ['sessionKey', 'session_key', 'conversationId', 'conversation_id', 'id', 'key'], fallbackKey));
  if (!sessionKey) return null;
  return {
    ...row,
    sessionKey,
    title: first(row, ['title', 'displayName', 'display_name', 'contactName', 'contact_name', 'name', 'chatJid'], sessionKey),
    unreadCount: Number(first(row, ['unreadCount', 'unread_count', 'unread'], 0)) || 0,
    lastMessageAt: first(row, ['lastMessageAt', 'last_message_at', 'updatedAt', 'updated_at'], '')
  };
}

function normalizeMessage(row = {}, fallbackSessionKey = '', fallbackId = '') {
  const sessionKey = clean(first(row, ['sessionKey', 'session_key', 'conversationId', 'conversation_id'], fallbackSessionKey));
  if (!sessionKey) return null;
  const sentAt = clean(first(row, ['sentAt', 'sent_at', 'timestamp', 'time', 'createdAt', 'created_at'])) || new Date().toISOString();
  const text = clean(first(row, ['text', 'content', 'body', 'message', 'messageText', 'message_text']));
  const externalId = clean(first(row, ['externalMessageId', 'external_message_id', 'messageId', 'message_id', 'id'], fallbackId));
  const dedupeKey = clean(first(row, ['dedupeKey', 'dedupe_key'])) || stableId('msg', [first(row, ['accountId', 'account_id']), sessionKey, externalId, sentAt, text]);
  return {
    ...row,
    id: dedupeKey,
    dedupeKey,
    externalMessageId: externalId || dedupeKey,
    sessionKey,
    conversationId: sessionKey,
    sentAt,
    timestamp: sentAt,
    messageType: first(row, ['messageType', 'message_type', 'type'], 'text'),
    quotedMessageId: first(row, ['quotedMessageId', 'quoted_message_id'], row.quoted?.id || ''),
    deliveryStatus: first(row, ['deliveryStatus', 'delivery_status', 'status'], '')
  };
}

function importAccounts(store, payload, report) {
  const rows = values(payload.accounts || payload);
  for (const row of rows) store.upsertAccount(row);
  store.setSetting('accounts-state', 'document', {
    schemaVersion: Math.max(3, Number(payload.schemaVersion || 0)),
    defaults: { whatsapp: '', telegram: '', facebook: '', ...(payload.defaults || {}) },
    bindings: payload.bindings || {},
    audit: Array.isArray(payload.audit) ? payload.audit : [],
    updatedAt: payload.updatedAt || new Date().toISOString()
  });
  report.imported.accounts += rows.length;
}

function importContacts(store, payload, report) {
  const rows = values(payload.contacts || payload);
  for (const row of rows) store.upsertContact(row);
  report.imported.contacts += rows.length;
}

function importConversations(store, payload, report) {
  const source = payload.conversations || payload.sessions || payload;
  const entries = Array.isArray(source) ? source.map((row, index) => [String(index), row]) : Object.entries(source || {});
  for (const [key, row] of entries) {
    const normalized = normalizeConversation(row, key);
    if (!normalized) { report.skipped.conversations += 1; continue; }
    store.upsertConversation(normalized);
    report.imported.conversations += 1;
  }
}

function importMessages(store, payload, report) {
  if (payload.contacts) importContacts(store, payload, report);
  if (payload.conversations) importConversations(store, payload, report);

  const source = payload.messages || payload.histories || payload.history || payload;
  const insert = (row, fallbackSessionKey = '', fallbackId = '') => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const normalized = normalizeMessage(row, fallbackSessionKey, fallbackId);
    if (!normalized) { report.skipped.messages += 1; return; }
    store.touchConversationFromMessage(normalized);
    store.upsertMessage(normalized);
    report.imported.messages += 1;
  };

  if (Array.isArray(source)) {
    source.forEach((row, index) => insert(row, '', String(index)));
    return;
  }

  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value)) {
      value.forEach((row, index) => insert(row, key, `${key}:${index}`));
      continue;
    }
    if (value && typeof value === 'object' && Array.isArray(value.messages)) {
      const fallbackSessionKey = clean(first(value, ['sessionKey', 'session_key', 'conversationId', 'conversation_id'], key));
      value.messages.forEach((row, index) => insert(row, fallbackSessionKey, `${key}:${index}`));
      continue;
    }
    insert(value, '', key);
  }
}


function collectionRows(payload, preferredKeys = []) {
  for (const key of preferredKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (payload?.[key] && typeof payload[key] === 'object') {
      return Object.entries(payload[key]).map(([id, value]) => value && typeof value === 'object' ? { id, ...value } : { id, value });
    }
  }
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return payload == null ? [] : [{ value: payload }];
  const entries = Object.entries(payload);
  if (entries.length && entries.every(([, value]) => value && typeof value === 'object')) {
    return entries.map(([id, value]) => ({ id, ...value }));
  }
  return [payload];
}

function recordIdentity(record, prefix = 'legacy') {
  const source = record && typeof record === 'object' ? record : { value: record };
  const explicit = clean(first(source, ['id', 'uuid', 'key', 'assetId', 'asset_id', 'memoryId', 'memory_id', 'path', 'filePath', 'file_path', 'title', 'name']));
  return explicit || stableId(prefix, [JSON.stringify(source)]);
}

function mergeRecords(existingRows, incomingRows, prefix) {
  const map = new Map();
  for (const row of [...(existingRows || []), ...(incomingRows || [])]) {
    const normalized = row && typeof row === 'object' ? row : { value: row };
    map.set(recordIdentity(normalized, prefix), normalized);
  }
  return [...map.values()];
}

function importAiMemory(store, payload, report) {
  const rows = collectionRows(payload, ['memories', 'memory', 'records', 'items', 'facts']);
  const existing = store.getSetting('ai-memory', 'document', { schemaVersion: 1, records: [] }) || { records: [] };
  const records = mergeRecords(existing.records, rows, 'ai-memory');
  store.setSetting('ai-memory', 'document', {
    ...existing,
    schemaVersion: Math.max(1, Number(existing.schemaVersion || 0)),
    records,
    migratedAt: new Date().toISOString()
  });
  report.imported.aiMemories += rows.length;
}

function knowledgeMaterial(row, index) {
  const source = row && typeof row === 'object' ? row : { text: row };
  return {
    ...source,
    id: recordIdentity(source, 'knowledge'),
    title: clean(first(source, ['title', 'name', 'label', 'filename', 'fileName'], `旧版知识资产 ${index + 1}`)),
    text: clean(first(source, ['text', 'content', 'body', 'sourceText', 'source_text', 'value'])),
    translation: clean(first(source, ['translation', 'chineseTranslation', 'chinese_translation'])),
    kind: clean(first(source, ['kind', 'type', 'assetKind', 'asset_kind'], 'knowledge')),
    status: clean(first(source, ['status', 'state'], 'imported')),
    scope: clean(first(source, ['scope', 'scopeType', 'scope_type'], 'workspace')),
    source: 'legacy-json-knowledge',
    migrated: true
  };
}

function importKnowledgeBase(store, payload, report) {
  const rows = collectionRows(payload, ['knowledge', 'items', 'assets', 'materials', 'documents', 'records']);
  const existing = store.getSetting('knowledge-base', 'document', { schemaVersion: 1, items: [] }) || { items: [] };
  const items = mergeRecords(existing.items, rows, 'knowledge');
  store.setSetting('knowledge-base', 'document', {
    ...existing,
    schemaVersion: Math.max(1, Number(existing.schemaVersion || 0)),
    items,
    migratedAt: new Date().toISOString()
  });

  const aiState = store.getSetting('ai-workbench', 'state', { templates: [], contactRules: {}, materials: [], routes: [], activity: [] }) || {};
  const materials = mergeRecords(aiState.materials, rows.map(knowledgeMaterial), 'knowledge-material');
  store.setSetting('ai-workbench', 'state', {
    ...aiState,
    materials,
    activity: [{ time: new Date().toISOString(), text: `已从旧JSON迁移 ${rows.length} 份知识资产` }, ...(aiState.activity || [])].slice(0, 100)
  });
  report.imported.knowledgeItems += rows.length;
}

function importMediaIndex(store, payload, report) {
  const rows = collectionRows(payload, ['entries', 'media', 'items', 'files', 'index', 'records']);
  const existing = store.getSetting('media-index', 'document', { schemaVersion: 1, entries: [] }) || { entries: [] };
  const entries = mergeRecords(existing.entries, rows, 'media-index');
  store.setSetting('media-index', 'document', {
    ...existing,
    schemaVersion: Math.max(1, Number(existing.schemaVersion || 0)),
    entries,
    migratedAt: new Date().toISOString()
  });
  report.imported.mediaIndexEntries += rows.length;
}

function importAiWorkbench(store, payload, report) {
  const current = store.getSetting('ai-workbench', 'state', { templates: [], contactRules: {}, materials: [], routes: [], activity: [] }) || {};
  const incoming = payload?.state && typeof payload.state === 'object' ? payload.state : payload;
  const next = {
    ...incoming,
    ...current,
    templates: mergeRecords(incoming?.templates, current.templates, 'ai-template'),
    materials: mergeRecords(incoming?.materials, current.materials, 'ai-material'),
    routes: mergeRecords(incoming?.routes, current.routes, 'ai-route'),
    contactRules: { ...(incoming?.contactRules || {}), ...(current.contactRules || {}) },
    activity: [...(current.activity || []), ...(incoming?.activity || [])].slice(-100)
  };
  store.setSetting('ai-workbench', 'state', next);
  report.imported.aiAssets += (incoming?.templates?.length || 0) + (incoming?.materials?.length || 0) + (incoming?.routes?.length || 0) + Object.keys(incoming?.contactRules || {}).length;
}

function importLegacyDocument(store, namespace, payload, report, counterName) {
  const current = store.getSetting(namespace, 'document', null);
  const value = current && typeof current === 'object' && payload && typeof payload === 'object' && !Array.isArray(current) && !Array.isArray(payload)
    ? { ...payload, ...current, migratedAt: new Date().toISOString() }
    : current ?? payload;
  store.setSetting(namespace, 'document', value);
  report.imported[counterName] += collectionRows(payload).length;
}

function settingNamespace(name) {
  return ({
    'notification-settings.json': 'notification-settings',
    'system-policy.json': 'system-policy',
    'feature-flags.json': 'feature-flags',
    'desktop-settings.json': 'desktop-settings',
    'system-health-history.json': 'system-health-history',
    'registry.json': 'model-registry',
    'customer-profiles.json': 'legacy-customer-profiles',
    'relationship-timeline.json': 'relationship-trajectory',
    'conversation-drafts.json': 'conversation-drafts',
    'task-routes.json': 'legacy-task-routes'
  })[name] || name.replace(/\.json$/i, '');
}

function importFile(store, file, sourceRoot, report) {
  const name = path.basename(file).toLowerCase();
  const payload = readJson(file);
  if (name === 'accounts.json') importAccounts(store, payload, report);
  else if (name === 'contacts.json') importContacts(store, payload, report);
  else if (name === 'conversations.json') importConversations(store, payload, report);
  else if (name === 'messages.json') importMessages(store, payload, report);
  else if (['ai-memory.json', 'ai-memories.json', 'memory.json', 'memories.json'].includes(name)) importAiMemory(store, payload, report);
  else if (['knowledge-base.json', 'knowledge.json', 'knowledge-assets.json', 'learning-materials.json'].includes(name)) importKnowledgeBase(store, payload, report);
  else if (['media-index.json', 'media-library.json', 'media-cache-index.json'].includes(name)) importMediaIndex(store, payload, report);
  else if (name === 'ai-workbench.json') importAiWorkbench(store, payload, report);
  else if (name === 'customer-profiles.json') importLegacyDocument(store, 'legacy-customer-profiles', payload, report, 'profiles');
  else if (name === 'relationship-timeline.json') importLegacyDocument(store, 'relationship-trajectory', payload, report, 'relationshipEvents');
  else if (name === 'conversation-drafts.json') importLegacyDocument(store, 'conversation-drafts', payload, report, 'drafts');
  else if (name === 'task-routes.json') importLegacyDocument(store, 'legacy-task-routes', payload, report, 'routes');
  else {
    store.setSetting(settingNamespace(name), 'document', payload);
    report.imported.settings += 1;
  }
  report.files.push({ file: path.relative(sourceRoot, file), bytes: fs.statSync(file).size, imported: true });
}

function archiveFiles(files, sourceRoot, archiveRoot = PATHS.legacyJson) {
  if (!files.length) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetRoot = path.join(archiveRoot, stamp);
  for (const file of files) {
    let relative = path.relative(sourceRoot, file);
    if (!relative || relative.startsWith('..')) relative = path.basename(file);
    const target = path.join(targetRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.renameSync(file, target);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(file);
    }
  }
  return targetRoot;
}

function migrateLegacyJson(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || PATHS.root);
  const dbPath = path.resolve(options.dbPath || PATHS.sqlite);
  const files = options.files || walk(sourceRoot);
  const report = {
    ok: false,
    mode: options.dryRun ? 'dry-run' : 'transactional-import',
    sourceRoot,
    dbPath,
    sourceFingerprint: files.length ? fingerprint(files, sourceRoot) : '',
    files: [],
    imported: { accounts: 0, contacts: 0, conversations: 0, messages: 0, settings: 0, profiles: 0, relationshipEvents: 0, drafts: 0, routes: 0, aiMemories: 0, knowledgeItems: 0, mediaIndexEntries: 0, aiAssets: 0 },
    skipped: { conversations: 0, messages: 0 },
    warnings: [],
    archiveRoot: '',
    startedAt: new Date().toISOString(),
    completedAt: ''
  };
  if (!files.length) {
    report.ok = true;
    report.mode = 'nothing-to-import';
    report.completedAt = new Date().toISOString();
    return report;
  }
  if (options.dryRun) {
    report.ok = true;
    report.files = files.map(file => ({ file: path.relative(sourceRoot, file), bytes: fs.statSync(file).size, imported: false }));
    report.completedAt = new Date().toISOString();
    return report;
  }

  const migrationAuthority = assertMigrationAuthority(options.migrationAuthority);
  if (migrationAuthority.authority !== 'AuthorityWriteHostMigrationAuthority') {
    throw Object.assign(new Error('Legacy JSON import requires AuthorityWriteHostMigrationAuthority'), { code: 'MIGRATION_AUTHORITY_INVALID' });
  }
  migrationAuthority.assertTargetDbPath(dbPath);
  const store = migrationAuthority.targetStore();
  const previous = completedJsonMigration(store, report.sourceFingerprint, files, sourceRoot);
  if (previous && !options.force) {
    report.ok = true;
    report.mode = 'already-imported';
    report.warnings.push(`相同数据快照已由迁移任务 ${previous.id} 导入。`);
    if (options.archive !== false) {
      try {
        report.archiveRoot = archiveFiles(files, sourceRoot, options.archiveRoot || PATHS.legacyJson);
      } catch (error) {
        report.warnings.push(`旧JSON已导入但归档失败：${error.message}`);
        report.archiveError = error.message;
      }
    }
    report.completedAt = new Date().toISOString();
    return report;
  }
  const runId = store.createMigrationRun({ sourceRoot, sourceFingerprint: report.sourceFingerprint, status: 'running', report });
  try {
    store.transaction(() => {
      for (const file of files) importFile(store, file, sourceRoot, report);
      store.setMeta('legacyJsonMigration', {
        runId,
        sourceRoot,
        sourceFingerprint: report.sourceFingerprint,
        importedAt: new Date().toISOString(),
        files: report.files.map(row => row.file)
      });
    });
    report.ok = true;
    report.completedAt = new Date().toISOString();
    store.finishMigrationRun(runId, 'completed', report);
  } catch (error) {
    report.error = error.stack || error.message || String(error);
    report.completedAt = new Date().toISOString();
    store.finishMigrationRun(runId, 'failed', report);
    throw error;
  }
  if (options.archive !== false) {
    try {
      report.archiveRoot = archiveFiles(files, sourceRoot, options.archiveRoot || PATHS.legacyJson);
    } catch (error) {
      report.warnings.push(`SQLite导入已完成，但旧JSON归档失败：${error.message}`);
      report.archiveError = error.message;
    }
  }
  return report;
}

module.exports = { LEGACY_NAMES, walk, fingerprint, migrateLegacyJson, normalizeConversation, normalizeMessage };
