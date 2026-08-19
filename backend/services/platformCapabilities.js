'use strict';

const STATE = Object.freeze({
  SUPPORTED: 'supported',
  PARTIAL: 'partial',
  POLICY: 'policy',
  PERMISSION: 'permission',
  UNSUPPORTED: 'unsupported'
});

function contract(state, route, adapterMethod, note = '', constraints = []) {
  return Object.freeze({
    state,
    route,
    adapterMethod,
    note,
    constraints: Object.freeze(Array.isArray(constraints) ? [...constraints] : [])
  });
}

const CONTRACTS = Object.freeze({
  whatsapp: Object.freeze({
    text: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-text', 'sendText', '真实文本发送'),
    image: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '真实图片发送'),
    video: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '真实视频发送'),
    gif: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '真实 GIF 发送'),
    sticker: contract(STATE.PARTIAL, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '仅发送已转换完成的 WebP 贴纸；PNG/GIF 不会伪装成贴纸', ['真实账号与平台版本仍需 UAT']),
    animatedSticker: contract(STATE.PARTIAL, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '动态 WebP 可接收并识别；发送仅接受预编码 WebP，缺少格式转换', ['前端播放受桌面动画策略控制']),
    lottieSticker: contract(STATE.PARTIAL, 'WhatsApp receive pipeline', 'downloadMediaMessage', 'FutureProof/Lottie 包装会解包并恢复；内层动态 WebP 可播放，原始 TGS/Lottie 当前使用缩略图回退', ['真实账号消息形态仍需 UAT']),
    animatedEmojiDisplay: contract(STATE.PARTIAL, 'renderer', 'animatedEmojiDisplay', '单 Emoji 文本可收发；言策仅为常用表情提供本地轻量动画，不保证与官方客户端完全一致'),
    voice: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '语音发送'),
    file: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-media-stream', 'sendMedia', '文件发送'),
    quote: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-text', 'sendText', '通过 quotedMessageId 发送引用回复', ['被引用消息必须仍可被平台识别']),
    reaction: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/reaction', 'sendReaction', '真实消息回应'),
    revoke: contract(STATE.PARTIAL, 'POST /api/r32/messages/whatsapp/:accountId/revoke', 'revokeMessage', '真实消息撤回', ['仅允许撤回本账号发送的消息', '受 WhatsApp 平台撤回时限约束']),
    readReceipt: contract(STATE.SUPPORTED, 'POST /api/r32/messages/conversations/:conversationId/read', 'markRead', '向平台发送已读回执'),
    typingSend: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/presence', 'sendPresence', '向对方发送“正在输入/暂停输入”状态'),
    incomingTyping: contract(STATE.SUPPORTED, 'WS /events conversation:presence', 'presence.update', '接收并显示对方正在输入状态'),
    terminalPresence: contract(STATE.PARTIAL, 'WS /events conversation:presence', 'presence.update', '接收联系人上线/离线状态并触发提醒', ['受联系人隐私设置、订阅状态和 WhatsApp 会话类型限制', '群聊成员状态不会触发联系人提醒']),
    contacts: contract(STATE.PARTIAL, 'POST /api/r32/accounts/:accountId/sync', 'sync', '联系人与头像按需同步'),
    groups: contract(STATE.SUPPORTED, 'conversation target', 'sendText', '群聊消息能力'),
    proactiveSend: contract(STATE.SUPPORTED, 'POST /api/r32/messages/whatsapp/:accountId/send-text', 'sendText', '主动发送'),
    historySync: contract(STATE.PARTIAL, 'Baileys history append', 'messages.upsert', '受 WhatsApp 历史同步范围限制')
  }),
  telegram: Object.freeze({
    text: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-text', 'sendText'),
    image: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia'),
    video: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia'),
    gif: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia'),
    sticker: contract(STATE.PARTIAL, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia', '普通 WebP 通过通用上传链发送；原生贴纸语义需真实账号确认'),
    animatedSticker: contract(STATE.PARTIAL, 'Telegram receive pipeline', 'downloadMedia', '动态贴纸可识别和缓存；原生 TGS/WebM 发送 API 尚未接入'),
    lottieSticker: contract(STATE.UNSUPPORTED, '', '', 'TGS/Lottie 可被识别但当前渲染器不支持播放'),
    animatedEmojiDisplay: contract(STATE.UNSUPPORTED, '', '', 'Telegram 动态 Emoji 需要专用文档/实体渲染，当前未实现'),
    voice: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia'),
    file: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-media-stream', 'sendMedia'),
    quote: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-text', 'sendText', '通过 replyTo 引用回复'),
    reaction: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/reaction', 'sendReaction'),
    revoke: contract(STATE.PARTIAL, 'POST /api/r32/messages/telegram/:accountId/revoke', 'revokeMessage', '真实撤回', ['受 Telegram 权限与消息时限约束']),
    readReceipt: contract(STATE.SUPPORTED, 'POST /api/r32/messages/conversations/:conversationId/read', 'markRead'),
    typingSend: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/presence', 'sendPresence'),
    incomingTyping: contract(STATE.SUPPORTED, 'GramJS raw UpdateUserTyping/UpdateChatUserTyping', 'attachTypingHandler', '接收 Telegram 对方输入、录音与上传状态'),
    terminalPresence: contract(STATE.PARTIAL, 'GramJS raw UpdateUserStatus', 'attachTypingHandler', '接收联系人上线/离线状态并触发提醒', ['受 Telegram 隐私设置和账号可见范围限制']),
    contacts: contract(STATE.PARTIAL, 'POST /api/r32/accounts/:accountId/sync', 'sync'),
    groups: contract(STATE.SUPPORTED, 'conversation target', 'sendText'),
    proactiveSend: contract(STATE.SUPPORTED, 'POST /api/r32/messages/telegram/:accountId/send-text', 'sendText'),
    historySync: contract(STATE.PARTIAL, 'POST /api/r32/accounts/:accountId/sync', 'sync', '通过 GramJS 分页补拉对话历史消息与媒体', ['同步范围受 Telegram API、账号权限和配置上限约束'])
  }),
  facebook: Object.freeze({
    text: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-text', 'sendText'),
    image: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-media-stream', 'sendMedia'),
    video: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-media-stream', 'sendMedia'),
    gif: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-media-stream', 'sendMedia'),
    sticker: contract(STATE.UNSUPPORTED, '', '', '当前 Graph API 发送链未实现贴纸协议'),
    animatedSticker: contract(STATE.UNSUPPORTED, '', '', '当前 Graph API 发送链未实现动态贴纸协议'),
    lottieSticker: contract(STATE.UNSUPPORTED, '', '', 'Facebook Page Messenger 当前产品范围不提供 Lottie 贴纸'),
    animatedEmojiDisplay: contract(STATE.UNSUPPORTED, '', '', 'Facebook Page Messenger 当前产品范围未实现动态 Emoji'),
    voice: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-media-stream', 'sendMedia'),
    file: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/send-media-stream', 'sendMedia'),
    quote: contract(STATE.UNSUPPORTED, '', '', 'Messenger 当前发送链没有正式引用回复接口'),
    reaction: contract(STATE.UNSUPPORTED, '', '', 'Messenger 当前发送链没有正式消息回应接口'),
    revoke: contract(STATE.UNSUPPORTED, '', '', 'Messenger 当前发送链没有正式撤回接口'),
    readReceipt: contract(STATE.SUPPORTED, 'POST /api/r32/messages/conversations/:conversationId/read', 'markRead'),
    typingSend: contract(STATE.SUPPORTED, 'POST /api/r32/messages/facebook/:accountId/presence', 'sendPresence'),
    incomingTyping: contract(STATE.UNSUPPORTED, '', '', '当前 Webhook 未提供稳定的对方输入状态'),
    terminalPresence: contract(STATE.UNSUPPORTED, '', '', 'Facebook Page Messenger Webhook 不提供稳定的联系人上线/离线状态'),
    contacts: contract(STATE.PARTIAL, 'POST /api/r32/accounts/:accountId/sync', 'sync', '同步 Messenger 实际会话参与者与头像'),
    groups: contract(STATE.UNSUPPORTED, '', '', '当前产品范围不支持 Messenger 群聊'),
    proactiveSend: contract(STATE.POLICY, 'POST /api/r32/messages/facebook/:accountId/send-text', 'sendText', '受 Meta 消息窗口与平台政策限制'),
    historySync: contract(STATE.PARTIAL, 'POST /api/r32/accounts/:accountId/sync', 'sync', '通过 Meta Conversations API 分页补拉 Page 会话与历史消息', ['同步范围受 Page 权限、API 分页和配置上限约束'])
  })
});

