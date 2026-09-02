'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = relativePath => JSON.parse(read(relativePath));

test('end-user Matrix identity uses one shared Synapse registration helper and no duplicate HMAC algorithm', () => {
  const helper = read('backend/services/synapseSharedSecretRegistration.js');
  const adapter = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');
  const service = read('backend/services/endUserMatrixIdentityService.js');
  assert.match(helper, /createHmac\('sha1',\s*sharedSecret\)/u);
  assert.match(helper, /\/_synapse\/admin\/v1\/register/u);
  assert.match(adapter, /registerSynapseUserWithSharedSecret/u);
  assert.match(service, /registerSynapseUserWithSharedSecret/u);
  assert.equal((adapter.match(/createHmac\(/g) || []).length, 0, 'Facebook adapter must not retain a duplicate Synapse HMAC parser');
});

test('local identity desktop endpoints stay inside local-control boundary before Personal Access guard', () => {
  const server = read('backend/server.js');
  const localSecurity = server.indexOf('app.use(createR32LocalApiSecurity({');
  const getIdentity = server.indexOf("app.get('/api/desktop/matrix-local-identity'");
  const postIdentity = server.indexOf("app.post('/api/desktop/matrix-local-identity'");
  const personalGuard = server.indexOf('app.use(createPersonalAccessGuard({ personalAccessService }))');
  const apiV2 = server.indexOf("app.use('/api/app/v2'");
  assert.ok(localSecurity >= 0 && localSecurity < getIdentity);
  assert.ok(getIdentity >= 0 && postIdentity > getIdentity && postIdentity < personalGuard);
  assert.ok(apiV2 > personalGuard);
  assert.doesNotMatch(server, /app\.(?:get|post)\('\/api\/app\/v2\/matrix-local-identity/u);
});

test('Electron bridge exposes only local identity status/create forwarding and command inventory owns the exact backend path', () => {
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');
  const inventory = read('tools/wp2/command-path-inventory.js');
  const manifest = json('electron/m2/ipcManifest.json');
  const channels = new Set(manifest.handlers.map(row => row.channel));
  assert.ok(channels.has('desktop:matrix-local-identity-status'));
  assert.ok(channels.has('desktop:matrix-local-identity-create'));
  assert.match(bridge, /matrixLocalIdentityStatus:\s*'desktop:matrix-local-identity-status'/u);
  assert.match(bridge, /apiRequest\('\/api\/desktop\/matrix-local-identity'\)/u);
  assert.match(preload, /getMatrixLocalIdentity:\s*\(\)\s*=>\s*invokeStore\('desktop:matrix-local-identity-status'\)/u);
  assert.match(preload, /createMatrixLocalIdentity:\s*input\s*=>\s*invokeStore\('desktop:matrix-local-identity-create'/u);
  assert.match(inventory, /\[CHANNELS\.matrixLocalIdentityStatus\][\s\S]*?\/api\/desktop\/matrix-local-identity/u);
  assert.match(inventory, /\[CHANNELS\.matrixLocalIdentityCreate\][\s\S]*?backend\/services\/endUserMatrixIdentityService\.js/u);
});

test('YanceLogin adds first-use setup while preserving Element login/session authority', () => {
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');
  assert.match(login, /data-yance-local-matrix-identity="first-use"/u);
  assert.match(login, /getMatrixLocalIdentity/u);
  assert.match(login, /createMatrixLocalIdentity/u);
  assert.match(login, new RegExp('@\\$\\{trimmedLocalpart\\}:yance\\.local', 'u'));
  assert.match(login, /data-yance-login-form-host="element-auth"[\s\S]*?\{children\}/u);
  assert.match(styles, /\.yance-login-local-identity\s*\{/u);
  for (const forbidden of ['_matrix/client', 'm.login.password', 'accessToken', 'localStorage.setItem', 'fetch(']) {
    assert.equal(login.includes(forbidden), false, `renderer must not implement Matrix session authority: ${forbidden}`);
  }
});

test('local identity provisioning records durable intent before the remote call and classifies every outcome', () => {
  const service = read('backend/services/endUserMatrixIdentityService.js');
  const adapter = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');

  const pendingWrite = service.indexOf('writeStateAtomic(pendingPath()');
  const remoteCall = service.indexOf('registerSynapseUserWithSharedSecret({');
  const receiptWrite = service.indexOf('writeStateAtomic(receiptPath()');
  assert.ok(pendingWrite >= 0 && remoteCall > pendingWrite, 'the durable pending marker must be written before the homeserver call');
  assert.ok(receiptWrite > remoteCall, 'the authoritative receipt may only be written after the homeserver confirms');

  assert.match(service, /YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_PENDING_V1/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_PROVISION_IN_PROGRESS/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_PERSIST_FAILED/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_LOCALPART_TAKEN/u);
  assert.match(service, /classifyRemoteOutcome/u);

  // Atomic durable write: O_EXCL create for the marker, temp+rename for the receipt.
  assert.match(service, /openSync\([^)]*'wx'/u);
  assert.match(service, /renameSync\(tempPath/u);

  // Upstream error bodies must never be forwarded or spread back into details.
  assert.doesNotMatch(service, /details:\s*\{\s*\.\.\./u);
  assert.doesNotMatch(service, /error\.details\.body/u);

  // Namespace collision proof: the bridged platform localpart is reserved.
  assert.match(adapter, /yance_fb_/u);
  assert.match(service, /RESERVED_LOCALPART_PREFIXES[\s\S]{0,200}?yance_/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED/u);

  // Secret custody stays enforced at every durable write.
  assert.match(service, /SECRET_MARKER_PATTERN/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_SECRET_RECEIPT_DENIED/u);
});
