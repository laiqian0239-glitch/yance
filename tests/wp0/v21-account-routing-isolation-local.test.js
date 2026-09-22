const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx'), 'utf8');

test('Matrix room projection requires bridge receiver bound to the exact Product account alias authority', () => {
  const matchStart = source.indexOf('function conversationMatchesBridgeIdentity');
  const resolverStart = source.indexOf('export function resolveCanonicalConversationRoom');
  assert.ok(matchStart >= 0 && resolverStart > matchStart);
  const matchBlock = source.slice(matchStart, resolverStart);
  assert.match(matchBlock, /const receiver = clean\(identity\.receiver\)/u);
  assert.match(matchBlock, /!platform \|\| !chatJid \|\| !accountId \|\| !receiver/u);
  assert.match(matchBlock, /\[accountId, \.\.\.bridgeReceiverAliases\]/u,
    'receiver aliases must be derived for the selected Product account only');
  assert.match(matchBlock, /chatJid === identityChatJid[\s\S]*acceptedReceivers\.has\(receiver\)/u,
    'same platform/contact is insufficient: receiver must belong to the selected account alias set');

  const resolverEnd = source.indexOf('function normalizedStoreRoute', resolverStart);
  const resolverBlock = source.slice(resolverStart, resolverEnd);
  assert.match(resolverBlock, /const routeMatches = \[\.\.\.identities\.values\(\)\]/u);
  assert.doesNotMatch(resolverBlock, /!identity\.receiver \|\|/u,
    'missing receiver must never downgrade to platform/contact-only matching');
  assert.doesNotMatch(resolverBlock, /platformMatches/u,
    'resolver must not keep a fallback platform/contact-only candidate set');
  assert.match(resolverBlock, /if \(routeMatches\.length > 1\)[\s\S]*status: "ambiguous"/u);
  assert.match(resolverBlock, /if \(routeMatches\.length === 1\) matches\.add\(roomId\)/u);
});


test('Relationship tool route never falls back when bridge receiver is missing or outside the exact account alias set', () => {
  const start = source.indexOf('export async function resolveRelationshipToolRoute');
  const end = source.indexOf('export function RelationshipOverlayHost', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /!identity\.receiver \|\| route\.accountId === identity\.receiver/u,
    'missing receiver must not degrade to platform/contact matching');
  assert.doesNotMatch(block, /receiverMatches\.length \? receiverMatches : platformMatches/u,
    'mismatched receiver must never fall back to platform/contact candidates');
  assert.match(block, /if \(!identity\.receiver\)[\s\S]*status: "unresolved"/u,
    'a missing bridge receiver must stop route resolution');
  assert.match(block, /bridgeReceiverAliasesForAccount\([\s\S]*route\.accountId[\s\S]*accountRows/u,
    'receiver aliases must be derived from the exact Store account row');
  assert.match(block, /return aliases\.includes\(identity\.receiver\)/u,
    'the bridge receiver must belong to the exact Store account alias set');
});
