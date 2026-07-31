'use strict';

const fs = require('fs');
const path = require('path');
const { getStore } = require('../repositories/storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const platformCapabilities = require('./platformCapabilities');
const platformDrivers = require('./platformDriverRegistry');
const mediaPipeline = require('./mediaPipeline');

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function normalizedKind(value) {
  const kind = clean(value, 40).toLowerCase();
  return kind === 'sticker' ? 'sticker' : kind === 'gif' ? 'gif' : '';
}
function firstAttachment(payload = {}) {
  const rows = Array.isArray(payload.attachments) ? payload.attachments : [];
  return rows.find(row => row && (row.mediaUrl || row.url || row.localUrl || row.thumbnailDataUrl || row.localFile || row.filePath || row.mediaKey || row.directPath)) || {};
}

function safePreviewUrl(value = '') {
  const url = clean(value, 2000);
  if (/^data:image\//i.test(url)) return url;
  if (/^\/api\/r32\/messages\/media\//i.test(url)) return url;
  return '';
}
function localPreview(row = {}, attachment = {}) {
  const direct = safePreviewUrl(row.mediaUrl || attachment.mediaUrl || attachment.url || attachment.localUrl || attachment.thumbnailDataUrl);
  if (direct) return { url: direct, localCached: true, thumbnailOnly: /^data:image\//i.test(direct) };
  const localFile = clean(attachment.localFile || attachment.filePath || row.mediaPath, 5000);
  if (localFile && fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
    return { url: mediaPipeline.publicUrl(row.accountId, row.sessionKey, path.basename(localFile)), localCached: true, thumbnailOnly: false };
  }
  const thumbnail = safePreviewUrl(attachment.thumbnailDataUrl);
  return { url: thumbnail, localCached: Boolean(thumbnail), thumbnailOnly: Boolean(thumbnail) };
}
function recoveryState(payload = {}, attachment = {}) {
  const status = clean(attachment.downloadStatus || attachment.status || payload.mediaStatus || payload.downloadStatus, 80).toLowerCase();
  const hasEnvelope = Boolean(attachment.mediaKey || attachment.directPath || payload.mediaEnvelope || payload.baileysMediaEnvelope);
  if (hasEnvelope) return { status: status || 'recoverable', recoverable: true, reason: '素材尚未缓存，可从 WhatsApp 重新恢复' };
  return { status: status || 'missing-envelope', recoverable: false, reason: '旧素材缺少恢复凭证，不能继续使用过期下载地址' };
}

function mimeFromName(value = '') {
  const ext = path.extname(String(value || '')).toLowerCase();
  return ({ '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' })[ext] || '';
}
function sendSupport(platform, kind, mimeType) {
  const p = clean(platform, 40).toLowerCase();
  const mime = clean(mimeType, 120).toLowerCase();
  if (kind === 'gif') return { supported: /^(?:image\/gif|video\/mp4|image\/webp)$/.test(mime), reason: 'GIF 需要 GIF、无声 MP4 或可播放 WebP' };
  if (kind !== 'sticker') return { supported: false, reason: '未知素材类型' };
  if (mime === 'image/webp') return { supported: true, reason: '' };
  if (p === 'telegram' && /^(?:video\/webm|application\/x-tgsticker|application\/gzip)$/.test(mime)) {
    return { supported: false, reason: '这是 Telegram 原生动态贴纸；当前通用媒体发送链不会把它伪装成静态贴纸' };
  }
  return { supported: false, reason: '当前发送链只接受真实 WebP 贴纸' };
}

async function recent(input = {}) {
  const platform = clean(input.platform, 40).toLowerCase();
  const accountId = clean(input.accountId, 160);
  const requestedKind = normalizedKind(input.kind);
  const limit = Math.min(120, Math.max(1, Number(input.limit || 60)));
  const where = ["m.message_type IN ('gif','sticker')"];
  const params = [];
  if (platform) { where.push('c.platform=?'); params.push(platform); }
  if (accountId) { where.push('m.account_id=?'); params.push(accountId); }
  if (requestedKind) { where.push('m.message_type=?'); params.push(requestedKind); }
  params.push(limit * 4);
  const rows = getStore().db.prepare(`
    SELECT m.id, m.account_id AS accountId, m.session_key AS sessionKey,
           m.message_type AS messageType, m.media_url AS mediaUrl,
           m.media_path AS mediaPath, m.sent_at AS sentAt, m.payload_json AS payloadJson,
           c.platform, c.title AS conversationTitle
    FROM r32_messages m
    JOIN r32_conversations c ON c.session_key=m.session_key
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(NULLIF(m.sent_at,''),m.created_at) DESC, m.id DESC
    LIMIT ?
  `).all(...params);
  const seen = new Set();
  const items = [];
  let nativeLibrary = { attempted: false, available: false, count: 0, error: '' };
  if (platform === 'telegram' && requestedKind) {
    nativeLibrary.attempted = true;
    try {
      const native = await platformDrivers.call('telegram', 'listNativeExpressions', accountId, requestedKind, { limit: Math.min(limit, 32) });
      for (const item of Array.isArray(native?.items) ? native.items : []) {
        const signature = `${item.kind}
${item.url}`;
        if (!item.url || seen.has(signature)) continue;
        seen.add(signature);
        items.push(item);
        if (items.length >= limit) break;
      }
      nativeLibrary = { attempted: true, available: true, count: items.length, error: '' };
    } catch (error) {
      nativeLibrary = { attempted: true, available: false, count: 0, error: clean(error.code || error.message || error, 240) };
    }
  }
  for (const row of rows) {
    if (items.length >= limit) break;
    const payload = parseJson(row.payloadJson, {}) || {};
    const attachment = firstAttachment(payload);
    const kind = normalizedKind(row.messageType || payload.type || attachment.kind);
    if (!kind) continue;
    const preview = localPreview(row, attachment);
    const recovery = recoveryState(payload, attachment);
    const mimeType = clean(attachment.mimeType || attachment.mimetype || payload.mimeType || mimeFromName(attachment.filename || row.mediaPath || preview.url), 120) || (kind === 'sticker' ? 'image/webp' : 'image/gif');
    const signature = `${kind}\n${preview.url || row.id}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const support = sendSupport(row.platform || platform, kind, mimeType);
    const sentLabel = row.sentAt ? String(row.sentAt).slice(0, 10) : '历史消息';
    const title = `${kind === 'sticker' ? '贴纸' : 'GIF'} · ${sentLabel}`;
    items.push({
      id: `platform:${row.id}`,
      source: 'platform-history',
      kind,
      label: title,
      name: clean(attachment.filename, 260) || `${kind}-${row.id}`,
      keywords: `${title} ${row.platform || platform} ${kind}`,
      url: preview.url,
      previewUrl: preview.url,
      mimeType,
      platform: row.platform || platform,
      accountId: row.accountId,
      sentAt: row.sentAt,
      supportedSend: support.supported && Boolean(preview.url) && preview.thumbnailOnly !== true,
      supportReason: preview.url ? (preview.thumbnailOnly ? '当前只有缩略图，尚未恢复真实素材文件' : support.reason) : recovery.reason,
      status: preview.url ? (preview.thumbnailOnly ? 'thumbnail-only' : 'ready') : recovery.status,
      recoverable: recovery.recoverable,
      localCached: preview.localCached === true,
      sourceConversationId: row.sessionKey,
      sourceMessageId: row.id,
      animated: attachment.isAnimated === true || attachment.isAnimatedSticker === true || /(?:webm|tgsticker|gif)/i.test(mimeType)
    });
    if (items.length >= limit) break;
  }
  const contracts = platform ? platformCapabilities.publicContracts(platform) : {};
  const selectContract = name => {
    const row = contracts?.[name] || null;
    return row ? { state: row.state, note: row.note || '', constraints: row.constraints || [] } : null;
  };
  return {
    items,
    count: items.length,
    platform,
    accountId,
    kind: requestedKind,
    capability: requestedKind ? selectContract(requestedKind) : null,
    capabilities: {
      gif: selectContract('gif'),
      sticker: selectContract('sticker'),
      animatedSticker: selectContract('animatedSticker'),
      lottieSticker: selectContract('lottieSticker'),
      animatedEmojiDisplay: selectContract('animatedEmojiDisplay')
    },
    sources: {
      platformHistory: true,
      localImport: true,
      nativePackBrowser: platform === 'telegram' && nativeLibrary.available,
      nativeLibrary,
      note: platform === 'telegram'
        ? (nativeLibrary.available
          ? `已接入 Telegram ${requestedKind === 'gif' ? '已保存 GIF' : '最近贴纸'}的账号会话内原生发送；TGS 可发送但桌面端当前只显示格式图标，WebM 使用视频预览。`
          : 'Telegram 原生素材读取当前不可用，已回退到真实聊天历史和本地收藏。')
        : platform === 'whatsapp'
          ? '当前显示真实聊天历史和本地收藏；WhatsApp 原生贴纸收藏/最近使用目录尚未接入。'
          : '当前显示真实聊天历史和本地收藏；平台原生素材目录尚未接入。'
    }
  };
}

module.exports = { recent, sendSupport };
