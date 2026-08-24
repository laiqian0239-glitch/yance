'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const PACKAGE = 'release/architecture-closure-v2/wp-b-governance-package.json';
const WORKFLOW = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
const CONTRACT = 'tests/layered-ci/v21-product-experience-shell-p0-final-validation.test.js';
const BINDING_PATH = 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json';
const OLD_SHA = '0a2b707e766b0005fac99f6a7b818aa407882e27';
const NEW_SHA = '4cdc0258d163014f28105aec71ddf620eccbf7a8';
const OLD_BRANCH = 'fix/v21-electron-supported-runtime-p0-production-amendment-3';
const NEW_BRANCH = 'fix/v21-electron-supported-runtime-p0-production-amendment-5';

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function replaceExact(path, expectedOldCount, expectedNewCount) {
  const source = fs.readFileSync(path, 'utf8');
  const oldCount = count(source, OLD_BRANCH);
  const newCount = count(source, NEW_BRANCH);
  if (oldCount === expectedOldCount && newCount === 0) {
    const next = source.split(OLD_BRANCH).join(NEW_BRANCH);
    assert.equal(count(next, OLD_BRANCH), 0, `${path}: stale Electron successor remains`);
    assert.equal(count(next, NEW_BRANCH), expectedNewCount, `${path}: unexpected amendment-5 occurrence count after patch`);
    fs.writeFileSync(path, next, 'utf8');
    return;
  }
  if (oldCount === 0 && newCount === expectedNewCount) return;
  throw new Error(`${path}: unexpected branch token counts old=${oldCount} new=${newCount}`);
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
assert.ok(Array.isArray(pkg.sourceBindings), 'WP-B governance package must define sourceBindings');
const matches = pkg.sourceBindings.filter((row) => row?.path === BINDING_PATH);
assert.equal(matches.length, 1, 'expected exactly one WP-B XState supply-chain sourceBinding');
if (matches[0].gitBlobSha === OLD_SHA) {
  matches[0].gitBlobSha = NEW_SHA;
  fs.writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
} else {
  assert.equal(matches[0].gitBlobSha, NEW_SHA, 'unexpected WP-B packaged sourceBinding SHA');
}

replaceExact(WORKFLOW, 3, 3);
replaceExact(CONTRACT, 1, 1);

console.log('GREEN: amendment-5 mechanical root fix is exact and idempotent');