function compactValue(item) {
  if (!item) return false;
  if (item.state === STATE.SUPPORTED) return true;
  if (item.state === STATE.PARTIAL) return 'partial';
  if (item.state === STATE.POLICY) return 'policy';
  if (item.state === STATE.PERMISSION) return 'permission';
  return false;
}

const MATRIX = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACTS).map(([platform, capabilities]) => [
    platform,
    Object.freeze(Object.fromEntries(Object.entries(capabilities).map(([name, item]) => [name, compactValue(item)])))
  ])
));

function canonicalOperation(operation) {
  const value = String(operation || '');
  const normalized = value.toLowerCase();
  if (normalized === 'typing') return 'typingSend';
  if (normalized === 'animatedsticker') return 'animatedSticker';
  if (normalized === 'lottiesticker') return 'lottieSticker';
  if (normalized === 'animatedemojidisplay') return 'animatedEmojiDisplay';
  return value;
}

function getContract(platform, operation) {
  return CONTRACTS[String(platform || '').toLowerCase()]?.[canonicalOperation(operation)] || null;
}

function supports(platform, operation) {
  const item = getContract(platform, operation);
  return Boolean(item && [STATE.SUPPORTED, STATE.PARTIAL, STATE.POLICY, STATE.PERMISSION].includes(item.state));
}

