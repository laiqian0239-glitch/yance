'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG, PATHS } = require('../config');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { reconstructBaileysMessageInfo } = require('./whatsappMediaEnvelope');
const { unwrap, stableJid } = require('./messageNormalizer');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safePart(value, fallback = 'item') {
  return String(value ?? '').trim().slice(0, 180).replace(/\.{2,}/g, '_').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || fallback;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function isAnimatedWebp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return false;
  return buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'));
}
function extension(mimeType = '', kind = '') {
  const mime = String(mimeType || '').toLowerCase().split(';')[0];
  if (mime === 'application/x-tgsticker' || mime === 'application/gzip') return 'tgs';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'image/webp' || kind === 'sticker') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'video/mp4' || kind === 'gif' || kind === 'video') return 'mp4';
  if (mime === 'audio/ogg' || kind === 'voice') return 'ogg';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'application/pdf') return 'pdf';
  return (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '') || 'bin';
}

function mediaDirectory(accountId, conversationId) {
  const dir = path.join(PATHS.media, safePart(accountId, 'account'), safePart(conversationId, 'conversation'));
  ensureDir(dir);
  return dir;
}

function publicUrl(accountId, conversationId, fileName) {
  return `/api/r32/messages/media/${encodeURIComponent(safePart(accountId))}/${encodeURIComponent(safePart(conversationId))}/${encodeURIComponent(fileName)}`;
}

function verifyBuffer(buffer, maxBytes = CONFIG.mediaMaxBytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Object.assign(new Error('媒体内容为空'), { code: 'MEDIA_EMPTY' });
  if (buffer.length > maxBytes) throw Object.assign(new Error(`媒体超过大小限制（${Math.round(maxBytes / 1024 / 1024)}MB）`), { code: 'MEDIA_TOO_LARGE' });
}

function mediaFailureRetryable(error = {}) {
  const code = String(error?.code || error?.message || error || '').toUpperCase();
  return !/(MEDIA_TOO_LARGE|MEDIA_EMPTY|MEDIA_HASH_MISMATCH|MEDIA_ENVELOPE_MISSING|BAILEYS_DOWNLOAD_MEDIA_UNAVAILABLE|UNSUPPORTED)/u.test(code);
}

function verifyFile(file, maxBytes = CONFIG.mediaMaxBytes) {
  const resolved = path.resolve(String(file || ''));
  let stat;
  try { stat = fs.statSync(resolved); } catch (_) { throw Object.assign(new Error('媒体文件不存在'), { code: 'MEDIA_FILE_MISSING' }); }
  if (!stat.isFile() || stat.size === 0) throw Object.assign(new Error('媒体内容为空'), { code: 'MEDIA_EMPTY' });
  if (stat.size > maxBytes) throw Object.assign(new Error(`媒体超过大小限制（${Math.round(maxBytes / 1024 / 1024)}MB）`), { code: 'MEDIA_TOO_LARGE' });
  return { file: resolved, bytes: stat.size };
}

