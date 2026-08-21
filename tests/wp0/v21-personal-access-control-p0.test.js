'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const requiredProductionPaths = [
  'backend/middleware/personalAccessGuard.js',
  'backend/routes/personalAccess.js',
  'backend/services/personalAccessService.js',
  'services/personal-access-worker/migrations/0001_personal_access.sql',
  'services/personal-access-worker/src/index.js',
  'services/personal-access-worker/wrangler.toml'
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

test('personal access production authority exists at every authorized runtime seam', () => {
  for (const relativePath of requiredProductionPaths) {
    assert.equal(fs.existsSync(path.join(ROOT, ...relativePath.split('/'))), true, `missing ${relativePath}`);
  }
});

test('server preserves local caller authentication before personal entitlement and guards product APIs', () => {
  const source = read('backend/server.js');
  const localSecurity = source.indexOf('app.use(createR32LocalApiSecurity(');
  const bodyParser = source.indexOf('app.use(express.json(');
  const personalRoutes = source.indexOf("app.use('/api/r32/personal-access'");
  const personalGuard = source.indexOf('app.use(createPersonalAccessGuard(');
  const protectedMessages = source.indexOf("app.use('/api/r32/messages'");
  assert.ok(localSecurity >= 0, 'existing local API session security must remain installed');
  assert.ok(bodyParser > localSecurity, 'existing local API security must run before JSON body parsing');
  assert.ok(personalRoutes > bodyParser, 'personal-access request/status routes must remain behind local API security');
  assert.ok(personalGuard > personalRoutes, 'minimal request/status surface must be mounted before the entitlement guard');
  assert.ok(protectedMessages > personalGuard, 'protected product routes must be mounted after the entitlement guard');
  assert.match(source, /createPersonalAccessGuard/);
  assert.match(source, /createPersonalAccessRouter/);
});

test('local entitlement service keeps owner secret in existing secure credential authority and fails tester closed', () => {
  const source = read('backend/services/personalAccessService.js');
  assert.match(source, /personal-access\.owner-admin/);
  assert.match(source, /getSecurityGuard|credentialStore/);
  assert.doesNotMatch(source, /owner.*secret.*(?:INSERT|UPDATE).*sqlite/is);
  assert.match(source, /REMOTE_AUTHORITY_UNAVAILABLE/);
  assert.match(source, /INSTALLATION_MISMATCH/);
  assert.match(source, /GRANT_SUSPENDED/);
  assert.match(source, /GRANT_REVOKED/);
});

test('Worker and D1 are a narrow shared entitlement authority, not a billing or identity platform', () => {
  const worker = read('services/personal-access-worker/src/index.js');
  const migration = read('services/personal-access-worker/migrations/0001_personal_access.sql');
  const wrangler = read('services/personal-access-worker/wrangler.toml');
  assert.match(worker, /OWNER_ADMIN_SECRET/);
  assert.match(worker, /PENDING/);
  assert.match(worker, /ASSIGNED/);
  assert.match(worker, /APPROVED/);
  assert.match(worker, /REJECTED/);
  assert.match(worker, /ACTIVE/);
  assert.match(worker, /SUSPENDED/);
  assert.match(worker, /REVOKED/);
  assert.match(migration, /personal_access_requests/i);
  assert.match(migration, /personal_access_grants/i);
  assert.match(migration, /installation_id/i);
  assert.match(wrangler, /d1_databases/i);
  for (const forbidden of ['billing', 'subscription', 'payment_intent', 'hardware_fingerprint']) {
    assert.doesNotMatch(`${worker}\n${migration}`, new RegExp(forbidden, 'i'), forbidden);
  }
});

test('System Center exposes personal-use request and owner tester controls without claiming cloud backup', () => {
  const source = read('frontend/r32-system-center.js');
  assert.match(source, /personal-access/);
  assert.match(source, /申请测试权限|申请使用权限|TESTER/);
  assert.match(source, /批准|APPROVE/);
  assert.match(source, /拒绝|REJECT/);
  assert.match(source, /暂停|SUSPEND/);
  assert.match(source, /撤销|REVOKE/);
  assert.doesNotMatch(source, /个人数据云备份已启用|cloud backup enabled/i);
});

test('authorization explicitly keeps channel identity authorities and release work outside this batch', () => {
  const authorization = JSON.parse(read('governance/layered-ci/v21-personal-access-control-p0-v1-authorization.json'));
  assert.equal(authorization.workPackage, 'V21-PERSONAL-ACCESS-CONTROL-P0-V1');
  assert.equal(authorization.productContract.sharedAuthority.testerStateMustBeServerAuthoritative, true);
  assert.equal(authorization.productContract.localEnforcement.ownerMustNotBeLockedOutByRemoteTesterState, true);
  assert.deepEqual(authorization.productContract.localEnforcement.minimalUnauthenticatedEntitlementSurface, [
    'status', 'submit-request', 'refresh-request'
  ]);
  assert.ok(authorization.productContract.outOfScope.includes('cloud backup or restore'));
  assert.equal(authorization.governance.formalReleaseAuthorized, false);
  assert.equal(authorization.governance.publishAuthorized, false);
});
