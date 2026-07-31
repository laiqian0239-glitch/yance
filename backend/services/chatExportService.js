'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const messageRepository = require('../repositories/messageRepository');

const MAX_EXPORT_MESSAGES = 250000;
const MAX_EXPORT_BYTES = 128 * 1024 * 1024;

function clean(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function html(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function safeBasename(value = '') {
  const normalized = clean(value).replace(/\\/g, '/').split(/[?#]/, 1)[0];
  if (!normalized) return '';
  return path.posix.basename(normalized).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
}

function safeFileStem(value = '') {
  let stem = clean(value, 'Conversation').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  if (!stem) stem = 'Conversation';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `Chat-${stem}`;
  return stem;
}

function normalizeTimestamp(value) {
  const raw = clean(value);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw.slice(0, 80) : date.toISOString();
}

function displayTimestamp(value) {
  const iso = normalizeTimestamp(value);
  if (!iso) return '时间未知';
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function dateKey(value) {
  const iso = normalizeTimestamp(value);
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '时间未知';
}

function isOutbound(message = {}) {
  const direction = clean(message.direction).toLowerCase();
  const role = clean(message.role).toLowerCase();
  return message.fromMe === true || ['outbound', 'outgoing', 'sent'].includes(direction) || ['assistant', 'me', 'self'].includes(role);
}

function messageTypeLabel(type) {
  const value = clean(type, 'text').toLowerCase();
  return ({
    text: '文字', image: '图片', photo: '图片', video: '视频', audio: '音频', voice: '语音',
    document: '文件', file: '文件', sticker: '贴纸', gif: 'GIF', location: '位置',
    contact: '联系人', revoke: '已撤回消息', system: '系统消息'
  })[value] || value.slice(0, 40);
}

function first(source, paths) {
  for (const keys of paths) {
    let current = source;
    for (const key of keys) current = current && typeof current === 'object' ? current[key] : undefined;
    if (current !== undefined && current !== null && clean(current)) return current;
  }
  return '';
}

function attachmentSummary(message = {}) {
  const fileName = safeBasename(first(message, [
    ['fileName'], ['filename'], ['name'], ['media', 'fileName'], ['media', 'filename'],
    ['attachment', 'fileName'], ['attachment', 'filename'], ['mediaPath']
  ]));
  const mimeType = clean(first(message, [
    ['mimeType'], ['mimetype'], ['media', 'mimeType'], ['media', 'mimetype'], ['attachment', 'mimeType']
  ])).slice(0, 120);
  const rawBytes = Number(first(message, [
    ['bytes'], ['size'], ['fileSize'], ['media', 'bytes'], ['media', 'size'], ['attachment', 'bytes']
  ]));
  const bytes = Number.isFinite(rawBytes) && rawBytes >= 0 ? Math.trunc(rawBytes) : 0;
  return fileName || mimeType || bytes ? { fileName, mimeType, bytes } : null;
}

function normalizeReactions(value) {
  if (!Array.isArray(value)) return [];
  const counts = new Map();
  for (const row of value) {
    const emoji = clean(typeof row === 'string' ? row : row?.emoji).slice(0, 16);
    if (!emoji) continue;
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  }
  return Array.from(counts, ([emoji, count]) => ({ emoji, count })).slice(0, 30);
}

function normalizeExportMessage(message = {}, conversation = {}) {
  const outbound = isOutbound(message);
  const revoked = message.revoked === true || clean(message.messageType || message.type).toLowerCase() === 'revoke';
  const type = clean(message.messageType || message.type, 'text');
  const visibleText = clean(message.text || message.caption || message.body);
  const sender = outbound
    ? '我'
    : (clean(first(message, [['senderName'], ['pushName'], ['authorName'], ['fromName']])) || clean(conversation.title || '对方')).slice(0, 120);
  return Object.freeze({
    timestamp: normalizeTimestamp(message.sentAt || message.timestamp || message.createdAt),
    sender,
    outbound,
    type,
    typeLabel: messageTypeLabel(type),
    text: revoked ? '一条消息已被撤回' : visibleText,
    attachment: attachmentSummary(message),
    deliveryStatus: clean(message.deliveryStatus || message.status).slice(0, 80),
    quoted: Boolean(clean(message.quotedMessageId) || message.quoted),
    reactions: normalizeReactions(message.reactions),
    revoked
  });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderMessage(message) {
  const attachment = message.attachment;
  const details = [];
  if (message.quoted) details.push('引用消息');
  if (attachment?.fileName) details.push(`附件：${attachment.fileName}`);
  if (attachment?.mimeType) details.push(attachment.mimeType);
  if (attachment?.bytes) details.push(formatBytes(attachment.bytes));
  if (message.deliveryStatus) details.push(`状态：${message.deliveryStatus}`);
  const reactions = message.reactions.length
    ? `<div class="reactions">${message.reactions.map(item => `<span>${html(item.emoji)}${item.count > 1 ? ` ×${item.count}` : ''}</span>`).join('')}</div>`
    : '';
  const text = message.text || (attachment ? `[${message.typeLabel}]` : `[${message.typeLabel}]`);
  return `<article class="message ${message.outbound ? 'outbound' : 'inbound'}">
    <div class="message-head"><strong>${html(message.sender)}</strong><time datetime="${html(message.timestamp)}">${html(displayTimestamp(message.timestamp))}</time></div>
    <div class="message-body">${html(text)}</div>
    ${details.length ? `<div class="message-meta">${details.map(html).join(' · ')}</div>` : ''}
    ${reactions}
  </article>`;
}

function renderTranscript({ conversation, messages, generatedAt }) {
  const groups = [];
  let current = null;
  for (const message of messages) {
    const key = dateKey(message.timestamp);
    if (!current || current.key !== key) {
      current = { key, messages: [] };
      groups.push(current);
    }
    current.messages.push(message);
  }
  const firstAt = messages[0]?.timestamp || '';
  const lastAt = messages.at(-1)?.timestamp || '';
  const title = clean(conversation.title || conversation.contactName || conversation.id, '未命名会话').slice(0, 160);
  const platform = clean(conversation.platform, 'unknown').slice(0, 40);
  const groupHtml = groups.length
    ? groups.map(group => `<section class="day"><h2>${html(group.key)}</h2>${group.messages.map(renderMessage).join('\n')}</section>`).join('\n')
    : '<section class="empty">该会话当前没有可导出的消息。</section>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${html(title)} · 言策聊天记录</title>
<style>
:root{color-scheme:light dark;font-family:Inter,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f4f6f8;color:#17202a}
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17202a}.page{max-width:920px;margin:0 auto;padding:32px 18px 60px}
header{background:#fff;border:1px solid #dce3e8;border-radius:18px;padding:24px;box-shadow:0 8px 28px rgba(22,34,45,.08)}
h1{margin:0 0 8px;font-size:26px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:18px}.summary div{background:#f6f8fa;border-radius:10px;padding:10px 12px}.summary span{display:block;color:#66727c;font-size:12px}.summary b{display:block;margin-top:4px;word-break:break-word}
.notice{margin:18px 0;padding:12px 14px;border-radius:10px;background:#fff6d8;border:1px solid #ead48a;color:#604d08}.day{margin-top:26px}.day h2{position:sticky;top:8px;width:max-content;margin:0 auto 14px;padding:6px 12px;border-radius:999px;background:#dfe7ed;color:#3c4b56;font-size:13px;font-weight:600}
.message{max-width:78%;margin:10px 0;padding:12px 14px;border-radius:16px;border:1px solid #dbe3e8;background:#fff;box-shadow:0 3px 12px rgba(22,34,45,.05)}.message.outbound{margin-left:auto;background:#dff6ee;border-color:#bde6d9}.message-head{display:flex;gap:12px;align-items:baseline;justify-content:space-between;color:#53616b;font-size:12px}.message-head strong{color:#1c2830;font-size:13px}.message-head time{white-space:nowrap}.message-body{margin-top:7px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}.message-meta{margin-top:8px;color:#6b7780;font-size:12px;overflow-wrap:anywhere}.reactions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.reactions span{border:1px solid #ccd7dd;border-radius:999px;background:#fff;padding:2px 8px;font-size:12px}.empty{margin-top:26px;padding:30px;text-align:center;background:#fff;border:1px solid #dce3e8;border-radius:16px;color:#66727c}
footer{margin-top:34px;color:#68757f;font-size:12px;line-height:1.6;text-align:center}
@media(max-width:640px){.page{padding:16px 10px 40px}.message{max-width:92%}.message-head{display:block}.message-head time{display:block;margin-top:3px}}
@media(prefers-color-scheme:dark){:root,body{background:#10161b;color:#e5edf2}header,.message,.empty{background:#172027;border-color:#30404a}.message.outbound{background:#173a32;border-color:#2c5a4e}.summary div{background:#202b33}.summary span,.message-head,.message-meta,footer,.empty{color:#a9b7c0}.message-head strong{color:#eef5f8}.day h2{background:#273640;color:#d8e4ea}.notice{background:#3b3117;border-color:#6d5a21;color:#f0d98b}.reactions span{background:#1b252c;border-color:#3b4a54}}
@media print{body{background:#fff}.page{max-width:none;padding:0}header,.message{box-shadow:none}.day h2{position:static}.notice{break-inside:avoid}.message{break-inside:avoid}}
</style>
</head>
<body><main class="page">
<header>
  <h1>${html(title)}</h1>
  <p>言策一键导出的完整聊天记录</p>
  <div class="summary">
    <div><span>平台</span><b>${html(platform)}</b></div>
    <div><span>消息数量</span><b>${messages.length}</b></div>
    <div><span>开始时间</span><b>${html(displayTimestamp(firstAt))}</b></div>
    <div><span>结束时间</span><b>${html(displayTimestamp(lastAt))}</b></div>
    <div><span>导出时间</span><b>${html(displayTimestamp(generatedAt))}</b></div>
  </div>
</header>
<div class="notice">这是离线只读记录。媒体文件未嵌入；仅显示可见文件名和类型。原聊天、数据库和附件不会因导出而改变。</div>
${groupHtml}
<footer>本文件不包含登录凭据、Cookie、API会话、数据库原始字段、完整本地路径或媒体访问令牌。</footer>
</main></body></html>`;
}

function createChatExportService(options = {}) {
  const repository = options.messageRepository || messageRepository;
  const clock = options.now || (() => new Date().toISOString());

  function createConversationExport(conversationId) {
    const id = clean(conversationId);
    if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) {
      const error = new Error('会话标识无效');
      error.code = 'CHAT_EXPORT_CONVERSATION_ID_INVALID';
      error.status = 400;
      throw error;
    }
    const conversation = repository.getConversation(id);
    if (!conversation) {
      const error = new Error('找不到要导出的会话');
      error.code = 'CONVERSATION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const rawMessages = repository.listMessagesForExport(id, { limit: MAX_EXPORT_MESSAGES + 1 });
    if (rawMessages.length > MAX_EXPORT_MESSAGES) {
      const error = new Error(`聊天记录超过单次导出上限（${MAX_EXPORT_MESSAGES}条）`);
      error.code = 'CHAT_EXPORT_MESSAGE_LIMIT_EXCEEDED';
      error.status = 413;
      throw error;
    }
    const generatedAt = normalizeTimestamp(clock()) || new Date().toISOString();
    const messages = rawMessages.map(message => normalizeExportMessage(message, conversation));
    const content = renderTranscript({ conversation, messages, generatedAt });
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_EXPORT_BYTES) {
      const error = new Error('聊天记录导出文件超过128MB，请缩小导出范围');
      error.code = 'CHAT_EXPORT_FILE_TOO_LARGE';
      error.status = 413;
      throw error;
    }
    const stamp = generatedAt.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
    const fileName = `Yance-Chat-${safeFileStem(conversation.title || conversation.contactName || id)}-${stamp}.html`;
    return Object.freeze({
      ok: true,
      fileName,
      mimeType: 'text/html; charset=utf-8',
      encoding: 'utf8',
      content,
      contentBytes,
      sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      messageCount: messages.length,
      generatedAt,
      conversation: Object.freeze({ title: clean(conversation.title || conversation.contactName || id), platform: clean(conversation.platform) })
    });
  }

  return Object.freeze({ createConversationExport });
}

module.exports = {
  MAX_EXPORT_MESSAGES,
  MAX_EXPORT_BYTES,
  createChatExportService,
  createConversationExport: createChatExportService().createConversationExport,
  normalizeExportMessage,
  renderTranscript,
  safeFileStem
};
