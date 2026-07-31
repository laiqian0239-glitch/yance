'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const syncStability = require('../../frontend/js/r32-sync-stability');
const { telegramPresenceUpdate } = require('../services/telegramAdapter');
const { optionalTimestampIso } = require('../services/whatsappAdapter');
const workspaceService = require('../services/workspaceService');
const { buildModelMessages, compactSocialDecisionPacket, serializeSocialDecisionPacket, learningFingerprint } = require('../services/contextAwareReplyBrain');
const { SCENARIOS, PLATFORM_COVERAGE } = require('../services/replyBrainBenchmark');
const { SoundNotificationService } = require('../../electron/SoundNotificationService');
const {
  layerReplyLearningContext,
  settleReplyLearning
} = require('../services/contextAwareReplyBrain');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('avatar and identity persistence events refresh the live contact UI', () => {
  assert.equal(syncStability.shouldHandleEvent('conversation:updated'), true);
  assert.equal(syncStability.shouldHandleEvent('contacts:identity-resolved'), true);
  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /applyPresenceEvent\?\.\(contacts,event\)/u);
  assert.match(ui, /contactInfoTooltip\(c,/u);
  assert.match(ui, /contactPresenceLabel\(c\)/u);
});

test('avatar freshness and terminal presence fields participate in the live UI fingerprint', () => {
  const required = [
    'avatarUpdatedAt', 'avatar_updated_at', 'presence', 'presenceState',
    'presenceUpdatedAt', 'presenceSupport', 'lastSeenAt', 'last_seen_at', 'lastSeenPrecision', 'last_seen_precision'
  ];
  for (const field of required) assert.ok(syncStability.CONTACT_UI_FIELDS.includes(field), `${field} must refresh UI`);

  const before = syncStability.conversationUiFingerprint({
    activeId: 'wa-1:49123@s.whatsapp.net',
    contacts: [{
      id: 'wa-1:49123@s.whatsapp.net',
      avatarUrl: 'media://avatar/contact-1',
      avatarUpdatedAt: '2026-07-24T12:00:00.000Z',
      online: false,
      presenceState: 'offline'
    }]
  });
  const avatarReplaced = syncStability.conversationUiFingerprint({
    activeId: 'wa-1:49123@s.whatsapp.net',
    contacts: [{
      id: 'wa-1:49123@s.whatsapp.net',
      avatarUrl: 'media://avatar/contact-1',
      avatarUpdatedAt: '2026-07-24T12:01:00.000Z',
      online: false,
      presenceState: 'offline'
    }]
  });
  assert.notEqual(avatarReplaced, before, 'same avatar URL with new bytes must invalidate the UI fingerprint');
});

test('terminal presence updates the matching contact without changing other contacts', () => {
  const before = [
    { id: 'wa-1:49123@s.whatsapp.net', online: false, name: 'Anna' },
    { id: 'tg-1:42', online: false, name: 'Mia' }
  ];
  const online = syncStability.applyPresenceEvent(before, {
    type: 'conversation:presence',
    payload: {
      conversationId: 'wa-1:49123@s.whatsapp.net',
      state: 'available',
      at: '2026-07-24T12:00:00.000Z'
    }
  });
  assert.equal(online.changed, true);
  assert.equal(online.contacts[0].online, true);
  assert.equal(online.contacts[0].presenceState, 'online');
  assert.equal(online.contacts[1], before[1]);

  const typing = syncStability.applyPresenceEvent(online.contacts, {
    payload: { conversationId: 'wa-1:49123@s.whatsapp.net', state: 'composing' }
  });
  assert.equal(typing.changed, false);
  assert.equal(typing.contacts, online.contacts);

  const mergedAlias = syncStability.applyPresenceEvent(before, {
    payload: {
      conversationId: 'wa-1:legacy-lid@lid',
      contactId: 'contact-a',
      state: 'available'
    }
  });
  const stableContact = [
    { id: 'wa-1:49123@s.whatsapp.net', contactId: 'contact-a', online: false },
    { id: 'tg-1:42', contactId: 'contact-b', online: false }
  ];
  const mergedResult = syncStability.applyPresenceEvent(stableContact, {
    payload: { conversationId: 'wa-1:legacy-lid@lid', contactId: 'contact-a', state: 'available' }
  });
  assert.equal(mergedAlias.changed, false, 'unmatched aliases without a stable contact id on rows stay unchanged');
  assert.equal(mergedResult.changed, true);
  assert.equal(mergedResult.contacts[0].online, true, 'stable contact id must bridge LID/phone conversation aliases');
});

