const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const agents = fs.readFileSync('AGENTS.md', 'utf8');
const mustContain = (token) => assert.equal(agents.includes(token), true, 'missing policy token: ' + token);

test('repository policy makes Mature Authority First and OSS First non-waivable', () => {
  [
    'MATURE_AUTHORITY_FIRST=non_waivable',
    'OSS_FIRST_CAPABILITY_ADMISSION=mandatory',
    'SELF_REINVENT_MATURE_CAPABILITY=forbidden',
    'SHADOW_AUTHORITY=release_blocker',
    'PARALLEL_LIFECYCLE=release_blocker',
    'MIRROR_STATE=release_blocker',
    'CUSTOM_FALLBACK_OVER_MATURE_OWNER=release_blocker',
    'UPSTREAM_PUBLIC_SEAM=narrowest_first',
    'FULL_CAPABILITY_MIGRATION=state_lifecycle_recovery_errors_tests_not_ui_only',
    'PRODUCT_ADAPTER=stateless_or_thinnest_projection',
    'MATURE_OWNER_RETAINS_LIFECYCLE_STATE_RETRY_RECOVERY=mandatory',
    'DELETE_SHADOW_BEFORE_COMPATIBILITY_LAYER=mandatory',
    'MATURE_AUTHORITY_VIOLATION=controller_execution_failure',
  ].forEach(mustContain);
  mustContain('Mature Authority First / OSS First admission (non-waivable execution invariant)');
  mustContain('The default decision is **mature OSS/owner reuse**, not custom implementation.');
});

test('Mature Authority admission preserves owner, state, lifecycle, recovery, and whole capability migration', () => {
  [
    'Existing mature owner identified',
    'No second owner',
    'Thin projection only',
    'Lifecycle remains upstream-owned',
    'State remains upstream-owned',
    'Retry/recovery remains upstream-owned',
    'Materialization remains tool-owned',
    'Narrowest public seam used',
    'Whole capability migrated, not UI copied',
    'No retired/shadow authority remains reachable',
    'Current-release scope respected',
    'Final Product language remains Yance-owned',
  ].forEach(mustContain);
});

test('repository policy permits only bounded same-root stronger mature OSS upgrades during release closure', () => {
  [
    'TARGETED_MATURE_OSS_UPGRADE_DURING_REPAIR=allowed_when_same_root_same_owner_stronger_upstream',
    'OSS_UPGRADE_DECISION=prefer_upstream_upgrade_when_it_closes_root_and_reduces_custom_code',
    'CAPABILITY_GAIN_WITH_ROOT_FIX=allowed_when_from_same_mature_upgrade_and_no_scope_expansion',
    'UNRELATED_BROAD_OSS_REFRESH=forbidden_during_release',
    'UPGRADE_MUST_PRESERVE_MATURE_AUTHORITY=mandatory',
    'UPGRADE_REQUIRES_CHANGELOG_MIGRATION_COMPATIBILITY_LOCAL_PROOF=mandatory',
    'A targeted upgrade of the same mature owner is allowed and preferred when the stronger upstream version directly closes the current root cause',
    'Capability gains delivered by that same mature upgrade are allowed when they do not create a new root, second owner, or unrelated release scope.',
    'Targeted stronger-upstream upgrade admission',
    'upstream release notes/changelog and relevant issue/fix history are reviewed',
    'breaking changes, migrations, config changes, data compatibility, runtime requirements, security implications, license/provenance, and packaging/materialization changes are audited',
    'Prefer useful mature capability already delivered by the upgrade over rebuilding an equivalent Yance feature later.',
    '"We already have custom code" is not a valid rejection reason.',
  ].forEach(mustContain);
});

test('repository policy names mature owners and blocks shadow authority from promotion', () => {
  [
    'Element / Matrix',
    'mautrix and admitted platform bridges',
    'LiteLLM / admitted model runtime',
    'Ollama / admitted local model runtime',
    'Electron and platform tooling',
    'Docker Compose',
    'npm/pnpm plus the pinned upstream workspace build seam',
    'NSIS / mature packaging tooling',
    'Hard release blockers include:',
    'Copying an OSS UI while replacing its mature behavior with Yance-owned lifecycle/state.',
    'Any promotion attempt with a known mature-authority violation is forbidden.',
    'CONTROLLER EXECUTION FAILURE',
  ].forEach(mustContain);
});

test('Mature Authority repair order deletes shadow ownership before Product projection', () => {
  const requiredOrder = [
    'identify mature owner',
    'inspect the narrowest public seam',
    'delete Yance shadow/mirror/fallback ownership',
    'project the mature owner into Yance Product',
    'preserve upstream lifecycle/state/retry/recovery/materialization',
    'add regression admission that forbids the shadow authority from returning',
  ];
  let previous = -1;
  for (const token of requiredOrder) {
    const position = agents.indexOf(token);
    assert.ok(position > previous, 'repair order missing or out of order: ' + token);
    previous = position;
  }
});
