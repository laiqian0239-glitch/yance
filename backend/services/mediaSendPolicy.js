'use strict';

const fs = require('node:fs');
const path = require('node:path');

function clean(value) { return String(value || '').trim().toLowerCase(); }
function extension(filename) { return path.extname(String(filename || '')).toLowerCase(); }
function fail(message, details = {}) {
  const error = Object.assign(new Error(message), { code: 'MEDIA_STICKER_FORMAT_UNSUPPORTED', status: 415, ...details });
  throw error;
}
function isWebpHeader(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}
function hasWebpSignature({ buffer, filePath } = {}) {
  if (Buffer.isBuffer(buffer)) return isWebpHeader(buffer);
  if (!filePath) return false;
  try {
    const fd = fs.openSync(path.resolve(filePath), 'r');
    try {
      const header = Buffer.alloc(12);
      const bytes = fs.readSync(fd, header, 0, header.length, 0);
      return bytes === 12 && isWebpHeader(header);
    } finally { fs.closeSync(fd); }
  } catch (_) { return false; }
}

function validateStickerInput({ platform, kind, mimeType, filename, buffer, filePath } = {}) {
  const normalizedPlatform = clean(platform);
  const normalizedKind = clean(kind);
  if (!['sticker', 'animatedsticker'].includes(normalizedKind)) return { validated: false, platform: normalizedPlatform, kind: normalizedKind };
  const mime = clean(mimeType);
  const ext = extension(filename);

  if (normalizedPlatform === 'facebook') {
    fail('Facebook Page Messenger 当前未实现贴纸发送协议', { platform: normalizedPlatform, kind: normalizedKind, reason: 'platform-unsupported' });
  }

  if (normalizedPlatform === 'whatsapp') {
    if (normalizedKind === 'animatedsticker') {
      fail('WhatsApp 动态贴纸发送仅接受已经转换完成的 WebP，并请以 sticker 类型发送', { platform: normalizedPlatform, kind: normalizedKind, reason: 'use-preencoded-webp' });
    }
    if (mime !== 'image/webp' || (ext && ext !== '.webp') || !hasWebpSignature({ buffer, filePath })) {
      fail('WhatsApp 贴纸必须是已经转换完成且内容签名有效的 image/webp 文件', { platform: normalizedPlatform, kind: normalizedKind, mimeType: mime, extension: ext, reason: 'webp-required' });
    }
    return { validated: true, platform: normalizedPlatform, kind: 'sticker', format: 'webp', nativeSend: true };
  }

  if (normalizedPlatform === 'telegram') {
    if (normalizedKind === 'animatedsticker') {
      fail('Telegram 原生 TGS/WebM 动态贴纸发送尚未接入专用贴纸 API', { platform: normalizedPlatform, kind: normalizedKind, reason: 'native-animated-sticker-api-missing' });
    }
    if (mime !== 'image/webp' || (ext && ext !== '.webp') || !hasWebpSignature({ buffer, filePath })) {
      fail('Telegram 普通贴纸发送当前仅接受内容签名有效的 WebP；其他格式会被当作普通文件', { platform: normalizedPlatform, kind: normalizedKind, mimeType: mime, extension: ext, reason: 'webp-required' });
    }
    return { validated: true, platform: normalizedPlatform, kind: 'sticker', format: 'webp', nativeSend: false };
  }

  fail('当前平台不支持贴纸发送', { platform: normalizedPlatform, kind: normalizedKind, reason: 'unknown-platform' });
}

module.exports = { isWebpHeader, hasWebpSignature, validateStickerInput };