test('terminal presence ignores an older reconnect event after a newer state is rendered', () => {
  const current = [{
    id: 'wa-1:49123@s.whatsapp.net',
    contactId: 'contact-a',
    online: true,
    presence: 'available',
    presenceState: 'online',
    presenceUpdatedAt: '2026-07-24T12:00:10.000Z'
  }];
  const stale = syncStability.applyPresenceEvent(current, {
    type: 'conversation:presence',
    payload: {
      conversationId: 'wa-1:49123@s.whatsapp.net',
      contactId: 'contact-a',
      state: 'unavailable',
      at: '2026-07-24T12:00:05.000Z'
    }
  });
  assert.equal(stale.changed, false);
  assert.equal(stale.contacts[0], current[0]);
  assert.equal(stale.contacts[0].presenceState, 'online');
});

test('WhatsApp numeric last-seen values are normalized before persistence and UI display', () => {
  assert.match(optionalTimestampIso(1784894400), /^2026-/u);
  assert.match(optionalTimestampIso(1784894400000), /^2026-/u);
  const source = read('backend/services/whatsappAdapter.js');
  assert.match(source, /const lastSeenAt = optionalTimestampIso\(presence\?\.lastSeen\)/u);
  assert.match(source, /lastSeen: lastSeenAt \|\| null/u);
});

test('Telegram raw user status events become terminal online and offline presence', () => {
  assert.deepEqual(telegramPresenceUpdate({
    className: 'UpdateUserStatus',
    userId: 42,
    status: { className: 'UserStatusOnline' }
  }), { userId: '42', state: 'available', lastSeen: '', lastSeenPrecision: '' });

  const offline = telegramPresenceUpdate({
    className: 'UpdateUserStatus',
    userId: 42,
    status: { className: 'UserStatusOffline', wasOnline: 1784894400 }
  });
  assert.equal(offline.userId, '42');
  assert.equal(offline.state, 'unavailable');
  assert.match(offline.lastSeen, /^2026-/u);
  assert.equal(offline.lastSeenPrecision, 'exact');
  assert.deepEqual(telegramPresenceUpdate({
    className: 'UpdateUserStatus', userId: 42, status: { className: 'UserStatusRecently' }
  }), { userId: '42', state: 'unavailable', lastSeen: '', lastSeenPrecision: 'recently' });
  assert.deepEqual(telegramPresenceUpdate({
    className: 'UpdateUserStatus', userId: 42, status: { className: 'UserStatusLastWeek' }
  }), { userId: '42', state: 'unavailable', lastSeen: '', lastSeenPrecision: 'last_week' });
  assert.equal(telegramPresenceUpdate({ className: 'UpdateUserTyping', userId: 42 }), null);
});

test('group participant presence never creates contact online notifications', async () => {
  let notifications = 0;
  let sounds = 0;
  const service = new SoundNotificationService({
    presentNotification: async () => { notifications += 1; return { shown: true }; },
    playSound: async () => { sounds += 1; return { played: true }; },
    settings: { presenceDesktopEnabled: true, presenceSoundEnabled: true }
  });
  const result = await service.handlePresence({
    payload: {
      conversationId: 'wa-1:1203630@g.us',
      state: 'available',
      notificationEligible: false,
      presenceScope: 'group-participant'
    }
  });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'presence-notification-ineligible');
  assert.equal(notifications, 0);
  assert.equal(sounds, 0);
});

test('platform capability contracts disclose terminal presence support honestly', () => {
  const { getContract } = require('../services/platformCapabilities');
  assert.equal(getContract('whatsapp', 'terminalPresence').state, 'partial');
  assert.equal(getContract('telegram', 'terminalPresence').state, 'partial');
  assert.equal(getContract('facebook', 'terminalPresence').state, 'unsupported');
  const accountCenter = read('frontend/r32-account-center.js');
  const conversationCapabilities = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(accountCenter, /terminalPresence: '联系人上线\/离线提醒'/u);
  assert.match(conversationCapabilities, /terminalPresence:'联系人上线\/离线提醒'/u);
});

test('Facebook capability remains unsupported internally without showing a fake presence row to customers', () => {
  const source = read('backend/services/workspaceService.js');
  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /platformCapabilityAuthority\.evaluate/u);
  assert.match(source, /presenceSupport: presence\?\.support \|\| 'unknown'/u);
  assert.doesNotMatch(source, /平台不提供上线状态/u);
  assert.match(ui, /presenceUnsupported=!contactPresenceSupported\(c\)/u);
  assert.match(ui, /activityFact=presenceUnsupported\?\['最近互动'/u);
});

