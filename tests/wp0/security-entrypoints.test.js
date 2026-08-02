'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('package exposes the canonical staged-secret scan commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.['security:scan-staged'], 'node scripts/security/scan-staged-secrets.js');
  assert.equal(pkg.scripts?.['test:security-scan'], 'node --test --test-concurrency=1 tests/security/staged-secret-scanner.test.js');
});

test('WP0 workflow executes the security scanner regression suite', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'stage-6459-wp0-gates.yml'), 'utf8');
  assert.match(workflow, /name:\s*Run staged-secret scanner regressions[\s\S]*?run:\s*npm run test:security-scan/u);
});
