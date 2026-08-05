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
    /product-route-executable-policy\.js --branch "\$\{IMPLEMENTATION_BRANCH\}"/u
  );
  assert.doesNotMatch(
    workflow,
    /npm run verify:wp0:gate -- --branch "\$\{IMPLEMENTATION_BRANCH\}"/u
  );
});

test('reviewed-candidate role is evaluated by a policy bundle exported from the trusted PR base', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /TRUSTED_POLICY_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /git worktree add --detach "\$\{TRUSTED_POLICY_ROOT\}" "\$\{TRUSTED_POLICY_SHA\}"/u);
  assert.match(workflow, /reviewed-candidate\/\*/u);
  assert.match(workflow, /"\$\{TRUSTED_POLICY_ROOT\}\/tools\/wp0\/product-route-executable-policy\.js"/u);
  assert.match(workflow, /--repository-root "\$\{GITHUB_WORKSPACE\}"/u);
  assert.doesNotMatch(workflow, /reviewed-candidate\/oss1a-task11/u);
});
