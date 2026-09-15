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
  'services/personal-access-worker/src/index.mjs',
  'services/personal-access-worker/wrangler.toml',
  'integration/element-module/src/index.tsx',
  'integration/element-module/src/YanceWorkspace.tsx',
  'integration/element-module/src/product-experience/PersonalAccessSurface.tsx',
  'electron/preload.js',
  'electron/r32StoreBridge.js',
  'electron/m2/ipcManifest.json',
  'tools/wp2/command-path-inventory.js',
  'tools/matrix/bootstrap.js',
  'upstream-patches/element-web/0019-yance-module-openid-token.patch'
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

test('personal access production authority exists at every authorized runtime seam', () => {
  for (const relativePath of requiredProductionPaths) {
    assert.equal(fs.existsSync(path.join(ROOT, ...relativePath.split('/'))), true, `missing ${relativePath}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'services/personal-access-worker/migrations/0001_personal_access.sql')), false);
});

test('server preserves local caller authentication before invitation entitlement and guards product APIs', () => {
  const source = read('backend/server.js');
  const localSecurity = source.indexOf('app.use(createR32LocalApiSecurity(');
  const bodyParser = source.indexOf('app.use(express.json(');
  const personalRoutes = source.indexOf("app.use('/api/r32/personal-access'");
  const personalGuard = source.indexOf('app.use(createPersonalAccessGuard(');
  const protectedMessages = source.indexOf("app.use('/api/r32/messages'");
  assert.ok(localSecurity >= 0, 'existing local API session security must remain installed');
  assert.ok(bodyParser > localSecurity, 'existing local API security must run before JSON body parsing');
  assert.ok(personalRoutes > bodyParser, 'personal-access status/activate routes must remain behind local API security');
  assert.ok(personalGuard > personalRoutes, 'minimal status/activate surface must be mounted before the entitlement guard');
  assert.ok(protectedMessages > personalGuard, 'protected product routes must be mounted after the entitlement guard');
  assert.match(source, /createPersonalAccessGuard/);
  assert.match(source, /createPersonalAccessRouter/);
});

test('backend keeps OWNER marker local and stores only non-secret Unkey keyId receipt for TESTER', () => {
  const source = read('backend/services/personalAccessService.js');
  assert.match(source, /personal-access\.owner-admin/);
  assert.match(source, /personal-access\.invitation-key/);
  assert.match(source, /require\(['"]jsonwebtoken['"]\)/);
  assert.match(source, /jwt\.sign/);
  assert.match(source, /org\.matrix\.login\.jwt/);
  assert.match(source, /_matrix\/client\/v3\/login/);
  assert.match(source, /matrixSubject/);
  assert.match(source, /_matrix\/federation\/v1\/openid\/userinfo/);
  assert.match(source, /MATRIX_SUBJECT_MISMATCH/);
  assert.match(source, /ENTITLEMENT_VALID/);
  assert.match(source, /persistEntitlementKeyId/);
  assert.match(source, /verifyStoredKeyIdForLogin/);
  assert.match(source, /verifyKeyIdForSubject/);
  assert.match(source, /matrixLoginForEntitlement/);
  assert.match(source, /TERMINAL_STORED_RECEIPT_REASONS/);
  assert.doesNotMatch(source, /authorization:\s*`Bearer/is);
  assert.doesNotMatch(source, /installationId|grantState|requestState/);
  assert.doesNotMatch(source, /persistInvitation|storedInvitation/u);
  assert.match(source, /Invitation identity must be one canonical Matrix localpart/u);
  assert.match(source, /UNKEY_ENTITLEMENT_EXPIRY_INVALID/u);
});

test('same-device login consumes raw invitation only when no durable keyId receipt exists', () => {
  const source = read('backend/services/personalAccessService.js');
  const login = source.slice(source.indexOf('async login(input = {})'), source.indexOf('async status(input = {})'));
  const storedLookup = login.indexOf('this.storedEntitlementKeyId()');
  const storedStatus = login.indexOf('this.verifyStoredKeyIdForLogin(storedKeyId)');
  const rawVerify = login.indexOf('this.verifyInvitationForLogin(input.invitationKey)');
  const persist = login.indexOf('this.persistEntitlementKeyId(entitlement.keyId)');
  const matrixHandoff = login.indexOf('this.matrixLoginForEntitlement(entitlement)');
  assert.ok(storedLookup >= 0 && storedStatus > storedLookup, 'stored keyId must be checked through non-consumptive status first');
  assert.ok(rawVerify > storedStatus, 'raw invitation verify must remain behind stored receipt resume');
  assert.ok(persist > rawVerify && matrixHandoff > persist, 'keyId receipt must be durable before Matrix login handoff');
  assert.match(login, /TERMINAL_STORED_RECEIPT_REASONS\.has\(resumed\.reasonCode\)[\s\S]*?clearEntitlementReceipt/u);
  assert.doesNotMatch(login, /verifyInvitationForLogin\(input\.invitationKey\)[\s\S]*?verifyInvitationForLogin\(input\.invitationKey\)/u);
});

test('activate verifies the stored entitlement once and logout never erases device entitlement', () => {
  const source = read('backend/services/personalAccessService.js');
  const activate = source.slice(source.indexOf('async activate(input = {})'), source.indexOf('async logout()'));
  const logout = source.slice(source.indexOf('async logout()'), source.indexOf('async authorizeProductRequest'));
  assert.equal((activate.match(/verifyKeyIdForSubject\(/gu) || []).length, 1, 'activate must perform exactly one Unkey keyId status verification');
  assert.doesNotMatch(activate, /persistEntitlementKeyId/u, 'post-login activation must not own receipt persistence');
  assert.match(logout, /DEVICE_ENTITLEMENT_PRESERVED/u);
  assert.doesNotMatch(logout, /clearEntitlementReceipt/u, 'Element session logout must not clear durable device entitlement');
});

test('post-login handoff serializes entitlement verification instead of racing normal refresh', () => {
  const surface = read('integration/element-module/src/product-experience/PersonalAccessSurface.tsx');
  assert.match(
    surface,
    /useEffect\(\(\) => \{\s*if \(window\.yancePersonalAccessHandoff\?\.keyId\) return;\s*void refresh\(\);\s*\}, \[refresh\]\);/u,
    'normal status refresh must stand down while the exact login handoff owns the initial post-login verification'
  );
  assert.match(
    surface,
    /if \(status\?\.usable !== true && window\.yancePersonalAccessHandoff\?\.keyId\) void activateHandoff\(\);/u,
    'handoff activation must remain the sole initial post-login entitlement verification path when a handoff exists'
  );
});

test('Worker and wrangler are stateless Unkey projection authority', () => {
  const worker = read('services/personal-access-worker/src/index.mjs');
  const wrangler = read('services/personal-access-worker/wrangler.toml');
  assert.equal(fs.existsSync(path.join(ROOT, 'services/personal-access-worker/src/index.js')), false);
  assert.match(worker, /export\s+default\s*\{\s*async\s+fetch\(request,\s*env\)/u);
  assert.match(worker, /UNKEY_ROOT_KEY/);
  assert.match(worker, /api\.unkey\.com\/v2\/keys\.verifyKey/u);
  assert.match(worker, /api\.unkey\.com\/v2\/keys\.getKey/u);
  assert.match(worker, /credits:\s*\{\s*cost:\s*1\s*\}/u);
  assert.doesNotMatch(worker, /module\.exports|prepare\(|SELECT|INSERT|UPDATE|DELETE|keys\.createKey|keys\.updateKey|keys\.deleteKey/u);
  assert.match(wrangler, /main\s*=\s*"src\/index\.mjs"/u);
  assert.match(wrangler, /workers_dev\s*=\s*true/u);
  assert.match(wrangler, /UNKEY_ROOT_KEY/u);
  assert.doesNotMatch(wrangler, /d1_databases|database_id|migrations_dir/u);
});

test('Element Product uses upstream Matrix OpenID seam and invitation/device-resume projection only', () => {
  const surface = read('integration/element-module/src/product-experience/PersonalAccessSurface.tsx');
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  const index = read('integration/element-module/src/index.tsx');
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const preload = read('electron/preload.js');
  const bridge = read('electron/r32StoreBridge.js');
  const manifest = read('electron/m2/ipcManifest.json');
  assert.match(workspace, /getMatrixOpenIdToken/);
  assert.match(index, /getOpenIdToken\.bind\(clientApi\)/);
  assert.doesNotMatch(surface, /邀请码/);
  assert.match(surface, /activatePersonalAccess/);
  assert.match(surface, /ELEMENT_MATRIX_OPENID_SEAM_MISSING/);
  assert.match(index, /\(props\)\s*=>\s*<YanceLogin onLoggedIn=\{props\.onLoggedIn\}/u);
  assert.match(login, /onLoggedIn\(result\.accountAuth\)/u);
  assert.match(login, /data-yance-device-resume="unkey-status-element-on-logged-in"/u);
  assert.match(login, /已授权设备登录/u);
  assert.doesNotMatch(index, /overwriteAccountAuth|accountAuthApi/u);
  assert.doesNotMatch(login, /overwriteAccountAuth\s*\(result\.accountAuth\)/u);
  assert.match(preload, /\bgetPersonalAccessStatus\s*:/);
  assert.match(preload, /\bloginPersonalAccess\s*:/);
  assert.match(preload, /\bactivatePersonalAccess\s*:/);
  assert.match(preload, /\blogoutPersonalAccess\s*:/);
  assert.match(preload, /PERSONAL_ACCESS_OWNER_REF_PROTECTED/);
  assert.match(bridge, /\/api\/r32\/personal-access\/status/);
  assert.match(bridge, /\/api\/r32\/personal-access\/login/);
  assert.match(bridge, /\/api\/r32\/personal-access\/activate/);
  assert.match(bridge, /\/api\/r32\/personal-access\/logout/);
  assert.match(manifest, /store:personal-access-login/);
  assert.match(manifest, /store:personal-access-activate/);
  assert.match(manifest, /store:personal-access-logout/);
  assert.doesNotMatch(index, /desktop\.logoutPersonalAccess/u, 'Element session logout must not mutate durable device entitlement');
  assert.doesNotMatch(preload, /getMatrixLocalIdentity|createMatrixLocalIdentity/u);
  assert.doesNotMatch(bridge, /matrixLocalIdentity|matrix-local-identity/u);
  assert.doesNotMatch(manifest, /desktop:matrix-local-identity/u);
  for (const retired of ['submitPersonalAccessRequest', 'refreshPersonalAccessRequest', 'listPersonalAccessOwnerRequests', 'mutatePersonalAccessOwnerRequest', 'mutatePersonalAccessOwnerGrant']) {
    assert.doesNotMatch(`${surface}\n${preload}\n${bridge}\n${manifest}`, new RegExp(retired, 'u'));
  }
});

test('Element OpenID module API patch is explicit and replayed after 0018', () => {
  const patch = read('upstream-patches/element-web/0019-yance-module-openid-token.patch');
  const bootstrap = read('tools/matrix/bootstrap.js');
  assert.match(patch, /packages\/module-api\/src\/api\/client\.ts/);
  assert.match(patch, /packages\/module-api\/element-web-module-api\.api\.md/);
  assert.match(patch, /apps\/web\/src\/modules\/ClientApi\.ts/);
  assert.match(patch, /MatrixClientPeg\.safeGet\(\)\.getOpenIdToken\(\)/);
  assert.match(bootstrap, /0019-yance-module-openid-token\.patch/);
  assert.ok(bootstrap.indexOf('MODULE_OPENID_TOKEN_PATCH') > bootstrap.indexOf('POST_LOGIN_SECURITY_PATCH'));
  assert.doesNotMatch(bootstrap, /glob[^\n]*upstream-patches|readdirSync[^\n]*upstream-patches/iu);
});

test('authorization explicitly keeps channel identity authorities and release work outside this batch', () => {
  const authorization = JSON.parse(read('governance/layered-ci/v21-personal-access-control-p0-v1-authorization.json'));
  assert.equal(authorization.governance.formalReleaseAuthorized, false);
  assert.equal(authorization.governance.publishAuthorized, false);
  assert.ok(authorization.productContract.outOfScope.includes('cloud backup or restore'));
});