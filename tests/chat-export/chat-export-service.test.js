'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createChatExportService,
  normalizeExportMessage,
  safeFileStem,
  MAX_EXPORT_MESSAGES
} = require('../../backend/services/chatExportService');

function serviceWith({ conversation, messages = [], now = '2026-07-07T01:02:03.000Z' } = {}) {
  return createChatExportService({
    now: () => now,
    messageRepository: {
      getConversation: id => id === 'conversation:1' ? conversation : null,
      listMessagesForExport: () => messages
    }
  });
}

test('creates a complete self-contained HTML transcript with deterministic identity', () => {
  const service = serviceWith({
    conversation: { id: 'conversation:1', title: 'Anna / Berlin', platform: 'whatsapp' },
    messages: [
      { sentAt: '2026-07-01T08:00:00Z', direction: 'inbound', senderName: 'Anna', text: 'Guten Morgen' },
      { sentAt: '2026-07-01T08:01:00Z', direction: 'outbound', text: 'Morgen ☕️', deliveryStatus: 'read' }
    ]
  });
  const result = service.createConversationExport('conversation:1');
  assert.equal(result.messageCount, 2);
  assert.match(result.fileName, /^Yance-Chat-Anna _ Berlin-20260707-010203Z\.html$/);
  assert.match(result.content, /Guten Morgen/);
  assert.match(result.content, /Morgen ☕️/);
  assert.match(result.content, /<strong>我<\/strong>/);
  assert.match(result.content, /Content-Security-Policy/);
  assert.doesNotMatch(result.content, /<script/i);
  assert.equal(result.contentBytes, Buffer.byteLength(result.content, 'utf8'));
  assert.equal(result.sha256, crypto.createHash('sha256').update(result.content, 'utf8').digest('hex'));
});

test('escapes active content and never serializes raw payload secrets or media locations', () => {
  const service = serviceWith({
    conversation: { id: 'conversation:1', title: '<img src=x onerror=alert(1)>', platform: 'telegram' },
    messages: [{
      sentAt: '2026-07-01T08:00:00Z',
      direction: 'inbound',
      senderName: '<script>alert(1)</script>',
      text: '<img src=x onerror=alert(1)> & hello',
      fileName: 'photo.jpg',
      mediaPath: 'C:\\Users\\Secret\\private\\photo.jpg',
      mediaUrl: 'https://cdn.example/photo.jpg?access_token=SECRET',
      cookie: 'SID=SECRET',
      apiSessionToken: 'SECRET_TOKEN',
      rawCredential: { password: 'SECRET_PASSWORD' }
    }, {
      sentAt: '2026-07-01T08:01:00Z',
      direction: 'inbound',
      type: 'image',
      mediaUrl: 'https://cdn.example/SECRET_REMOTE_FILE.jpg?access_token=SECOND_SECRET'
    }]
  });
  const result = service.createConversationExport('conversation:1');
  assert.match(result.content, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(result.content, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(result.content, /附件：photo\.jpg/);
  for (const forbidden of ['SECRET_TOKEN', 'SECRET_PASSWORD', 'SID=SECRET', 'C:\\Users\\Secret', 'access_token=SECRET', 'SECRET_REMOTE_FILE', 'SECOND_SECRET']) {
    assert.doesNotMatch(result.content, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('exports visible attachment metadata, quoted state, reactions and revoked messages', () => {
  const service = serviceWith({
    conversation: { id: 'conversation:1', title: 'Media Chat', platform: 'whatsapp' },
    messages: [
      {
        sentAt: '2026-07-02T10:00:00Z', direction: 'inbound', type: 'image', caption: 'Look',
        mediaPath: '/private/media/picture.png', mimeType: 'image/png', bytes: 2048,
        quotedMessageId: 'internal-id', reactions: [{ emoji: '❤️', actor: 'phone-1' }, { emoji: '❤️', actor: 'phone-2' }]
      },
      { sentAt: '2026-07-02T10:01:00Z', direction: 'outbound', type: 'revoke', revoked: true, text: 'secret old text' }
    ]
  });
  const result = service.createConversationExport('conversation:1');
  assert.match(result.content, /Look/);
  assert.match(result.content, /附件：picture\.png/);
  assert.match(result.content, /image\/png/);
  assert.match(result.content, /2\.0 KB/);
  assert.match(result.content, /引用消息/);
  assert.match(result.content, /❤️ ×2/);
  assert.match(result.content, /一条消息已被撤回/);
  assert.doesNotMatch(result.content, /secret old text/);
  assert.doesNotMatch(result.content, /internal-id/);
  assert.doesNotMatch(result.content, /phone-1/);
});

test('normalizes sender and message fields without leaking internal identifiers', () => {
  const normalized = normalizeExportMessage({
    direction: 'incoming', senderId: '49123456789@s.whatsapp.net', senderName: '', text: 'hello', sentAt: '2026-01-01T00:00:00Z'
  }, { title: 'Norbert' });
  assert.equal(normalized.sender, 'Norbert');
  assert.equal(normalized.outbound, false);
  assert.equal(normalized.text, 'hello');
  assert.equal(Object.hasOwn(normalized, 'senderId'), false);
});

test('sanitizes Windows filenames including reserved device names', () => {
  assert.equal(safeFileStem('  A/B:C*D?  '), 'A_B_C_D_');
  assert.equal(safeFileStem('CON'), 'Chat-CON');
  assert.equal(safeFileStem('...'), 'Conversation');
});

test('supports empty conversations while preserving a readable export', () => {
  const result = serviceWith({ conversation: { id: 'conversation:1', title: 'Empty', platform: 'facebook' } })
    .createConversationExport('conversation:1');
  assert.equal(result.messageCount, 0);
  assert.match(result.content, /当前没有可导出的消息/);
  assert.match(result.content, /消息数量<\/span><b>0<\/b>/);
});

test('rejects invalid and missing conversations', () => {
  const service = serviceWith({ conversation: { id: 'conversation:1', title: 'Valid' } });
  assert.throws(() => service.createConversationExport(''), error => error.code === 'CHAT_EXPORT_CONVERSATION_ID_INVALID' && error.status === 400);
  assert.throws(() => service.createConversationExport('missing'), error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  assert.throws(() => service.createConversationExport(`bad\u0000id`), error => error.code === 'CHAT_EXPORT_CONVERSATION_ID_INVALID');
});

test('fails closed before rendering when the complete conversation exceeds the export limit', () => {
  const service = createChatExportService({
    messageRepository: {
      getConversation: () => ({ id: 'conversation:1', title: 'Huge' }),
      listMessagesForExport: () => ({ length: MAX_EXPORT_MESSAGES + 1 })
    }
  });
  assert.throws(() => service.createConversationExport('conversation:1'), error => error.code === 'CHAT_EXPORT_MESSAGE_LIMIT_EXCEEDED' && error.status === 413);
});
