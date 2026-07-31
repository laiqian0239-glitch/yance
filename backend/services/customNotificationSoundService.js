'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const { PATHS } = require('../config');
const eventBus = require('./eventBus');
const { isCustomSoundPattern } = require('../../shared/notificationSoundCatalog');

const MAX_SOUND_BYTES = Math.max(256 * 1024, Number(process.env.YANCE_NOTIFICATION_SOUND_MAX_BYTES || 8 * 1024 * 1024));
const MIN_SOUND_BYTES = 24;
const ALLOWED_EXTENSIONS = Object.freeze(['wav', 'mp3', 'm4a', 'aac']);
const ALLOWED_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/aacp',
  'application/octet-stream'
]);
const MIME_BY_EXTENSION = Object.freeze({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac' });
const DEFAULT_DOCUMENT = Object.freeze({ schemaVersion: 1, items: [] });
const store = new SqliteDocumentStore('custom-notification-sounds', DEFAULT_DOCUMENT);

function soundError(message, code, status = 400, details) {
  return Object.assign(new Error(message), { code, reasonCode: code, status, ...(details ? { details } : {}) });
}

function clean(value, max = 255) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function ensureDirectory() {
  fs.mkdirSync(PATHS.notificationSounds, { recursive: true });
  return PATHS.notificationSounds;
}

function safeExtension(value) {
  const extension = String(value || '').trim().toLowerCase().replace(/^\./, '');
  return ALLOWED_EXTENSIONS.includes(extension) ? extension : '';
}

function extensionFromName(fileName) {
  return safeExtension(path.extname(clean(fileName)).slice(1));
}

function isWave(buffer) {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function isM4a(buffer) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
  return ['m4a ', 'm4b ', 'isom', 'mp41', 'mp42', 'dash'].includes(brand);
}

function isAac(buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
}

function isMp3(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && !isAac(buffer);
}

function detectAudio(buffer) {
  if (isWave(buffer)) return { extension: 'wav', mimeType: MIME_BY_EXTENSION.wav };
  if (isM4a(buffer)) return { extension: 'm4a', mimeType: MIME_BY_EXTENSION.m4a };
  if (isAac(buffer)) return { extension: 'aac', mimeType: MIME_BY_EXTENSION.aac };
  if (isMp3(buffer)) return { extension: 'mp3', mimeType: MIME_BY_EXTENSION.mp3 };
  return null;
}

function soundPath(id, extension) {
  if (!isCustomSoundPattern(id)) throw soundError('自定义提示音标识无效', 'CUSTOM_SOUND_ID_INVALID');
  const safe = safeExtension(extension);
  if (!safe) throw soundError('自定义提示音格式无效', 'CUSTOM_SOUND_EXTENSION_INVALID');
  const root = path.resolve(ensureDirectory());
  const target = path.resolve(root, `${id}.${safe}`);
  if (!target.startsWith(`${root}${path.sep}`)) throw soundError('自定义提示音路径越界', 'CUSTOM_SOUND_PATH_TRAVERSAL');
  return target;
}

function normalizeDocument(value = {}) {
  const items = (Array.isArray(value.items) ? value.items : []).flatMap(row => {
    const id = String(row?.id || '').trim().toLowerCase();
    const extension = safeExtension(row?.extension);
    if (!isCustomSoundPattern(id) || !extension) return [];
    return [{
      id,
      label: clean(row?.label, 60) || '自定义提示音',
      description: clean(row?.description, 160) || '用户上传的本地提示音。',
      originalFileName: clean(row?.originalFileName, 255),
      extension,
      mimeType: clean(row?.mimeType, 80) || MIME_BY_EXTENSION[extension],
      sizeBytes: Math.max(0, Number(row?.sizeBytes || 0)),
      sha256: String(row?.sha256 || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 64),
      createdAt: String(row?.createdAt || ''),
      updatedAt: String(row?.updatedAt || row?.createdAt || '')
    }];
  });
  return { schemaVersion: 1, items };
}

function readDocument() {
  return normalizeDocument(store.read());
}

function list(options = {}) {
  const includeMissing = options.includeMissing === true;
  return readDocument().items.filter(row => includeMissing || fs.existsSync(soundPath(row.id, row.extension))).map(row => ({ ...row, custom: true }));
}

function get(id) {
  const normalized = String(id || '').trim().toLowerCase();
  return list({ includeMissing: true }).find(row => row.id === normalized) || null;
}

function exists(id) {
  const row = get(id);
  if (!row) return false;
  try { return fs.statSync(soundPath(row.id, row.extension)).isFile(); } catch (_) { return false; }
}

function resolvePath(id) {
  const row = get(id);
  if (!row) return '';
  const target = soundPath(row.id, row.extension);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return '';
    return target;
  } catch (_) { return ''; }
}

async function createFromBuffer(payload = {}) {
  const buffer = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer || []);
  if (buffer.length < MIN_SOUND_BYTES) throw soundError('提示音文件为空或内容过短', 'CUSTOM_SOUND_FILE_EMPTY');
  if (buffer.length > MAX_SOUND_BYTES) throw soundError(`提示音文件不能超过 ${Math.round(MAX_SOUND_BYTES / 1024 / 1024)} MB`, 'CUSTOM_SOUND_FILE_TOO_LARGE', 413, { maxBytes: MAX_SOUND_BYTES });

  const declaredMime = (clean(payload.mimeType, 80).toLowerCase().split(';')[0].trim() || 'application/octet-stream');
  if (!ALLOWED_MIME_TYPES.has(declaredMime) && !declaredMime.startsWith('audio/')) {
    throw soundError('只允许上传 WAV、MP3、M4A 或 AAC 音频', 'CUSTOM_SOUND_MIME_UNSUPPORTED', 415);
  }
  const detected = detectAudio(buffer);
  if (!detected) throw soundError('无法识别音频格式；请选择真实的 WAV、MP3、M4A 或 AAC 文件', 'CUSTOM_SOUND_FORMAT_UNRECOGNIZED', 415);
  const requestedExtension = extensionFromName(payload.originalFileName);
  if (requestedExtension && requestedExtension !== detected.extension) {
    throw soundError('文件扩展名与音频内容不一致', 'CUSTOM_SOUND_EXTENSION_MISMATCH', 415, { requestedExtension, detectedExtension: detected.extension });
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const duplicate = list().find(row => row.sha256 === sha256 && row.sizeBytes === buffer.length);
  if (duplicate) return { item: duplicate, duplicate: true };

  const id = `custom-${crypto.randomUUID()}`;
  const originalFileName = clean(payload.originalFileName, 255) || `${id}.${detected.extension}`;
  const fileStem = path.basename(originalFileName, path.extname(originalFileName));
  const label = clean(payload.label, 60) || clean(fileStem, 60) || '自定义提示音';
  const now = new Date().toISOString();
  const item = {
    id,
    label,
    description: '用户上传的本地提示音。',
    originalFileName,
    extension: detected.extension,
    mimeType: detected.mimeType,
    sizeBytes: buffer.length,
    sha256,
    createdAt: now,
    updatedAt: now
  };

  const target = soundPath(id, detected.extension);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch (_) {}
    await store.update(document => {
      const current = normalizeDocument(document);
      current.items.push(item);
      return current;
    });
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    try { fs.rmSync(target, { force: true }); } catch (_) {}
    if (error.code && String(error.code).startsWith('CUSTOM_SOUND_')) throw error;
    throw soundError(`提示音保存失败：${error.message}`, 'CUSTOM_SOUND_SAVE_FAILED', 500);
  }

  eventBus.publish('system:notification-sounds-updated', { action: 'created', item: { ...item, custom: true } });
  return { item: { ...item, custom: true }, duplicate: false };
}

