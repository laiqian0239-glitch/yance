'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const { getTemplateCatalog, TEMPLATE_CATALOG_VERSION } = require('./aiWorkbenchDefaults');
const { sha256 } = require('./domainEventLogService');

const AUTHORITY = 'AiWorkbenchDirectorRuleAuthority';
const SCHEMA_VERSION = 1;
const DEFAULT_RULE_MIGRATION_VERSION = 2;
const DEFAULT_ENABLED_TEMPLATE_IDS = Object.freeze([
  'template-evidence-first',
  'template-warm-boundary',
  'template-natural-target-language',
  'template-slow-relationship'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizeRule(input = {}, fallbackScope = 'global') {
  const priority = Number(input.priority || 0);
  return {
    id: clean(input.id) || `rule-${sha256({ name: clean(input.name), body: clean(input.body), scope: fallbackScope }).slice(0, 20)}`,
    templateId: clean(input.templateId || input.originTemplateId),
    originTemplateId: clean(input.originTemplateId || input.templateId),
    scope: clean(input.scope || fallbackScope) || fallbackScope,
    contactId: clean(input.contactId),
    name: clean(input.name) || '未命名导演规则',
    body: clean(input.body),
    priority: Number.isFinite(priority) ? Math.max(0, Math.min(1000, Math.round(priority))) : 0,
    enabled: input.enabled !== false,
    systemSeeded: input.systemSeeded === true,
    source: clean(input.source) || (input.systemSeeded === true ? 'system-default' : 'user'),
    createdAt: clean(input.createdAt),
    updatedAt: clean(input.updatedAt)
  };
}

function defaultRules(timestamp = nowIso()) {
  const byId = new Map(getTemplateCatalog().map(row => [row.id, row]));
  return DEFAULT_ENABLED_TEMPLATE_IDS.map(templateId => byId.get(templateId)).filter(Boolean).map(template => normalizeRule({
    id: `default:${template.id}`,
    templateId: template.id,
    scope: 'global',
    name: template.name,
    body: template.body,
    priority: template.priority,
    enabled: true,
    systemSeeded: true,
    source: `template-catalog-v${TEMPLATE_CATALOG_VERSION}`,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

function normalizeState(input = {}) {
  const state = input && typeof input === 'object' && !Array.isArray(input) ? clone(input) : {};
  const templates = Array.isArray(state.templates) ? state.templates.map(row => normalizeRule(row, 'global')).filter(row => row.body) : [];
  const contactRules = {};
  for (const [contactId, rows] of Object.entries(state.contactRules && typeof state.contactRules === 'object' ? state.contactRules : {})) {
    contactRules[contactId] = (Array.isArray(rows) ? rows : []).map(row => normalizeRule({ ...row, contactId: clean(row?.contactId) || contactId }, 'contact')).filter(row => row.body);
  }
  return { ...state, templates, contactRules };
}

function isUnmodifiedSystemGermanRule(rule = {}) {
  const catalog = new Map(getTemplateCatalog().map(row => [row.id, row]));
  const template = catalog.get('template-natural-german');
  if (!template) return false;
  return rule.systemSeeded === true
    && ['template-natural-german', 'default:template-natural-german'].includes(clean(rule.templateId || rule.originTemplateId || rule.id))
    && clean(rule.name) === clean(template.name)
    && clean(rule.body) === clean(template.body);
}

function migrateLanguageNeutralDefault(state = {}, timestamp = nowIso()) {
  let replaced = false;
  const retained = [];
  for (const rule of state.templates || []) {
    if (isUnmodifiedSystemGermanRule(rule)) { replaced = true; continue; }
    retained.push(rule);
  }
  if (replaced && !retained.some(rule => clean(rule.templateId || rule.originTemplateId) === 'template-natural-target-language')) {
    const replacement = defaultRules(timestamp).find(rule => rule.templateId === 'template-natural-target-language');
    if (replacement) retained.push(replacement);
  }
  state.templates = retained;
  return replaced;
}

function ensureDefaults(options = {}) {
  const repository = options.repository || settingsRepository;
  const timestamp = clean(options.now) || nowIso();
  const persisted = repository.get('ai-workbench', 'state', null);
  const state = normalizeState(persisted || {});
  const migration = state.directorDefaults && typeof state.directorDefaults === 'object' ? state.directorDefaults : {};
  const priorVersion = Number(migration.migrationVersion || 0);
  const alreadyMigrated = priorVersion >= DEFAULT_RULE_MIGRATION_VERSION;
  let changed = persisted == null;
  let seeded = false;
  let languageNeutralMigration = false;
  if (!alreadyMigrated) {
    if (priorVersion === 0 && state.templates.length === 0) {
      state.templates = defaultRules(timestamp);
      seeded = true;
    } else if (priorVersion > 0) {
      languageNeutralMigration = migrateLanguageNeutralDefault(state, timestamp);
    }
    state.directorDefaults = {
      ...migration,
      authority: AUTHORITY,
      migrationVersion: DEFAULT_RULE_MIGRATION_VERSION,
      templateCatalogVersion: TEMPLATE_CATALOG_VERSION,
      seeded: seeded || migration.seeded === true,
      seededRuleIds: state.templates.filter(row => row.systemSeeded).map(row => row.id),
      languageNeutralMigration,
      migratedAt: timestamp
    };
    changed = true;
  }
  if (changed && options.persist !== false) repository.set('ai-workbench', 'state', { ...state, updatedAt: timestamp });
  return { state, changed, seeded, languageNeutralMigration, authority: AUTHORITY };
}

function ruleIdentity(rule = {}) {
  return clean(rule.id) || sha256({ name: clean(rule.name), body: clean(rule.body), priority: Number(rule.priority || 0) });
}

function activeRules(rows = []) {
  const seen = new Set();
  return rows.map(row => normalizeRule(row, row?.scope || 'global'))
    .filter(row => row.enabled !== false && row.body)
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0) || left.name.localeCompare(right.name, 'zh-CN'))
    .filter(row => {
      const identity = ruleIdentity(row);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

function contactRuleRows(state = {}, aliases = []) {
  const rows = [];
  const contactRules = state.contactRules && typeof state.contactRules === 'object' ? state.contactRules : {};
  for (const alias of unique(aliases)) rows.push(...(Array.isArray(contactRules[alias]) ? contactRules[alias] : []));
  return rows;
}

function resolve(input = {}, options = {}) {
  const ensured = ensureDefaults({ ...options, persist: options.persist !== false });
  const state = ensured.state;
  const contactId = clean(input.contactId);
  const conversationId = clean(input.conversationId);
  const aliases = unique([contactId, input.canonicalContactId, input.customerProfileId, conversationId]);
  const globalRules = activeRules(state.templates || []);
  const contactRules = activeRules(contactRuleRows(state, aliases));
  const manual = input.director && typeof input.director === 'object' ? { ...input.director } : {};
  const lines = [
    ...globalRules.map(row => `[全局规则·P${row.priority}] ${row.name}：${row.body}`),
    ...contactRules.map(row => `[联系人规则·P${row.priority}] ${row.name}：${row.body}`)
  ];
  const temporaryInstruction = clean(manual.instruction);
  if (temporaryInstruction) lines.push(`[临时导演指令·最高优先级] ${temporaryInstruction}`);
  const ruleRows = [...globalRules, ...contactRules];
  const receiptBase = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    pass: globalRules.length > 0,
    contactId,
    conversationId,
    migrationVersion: Number(state.directorDefaults?.migrationVersion || 0),
    templateCatalogVersion: Number(state.directorDefaults?.templateCatalogVersion || TEMPLATE_CATALOG_VERSION),
    defaultSeeded: state.directorDefaults?.seeded === true,
    globalRuleCount: globalRules.length,
    contactRuleCount: contactRules.length,
    temporaryInstructionApplied: Boolean(temporaryInstruction),
    ruleIds: ruleRows.map(row => row.id),
    ruleSha256: sha256(ruleRows.map(row => ({ id: row.id, priority: row.priority, name: row.name, body: row.body })))
  };
  const receipt = Object.freeze({ ...receiptBase, receiptSha256: sha256(receiptBase) });
  if (!receipt.pass) {
    const error = new Error('AI 导演缺少可执行的全局基础规则。');
    error.code = 'AI_DIRECTOR_RULE_STACK_EMPTY';
    error.status = 409;
    error.receipt = receipt;
    throw error;
  }
  return {
    authority: AUTHORITY,
    director: {
      ...manual,
      instruction: lines.join('\n'),
      ruleStackReceipt: receipt,
      appliedGlobalRules: globalRules.map(row => ({ id: row.id, name: row.name, priority: row.priority })),
      appliedContactRules: contactRules.map(row => ({ id: row.id, name: row.name, priority: row.priority }))
    },
    receipt,
    globalRules,
    contactRules
  };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  DEFAULT_RULE_MIGRATION_VERSION,
  DEFAULT_ENABLED_TEMPLATE_IDS,
  normalizeRule,
  normalizeState,
  defaultRules,
  isUnmodifiedSystemGermanRule,
  migrateLanguageNeutralDefault,
  ensureDefaults,
  activeRules,
  resolve
};
