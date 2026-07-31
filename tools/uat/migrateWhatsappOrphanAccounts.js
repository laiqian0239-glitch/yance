'use strict';

const fs = require('fs');
const path = require('path');

function clean(value) { return String(value == null ? '' : value).trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--data-root') options.dataRoot = argv[++index];
    else if (item.startsWith('--data-root=')) options.dataRoot = item.slice('--data-root='.length);
    else if (item === '--output') options.output = argv[++index];
    else if (item.startsWith('--output=')) options.output = item.slice('--output='.length);
    else if (item === '--dry-run') options.dryRun = true;
    else throw Object.assign(new Error(`不支持的参数：${item}`), { code: 'WHATSAPP_ACCOUNT_RECONCILIATION_ARGUMENT_INVALID' });
  }
  if (!clean(options.dataRoot)) throw Object.assign(new Error('缺少 --data-root'), { code: 'WHATSAPP_ACCOUNT_RECONCILIATION_DATA_ROOT_MISSING' });
  return options;
}

function main() {
  const options = parseArgs();
  process.env.YANCE_DATA_DIR = path.resolve(options.dataRoot);
  const service = require('../../backend/services/whatsappAccountReconciliationService');
  const { closeStore, getStore } = require('../../backend/repositories/storeProvider');
  let report;
  try {
    const discovery = service.discoverOrphanAccountAliases();
    report = options.dryRun ? { ...discovery, dryRun: true, reports: [], applied: 0 } : service.reconcileOrphanAccounts();
    const db = getStore().db;
    const unresolved = (report.plans || []).filter(row => !row.eligible && (row.sourceCanonicalJids || []).length > 0);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    report = {
      schemaVersion: 1,
      kind: 'YANCE_WHATSAPP_ORPHAN_ACCOUNT_RECONCILIATION',
      generatedAt: new Date().toISOString(),
      dataRoot: process.env.YANCE_DATA_DIR,
      dryRun: options.dryRun,
      ...report,
      unresolved,
      foreignKeyErrors,
      ok: unresolved.length === 0 && foreignKeyErrors.length === 0
    };
  } finally {
    closeStore();
  }
  const output = path.resolve(options.output || path.join(process.cwd(), `Yance-WhatsApp-Account-Reconciliation-${report.generatedAt.replace(/[:.]/gu, '-')}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: report.ok, output, applied: report.applied, unresolved: report.unresolved }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'WHATSAPP_ACCOUNT_RECONCILIATION_FAILED', message: error.message, stack: error.stack || '' }, null, 2)}\n`);
  process.exitCode = 1;
}
