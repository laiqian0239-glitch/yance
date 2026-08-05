'use strict';

const fs = require('node:fs');

const POLICY_PATH = 'governance/layered-ci/wp0-routing-policy.json';
const REGISTRY_TEST_PATH = 'tests/layered-ci/open-source-work-package-registry.test.js';
const TARGET_PATH = 'requirements/uat-playwright.txt';
const FORBIDDEN_PREFIX = 'requirements/';

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`${label}: source block is ambiguous`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function updateRoutingPolicy() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  if (!Array.isArray(policy.productExactPaths) || !Array.isArray(policy.productPrefixes)) {
    throw new Error('WP0 routing policy product rules are malformed');
  }
  if (policy.productExactPaths.includes(TARGET_PATH)) {
    throw new Error(`${TARGET_PATH} is already routed`);
  }
  if (policy.productPrefixes.includes(FORBIDDEN_PREFIX)) {
    throw new Error('requirements directory prefix authorization is forbidden');
  }
  policy.productExactPaths.push(TARGET_PATH);
  if (new Set(policy.productExactPaths).size !== policy.productExactPaths.length) {
    throw new Error('WP0 product exact paths must remain unique');
  }
  if (policy.productExactPaths.some(value => /[*?[\]]/u.test(String(value)))) {
    throw new Error('WP0 product exact paths must not contain wildcard rules');
  }
  policy.readyForPromotion = false;
  fs.writeFileSync(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

function repairRegistryReceiptFixture() {
  const before = fs.readFileSync(REGISTRY_TEST_PATH, 'utf8');
  const sourceBlock = "    authorizationPath: OSS1A_ENTRY.authorizationPath,\n    authorizationCommit: 'c'.repeat(40),\n";
  const replacement = "    authorizationPath: OSS1A_ENTRY.authorizationPath,\n    approvedPlanPath: authorization.approvedPlanPath,\n    approvedPlanHead: authorization.approvedPlanHead,\n    authorizationCommit: 'c'.repeat(40),\n";
  const after = replaceExact(before, sourceBlock, replacement, 'registry receipt fixture: bind approved plan identity');
  fs.writeFileSync(REGISTRY_TEST_PATH, after, 'utf8');
}

function main() {
  updateRoutingPolicy();
  repairRegistryReceiptFixture();
}

if (require.main === module) main();

module.exports = {
  POLICY_PATH,
  REGISTRY_TEST_PATH,
  TARGET_PATH,
  FORBIDDEN_PREFIX,
  replaceExact,
  updateRoutingPolicy,
  repairRegistryReceiptFixture,
  main
};