function saveBuffer({ accountId, conversationId, messageId, buffer, descriptor = {} }) {
  verifyBuffer(buffer);
  const digest = sha256(buffer);
  const ext = extension(descriptor.mimeType, descriptor.kind);
  const fileName = `${safePart(messageId, 'message')}-${digest.slice(0, 20)}.${ext}`;
  const dir = mediaDirectory(accountId, conversationId);
  const fullPath = path.join(dir, fileName);
  if (!fs.existsSync(fullPath)) {
    const tmp = `${fullPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, fullPath);
  }
  const animated = descriptor.renderable !== false && descriptor.kind === 'sticker' && String(descriptor.mimeType || '').toLowerCase().startsWith('image/webp') && isAnimatedWebp(buffer);
  const row = {
    ...descriptor,
    size: buffer.length,
    fileHash: digest,
    localFile: fullPath,
    mediaUrl: publicUrl(accountId, conversationId, fileName),
    url: publicUrl(accountId, conversationId, fileName),
    isAnimated: descriptor.isAnimated === true || animated,
    isAnimatedSticker: descriptor.isAnimatedSticker === true || animated,
    downloadStatus: 'ready',
    cachedAt: new Date().toISOString()
  };
  eventBus.publish('media:ready', { accountId, conversationId, messageId, attachment: row });
  return row;
}

function saveFile({ accountId, conversationId, messageId, filePath, descriptor = {}, expectedSha256 = '' }) {
  const verified = verifyFile(filePath);
  const digest = sha256File(verified.file);
  if (expectedSha256 && digest !== expectedSha256) throw Object.assign(new Error('媒体文件校验失败'), { code: 'MEDIA_HASH_MISMATCH' });
  const ext = extension(descriptor.mimeType, descriptor.kind);
  const fileName = `${safePart(messageId, 'message')}-${digest.slice(0, 20)}.${ext}`;
  const dir = mediaDirectory(accountId, conversationId);
  const fullPath = path.join(dir, fileName);
  if (!fs.existsSync(fullPath)) {
    const tmp = `${fullPath}.${process.pid}.tmp`;
    fs.copyFileSync(verified.file, tmp, fs.constants.COPYFILE_EXCL);
    fs.renameSync(tmp, fullPath);
  }
  let animated = false;
  if (descriptor.renderable !== false && descriptor.kind === 'sticker' && String(descriptor.mimeType || '').toLowerCase().startsWith('image/webp')) {
    const previewSize = Math.min(8 * 1024 * 1024, verified.bytes);
    const fd = fs.openSync(verified.file, 'r');
    try {
      const preview = Buffer.alloc(previewSize);
      fs.readSync(fd, preview, 0, preview.length, 0);
      animated = isAnimatedWebp(preview);
    } finally { fs.closeSync(fd); }
  }
  const row = {
    ...descriptor,
    size: verified.bytes,
    fileHash: digest,
    localFile: fullPath,
    mediaUrl: publicUrl(accountId, conversationId, fileName),
    url: publicUrl(accountId, conversationId, fileName),
    isAnimated: descriptor.isAnimated === true || animated,
    isAnimatedSticker: descriptor.isAnimatedSticker === true || animated,
    downloadStatus: 'ready',
    cachedAt: new Date().toISOString()
  };
  eventBus.publish('media:ready', { accountId, conversationId, messageId, attachment: row });
  return row;

}


function canonicalBaileysMediaInfo(info = {}) {
  const chatJid = stableJid(info);
  return {
    ...info,
    key: { ...(info.key || {}), remoteJid: chatJid || info.key?.remoteJid || '' },
    message: unwrap(info.message || {})
  };
}

async function materializeBaileys({ accountId, conversationId, messageId, info, socket, descriptor, timeoutMs = 45000 }) {
  if (descriptor?.downloadable === false) {
    return { ...descriptor, downloadStatus: 'unsupported', cachedAt: new Date().toISOString() };
  }
  const rawMessageInfo = info || reconstructBaileysMessageInfo(descriptor?.mediaEnvelope);
  const messageInfo = rawMessageInfo?.message ? canonicalBaileysMediaInfo(rawMessageInfo) : rawMessageInfo;
  if (!messageInfo?.message) throw Object.assign(new Error('媒体恢复缺少可重建的 WhatsApp 消息信封'), { code: 'MEDIA_ENVELOPE_MISSING' });
  const controller = new AbortController();
  const baileysLogger = {
    info(details, message) { logger.info('media', 'baileys-download', { message: String(message || ''), details: details || {} }); },
    warn(details, message) { logger.warn('media', 'baileys-download-warning', { message: String(message || ''), details: details || {} }); },
    error(details, message) { logger.error('media', 'baileys-download-error', { message: String(message || ''), details: details || {} }); },
    debug() {}, trace() {}, child() { return this; }
  };
  const timer = setTimeout(() => controller.abort(new Error('MEDIA_DOWNLOAD_TIMEOUT')), timeoutMs);
  try {
    const baileys = await import('@whiskeysockets/baileys');
    if (typeof baileys.downloadMediaMessage !== 'function') throw new Error('BAILEYS_DOWNLOAD_MEDIA_UNAVAILABLE');
    const download = baileys.downloadMediaMessage(
      messageInfo,
      'buffer',
      {},
      socket && typeof socket.updateMediaMessage === 'function'
        ? { reuploadRequest: socket.updateMediaMessage.bind(socket), logger: baileysLogger }
        : undefined
    );
    const buffer = await Promise.race([
      download,
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('媒体下载超时'), { code: 'MEDIA_DOWNLOAD_TIMEOUT' })), { once: true }))
    ]);
    const saved = saveBuffer({ accountId, conversationId, messageId, buffer, descriptor });
    const mime = String(saved.mimeType || '').toLowerCase();
    if (/tgsticker|lottie|gzip/.test(mime) || String(saved.localFile || '').toLowerCase().endsWith('.tgs')) {
      return { ...saved, stickerFormat: 'lottie', isAnimated: true, isAnimatedSticker: true, renderable: false, supportState: 'thumbnail-fallback' };
    }
    return saved;
  } catch (error) {
    const failed = { ...descriptor, downloadStatus: 'failed', downloadError: error.code || error.message || String(error), failedAt: new Date().toISOString(), retryable: mediaFailureRetryable(error) };
    logger.warn('media', 'materialize-failed', { accountId, conversationId, messageId, error: failed.downloadError });
    eventBus.publish('media:failed', { accountId, conversationId, messageId, attachment: failed });
    return failed;
  } finally {
    clearTimeout(timer);
  }
}

function resolveFile(accountId, conversationId, fileName) {
  const full = path.resolve(PATHS.media, safePart(accountId), safePart(conversationId), safePart(fileName, ''));
  const base = path.resolve(PATHS.media) + path.sep;
  if (!full.startsWith(base) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return '';
  return full;
}

function cleanup({ olderThanDays = 45, dryRun = true } = {}) {
  ensureDir(PATHS.media);
  const cutoff = Date.now() - Math.max(1, olderThanDays) * 86400000;
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(PATHS.media);
  const removable = files.filter(file => fs.statSync(file).mtimeMs < cutoff);
  if (!dryRun) removable.forEach(file => { try { fs.unlinkSync(file); } catch (_) {} });
  return { scanned: files.length, removable: removable.length, removed: dryRun ? 0 : removable.length, dryRun };
}

module.exports = { safePart, sha256, sha256File, isAnimatedWebp, extension, saveBuffer, saveFile, canonicalBaileysMediaInfo, materializeBaileys, resolveFile, cleanup, verifyBuffer, verifyFile, publicUrl, mediaFailureRetryable };
