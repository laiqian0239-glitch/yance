'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
const json = relative => JSON.parse(read(relative));
const exists = relative => fs.existsSync(path.join(ROOT, ...relative.split('/')));
const META_COMMIT = json('config/upstreams/v21-comms-p0.json').externalRuntimes.mautrixMeta.commit;

test('Facebook Personal production pins mature mautrix-meta messenger-lite authority', () => {
  const upstream = json('config/upstreams/v21-comms-p0.json').externalRuntimes.mautrixMeta;
  assert.equal(upstream.version, 'v0.2609.0');
  assert.equal(upstream.commit, META_COMMIT);
  assert.equal(upstream.adoptionMode, 'sidecar-service');
  assert.equal(upstream.protocolAuthority, 'facebook-personal-messenger');
  assert.equal(upstream.nativeLoginFlow, 'messenger-lite');
  assert.match(read('third_party/licenses/mautrix-meta-AGPL-3.0.txt'), /GNU AFFERO GENERAL PUBLIC LICENSE/u);
});

test('Facebook Personal retired Yance protocol/Matrix owner is absent', () => {
  assert.equal(exists('backend/services/facebookPersonalMessengerMautrixAdapter.js'), false);
  assert.equal(exists('backend/services/facebookPersonalMessengerExperimentalAdapter.js'), false);
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /'facebook-personal-messenger-mautrix-meta'/u);
  assert.match(registry, /protocolAuthority:\s*'mautrix-meta'/u);
  assert.doesNotMatch(registry, /facebookPersonalMessengerMautrixAdapter|facebookPersonalMessengerExperimentalAdapter/u);
});

test('Facebook Personal multi-account projection is generic and login-scoped', () => {
  const ui = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  const manager = read('backend/services/accountManagerCore.js');
  assert.match(ui, /connectableType\(selectedPlatform, selectedMeta\.accountKind\)[\s\S]{0,180}createTypedAccount\(item\.platform, item\.accountKind, item\.driverId, item\.label\)/u);
  assert.match(ui, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(manager, /unmatchedLoginIds\.length === 1 && unmatchedLoginIds\[0\] === loginId && compatiblePending\.length === 1/u);
  assert.match(manager, /scopeMatureBridgeObservation\(account, observed = \{\}\)/u);
});

test('Facebook Personal session/reconnect remains bridge-owned instead of Yance SESSION_RESTORE', () => {
  const accountManager = read('backend/services/accountManager.js');
  assert.match(accountManager, /function matureBridgeOwnsSession\(account = \{\}\)/u);
  assert.match(accountManager, /\/-mautrix-\/u\.test\(driverId\)/u);
  assert.match(accountManager, /if \(matureBridgeOwnsSession\(account\)\) continue;/u);
});

test('Facebook Personal physical send stays with Element/Matrix and mautrix-meta', () => {
  const adapter = read('backend/services/mautrixProvisioningAdapter.js');
  const element = read('integration/element-module/src/index.tsx');
  assert.match(adapter, /ELEMENT_MATRIX_SEND_AUTHORITY_REQUIRED/u);
  assert.match(adapter, /facebook:\s*Object\.freeze\(\{[\s\S]{0,120}authority:\s*'mautrix-meta'/u);
  assert.match(element, /registerOutgoingMessagePrepare/u);
  assert.match(element, /builtins\.renderRoomView\(roomId, props\)/u);
});

test('Facebook Page Chatwoot remains isolated from Personal Messenger', () => {
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /facebook-page-official[\s\S]*facebookChatwoot/u);
  assert.match(registry, /facebook-personal-messenger-mautrix-meta/u);
});
