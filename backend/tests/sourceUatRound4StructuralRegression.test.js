'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round4-'));
process.env.YANCE_DATA_DIR = dataRoot;

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const { closeStore } = require('../repositories/storeProvider');
const { stableJid } = require('../services/messageNormalizer');
const whatsappAuthority = require('../services/whatsappIdentityAuthority');
const expressionLibrary = require('../services/expressionLibraryService');
const modelAutoActivation = require('../services/modelAutoActivationService');

process.on('exit', () => {
  try { closeStore(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

test('attachment-only composer is sendable and attachment changes resync button state', () => {
  const ui = read('frontend/js/r32-ui-runtime.js');
  const capabilities = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(ui, /hasAttachment=Boolean\(window\.YanceR32ConversationCapabilities\?\.hasPendingAttachment\?\.\(\)\)/);
  assert.match(ui, /hasSendableContent=hasText\|\|hasAttachment/);
  assert.match(ui, /send\.disabled=!c\|\|Boolean\(route\.conflict\)\|\|!hasSendableContent/);
  assert.match(capabilities, /yance:r32-composer-content-changed/);
  assert.match(capabilities, /hasPendingAttachment:\(\)=>Boolean\(pending\)/);
});

test('WhatsApp LID prefers phone-number alternate JID and authority persists aliases, name and avatar', () => {
  assert.equal(stableJid({
    key: { remoteJid: '58141257502913@lid', remoteJidAlt: '49123456789@s.whatsapp.net' }
  }), '49123456789@s.whatsapp.net');

  const recorded = whatsappAuthority.record({
    accountId: 'wa-account',
    aliases: ['58141257502913@lid', '49123456789@s.whatsapp.net'],
    canonicalJid: '49123456789@s.whatsapp.net',
    displayName: 'Anna Müller',
    nameSource: 'live-message-pushName',
    avatarUrl: '/api/r32/messages/media/wa/anna/avatar.webp',
    avatarSource: 'whatsapp-profile'
  });
  assert.equal(recorded.canonicalJid, '49123456789@s.whatsapp.net');
  assert.equal(recorded.displayName, 'Anna Müller');
  assert.equal(recorded.avatarUrl, '/api/r32/messages/media/wa/anna/avatar.webp');
  const byLid = whatsappAuthority.resolve('wa-account', ['58141257502913@lid']);
  assert.equal(byLid.canonicalJid, '49123456789@s.whatsapp.net');
  assert.equal(byLid.displayName, 'Anna Müller');
  assert.equal(byLid.avatarUrl, '/api/r32/messages/media/wa/anna/avatar.webp');
  assert.equal(whatsappAuthority.weakName('me'), true);
  assert.equal(whatsappAuthority.weakName('Anna Müller'), false);
});

test('platform expression library accepts real WebP stickers and rejects fake native-format coercion', () => {
  assert.deepEqual(expressionLibrary.sendSupport('whatsapp', 'sticker', 'image/webp'), { supported: true, reason: '' });
  const telegramVideoSticker = expressionLibrary.sendSupport('telegram', 'sticker', 'video/webm');
  assert.equal(telegramVideoSticker.supported, false);
  assert.match(telegramVideoSticker.reason, /Telegram 原生动态贴纸/);
  assert.equal(expressionLibrary.sendSupport('telegram', 'gif', 'video/mp4').supported, true);
  const frontend = read('frontend/js/r32-conversation-capabilities.js');
  assert.doesNotMatch(frontend, /builtin-soft-smile|Schönes Wochenende-sticker/);
  assert.match(frontend, /当前账号暂无已缓存的真实素材/);
  assert.match(frontend, /不再提供伪装饰素材/);
});

test('Ollama autoactivation chooses usable general and translation models, not coder/embed models', () => {
  const models = [
    { id: 'embed', name: 'nomic-embed-text', provider: 'ollama', available: true },
    { id: 'coder', name: 'qwen2.5-coder:14b', provider: 'ollama', available: true },
    { id: 'general', name: 'ministral-3:14b', provider: 'ollama', available: true },
    { id: 'translation', name: 'translategemma:4b', provider: 'ollama', available: true }
  ];
  const chosen = modelAutoActivation.chooseCandidates(models);
  assert.ok(chosen.some(row => row.model.id === 'general' && row.role === 'general'));
  assert.ok(chosen.some(row => row.model.id === 'translation' && row.role === 'translation'));
  assert.equal(chosen.some(row => row.model.id === 'embed'), false);
  assert.equal(chosen.some(row => row.model.id === 'coder'), false);
  const server = read('backend/server.js');
  assert.match(server, /modelAutoActivation\.schedule/);
  const routes = read('backend/routes/models.js');
  assert.match(routes, /autoActivation: modelAutoActivation\.status\(\)/);
});

test('theme authority defines missing workspace/shadow variables and dynamic surfaces use semantic contract', () => {
  const css = read('frontend/r32-theme-authority.css');
  assert.match(css, /--theme-workspace-bg\s*:/);
  assert.match(css, /--theme-shadow-strong\s*:/);
  assert.match(css, /--surface-app\s*:/);
  assert.match(css, /--surface-panel\s*:/);
  assert.match(css, /--surface-control\s*:/);
  assert.match(css, /\.relationship-workbench/);
  assert.match(css, /\.contact-search-dialog/);
  const themeRuntime = read('frontend/r32-theme-motion.js');
  assert.match(themeRuntime, /getComputedStyle\(root\)/);
  assert.match(themeRuntime, /getPropertyValue\('--nav'\)/);
  assert.match(themeRuntime, /setTitlebarTheme/);
});
