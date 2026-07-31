'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'scripts', 'branding', 'audit-yance-brand.js');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-packaged-brand-audit-'));
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function runAudit(root, scope = 'PACKAGED') {
  const result = spawnSync(process.execPath, [AUDIT, '--scan-root', root, '--scope', scope], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return { ...result, report: JSON.parse(result.stdout) };
}

test('packaged scan permits only exact non-visible legacy migration code', () => {
  const root = fixture();
  try {
    write(root, 'electron_runtime/dataRootMigration.js', "const legacyDirectoryNames = ['Yance29'];\n");
    write(root, 'frontend/index.html', '<title>言策</title>\n');
    const result = runAudit(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.status, 'PASS');
    assert.equal(result.report.findingCount, 1);
    assert.equal(result.report.findings[0].policyPath, 'electron/dataRootMigration.js');
    assert.equal(result.report.findings[0].userVisible, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('packaged scan rejects an old public name in content', () => {
  const root = fixture();
  try {
    write(root, 'frontend/index.html', '<title>Yance29</title>\n');
    const result = runAudit(root);
    assert.equal(result.status, 1);
    assert.equal(result.report.status, 'FAIL');
    assert.equal(result.report.unexplainedCount, 1);
    assert.equal(result.report.findings[0].findingKind, 'CONTENT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('packaged scan rejects a legacy-branded filename even when its contents are binary', () => {
  const root = fixture();
  try {
    write(root, 'assets/Yance29.ico', Buffer.from([0, 0, 1, 0]));
    const result = runAudit(root, 'INSTALLED');
    assert.equal(result.status, 1);
    assert.equal(result.report.status, 'FAIL');
    assert.equal(result.report.pathFindingCount, 1);
    assert.equal(result.report.findings[0].findingKind, 'PATH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('historical source paths are not silently allowed in packaged output', () => {
  const root = fixture();
  try {
    write(root, 'docs/wp7/Yance29-history.md', 'Yance29 historical record\n');
    const result = runAudit(root);
    assert.equal(result.status, 1);
    assert.equal(result.report.status, 'FAIL');
    assert.ok(result.report.unexplainedCount >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
