'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'stage-6459-wp0-gates.yml');

test('Product WP0 uses the branch-role executable policy instead of assuming every product-route branch is executable', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(
    workflow,
    /node tools\/wp0\/product-route-executable-policy\.js --branch "\$\{IMPLEMENTATION_BRANCH\}"/u
  );
  assert.doesNotMatch(
    workflow,
    /npm run verify:wp0:gate -- --branch "\$\{IMPLEMENTATION_BRANCH\}"/u
  );
});