function publicContracts(platform = '') {
  if (platform) return CONTRACTS[String(platform || '').toLowerCase()] || {};
  return CONTRACTS;
}


const FACEBOOK_ACCOUNT_CAPABILITIES = Object.freeze({
  page: Object.freeze({
    authority: 'chatwoot-facebook-page',
    sendText: true,
    receive: true,
    attachments: true,
    typing: true,
    readReceipt: true,
    historyBackfill: true
  }),
  'personal-messenger': Object.freeze({
    authority: 'mautrix-meta',
    sendText: true,
    receive: true,
    attachments: true,
    typing: true,
    readReceipt: true,
    historyBackfill: true
  }),
  'personal-identity': Object.freeze({
    authority: 'facebook-identity-oauth',
    sendText: false,
    receive: false,
    attachments: false,
    typing: false,
    readReceipt: false,
    historyBackfill: false
  })
});

function resolveForAccount(account = {}) {
  const platform = String(account.platform || '').trim().toLowerCase();
  if (platform !== 'facebook') return Object.freeze({ authority: `${platform || 'unknown'}-platform-driver`, ...(MATRIX[platform] || {}) });
  const kind = String(account.accountKind || account.metadata?.accountKind || 'page').trim().toLowerCase();
  return FACEBOOK_ACCOUNT_CAPABILITIES[kind] || FACEBOOK_ACCOUNT_CAPABILITIES.page;
}

function mediaCapability(kind) {
  const value = String(kind || 'file').toLowerCase();
  if (value === 'document' || value === 'audio') return value === 'document' ? 'file' : 'voice';
  return canonicalOperation(value);
}

module.exports = { STATE, CONTRACTS, MATRIX, FACEBOOK_ACCOUNT_CAPABILITIES, getContract, publicContracts, resolveForAccount, supports, mediaCapability, canonicalOperation };
