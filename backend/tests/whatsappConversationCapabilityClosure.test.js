'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-conversation-capability-'));
process.env.YANCE_DATA_DIR = dataRoot;

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

process.on('exit', () => {
  try { require('../repositories/storeProvider').closeStore(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

const capabilityRuntime = require('../../frontend/js/r32-platform-capability-runtime');
const mediaIntelligence = require('../services/mediaIntelligenceService');
const transcription = require('../services/transcriptionService');

function bareNativeDialogCalls(text) {
  return [...text.matchAll(/(^|[^.\w])(?:window\.)?(prompt|alert)\s*\(/gm)].map(match => match[2]);
}

test('supported conversation operations use in-app dialogs and removed contact-menu tag editing does not survive as a hidden duplicate', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  const settings = source('frontend/r32-settings-recovery.js');
  const index = source('frontend/index.html');
  const dialog = source('frontend/js/r32-dialog-runtime.js');

  assert.deepEqual(bareNativeDialogCalls(ui), []);
  assert.deepEqual(bareNativeDialogCalls(capabilities), []);
  assert.deepEqual(bareNativeDialogCalls(settings), []);
  assert.doesNotMatch(ui, /编辑联系人标签|data-contact-action=\"tag\"/);
  assert.match(ui, /YanceDialogs\.(?:prompt|confirm)\(/);
  assert.match(dialog, /root\.YanceDialogs = Object\.freeze/);
  assert.ok(index.indexOf('/js/r32-dialog-runtime.js') < index.indexOf('/js/r32-platform-capability-runtime.js'));
});

test('conversation route selector only switches explicit linked conversations and never binds by name or avatar', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const start = ui.indexOf('function strongConversationLinkKeys');
  const end = ui.indexOf('function messageTimeValue', start);
  const routeBlock = ui.slice(start, end);

  assert.match(routeBlock, /canonicalContactId/);
  assert.match(routeBlock, /customerId/);
  assert.match(routeBlock, /conversation:/);
  assert.match(routeBlock, /selectContact\(allowed\.id\)/);
  assert.doesNotMatch(routeBlock, /contact\.name|row\.name|avatar/);
  assert.doesNotMatch(routeBlock, /view:/);
  assert.doesNotMatch(routeBlock, /bind-conversation/);
  assert.match(routeBlock, /platform,profileText\(contact\?\.accountId/);
  assert.match(ui, /messageRouteLabel/);
  assert.match(ui, /samePlatformAccounts\.length<2/);
});

test('capability decisions distinguish protocol support, account connection, target route and conflicts', () => {
  const contact = { platform: 'whatsapp', accountId: 'wa-a', capabilities: { image: true } };
  const ready = capabilityRuntime.actionDecision(contact, 'image', {
    showUnavailable: true,
    requiresAccount: true,
    evaluateRoute: true,
    routeContext: {
      platform: 'whatsapp', sourceAccountId: 'wa-a', sourceAccountIdentity: '+491111',
      accountConnected: true, targetIdentity: '492222@s.whatsapp.net', conflict: ''
    }
  });
  assert.equal(ready.supported, true);
  assert.equal(ready.enabled, true);
  assert.equal(ready.protocol.state, 'supported');
  assert.equal(ready.account.state, 'ready');
  assert.equal(ready.route.state, 'ready');
  assert.match(ready.reason, /当前账号已连接/);

  const missingTarget = capabilityRuntime.actionDecision(contact, 'image', {
    showUnavailable: true,
    requiresAccount: true,
    evaluateRoute: true,
    routeContext: { platform: 'whatsapp', sourceAccountId: 'wa-a', accountConnected: true, targetIdentity: '' }
  });
  assert.equal(missingTarget.enabled, false);
  assert.match(missingTarget.reason, /缺少目标号码、JID 或 Page 身份/);

  const conflict = capabilityRuntime.actionDecision(contact, 'image', {
    showUnavailable: true,
    evaluateRoute: true,
    routeContext: { platform: 'whatsapp', sourceAccountId: 'wa-a', accountConnected: true, targetIdentity: 'x', conflict: 'platform-mismatch' }
  });
  assert.equal(conflict.enabled, false);
  assert.equal(conflict.route.state, 'blocked');
  assert.match(conflict.reason, /路由被阻断/);
});

test('conversation menu is intentionally slim, non-duplicated, and every rendered action has a handler', () => {
  const code = source('frontend/js/r32-conversation-capabilities.js');
  const menuStart = code.indexOf('function buildConversationMenu');
  const bindStart = code.indexOf('function bindNow', menuStart);
  const menu = code.slice(menuStart, bindStart);
  const bind = code.slice(bindStart, code.indexOf('const BIND_REQUIRED_IDS', bindStart));
  const actions = [...menu.matchAll(/data-conv="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(actions, ['search', 'export', 'clear', 'archive']);
  for (const action of actions) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const direct = new RegExp(`data-conv=["']${escaped}["']`);
    assert.ok(direct.test(bind), `missing handler reference for ${action}`);
  }
  assert.match(menu, /搜索当前会话/);
  assert.match(menu, /导出完整聊天记录/);
  assert.match(menu, /清除当前附件与引用/);
  assert.match(menu, /归档会话/);
  assert.doesNotMatch(menu, /静音|标记为已读|查看联系人|编辑备注|媒体、链接及文档|仅显示原文|仅显示中文/);
  assert.match(menu, /hasComposerContext\?/);
});

test('scroll persistence records only user intent and invalidates old pixel-only workspace state', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const runtime = require('../../frontend/js/r32-message-interaction-runtime');
  assert.equal(runtime.normalizeScrollState(88).version, 3);
  assert.match(ui, /messageScrollUserIntentUntil/);
  assert.match(ui, /options\.force!==true&&!messageScrollHasUserIntent\(\)/);
  assert.match(ui, /uiVersion:4/);
  assert.match(ui, /Number\(s\.uiVersion\|\|0\)>=4/);
  assert.match(ui, /\['wheel','touchstart','pointerdown'\]/);
  assert.match(ui, /restoreMessagePositionAfterMediaLayout/);
  const renderStart = ui.indexOf('function renderMessages');
  const renderEnd = ui.indexOf('function stashConversationState', renderStart);
  const renderBlock = ui.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderBlock, /saveMessageScrollState\(/);
  assert.doesNotMatch(renderBlock, /captureMessageScrollState\(/);
});

test('GIF and sticker library never feeds expired remote URLs to image cards or cross-account send routes', () => {
  const service = source('backend/services/expressionLibraryService.js');
  const ui = source('frontend/js/r32-conversation-capabilities.js');
  assert.match(service, /safePreviewUrl/);
  assert.match(service, /localFile \|\| attachment\.filePath/);
  assert.match(service, /旧素材缺少恢复凭证/);
  assert.match(service, /supportedSend: support\.supported && Boolean\(preview\.url\)/);
  assert.doesNotMatch(service, /\^https\?:\\\/\\\//);
  assert.match(ui, /allowHttp:false,allowHttps:false/);
  assert.match(ui, /该素材属于另一个登录账号/);
  assert.match(ui, /素材尚未恢复到本机/);
  assert.match(ui, /当前账号可用素材/);
});

test('dynamic WebP, GIF and video recognition extracts a local representative PNG frame', async () => {
  const originalDiscover = transcription.discoverFfmpeg;
  const originalRun = transcription.runCommand;
  const calls = [];
  transcription.discoverFfmpeg = () => 'fake-ffmpeg';
  transcription.runCommand = async (command, args) => {
    calls.push({ command, args });
    fs.writeFileSync(args.at(-1), Buffer.from('png-frame'));
  };
  try {
    assert.equal(mediaIntelligence.requiresRepresentativeFrame('image', 'image/webp', ''), true);
    assert.equal(mediaIntelligence.requiresRepresentativeFrame('image', 'image/jpeg', ''), false);
    const input = await mediaIntelligence.prepareVisionInput({ buffer: Buffer.from('webp'), mimeType: 'image/webp', kind: 'image' });
    assert.equal(input.mimeType, 'image/png');
    assert.equal(input.buffer.toString(), 'png-frame');
    assert.equal(calls.length, 1);
    assert.match(calls[0].args.join(' '), /-frames:v 1/);
    input.cleanup();
  } finally {
    transcription.discoverFfmpeg = originalDiscover;
    transcription.runCommand = originalRun;
  }
});

test('media analysis shows one friendly error surface and hides raw WhatsApp URLs from media recovery cards', () => {
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(capabilities, /notifyOnce/);
  assert.match(capabilities.slice(capabilities.indexOf("function notify(message"), capabilities.indexOf('function capabilityRows')), /YanceNotificationLayoutAuthority\.show/);
  assert.match(capabilities, /FAILED TO LOAD IMAGE OR AUDIO FILE/);
  assert.match(ui, /friendlyMediaRecoveryError/);
  assert.match(ui, /WhatsApp 原下载凭证已失效/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function mediaRecoveryLabel'), ui.indexOf('function messageVoiceMarkup')), /mmg\.whatsapp\.net.*\$\{/);
  assert.match(ui, /(?:function\s+safeUiText|const\s+safeUiText\s*=)\s*\([^)]*fallback/);
});