test('reply-learning events invalidate only the affected contact conversation cache', () => {
  const contacts = [
    { id: 'wa-main:49123@s.whatsapp.net', contactId: 'contact-a' },
    { id: 'tg-main:42', contactId: 'contact-b' }
  ];
  assert.deepEqual(syncStability.learningCacheKeysForEvent(contacts, {
    eventType: 'ai.replyFeedback.learned',
    entityId: 'contact-a',
    payload: { contactId: 'contact-a' }
  }), ['wa-main:49123@s.whatsapp.net']);
  assert.deepEqual(syncStability.learningCacheKeysForEvent(contacts, {
    eventType: 'ai.replyFeedback.learned',
    payload: { conversationId: 'tg-main:42', contactId: 'contact-b' }
  }), ['tg-main:42']);
  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /affectedKeys\.forEach\(key=>delete replyLearningCache\[key\]\)/u);
  assert.doesNotMatch(ui, /delete replyLearningCache\[activeId\];if\(r32RuntimeState\.aiPanel==='learning'\)/u);
});

test('reply generation waits for pending learning and preserves layered learning after quiet-window refresh', async () => {
  const order = [];
  await settleReplyLearning(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    order.push('learned');
  });
  order.push('generated');
  assert.deepEqual(order, ['learned', 'generated']);

  let received = null;
  const context = layerReplyLearningContext({
    customer: { platform: 'whatsapp', accountId: 'wa-main' },
    feedbackLearning: { version: 3, effective: { replyLength: { value: 'short' } } }
  }, 'contact-1', {
    layered(input) {
      received = input;
      return { version: 4, effective: { replyLength: { value: 'short', scope: 'contact' } } };
    }
  });
  assert.equal(received.contactId, 'contact-1');
  assert.equal(received.platform, 'whatsapp');
  assert.equal(received.sourceAccountId, 'wa-main');
  assert.equal(context.feedbackLearning.version, 4);

  const source = read('backend/services/contextAwareReplyBrain.js');
  const waits = source.match(/await settleReplyLearning\(waitForLearningIdle\)/gu) || [];
  assert.ok(waits.length >= 2, 'learning must settle both before initial context and after quiet-window refresh');
  assert.match(source, /layerReplyLearningContext\(contactContextAuthority\.getSocialContext/u);
});

test('presence events carry contact identity and avatar into notifications', () => {
  const whatsapp = read('backend/services/whatsappAdapter.js');
  const telegram = read('backend/services/telegramAdapter.js');
  for (const source of [whatsapp, telegram]) {
    assert.match(source, /senderName:/u);
    assert.match(source, /avatarUrl:/u);
    assert.match(source, /presenceScope:/u);
    assert.match(source, /updateConversationMetadata/u);
  }
});


test('contact fallback names never present Telegram or Facebook ids as WhatsApp phone numbers', () => {
  const telegram = workspaceService.contactFromConversation({
    sessionKey: 'tg-main:123456789',
    platform: 'telegram',
    payload: { externalId: '123456789' }
  });
  const facebook = workspaceService.contactFromConversation({
    sessionKey: 'fb-main:987654321012345',
    platform: 'facebook',
    payload: { externalId: '987654321012345' }
  });
  assert.equal(telegram.name, 'Telegram 联系人');
  assert.equal(facebook.name, 'Facebook 联系人');
  assert.equal(telegram.name.startsWith('+'), false);
  assert.equal(facebook.name.startsWith('+'), false);
});

test('AI reply brain uses the active platform instead of calling every reply WhatsApp', () => {
  const basePacket = {
    customer: { name: 'Anna', platform: 'telegram' },
    relationshipPotential: {}, emotion: {}, interaction: {}, preferences: {}, feedbackLearning: {},
    interactionPolicy: {}, replyStrategy: {}, relevantMemories: {}, relationshipTimeline: [],
    recentSignals: [], recentMessages: [], director: {}, incomingMessage: { text: 'Hallo' },
    persona: { truthSafePacket: { presentationProfile: { expressionHabits: ['short natural messages'] } } }, contactLanguage: {}, performanceMode: 'rapid'
  };
  const telegramPrompt = buildModelMessages(basePacket)[0].content;
  assert.match(telegramPrompt, /真实 Telegram 回复大脑/u);
  assert.doesNotMatch(telegramPrompt, /真实 WhatsApp 回复大脑/u);
  assert.doesNotMatch(telegramPrompt, /像真实 WhatsApp/u);

  const facebookPrompt = buildModelMessages({ ...basePacket, customer: { name: 'Anna', platform: 'facebook' } })[0].content;
  assert.match(facebookPrompt, /真实 Facebook Messenger 回复大脑/u);
});

