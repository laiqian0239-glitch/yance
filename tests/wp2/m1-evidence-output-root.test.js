'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_EVIDENCE = path.join(ROOT, 'evidence', 'm1', 'm1-evidence.json');

test('M1 evidence root can be redirected outside the repository without dirtying the default evidence path', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-m1-evidence-'));
  const defaultExistedBefore = fs.existsSync(DEFAULT_EVIDENCE);
  const result = spawnSync(process.execPath, ['tools/m1/generate-evidence.js'], {
    cwd: ROOT,
    env: { ...process.env, YANCE_M1_EVIDENCE_ROOT: outputRoot, YANCE_M1_WINDOWS_EVIDENCE: '1' },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const evidencePath = path.join(outputRoot, 'm1-evidence.json');
  assert.equal(fs.existsSync(evidencePath), true);
  assert.equal(path.resolve(result.stdout.trim()), evidencePath);

  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.schema, 'yance.m1.evidence.v1');
  assert.equal(evidence.windowsEvidenceRequired, true);

  if (!defaultExistedBefore) assert.equal(fs.existsSync(DEFAULT_EVIDENCE), false);
});

test('verify:m1:windows defaults to an out-of-tree temporary evidence root', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'm1', 'verify-windows.js'), 'utf8');
  assert.match(source, /YANCE_M1_EVIDENCE_ROOT/);
  assert.match(source, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'yance-m1-evidence-'\)\)/);
  assert.match(source, /YANCE_M1_EVIDENCE_ROOT:\s*evidenceRoot/);
});
