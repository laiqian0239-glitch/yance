'use strict';

const fs = require('fs');
const path = require('path');
const { getStore, closeStore } = require('../../backend/repositories/storeProvider');
const merger = require('../../backend/services/whatsappConversationMergeService');

function clean(value) { return String(value == null ? '' : value).trim(); }
function outputPath() {
  const index = process.argv.indexOf('--output');
  return index >= 0 ? clean(process.argv[index + 1]) : clean(process.env.YANCE_UAT_MIGRATION_REPORT);
}
function count(db, sql, ...args) { return Number(db.prepare(sql).get(...args)?.n || 0); }
function snapshot(db) {
  return {
    whatsappConversations: count(db, "SELECT COUNT(*) AS n FROM r32_conversations WHERE platform='whatsapp'"),
    whatsappActiveContacts: count(db, "SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND merged_into_id=''"),
    messages: count(db, 'SELECT COUNT(*) AS n FROM r32_messages'),
    profiles: count(db, 'SELECT COUNT(*) AS n FROM customer_profiles'),
    insights: count(db, 'SELECT COUNT(*) AS n FROM relationship_insights'),
    aiContextSnapshots: count(db, 'SELECT COUNT(*) AS n FROM ai_context_snapshots')
  };
}

function main() {
  const store = getStore();
  const db = store.db;
  const before = snapshot(db);
  const hasAuthority = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='whatsapp_identity_authority'").get());
  const accounts = hasAuthority
    ? db.prepare('SELECT DISTINCT account_id FROM whatsapp_identity_authority ORDER BY account_id').all().map(row => clean(row.account_id)).filter(Boolean)
    : [];
  const firstPass = accounts.flatMap(accountId => merger.reconcileAccount(accountId));
  const after = snapshot(db);
  const secondPass = accounts.flatMap(accountId => merger.reconcileAccount(accountId));
  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
  const duplicateContactConversations = db.prepare(`
    SELECT account_id, contact_id, COUNT(*) AS count
    FROM r32_conversations
    WHERE platform='whatsapp' AND contact_id<>''
    GROUP BY account_id, contact_id
    HAVING COUNT(*)>1
  `).all();
  const activeMergedContacts = count(db, "SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND merged_into_id<>'' AND tombstoned_at<>''");
  const report = {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_CONVERSATION_ALIAS_MIGRATION',
    generatedAt: new Date().toISOString(),
    dataRoot: process.env.YANCE_DATA_DIR || '',
    before,
    after,
    accounts,
    firstPass,
    idempotency: {
      secondPassMerged: secondPass.filter(row => row?.merged).length,
      secondPass
    },
    activeMergedContacts,
    duplicateContactConversations,
    foreignKeyErrors,
    ok: foreignKeyErrors.length === 0 && duplicateContactConversations.length === 0 && secondPass.every(row => !row?.merged)
  };
  const target = outputPath();
  if (target) {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  closeStore();
  if (!report.ok) process.exitCode = 1;
}

try { main(); }
catch (error) {
  try { closeStore(); } catch (_) {}
  console.error(JSON.stringify({ ok: false, code: error.code || 'WHATSAPP_ALIAS_MIGRATION_FAILED', message: error.message, stack: error.stack || '' }, null, 2));
  process.exitCode = 1;
}
