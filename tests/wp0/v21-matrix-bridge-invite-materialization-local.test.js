'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const entry = fs.readFileSync(path.join(root, 'integration/element-module/src/index.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx'), 'utf8');
const patch = fs.readFileSync(path.join(root, 'upstream-patches/element-web/0020-yance-product-live-room-public-seams.patch'), 'utf8');

test('bridge-owned invite rooms are joined through Element before Product projects their identity', () => {
  assert.match(entry, /ensureRoomJoined\?: \(roomId: string\) => Promise<void>/u);
  assert.match(entry, /await clientApi\.ensureRoomJoined\?\.\(spaceRoom\)/u);
  assert.match(entry, /await clientApi\.ensureRoomJoined\?\.\(roomId\)/u);
  assert.match(patch, /ensureRoomJoined/u);
});

test('matrix direct projections use canonical Product account ids and fail closed without a chat identity', () => {
  assert.match(entry, /const productAccountId = text\(account\.id\)/u);
  assert.match(entry, /accountId: productAccountId/u);
  assert.match(shell, /const key = directRouteKey\(live\.conversations\[0\]\);\s*if \(!key\) continue;/u);
});

test('fallback Matrix projections canonicalize bridge receiver to the Product account id', () => {
  assert.match(entry, /const productAccountIdByBridgeReceiver = new Map<string, string>\(\)/u);
  assert.match(entry, /productAccountIdByBridgeReceiver\.set\(bridgeLoginId, productAccountId\)/u);
  assert.match(entry, /productAccountIdByBridgeReceiver\.get\(bridgeAccountId\)/u);
  assert.doesNotMatch(entry, /const accountId = owner\?\.accountId \|\| bridgeAccountId/u);
});
