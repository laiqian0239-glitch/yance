'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('new connection creates a fresh WhatsApp pending account instead of reusing the first account', () => {
  const source = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  assert.match(source, /const addSelectedConnection = \(\): void =>/u);
  assert.match(source, /const item = selectedPlatform === "facebook-messenger"[\s\S]{0,280}connectableType\(selectedPlatform, selectedMeta\.accountKind\)[\s\S]{0,180}createTypedAccount\(item\.platform, item\.accountKind, item\.driverId, item\.label\)/u);
  assert.match(source, /className="yance-account-manager__add" onClick=\{addSelectedConnection\}/u);
});

test('one newly observed mautrix login adopts the one pending WhatsApp account without an existing login consuming it', () => {
  const source = read('backend/services/accountManagerCore.js');
  const start = source.indexOf('async materializeMatureBridgeAccounts');
  const end = source.indexOf('async listObserved', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /unmatchedLoginIds/u);
  assert.match(block, /unmatchedLoginIds\.length === 1 && unmatchedLoginIds\[0\] === loginId && compatiblePending\.length === 1/u);
  assert.doesNotMatch(block, /logins\.length === 1 && compatiblePending\.length === 1/u);
  assert.match(block, /if \(existing\) continue;/u);
  assert.doesNotMatch(block, /if \(existing\) \{[\s\S]{0,1200}compatiblePending/u);
});

test('observed account state is scoped to its own mautrix login instead of copying every login to every account', () => {
  const source = read('backend/services/accountManagerCore.js');
  assert.match(source, /function scopeMatureBridgeObservation\(account, observed = \{\}\)/u);
  assert.match(source, /observedMatureBridgeLoginId\(account, account\.platform\)/u);
  assert.match(source, /bridgeLogins\.filter\(row => String\(row\?\.id \|\| ''\)\.trim\(\) === ownerLoginId\)/u);
  assert.match(source, /this\.publicAccount\(account, matureBridge \? scopeMatureBridgeObservation\(account, observed\) : observed\)/u);
});
