'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const settingsRepository = require('../repositories/settingsRepository');
const modelRegistry = require('./modelRegistry');
const { streamChat } = require('./ollamaClient');
const transcription = require('./transcriptionService');
const messageStore = require('./messageStore');

const MAX_BYTES = Math.max(1024 * 1024, Number(process.env.YANCE_MEDIA_ANALYSIS_MAX_BYTES || 32 * 1024 * 1024));
function clean(value, max = 60000) { return String(value ?? '').trim().slice(0, max); }
function normalizeKind(value) {
  const v = clean(value, 80).toLowerCase();
  if (/voice|ptt|audio|ogg|opus|mp3|m4a|aac|wav/.test(v)) return 'audio';
  if (/video|mp4|mov|webm/.test(v)) return 'video';
  if (/image|photo|picture|jpeg|jpg|png|webp|sticker|gif/.test(v)) return 'image';
  if (/pdf|document|file/.test(v)) return 'document';
  return v || 'unknown';
}
function parseJson(text) {
  const raw = clean(text, 100000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(raw); } catch (error) { void error; }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch (error) { void error; }
  return { summary: raw };
}
function readFile(filePath) {
  const full = path.resolve(clean(filePath, 5000));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw Object.assign(new Error('媒体文件不存在'), { code: 'MEDIA_FILE_NOT_FOUND' });
  const size = fs.statSync(full).size;
  if (!size || size > MAX_BYTES) throw Object.assign(new Error('媒体文件为空或超过识别大小限制'), { code: 'MEDIA_TOO_LARGE' });
  return { full, buffer: fs.readFileSync(full), size };
}

function frameExtension(mimeType = '', filePath = '') {
  const mime = clean(mimeType, 120).toLowerCase().split(';')[0];
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime.startsWith('video/')) return `.${mime.split('/')[1].replace(/[^a-z0-9]/g, '') || 'mp4'}`;
  return path.extname(filePath) || '.bin';
}
function requiresRepresentativeFrame(kind, mimeType = '', filePath = '') {
  const mime = clean(mimeType, 120).toLowerCase();
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return kind === 'video' || /(?:gif|webp|video)/i.test(mime) || ['.gif', '.webp', '.mp4', '.webm', '.mov', '.m4v'].includes(ext);
}
async function extractRepresentativeFrame({ filePath = '', buffer = null, mimeType = '', kind = 'image' }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-media-frame-'));
  try {
    let input = filePath;
    if (buffer) {
      input = path.join(temporaryRoot, `input${frameExtension(mimeType, filePath)}`);
      fs.writeFileSync(input, buffer);
    }
    const ffmpeg = transcription.discoverFfmpeg();
    if (!ffmpeg) throw Object.assign(new Error('动态贴纸、GIF 或视频需要 FFmpeg 提取可识别画面。请先完成本地语音组件安装。'), { code: 'MEDIA_FRAME_CONVERTER_NOT_CONFIGURED', status: 409 });
    const output = path.join(temporaryRoot, 'representative-frame.png');
    try {
      await transcription.runCommand(ffmpeg, ['-nostdin', '-y', '-i', input, '-frames:v', '1', '-vf', 'scale=min(1600\\,iw):-2', output], 120000);
    } catch (error) {
      throw Object.assign(new Error('未能从动态贴纸、GIF 或视频中提取可识别画面。'), { code: 'MEDIA_FRAME_EXTRACTION_FAILED', status: 422, cause: error });
    }
    if (!fs.existsSync(output) || !fs.statSync(output).size) throw Object.assign(new Error('媒体中没有可识别的有效画面。'), { code: 'MEDIA_FRAME_EMPTY', status: 422 });
    return { buffer: fs.readFileSync(output), mimeType: 'image/png', kind, cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }) };
  } catch (error) {
    try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch (cleanupError) { console.warn('[media-intelligence] temporary frame cleanup failed', { temporaryRoot, reason: cleanupError?.message || String(cleanupError) }); }
    throw error;
  }
}
async function prepareVisionInput({ filePath = '', buffer = null, mimeType = '', kind = 'image' }) {
  if (requiresRepresentativeFrame(kind, mimeType, filePath)) return extractRepresentativeFrame({ filePath, buffer, mimeType, kind });
  if (buffer) return { buffer, mimeType: mimeType || 'image/jpeg', kind, cleanup: () => {} };
  const file = readFile(filePath);
  return { buffer: file.buffer, mimeType: mimeType || 'image/jpeg', kind, cleanup: () => {} };
}

