'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const AUTHORIZATION_MERGE = 'b0d7ea2f11aa504b51846fe153a781768ded4192';
const RELATIVE_TEST = 'tests/layered-ci/v21-product-experience-shell-p0-final-validation.test.js';
const WORKFLOW = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
const ROOT = path.resolve(__dirname, '../..');

const baseSource = execFileSync(
  'git',
  ['show', `${AUTHORIZATION_MERGE}:${RELATIVE_TEST}`],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);
const baseModule = new Module(`${__filename}.authorization-base`, module);
baseModule.filename = __filename;
baseModule.paths = module.paths;
baseModule._compile(baseSource, __filename);

test('failure-first: Product Final exact route must admit successor-v13 in all three existing jobs', () => {
  const source = fs.readFileSync(path.join(ROOT, ...WORKFLOW.split('/')), 'utf8');
  const exactEquality = /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v13'/gu;
  const matches = source.match(exactEquality) || [];
  assert.equal(
    matches.length,
    3,
    `causal RED: successor-v13 exact Product Final route must appear in exactly three existing job allowlists; actual=${matches.length}`
  );
});
