'use strict';

const fs = require('node:fs');

const POLICY_PATH = 'governance/layered-ci/wp0-routing-policy.json';
const TARGET_PATH = 'requirements/uat-playwright.txt';
const FORBIDDEN_PREFIX = 'requirements/';

function main() {
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

if (require.main === module) main();

module.exports = {
  POLICY_PATH,
  TARGET_PATH,
  FORBIDDEN_PREFIX,
  main
};
