'use strict';

const crypto = require('crypto');
const { looksLikeRawJid, normalizePhone } = require('./whatsappIdentity');
const { serializeBaileysMessageInfo } = require('./whatsappMediaEnvelope');

const clean = (value, max = 12000) => String(value ?? '').trim().slice(0, max);

function unwrap(message = {}, depth = 0) {
  if (!message || typeof message !== 'object' || depth > 12) return message || {};
  const inner =
    message.deviceSentMessage?.message ||
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message ||
    // WhatsApp wraps some animated stickers/emoji as FutureProofMessage. The inner
    // message is a normal stickerMessage and must follow the regular media path.
    message.lottieStickerMessage?.message;
  return inner ? unwrap(inner, depth + 1) : message;
}

function deviceSentDestination(message = {}, depth = 0) {
  if (!message || typeof message !== 'object' || depth > 12) return '';
  const direct = clean(message.deviceSentMessage?.destinationJid, 300).toLowerCase();
  if (direct) return direct.replace(/@c\.us$/i, '@s.whatsapp.net');
  const inner =
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message ||
    message.lottieStickerMessage?.message;
  return inner ? deviceSentDestination(inner, depth + 1) : '';
}


function binaryToken(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return clean(value, 2000);
}

function mobileMediaFingerprint(info = {}, jid = '', type = '') {
  if (info.key?.fromMe !== true || !deviceSentDestination(info.message || {})) return '';
  const message = unwrap(info.message || {});
  const node = message.audioMessage || message.imageMessage || message.videoMessage || message.stickerMessage || message.documentMessage || null;
  if (!node) return '';
  const strong = [node.directPath, node.url, binaryToken(node.fileSha256), binaryToken(node.fileEncSha256), binaryToken(node.mediaKey)].filter(Boolean);
  if (!strong.length) return '';
  const rawTimestamp = typeof info.messageTimestamp === 'object' && typeof info.messageTimestamp?.toNumber === 'function'
    ? info.messageTimestamp.toNumber()
    : Number(info.messageTimestamp || 0);
  return crypto.createHash('sha256').update(JSON.stringify({ jid, type, timestamp: rawTimestamp, strong })).digest('hex');
}

