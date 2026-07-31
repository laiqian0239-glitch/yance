'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bestWhatsAppDisplayName, whatsappJidCandidates, isWeakWhatsAppName } = require('../services/whatsappAdapter');
const { AvatarSyncService } = require('../services/avatarService');

const root = path.resolve(__dirname, '../..');

test('WhatsApp strong names beat raw LID and phone placeholders', () => {
  assert.equal(isWeakWhatsAppName('58141257502913@lid'), true);
  assert.equal(isWeakWhatsAppName('+49123456789'), true);
  assert.equal(bestWhatsAppDisplayName(['+49123456789', 'Anna Müller'], '49123456789@s.whatsapp.net'), 'Anna Müller');
  assert.deepEqual(whatsappJidCandidates({ id: '5814@lid', remoteJidAlt: '49123@s.whatsapp.net', aliases: ['49123@s.whatsapp.net'] }), ['49123@s.whatsapp.net', '5814@lid']);
});

test('WhatsApp avatar lookup tries LID and phone-number JID before declaring unavailable', async () => {
  const patches = [];
  const messageStore = {
    getConversation: () => ({ avatarUrl: '', avatarStatus: '' }),
    updateConversationMetadata: async (_id, patch) => { patches.push(patch); return { id: 'conv', ...patch }; }
  };
  const service = new AvatarSyncService({ messageStore, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Uint8Array.from([0xff,0xd8,0xff,0xd9]).buffer }) });
  service.cacheRemote = async () => ({ avatarUrl: '/api/r32/messages/media/a/c/contact-avatar.jpg', avatarStatus: 'ready' });
  const calls = [];
  const result = await service.syncWhatsAppContact({
    accountId: 'wa', conversationId: 'conv', jid: '5814@lid', jidCandidates: ['49123@s.whatsapp.net'], force: true,
    socket: { profilePictureUrl: async (jid) => { calls.push(jid); if (jid.endsWith('@lid')) { const error = new Error('404'); error.status = 404; throw error; } return 'https://example.test/avatar.jpg'; } }
  });
  assert.equal(result.status, 'downloaded');
  assert.equal(result.resolvedJid, '49123@s.whatsapp.net');
  assert.deepEqual(calls.slice(0, 3), ['5814@lid', '5814@lid', '49123@s.whatsapp.net']);
  assert.ok(patches.some(patch => patch.avatarResolvedJid === '49123@s.whatsapp.net'));
});

test('conversation renderer uses nested live account avatar and shows other online accounts', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(source, /account\.user\?\.avatarUrl/);
  assert.match(source, /account\.metadata\?\.liveUser\?\.avatarUrl/);
  assert.match(source, /其他在线账号/);
  assert.match(source, /切换到该账号的会话/);
  assert.match(source, /hydrateMessageAccountAvatars/);
});
