'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Facebook Page history has no Yance runtime replay owner', () => {
  const files = [
    'integration/element-module/src/index.tsx',
    'backend/routes/accounts.js',
    'backend/core/accountContext.js',
    'backend/services/accountManagerCore.js',
    'backend/services/platformDriverRegistry.js',
    'backend/services/facebookChatwootMatrixBridge.js',
    'electron/r32StoreBridge.js'
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /facebook-page-history-sync|syncFacebookPageHistoryForRoom|planFacebookPageHistory|applyFacebookPageHistoryInbound/u, file);
  }
});

test('Element module API does not expose a Yance-only sendRoomMessage replay seam', () => {
  assert.doesNotMatch(read('services/matrix/.runtime/element-web/packages/module-api/src/api/client.ts'), /sendRoomMessage/u);
  assert.doesNotMatch(read('services/matrix/.runtime/element-web/apps/web/src/modules/ClientApi.ts'), /sendRoomMessage/u);
});

test('Facebook Page has no Graph backfill runner or Chatwoot monkey-patch owner', () => {
  const retired = [
    'tools/chatwoot-facebook-page/history_backfill_policy.rb',
    'tools/chatwoot-facebook-page/history_backfill_runner.rb',
    'services/matrix/chatwoot-facebook-page/overrides/yance_message_finder_cursor.rb',
    'services/matrix/chatwoot-facebook-page/overrides/yance_contact_avatar_after_commit.rb',
    'backend/services/facebookAdapter.js',
    'backend/services/facebookRelayClient.js',
    'services/facebook-worker/src/desktopApi.js',
    'services/facebook-worker/src/media.js',
    'services/facebook-worker/src/webhook.js'
  ];
  for (const relative of retired) {
    assert.equal(fs.existsSync(path.join(ROOT, relative)), false, `${relative} must not remain as a second Page owner`);
  }
});