function timestampIso(value) {
  const raw = typeof value === 'object' && value !== null && typeof value.toNumber === 'function' ? value.toNumber() : Number(value || 0);
  if (!raw) return new Date().toISOString();
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function extractContext(message = {}) {
  const value = unwrap(message);
  const nodes = [
    value.extendedTextMessage,
    value.imageMessage,
    value.videoMessage,
    value.audioMessage,
    value.documentMessage,
    value.stickerMessage,
    value.lottieStickerMessage
  ].filter(Boolean);
  return nodes.map(node => node.contextInfo).find(Boolean) || null;
}

function compactText(message = {}) {
  const value = unwrap(message);
  return clean(
    value.conversation ||
    value.extendedTextMessage?.text ||
    value.imageMessage?.caption ||
    value.videoMessage?.caption ||
    value.documentMessage?.caption ||
    value.contactMessage?.displayName ||
    '',
    12000
  ) || (
    value.lottieStickerMessage ? 'Lottie动态贴纸' :
    value.stickerMessage ? '贴纸' :
    value.imageMessage ? '图片' :
    value.videoMessage ? (value.videoMessage.gifPlayback ? 'GIF' : '视频') :
    value.audioMessage ? (value.audioMessage.ptt ? '语音' : '音频') :
    value.documentMessage ? '文件' : '消息'
  );
}

function quoted(message = {}) {
  const context = extractContext(message);
  if (!context?.stanzaId) return null;
  return {
    id: clean(context.stanzaId, 300),
    sender: clean(context.participant || context.remoteJid, 300),
    text: compactText(context.quotedMessage || {})
  };
}

function thumbnailDataUrl(node = {}) {
  if (Buffer.isBuffer(node.jpegThumbnail) || node.jpegThumbnail instanceof Uint8Array) {
    return `data:image/jpeg;base64,${Buffer.from(node.jpegThumbnail).toString('base64')}`;
  }
  if (Buffer.isBuffer(node.pngThumbnail) || node.pngThumbnail instanceof Uint8Array) {
    return `data:image/png;base64,${Buffer.from(node.pngThumbnail).toString('base64')}`;
  }
  return '';
}

function waveformData(node = {}) {
  const waveform = node.waveform;
  if (Buffer.isBuffer(waveform) || waveform instanceof Uint8Array) return Buffer.from(waveform).toString('base64');
  return '';
}

function attachmentDescriptor(kind, node = {}, metadata = {}) {
  const mimeType = clean(node.mimetype || node.mimeType, 160);
  const lottie = kind === 'sticker' && (node.isLottie === true || /tgsticker|lottie|gzip/i.test(mimeType));
  const animatedSticker = kind === 'sticker' && (node.isAnimated === true || lottie);
  return {
    kind,
    mediaType: kind,
    mimeType,
    filename: clean(node.fileName || node.filename, 500),
    size: Number(node.fileLength || node.size || 0) || 0,
    width: Number(node.width || 0) || 0,
    height: Number(node.height || 0) || 0,
    duration: Number(node.seconds || 0) || 0,
    gifPlayback: kind === 'gif',
    isSticker: kind === 'sticker',
    isAnimated: animatedSticker,
    isAnimatedSticker: animatedSticker,
    stickerFormat: lottie ? 'lottie' : (kind === 'sticker' ? 'webp' : ''),
    waveformBase64: waveformData(node),
    downloadStatus: 'pending',
    thumbnailDataUrl: thumbnailDataUrl(node),
    ...metadata
  };
}

function payload(info = {}) {
  const message = unwrap(info.message || {});
  const mediaEnvelope = serializeBaileysMessageInfo(info);
  if (message.conversation) return { type: 'text', text: clean(message.conversation), attachments: [] };
  if (message.extendedTextMessage?.text) return { type: 'text', text: clean(message.extendedTextMessage.text), attachments: [] };
  if (message.imageMessage) return { type: 'image', text: clean(message.imageMessage.caption) || '对方发送了一张图片', mediaMessage: message, attachments: [attachmentDescriptor('image', message.imageMessage, { mediaEnvelope })] };
  if (message.videoMessage) {
    const type = message.videoMessage.gifPlayback ? 'gif' : 'video';
    return { type, text: clean(message.videoMessage.caption) || (type === 'gif' ? '对方发送了一个 GIF' : '对方发送了一段视频'), mediaMessage: message, attachments: [attachmentDescriptor(type, message.videoMessage, { mediaEnvelope })] };
  }
  if (message.audioMessage) {
    const type = message.audioMessage.ptt ? 'voice' : 'audio';
    return { type, text: type === 'voice' ? '对方发送了一条语音' : '对方发送了一个音频文件', mediaMessage: message, attachments: [attachmentDescriptor(type, message.audioMessage, { mediaEnvelope })] };
  }
  if (message.documentMessage) return { type: 'document', text: clean(message.documentMessage.caption) || `对方发送了一个文件${message.documentMessage.fileName ? `：${message.documentMessage.fileName}` : ''}`, mediaMessage: message, attachments: [attachmentDescriptor('document', message.documentMessage, { mediaEnvelope })] };
  if (message.lottieStickerMessage) return { type: 'sticker', text: '对方发送了一个动态贴纸', mediaMessage: message, attachments: [attachmentDescriptor('sticker', message.lottieStickerMessage, { mediaEnvelope, stickerFormat: 'lottie', isAnimated: true, isAnimatedSticker: true, renderable: true, downloadable: true, supportState: 'recoverable' })] };
  if (message.stickerMessage) return { type: 'sticker', text: message.stickerMessage.isAnimated || message.stickerMessage.isLottie ? '对方发送了一个动态贴纸' : '对方发送了一个贴纸', mediaMessage: message, attachments: [attachmentDescriptor('sticker', message.stickerMessage, { mediaEnvelope })] };
  if (message.contactMessage) return { type: 'contact', text: clean(message.contactMessage.displayName) ? `对方发送了一张联系人名片：${clean(message.contactMessage.displayName)}` : '对方发送了一张联系人名片', attachments: [] };
  if (message.contactsArrayMessage) return { type: 'contacts', text: '对方发送了联系人名片', attachments: [] };
  if (message.locationMessage || message.liveLocationMessage) return { type: 'location', text: '对方发送了一个位置', attachments: [] };
  if (message.reactionMessage) return { type: 'reaction', text: clean(message.reactionMessage.text, 32), targetId: clean(message.reactionMessage.key?.id, 300), attachments: [] };
  const protocolType = String(message.protocolMessage?.type ?? '').toUpperCase();
  const revoke = message.protocolMessage?.key?.id && (message.protocolMessage.type === 0 || protocolType === 'REVOKE' || protocolType === 'MESSAGE_REVOKE');
  if (revoke) return { type: 'revoke', text: '一条消息已被撤回', targetId: clean(message.protocolMessage.key.id, 300), attachments: [] };
  if (message.protocolMessage || message.senderKeyDistributionMessage) return { type: 'protocol', ignored: true, text: '', attachments: [] };
  return { type: 'unknown', text: '对方发送了一条暂不支持的消息', attachments: [] };
}

function stableJid(info = {}) {
  const key = info.key || {};
  const deviceDestination = key.fromMe === true ? deviceSentDestination(info.message || {}) : '';
  const primary = clean(deviceDestination || key.remoteJid || info.remoteJid || info.chatJid, 300).toLowerCase();
  const alternate = clean(key.remoteJidAlt || info.remoteJidAlt || info.senderPn, 300).toLowerCase();
  // Baileys can expose a private LID as remoteJid and the real phone-number JID as remoteJidAlt.
  // Persist the phone-number JID as the canonical conversation key whenever it is available.
  if (primary.endsWith('@lid') && /@(?:s\.whatsapp\.net|c\.us)$/i.test(alternate)) return alternate.replace(/@c\.us$/i, '@s.whatsapp.net');
  return primary || alternate;
}

function readableSender(info = {}, jid = '') {
  for (const value of [info.pushName, info.verifiedBizName, info.name]) {
    const text = clean(value, 180);
    if (text && !looksLikeRawJid(text)) return text;
  }
  const phone = normalizePhone(jid);
  return phone ? `+${phone}` : 'WhatsApp 联系人';
}

function normalizeIncoming({ accountId, info, source = 'baileys-live' }) {
  const jid = stableJid(info);
  const data = payload(info);
  if (!jid || data.ignored) return null;
  const fromMe = info.key?.fromMe === true;
  if (fromMe) {
    const outboundLabels = new Map([
      ['对方发送了一张图片', '你发送了一张图片'],
      ['对方发送了一个 GIF', '你发送了一个 GIF'],
      ['对方发送了一段视频', '你发送了一段视频'],
      ['对方发送了一条语音', '你发送了一条语音'],
      ['对方发送了一个音频文件', '你发送了一个音频文件'],
      ['对方发送了一个动态贴纸', '你发送了一个动态贴纸'],
      ['对方发送了一个贴纸', '你发送了一个贴纸'],
      ['对方发送了一张联系人名片', '你发送了一张联系人名片'],
      ['对方发送了联系人名片', '你发送了联系人名片'],
      ['对方发送了一个位置', '你发送了一个位置'],
      ['对方发送了一条暂不支持的消息', '你发送了一条暂不支持的消息']
    ]);
    data.text = outboundLabels.get(data.text) || data.text;
  }
  const at = timestampIso(info.messageTimestamp);
  const id = clean(info.key?.id, 300) || crypto.createHash('sha256').update(`${accountId}\n${jid}\n${at}\n${data.text}`).digest('hex');
  const transportFingerprint = mobileMediaFingerprint(info, jid, data.type);
  const direction = fromMe ? 'outbound' : 'inbound';
  const row = {
    schemaVersion: 1,
    id,
    externalMessageId: id,
    dedupeKey: transportFingerprint ? `${accountId}:${jid}:mobile-media:${transportFingerprint}` : `${accountId}:${jid}:${id}`,
    accountId: clean(accountId, 120),
    conversationId: `${clean(accountId, 120)}:${jid}`,
    chatJid: jid,
    direction,
    fromMe,
    sender: fromMe ? 'me' : readableSender(info, jid),
    senderName: fromMe ? '' : readableSender(info, jid),
    type: data.type,
    text: data.text,
    timestamp: at,
    attachments: data.attachments || [],
    quoted: quoted(info.message || {}),
    targetId: data.targetId || '',
    status: fromMe ? 'sent' : 'received',
    source,
    rawMeta: {
      messageType: data.type,
      participant: clean(info.key?.participant, 300),
      remoteJid: clean(info.key?.remoteJid || info.remoteJid || jid, 300).toLowerCase(),
      remoteJidAlt: clean(info.key?.remoteJidAlt || info.remoteJidAlt || info.senderPn, 300).toLowerCase(),
      canonicalJid: jid,
      deviceSent: Boolean(info.message?.deviceSentMessage),
      deviceSentDestination: deviceSentDestination(info.message || {}),
      transportDedupeKey: transportFingerprint
    }
  };
  return row;
}

module.exports = { unwrap, deviceSentDestination, mobileMediaFingerprint, payload, quoted, compactText, timestampIso, stableJid, readableSender, normalizeIncoming, attachmentDescriptor };
