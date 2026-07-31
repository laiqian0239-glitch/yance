'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../frontend/js/r32-business-presentation-authority');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('business presentation authority localizes internal relationship and style enums', () => {
  assert.equal(authority.label('relationshipStage', 'declining'), '关系降温');
  assert.equal(authority.label('relationshipStage', 'new'), '新建立');
  assert.equal(authority.label('interactionStyle', 'calm_natural'), '自然平和');
  assert.equal(authority.label('interactionStyle', 'warm_calm'), '温暖克制');
  assert.equal(authority.label('status', 'failed_final'), '最终失败');
  assert.equal(authority.label('platform', 'facebook'), 'Facebook 公共主页');
  assert.equal(authority.label('relationshipStage', '稳定联系'), '稳定联系');
});

test('business presentation authority separates business identity from exact technical identity', () => {
  const jid = '4917612345678@s.whatsapp.net';
  const uuid = '01345678-1234-4abc-9def-1234567890ab';
  assert.equal(authority.isTechnicalIdentity(jid), true);
  assert.equal(authority.isTechnicalIdentity(uuid), true);
  assert.match(authority.businessIdentity(jid, { platform: 'whatsapp' }), /WhatsApp 身份 · 尾号 5678/u);
  assert.match(authority.businessIdentity(uuid, { platform: 'telegram' }), /Telegram · 标识尾号/u);
  assert.equal(authority.businessIdentity(jid, { reveal: true }), jid);
  assert.equal(authority.businessIdentity('Anna'), 'Anna');
  assert.doesNotMatch(authority.businessIdentity(uuid), /01345678-1234/u);
});

test('formal business runtimes load and use one authority before rendering', () => {
  const index = read('frontend/index.html');
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const contactRenderers = read('frontend/js/r32-contact-safe-renderers.js');
  const accountCenter = read('frontend/r32-account-center.js');
  const aiWorkbench = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.ok(index.indexOf('/js/r32-business-presentation-authority.js') > index.indexOf('/js/r32-security.js'));
  assert.ok(index.indexOf('/js/r32-business-presentation-authority.js') < index.indexOf('/js/r32-contact-safe-renderers.js'));
  assert.ok(index.indexOf('/js/r32-business-presentation-authority.js') < index.indexOf('/js/r32-ui-runtime.js'));
  assert.match(runtime, /businessLabel\('relationshipStage',t\.stage,'待分析'\)/u);
  assert.match(runtime, /businessLabel\('interactionStyle',s\.generationMetadata\?\.styleVariant/u);
  assert.match(runtime, /businessLabel\('eventType',x\[1\]/u);
  assert.match(aiWorkbench, /businessLabel\('source',m\.source/u);
  assert.match(contactRenderers, /technicalDetailsNode/u);
  assert.match(contactRenderers, /businessIdentity\(contact\.stableId/u);
  assert.match(accountCenter, /ac32-technical-details/u);
  assert.match(accountCenter, /businessIdentity\(row\.externalConversationId\|\|row\.conversationId/u);
});

test('formal business cards do not directly render raw stage or stable identity values', () => {
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const contactRenderers = read('frontend/js/r32-contact-safe-renderers.js');
  assert.doesNotMatch(runtime, /htmlText\(t\.stage\)/u);
  assert.doesNotMatch(runtime, /htmlText\(t\.stage\|\|'待分析'\)/u);
  assert.doesNotMatch(contactRenderers, /\['稳定身份',\s*contact\.stableId/u);
  assert.match(contactRenderers, /查看技术身份/u);
});

test('presentation changes do not alter exact send routing and evidence identity contracts', () => {
  const runtime = read('frontend/js/r32-ui-runtime.js');
  assert.match(runtime, /targetIdentity:target/u);
  assert.match(runtime, /chatJid:c\.chatJid/u);
  assert.match(runtime, /accountId:c\.accountId/u);
  assert.match(runtime, /data-message-id="\$\{htmlAttr\(m\.id\|\|''\)\}"/u);
  assert.match(runtime, /function messageEvidence\(message=\{\}\).*messageId:/u);
});
