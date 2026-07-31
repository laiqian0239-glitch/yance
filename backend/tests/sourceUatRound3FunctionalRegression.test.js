'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qualificationFromScores } = require('../services/modelQualification');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('conversation analysis keeps aiGateway method bound so dedupe state is available', () => {
  const repository = source('backend/repositories/workspaceRepository.js');
  assert.match(repository, /const gateway = require\('\.\.\/services\/aiGateway'\)/);
  assert.match(repository, /payload => gateway\.execute\(payload\)/);
  assert.doesNotMatch(repository, /require\('\.\.\/services\/aiGateway'\)\.execute;/);
});

test('a real connectivity response makes a local model experimental instead of unusable', () => {
  assert.equal(qualificationFromScores({ connectivity: { pass: true } }), 'experimental');
  assert.equal(qualificationFromScores({ connectivity: { pass: false } }), 'failed');
  assert.equal(qualificationFromScores({
    connectivity: { pass: true }, translation: { pass: true }, json: { pass: true },
    persona: { pass: true }, hallucination: { pass: true }
  }), 'verified');
});

test('successful qualification automatically creates task routes', () => {
  const registry = source('backend/services/modelRegistry.js');
  assert.match(registry, /source: 'qualification-auto-route'/);
  assert.match(registry, /allowExperimental: result\.qualification === 'experimental'/);
  assert.match(registry, /routingIntegrity\.repairRegistryDocument/);
});

test('archived filter, contact context actions and alternate online accounts are interactive', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /function activateConversationFilter/);
  assert.match(ui, /data-contact-action="archive"/);
  assert.match(ui, /button\.oncontextmenu/);
  assert.match(ui, /value="conversation:\$\{htmlAttr\(row\.id\)\}"/);
  assert.match(ui, /explicitlyLinkedConversations/);
  assert.doesNotMatch(ui, /bind-conversation/);
  assert.match(ui, /hydrateMessageAccountAvatars/);
});

test('chat media viewer and platform-real expression library are functional', () => {
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(capabilities, /id="r32MediaViewer"/);
  assert.match(capabilities, /data-media-action="save"/);
  assert.match(capabilities, /copyMediaViewerImage/);
  assert.match(capabilities, /expressions\/recent/);
  assert.match(capabilities, /当前账号暂无已缓存的真实素材/);
  assert.match(capabilities, /不再提供伪装饰素材/);
  assert.doesNotMatch(capabilities, /builtin-soft-smile|Schönes Wochenende-sticker/);
  assert.match(capabilities, /openMediaViewer\(image\.currentSrc\|\|image\.src\)/);
});

test('decorative placeholder assets are not wired into the live expression picker', () => {
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  assert.doesNotMatch(capabilities, /\/assets\/expressions\//);
  assert.match(capabilities, /platformExpressions/);
  assert.match(capabilities, /supportedSend/);
});
