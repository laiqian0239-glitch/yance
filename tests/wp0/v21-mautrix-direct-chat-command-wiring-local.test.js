const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('direct-chat provisioning stays behind the existing closed account command boundary', () => {
  const routes = read('backend/routes/accounts.js');
  const context = read('backend/core/accountContext.js');
  const bridge = read('electron/r32StoreBridge.js');

  assert.match(routes, /post\('\/:id\/provisioning\/direct-chat\/ensure'/u);
  assert.match(routes, /account\.provisioning\.directChat\.ensure/u);
  assert.match(context, /case 'account\.provisioning\.directChat\.ensure'/u);
  assert.match(context, /ensureProvisioningDirectChat/u);
  assert.match(bridge, /'provisioning-direct-chat-ensure'/u);
  assert.match(bridge, /\/provisioning\/direct-chat\/ensure/u);
});

test('Conversation navigation retries an unresolved mautrix route through exact direct-chat authority', () => {
  const index = read('integration/element-module/src/index.tsx');
  assert.match(index, /runPlatformAccountCommand\?:/u);
  assert.match(index, /action:\s*"provisioning-direct-chat-ensure"/u);
  assert.match(index, /navigationApi\.openRoom\(ensuredRoomId,\s*\{\s*autoJoin:\s*true\s*\}\)/u);
  assert.match(index, /resolveCanonicalConversationRoom\([\s\S]*ensuredRoomId/u);
});
