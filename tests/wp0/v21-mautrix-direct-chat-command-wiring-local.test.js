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

test('direct-chat provisioning command is admitted by the core command contract as a write command', () => {
  const contracts = require(path.join(ROOT, 'shared/core/contracts.js'));
  const command = 'account.provisioning.directChat.ensure';
  assert.equal(contracts.isKnownCommand(command), true);
  assert.equal(contracts.isWriteCommand(command), true);
});

test('Conversation navigation retries an unresolved mautrix route through exact direct-chat authority without exposing raw Element navigation', () => {
  const index = read('integration/element-module/src/index.tsx');
  assert.match(index, /runPlatformAccountCommand\?:/u);
  assert.match(index, /action:\s*"provisioning-direct-chat-ensure"/u);
  assert.match(index, /clientApi\.ensureRoomJoined\?\.\(ensuredRoomId\)/u);
  assert.doesNotMatch(index, /navigationApi\.openRoom\(ensuredRoomId/u);
  assert.match(index, /navigationApi\.navigateToLocation\?\.\("yance"\)/u);
  assert.match(index, /resolution = \{ status: "resolved", roomId: ensuredRoomId \}/u);
});

test('Conversation navigation does not treat an invited mautrix room as a joined direct chat', () => {
  const index = read('integration/element-module/src/index.tsx');
  assert.match(index, /m\.room\.member/u);
  assert.match(index, /content\?\.membership\)\s*===\s*"join"/u);
  assert.match(index, /joinedCandidateRoomIds/u);
  assert.match(index, /resolveCanonicalConversationRoom\(\s*conversation,\s*joinedCandidateRoomIds/u);
});

test('Conversation target selection never leaves the previous real RoomView bound while the new target resolves', () => {
  const index = read('integration/element-module/src/index.tsx');
  const start = index.indexOf('const activateCanonicalConversation');
  const end = index.indexOf('const activateProductConversation', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const activate = index.slice(start, end);
  assert.match(activate, /beginProductConversationNavigation\(relationshipId\.trim\(\), conversation\)[\s\S]*const sessionKey/u,
    'a new direct-chat target must unbind the old RoomView before exact mature-owner resolution starts');
});

test('official mautrix create_dm room identity is accepted after Element joins it without a second local re-resolution race', () => {
  const index = read('integration/element-module/src/index.tsx');
  const start = index.indexOf('const activateCanonicalConversation');
  const end = index.indexOf('const activateProductConversation', start);
  const activate = index.slice(start, end);
  assert.match(activate, /const ensuredRoomId = text\(ensured\.roomId\)[\s\S]*ensureRoomJoined\?\.\(ensuredRoomId\)[\s\S]*resolution = \{ status: "resolved", roomId: ensuredRoomId \}/u,
    'mautrix create_dm is the mature room-creation authority; Product must not wait for a duplicate bridge-state projection to catch up');
});

test('Conversation switching keeps the Product conversation surface mounted while the new mature room resolves', () => {
  const index = read('integration/element-module/src/index.tsx');
  const session = read('integration/element-module/src/product-experience/experienceSession.ts');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(session, /conversationNavigationPending:\s*boolean/u);
  assert.match(session, /export function beginProductConversationNavigation/u);
  assert.match(session, /activeMatrixRoomId:\s*""[\s\S]*conversationNavigationPending:\s*true/u);
  assert.match(index, /beginProductConversationNavigation\(relationshipId\.trim\(\), conversation\)[\s\S]*const sessionKey/u,
    'switching targets must unbind the old RoomView while preserving the target conversation shell');
  assert.match(shell, /session\.activeMatrixRoomId\s*\|\|\s*session\.conversationNavigationPending\s*\|\|\s*session\.selectedConversationId/u);
  assert.match(shell, /conversationNavigationPending[\s\S]*正在打开真实对话/u);
});
test('Conversation switching keeps immersive shell layout while the mature room is temporarily unbound', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(shell, /data-conversation-surface-active=\{!settingsVisible\s*&&\s*session\.conversationNavigationPending\s*\?\s*"true"\s*:\s*undefined\}/u,
    'pending conversation presentation needs its own layout marker instead of overloading the real room-id marker');
  assert.match(css, /\.yance-product-shell\[data-conversation-surface-active\]\s*\{[\s\S]*?padding:\s*0/u,
    'pending conversation presentation must not restore the outer desktop gutter');
  assert.match(css, /\.yance-product-shell\[data-conversation-surface-active\]\s*>\s*\.yance-shell-scene--conversation\s*\{[\s\S]*?width:\s*100%/u,
    'pending conversation scene must keep the same full-width geometry as an active room');
});