async function remove(id) {
  const normalized = String(id || '').trim().toLowerCase();
  if (!isCustomSoundPattern(normalized)) throw soundError('自定义提示音标识无效', 'CUSTOM_SOUND_ID_INVALID');
  const item = get(normalized);
  if (!item) throw soundError('自定义提示音不存在', 'CUSTOM_SOUND_NOT_FOUND', 404);
  const target = soundPath(item.id, item.extension);
  const tombstone = `${target}.${process.pid}.${Date.now()}.delete`;
  let moved = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, tombstone);
      moved = true;
    }
    await store.update(document => {
      const current = normalizeDocument(document);
      current.items = current.items.filter(row => row.id !== normalized);
      return current;
    });
    if (moved) fs.rmSync(tombstone, { force: true });
  } catch (error) {
    if (moved && fs.existsSync(tombstone) && !fs.existsSync(target)) {
      try { fs.renameSync(tombstone, target); } catch (_) {}
    }
    if (error.code && String(error.code).startsWith('CUSTOM_SOUND_')) throw error;
    throw soundError(`提示音文件删除失败：${error.message}`, 'CUSTOM_SOUND_DELETE_FAILED', 500);
  }
  eventBus.publish('system:notification-sounds-updated', { action: 'deleted', id: normalized });
  return { ...item, custom: true };
}

function inventory() {
  const items = list();
  return {
    count: items.length,
    totalBytes: items.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0),
    maxBytes: MAX_SOUND_BYTES,
    acceptedExtensions: [...ALLOWED_EXTENSIONS],
    directory: PATHS.notificationSounds
  };
}

module.exports = {
  createFromBuffer,
  remove,
  list,
  get,
  exists,
  resolvePath,
  inventory,
  detectAudio,
  soundPath,
  MAX_SOUND_BYTES,
  ALLOWED_EXTENSIONS
};
