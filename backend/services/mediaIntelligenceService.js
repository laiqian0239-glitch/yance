'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const settingsRepository = require('../repositories/settingsRepository');
const aiGateway = require('./aiGateway');
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

async function analyzeImageBuffer({ buffer, mimeType = 'image/jpeg', caption = '', kind = 'image' }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('没有可识别的图片内容'), { code: 'IMAGE_EMPTY' });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('图片超过识别大小限制'), { code: 'MEDIA_TOO_LARGE' });
  const instruction = kind === 'video'
    ? '这是视频代表画面。识别场景、人物动作、物品、可见文字、文字语言、主要内容和可能表达的意图。'
    : '识别图片或贴纸中的场景、人物动作、物品、可见文字、文字语言、主要内容和可能表达的意图。';
  try {
    const response = await aiGateway.execute({
      task: 'media_analysis',
      messages: [
        { role: 'system', content: '只根据可见证据分析，不猜测身份，不发送消息。只输出合法JSON。' },
        { role: 'user', content: [
          { type: 'text', text: `${instruction}\n附加文字：${clean(caption, 12000)}\n只返回JSON：{"summary":"","visibleText":"","translation":"","scene":"","intent":"","replyCues":[""]}` },
          { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`, detail: 'low' } }
        ] }
      ],
      options: {
        temperature: 0.1,
        maxTokens: 1800,
        json: true,
        timeoutMs: 300000,
        constraints: { modalities: ['vision'] }
      }
    });
    return {
      status: 'completed',
      kind,
      ...parseJson(response.text),
      modelBrain: { provider: response.provider || '', selectedModel: response.model || response.modelId || '' },
      metrics: { totalMs: Number(response.latencyMs || 0), totalTokens: Number(response.totalTokens || 0), costUsd: Number(response.costUsd || 0) }
    };
  } catch (error) {
    if (error?.code === 'MODEL_BRAIN_NO_ELIGIBLE_DEPLOYMENT' || error?.code === 'MODEL_BRAIN_RUNTIME_UNAVAILABLE') {
      return { status: 'unavailable', kind, error: 'Model Brain 没有满足视觉硬资格条件的可用模型。请在 AI 工作台扫描、配置并完成模型资格测试。' };
    }
    throw error;
  }
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

function createMediaIntelligenceService({
  transcriptionService = transcription,
  persistAnalysis = saveAnalysis
} = {}) {
  if (!transcriptionService || typeof transcriptionService.transcribe !== 'function') {
    throw new TypeError('Media intelligence requires a transcription scheduling service');
  }
  if (typeof persistAnalysis !== 'function') {
    throw new TypeError('Media intelligence requires an analysis persistence function');
  }

  async function analyzeFile({ filePath, kind, mimeType, caption = '', key = '' }) {
    const normalized = normalizeKind(kind || mimeType || filePath);
    const analysisKey = key || crypto.randomUUID();
    if (normalized === 'audio') {
      const scheduled = await transcriptionService.transcribe({
        mediaReference: clean(filePath, 5000),
        filePath: clean(filePath, 5000),
        language: 'auto',
        translateToChinese: true,
        traceId: `media-intelligence:${analysisKey}`,
        sourceScopeReference: `media-intelligence-source:${analysisKey}`,
        destinationScopeReference: `media-intelligence-result:${analysisKey}`,
        custodyReference: `media-intelligence-custody:${analysisKey}`
      });
      return persistAnalysis(analysisKey, {
        status: 'scheduled',
        kind: 'audio',
        executionId: clean(scheduled?.executionId, 2048),
        intentId: clean(scheduled?.intentId, 2048),
        operationKind: clean(scheduled?.operationKind, 128),
        idempotencyKey: clean(scheduled?.idempotencyKey, 2048)
      });
    }
    if (normalized === 'image' || normalized === 'video') {
      const input = await prepareVisionInput({ filePath, mimeType, kind: normalized });
      try {
        return persistAnalysis(analysisKey, await analyzeImageBuffer({ buffer: input.buffer, mimeType: input.mimeType, caption, kind: normalized }));
      } finally { input.cleanup(); }
    }
    return persistAnalysis(analysisKey, { status: 'unavailable', kind: normalized, error: '当前媒体类型暂不支持自动识别' });
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
        return persistAnalysis(key || crypto.randomUUID(), result);
      } finally { input.cleanup(); }
    }
    throw Object.assign(new Error('流式识别当前只接受图片或视频代表帧'), { code: 'STREAM_ANALYSIS_KIND_UNSUPPORTED' });
  }

  return Object.freeze({ analyzeMessage, analyzeFile, analyzeBuffer });
}

const defaultMediaIntelligenceService = createMediaIntelligenceService();

module.exports = {
  ...defaultMediaIntelligenceService,
  createMediaIntelligenceService,
  getAnalysis,
  normalizeKind,
  parseJson,
  analyzeImageBuffer,
  prepareVisionInput,
  requiresRepresentativeFrame
};
