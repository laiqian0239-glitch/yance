'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');

function digestTree(root) {
  const rows = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else rows.push({ path: path.relative(root, file), bytes: fs.readFileSync(file).toString('hex') });
    }
  }
  visit(root);
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function runExternalMigration({ mutateDuringRead = false } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wp5-external-migration-'));
  const currentRoot = path.join(parent, '.yance');
  const legacyRoot = path.join(parent, '.yance27');
  const reportFile = path.join(parent, 'report.json');
  fs.mkdirSync(currentRoot, { recursive: true });
  fs.mkdirSync(legacyRoot, { recursive: true });
  const sourceFile = path.join(legacyRoot, 'accounts.json');
  fs.writeFileSync(sourceFile, JSON.stringify({ accounts: [{ id: 'legacy-account', platform: 'whatsapp', displayName: 'Legacy' }] }));
  const before = digestTree(legacyRoot);
  const script = `
    'use strict';
    const fs = require('node:fs');
    const sourceFile = process.env.WP5_SOURCE_FILE;
    if (process.env.WP5_MUTATE_DURING_READ === '1') {
      const original = fs.readFileSync;
      let mutated = false;
      fs.readFileSync = function(file, ...args) {
        const value = original.call(this, file, ...args);
        if (!mutated && require('node:path').resolve(String(file)) === require('node:path').resolve(sourceFile)) {
          mutated = true;
          fs.appendFileSync(sourceFile, '\\n');
        }
        return value;
      };
    }
    const { migrateExternalRoot } = require('./backend/services/migrationService');
    const report = migrateExternalRoot(process.env.WP5_LEGACY_ROOT);
    fs.writeFileSync(process.env.WP5_REPORT_FILE, JSON.stringify(report));
  `;
  const result = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      YANCE_DATA_DIR: currentRoot,
      WP5_LEGACY_ROOT: legacyRoot,
      WP5_SOURCE_FILE: sourceFile,
      WP5_REPORT_FILE: reportFile,
      WP5_MUTATE_DURING_READ: mutateDuringRead ? '1' : '0'
    },
    timeout: 60000
  });
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  const after = digestTree(legacyRoot);
  return { parent, legacyRoot, sourceFile, before, after, result, report };
}

test('external Yance27 JSON migration verifies content-level source immutability and never archives source', () => {
  const run = runExternalMigration();
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.equal(run.report.ok, true);
    assert.equal(run.report.sourceUntouched, true);
    assert.equal(run.report.sourceVerification.ok, true);
    assert.equal(run.report.sourceVerification.sourceMutationCount, 0);
    assert.equal(run.before, run.after);
    assert.equal(fs.existsSync(run.sourceFile), true);
    assert.equal(fs.existsSync(path.join(run.legacyRoot, 'legacy-json')), false);
  } finally { fs.rmSync(run.parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('external Yance27 source mutation during import is detected and fails closed', () => {
  const run = runExternalMigration({ mutateDuringRead: true });
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.equal(run.report.ok, false);
    assert.equal(run.report.code, 'LEGACY_SOURCE_MUTATED_DURING_IMPORT');
    assert.equal(run.report.sourceVerification.ok, false);
    assert.equal(run.report.sourceVerification.sourceMutationCount, 1);
    assert.notEqual(run.before, run.after);
  } finally { fs.rmSync(run.parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