function visionModel() {
  const state = modelRegistry.read();
  const models = (state.models || []).filter(row => row.available !== false && /vision|llava|qwen.*vl|minicpm.*v|gemma3|gemma-3|moondream|bakllava|pixtral/i.test(`${row.name || ''} ${row.family || ''} ${(row.families || []).join(' ')}`));
  return models.find(row => ['verified', 'experimental'].includes(row.qualification)) || models[0] || null;
}
async function analyzeImageBuffer({ buffer, mimeType = 'image/jpeg', caption = '', kind = 'image' }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('没有可识别的图片内容'), { code: 'IMAGE_EMPTY' });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('图片超过识别大小限制'), { code: 'MEDIA_TOO_LARGE' });
  const model = visionModel();
  if (!model) return { status: 'unavailable', kind, error: '没有检测到可用的本地视觉模型。请先在AI工作台完成视觉模型扫描和资格测试。' };
  const instruction = kind === 'video'
    ? '这是视频代表画面。识别场景、人物动作、物品、可见文字、文字语言、主要内容和可能表达的意图。'
    : '识别图片或贴纸中的场景、人物动作、物品、可见文字、文字语言、主要内容和可能表达的意图。';
  const response = await streamChat({
    endpoint: model.endpoint,
    model: model.name,
    messages: [
      { role: 'system', content: '你是言策本地媒体理解模块。只根据可见证据分析，不猜测身份，不发送消息。只输出合法JSON。' },
      {
        role: 'user',
        content: `${instruction}\n附加文字：${clean(caption, 12000)}\n只返回JSON：{"summary":"","visibleText":"","translation":"","scene":"","intent":"","replyCues":[""]}`,
        images: [buffer.toString('base64')]
      }
    ],
    options: { maxTokens: 1800, temperature: 0.1, json: true, timeoutMs: 300000 }
  });
  return { status: 'completed', kind, ...parseJson(response.text), model: { id: model.id, name: model.name, endpoint: model.endpoint }, metrics: { totalMs: response.totalMs, firstTokenMs: response.firstTokenMs } };
}
function findMessage(sessionKey, messageId) {
  return messageStore.listMessages(sessionKey, { limit: 5000 }).find(row => row.id === messageId || row.externalMessageId === messageId || row.dedupeKey === messageId) || null;
}
function attachmentFromMessage(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const first = attachments[0] || {};
  return {
    kind: normalizeKind(first.kind || message?.type || message?.messageType || first.mimeType),
    filePath: first.localFile || first.filePath || message?.mediaPath || '',
    mimeType: first.mimeType || message?.mimeType || '',
    caption: message?.text || first.caption || ''
  };
}
function saveAnalysis(key, value) {
  const row = { ...value, analyzedAt: new Date().toISOString() };
  settingsRepository.set('media-analysis', clean(key, 500), row);
  return row;
}
function getAnalysis(key) { return settingsRepository.get('media-analysis', clean(key, 500), null); }
async function analyzeFile({ filePath, kind, mimeType, caption = '', key = '' }) {
  const normalized = normalizeKind(kind || mimeType || filePath);
  if (normalized === 'audio') {
    const result = await transcription.transcribe({ filePath, language: 'auto', translateToChinese: true });
    return saveAnalysis(key || crypto.randomUUID(), { status: 'completed', kind: 'audio', transcript: result.transcript, translation: result.chinese, summary: result.chinese || result.transcript, language: result.language, durationMs: result.durationMs, engine: result.engine });
  }
  if (normalized === 'image' || normalized === 'video') {
    const input = await prepareVisionInput({ filePath, mimeType, kind: normalized });
    try {
      return saveAnalysis(key || crypto.randomUUID(), await analyzeImageBuffer({ buffer: input.buffer, mimeType: input.mimeType, caption, kind: normalized }));
    } finally { input.cleanup(); }
  }
  return saveAnalysis(key || crypto.randomUUID(), { status: 'unavailable', kind: normalized, error: '当前媒体类型暂不支持自动识别' });
}
async function analyzeMessage({ sessionKey, messageId }) {
  const message = findMessage(clean(sessionKey), clean(messageId));
  if (!message) throw Object.assign(new Error('消息不存在'), { code: 'MESSAGE_NOT_FOUND', status: 404 });
  const attachment = attachmentFromMessage(message);
  if (!attachment.filePath) throw Object.assign(new Error('消息媒体尚未缓存到本地'), { code: 'MEDIA_NOT_CACHED', status: 409 });
  return analyzeFile({ ...attachment, key: message.id || messageId });
}
async function analyzeBuffer({ buffer, kind, mimeType, caption = '', key = '' }) {
  const normalized = normalizeKind(kind || mimeType);
  if (normalized === 'image' || normalized === 'video') {
    const input = await prepareVisionInput({ buffer, mimeType, kind: normalized });
    try {
      const result = await analyzeImageBuffer({ buffer: input.buffer, mimeType: input.mimeType, caption, kind: normalized });
      return saveAnalysis(key || crypto.randomUUID(), result);
    } finally { input.cleanup(); }
  }
  throw Object.assign(new Error('流式识别当前只接受图片或视频代表帧'), { code: 'STREAM_ANALYSIS_KIND_UNSUPPORTED' });
}

module.exports = { analyzeMessage, analyzeFile, analyzeBuffer, getAnalysis, normalizeKind, parseJson, analyzeImageBuffer, prepareVisionInput, requiresRepresentativeFrame };
