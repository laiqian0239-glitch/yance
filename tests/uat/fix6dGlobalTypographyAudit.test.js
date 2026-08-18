'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { auditTypography, REQUIRED_TOKENS } = require('../../tools/uat/fix6d-global-typography-audit');

const ROOT = path.resolve(__dirname, '../..');

function concise(result) {
  return JSON.stringify({ pass: result.pass, counts: result.counts, examples: result.violations.slice(0, 20) }, null, 2);
}

test('FIX6D formal frontend has one semantic typography authority and zero competing font-size rules', () => {
  const result = auditTypography(ROOT);
  assert.deepEqual(result.requiredTokens, REQUIRED_TOKENS);
  assert.equal(result.pass, true, concise(result));
  assert.equal(Object.keys(result.counts).length, 0, JSON.stringify(result.counts));
});

test('FIX6D typography audit rejects dynamic font-size writes and unknown semantic tokens', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fix6d-typography-audit-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const frontend = path.join(tempRoot, 'frontend');
  fs.mkdirSync(frontend, { recursive: true });
  fs.writeFileSync(path.join(frontend, 'probe.css'), '.probe{font-size:var(--type-unknown)}\n');
  fs.writeFileSync(path.join(frontend, 'probe.js'), "node.style.setProperty('font-size', '9px');\n");
  const result = auditTypography(tempRoot);
  assert.ok(result.violations.some(row => row.type === 'dynamic-font-size' && row.file === 'frontend/probe.js'), concise(result));
  assert.ok(result.violations.some(row => row.type === 'non-semantic-font-size' && row.file === 'frontend/probe.css'), concise(result));
});

test('FIX6D typography audit covers the shipping Element module', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fix6d-element-typography-audit-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const elementSrc = path.join(tempRoot, 'integration', 'element-module', 'src');
  fs.mkdirSync(elementSrc, { recursive: true });
  fs.writeFileSync(path.join(elementSrc, 'probe.css'), '.probe{font-size:13px}\n');
  const result = auditTypography(tempRoot);
  assert.ok(
    result.violations.some(row => row.type === 'non-semantic-font-size' && row.file === 'integration/element-module/src/probe.css'),
    concise(result)
  );
});