test('reply-brain qualification performs real generation coverage across all three platforms', () => {
  assert.deepEqual(PLATFORM_COVERAGE, ['whatsapp', 'telegram', 'facebook']);
  const corePlatforms = new Set(SCENARIOS.filter(row => row.required === true).map(row => row.platform));
  assert.equal(corePlatforms.has('whatsapp'), true);
  assert.equal(corePlatforms.has('telegram'), true);
  assert.equal(corePlatforms.has('facebook'), true);

  const telegram = SCENARIOS.find(row => row.id === 'german_whatsapp');
  const facebook = SCENARIOS.find(row => row.id === 'english_whatsapp');
  const whatsapp = SCENARIOS.find(row => row.id === 'persona_boundary');
  assert.match(telegram.messages[0].content, /Telegram/u);
  assert.match(facebook.messages[0].content, /Facebook Messenger/u);
  assert.match(whatsapp.messages[0].content, /WhatsApp/u);

  const workbench = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(workbench, /WhatsApp、Telegram、Facebook Messenger 跨平台真实聊天基准/u);
  assert.doesNotMatch(workbench, /缺少通过真实 WhatsApp 基准的主模型/u);
});

test('reply-brain context compression preserves contact language, boundaries and sensitive topics', () => {
  const packet = {
    customer: { name: 'Anna', platform: 'telegram' },
    relevantMemories: {
      confirmedFacts: [{ text: '住在 Berlin' }],
      boundaries: [{ text: '不讨论投资转账' }],
      sensitiveTopics: [{ text: '家庭疾病属于敏感话题' }]
    },
    recentMessages: [], relationshipTimeline: [], recentSignals: [],
    incomingMessage: { text: 'Hallo' },
    contactLanguage: { code: 'de', promptLabel: '德语', source: 'confirmed-contact-language' },
    feedbackLearning: { effective: { replyLength: { value: 'short', scope: 'contact' } } },
    persona: { truthSafePacket: {} }
  };
  const compact = compactSocialDecisionPacket(packet);
  assert.equal(compact.contactLanguage.code, 'de');
  assert.equal(compact.relevantMemories.boundaries[0].text, '不讨论投资转账');
  assert.equal(compact.relevantMemories.sensitiveTopics[0].text, '家庭疾病属于敏感话题');

  const serialized = serializeSocialDecisionPacket(packet, 6000, { maxString: 80 });
  assert.match(serialized, /confirmed-contact-language/u);
  assert.match(serialized, /不讨论投资转账/u);
  assert.match(serialized, /家庭疾病属于敏感话题/u);
});

test('candidate dedupe fingerprint changes when learned preferences change', () => {
  const short = learningFingerprint({
    version: 3,
    updatedAt: '2026-07-24T12:00:00.000Z',
    effective: { replyLength: { value: 'short', scope: 'contact', confidence: 0.9 } }
  });
  const warm = learningFingerprint({
    version: 3,
    updatedAt: '2026-07-24T12:00:00.000Z',
    effective: { replyLength: { value: 'short', scope: 'contact', confidence: 0.9 }, tone: { value: 'warm', scope: 'platform', confidence: 0.8 } }
  });
  assert.notEqual(short, warm);
  const source = read('backend/services/contextAwareReplyBrain.js');
  assert.match(source, /learningFingerprint\(socialContext\.feedbackLearning\)/u);
  assert.match(source, /clean\(personaCtx\.policyHash\)/u);
  assert.match(source, /clean\(languageAuthority\.code\)/u);
});

test('current product replaces obsolete Fix11 launcher with production-chain regression tests', () => {
  assert.equal(fs.existsSync(path.join(root, 'RUN_YANCE_FIX11_WINDOWS_UAT.ps1')), false);
  for (const file of ['backend/tests/round7ProductWiringP0.test.js','backend/tests/round7InboundIntelligenceP0.test.js','backend/tests/round7ModelRoutingP0.test.js']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
  }
  const launcher = read('tools/runtime-delivery/start-source-uat.js');
  assert.match(launcher, /discoverExistingDataRoots/);
  assert.match(launcher, /YANCE_UAT_SELECTED_DATA_ROOT/);
});
