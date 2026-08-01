'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const { normalizeIncoming, readableSender } = require('../services/messageNormalizer');
const avatarService = require('../services/avatarService');
const { ownWhatsAppProfile } = require('../services/whatsappAdapter');

test('raw WhatsApp LID is never exposed as the visible sender name', () => {
  const jid = '58141257502913@lid';
  assert.equal(readableSender({}, jid), '+58141257502913');
  const message = normalizeIncoming({
    accountId: 'wa-account',
    info: {
      key: { id: 'message-1', remoteJid: jid, fromMe: false },
      messageTimestamp: 1710000000,
      message: { conversation: 'hello' }
    }
  });
  assert.equal(message.sender, '+58141257502913');
  assert.equal(message.senderName, '+58141257502913');
  assert.equal(message.sender.includes('@lid'), false);
});

test('WhatsApp account profile picture is cached to the local media route before UI exposure', async t => {
  const original = avatarService.cacheStandaloneRemote;
  t.after(() => { avatarService.cacheStandaloneRemote = original; });
  let input = null;
  avatarService.cacheStandaloneRemote = async value => {
    input = value;
    return { avatarUrl: '/api/r32/messages/media/acct/profile/avatar.jpg', avatarUpdatedAt: '2026-07-19T00:00:00.000Z' };
  };
  const result = await ownWhatsAppProfile({ profilePictureUrl: async () => 'https://example.test/avatar.jpg' }, { id: '49123456789@s.whatsapp.net', name: 'Yeonhee' }, 'wa-db');
  assert.equal(input.accountId, 'wa-db');
  assert.equal(result.avatarUrl, '/api/r32/messages/media/acct/profile/avatar.jpg');
  assert.equal(result.avatarStatus, 'ready');
});

test('Telegram login source contains QR authorization polling, account avatar caching and automatic history sync', () => {
  const source = read('backend/services/telegramAdapter.js');
  assert.match(source, /waitForQrAuthorization/);
  assert.match(source, /Promise\.race\(\[sdkLogin, this\.waitForQrAuthorization/);
  assert.match(source, /telegram-account-avatar/);
  assert.match(source, /this\.sync\(account\)/);
  assert.match(source, /telegram:history-synced/);
});

test('runtime identity persistence carries Telegram and WhatsApp live avatars into account metadata', () => {
  const source = read('backend/services/accountManager.js');
  assert.match(source, /metadata\.liveUser = \{ \.\.\.\(metadata\.liveUser \|\| \{\}\), \.\.\.result\.user \}/);
  assert.match(source, /if \(payload\.user\) this\.updateIdentityFromRuntime/);
});

test('contact search is an independent modal rather than an alias of the identity page', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /function openContactSearchWorkspace\(\)/);
  assert.match(source, /contact-search-dialog/);
  assert.match(source, /navSearch'\)\.onclick=\(\)=>\{openContactSearchWorkspace\(\)/);
  assert.doesNotMatch(source, /navSearch'\)\.onclick=\(\)=>\{openContactsPage\(activeId\)/);
});

test('native Windows titlebar and relationship surfaces follow the active theme', () => {
  const main = read('electron/main.js');
  const preload = read('electron/preload.js');
  const theme = read('frontend/r32-theme-motion.js');
  const css = read('frontend/r32-theme-authority.css');
  assert.match(main, /desktop:set-titlebar-theme/);
  assert.match(main, /setTitleBarOverlay/);
  assert.match(preload, /setTitlebarTheme/);
  assert.match(theme, /setTitlebarTheme/);
  assert.match(css, /\.insight29-main/);
  assert.match(css, /\.relationship-workbench/);
});

test('Facebook authorization copy separates official Page, official personal identity and experimental Messenger', () => {
  const source = read('frontend/r32-account-center.js');
  assert.match(source, /Facebook 公共主页（官方）/);
  assert.match(source, /Facebook 个人身份（官方，仅身份）/);
  assert.match(source, /Facebook 个人 Messenger（非官方实验）/);
  assert.match(source, /个人身份登录不提供 Messenger 私信/);
  assert.match(source, /不会创建一个无法登录的假账号/);
});
