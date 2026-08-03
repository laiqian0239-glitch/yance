'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const aiGateway = require('./aiGateway');
const logger = require('./logger');
const mediaPipeline = require('./mediaPipeline');
const { deepFreeze } = require('../lib/deepFreeze');
const { PATHS } = require('../config');

function tokenizeCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map(part => part.replace(/^"|"$/g, ''));
}

function runCommand(command, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('语音转写超时'), { code: 'TRANSCRIPTION_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Object.assign(new Error(stderr.trim() || `转写命令退出码 ${code}`), { code: 'TRANSCRIPTION_COMMAND_FAILED' }));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function executableOnPath(name) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [name], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
}

function firstExisting(paths = []) {
  return paths.map(value => path.resolve(value)).find(value => {
    try { return fs.statSync(value).isFile(); } catch (_) { return false; }
  }) || '';
}

function sourceRoot() { return path.resolve(__dirname, '..', '..'); }

function discoverModel() {
  const configured = String(process.env.YANCE_WHISPER_MODEL || '').trim();
  const candidates = [
    configured,
    path.join(PATHS.models, 'whisper', 'ggml-base.bin'),
    path.join(PATHS.models, 'whisper', 'ggml-small.bin'),
    path.join(PATHS.models, 'ggml-base.bin'),
    path.join(sourceRoot(), 'tools', 'whisper', 'ggml-base.bin'),
    path.join(sourceRoot(), 'tools', 'whisper', 'models', 'ggml-base.bin'),
    path.join(process.cwd(), 'tools', 'whisper', 'ggml-base.bin'),
    path.join(process.cwd(), 'tools', 'whisper', 'models', 'ggml-base.bin')
  ].filter(Boolean);
  return firstExisting(candidates);
}

function cleanupTemporaryDirectory(directory, operation) {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    logger.warn('speech', 'temporary-directory-cleanup-failed', {
      operation,
      accountId: '',
      conversationId: '',
      reasonCode: error.code || 'TEMP_DIRECTORY_CLEANUP_FAILED',
      httpStatus: 0,
      attempt: 1,
      nextRetryAt: '',
      directory,
      error: error.message
    });
  }
}

function discoverFfmpeg() {
  const candidates = [
    path.join(PATHS.models, 'whisper', 'ffmpeg.exe'),
    path.join(PATHS.root, 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.join(PATHS.root, 'tools', 'ffmpeg.exe'),
    path.join(process.cwd(), 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.join(process.cwd(), 'tools', 'ffmpeg.exe')
  ];
  return firstExisting(candidates) || executableOnPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function discoverEngine() {
  const configured = String(process.env.YANCE_WHISPER_COMMAND || '').trim();
  if (configured) return { kind: 'template', commandLine: configured, source: 'YANCE_WHISPER_COMMAND' };

  const localCandidates = [
    path.join(PATHS.models, 'whisper', 'whisper-cli.exe'),
    path.join(PATHS.models, 'whisper', 'main.exe'),
    path.join(PATHS.root, 'tools', 'whisper', 'whisper-cli.exe'),
    path.join(PATHS.root, 'tools', 'whisper', 'main.exe'),
    path.join(sourceRoot(), 'tools', 'whisper', 'whisper-cli.exe'),
    path.join(sourceRoot(), 'tools', 'whisper', 'main.exe'),
    path.join(process.cwd(), 'tools', 'whisper', 'whisper-cli.exe'),
    path.join(process.cwd(), 'tools', 'whisper', 'main.exe')
  ];
  const whisperCpp = firstExisting(localCandidates) || executableOnPath(process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli') || executableOnPath(process.platform === 'win32' ? 'main.exe' : 'whisper-cpp');
  if (whisperCpp) {
    const model = discoverModel();
    return { kind: 'whisper-cpp', command: whisperCpp, model, ready: Boolean(model), source: 'auto-discovery', reasonCode: model ? '' : 'TRANSCRIPTION_MODEL_NOT_CONFIGURED' };
  }

  const pythonWhisper = executableOnPath(process.platform === 'win32' ? 'whisper.exe' : 'whisper');
  if (pythonWhisper) return { kind: 'openai-whisper-cli', command: pythonWhisper, source: 'PATH' };
  return null;
}

function engineStatus() {
  const engine = discoverEngine();
  const ffmpeg = discoverFfmpeg();
  if (!engine) {
    return {
      available: false,
      kind: '',
      source: '',
      command: '',
      model: '',
      audioConverterAvailable: Boolean(ffmpeg),
      audioConverter: ffmpeg || '',
      reasonCode: 'TRANSCRIPTION_ENGINE_NOT_CONFIGURED',
      installSupported: process.platform === 'win32',
      whatsappAudioReady: false
    };
  }
  if (engine.kind === 'whisper-cpp' && !engine.model) {
    return {
      available: false,
      kind: engine.kind,
      source: engine.source,
      command: engine.command || '',
      model: '',
      audioConverterAvailable: Boolean(ffmpeg),
      audioConverter: ffmpeg || '',
      reasonCode: 'TRANSCRIPTION_MODEL_NOT_CONFIGURED',
      installSupported: process.platform === 'win32',
      whatsappAudioReady: false
    };
  }
  return {
    available: true,
    kind: engine.kind,
    source: engine.source,
    command: engine.command || tokenizeCommand(engine.commandLine)[0] || '',
    model: engine.model || '',
    audioConverterAvailable: Boolean(ffmpeg),
    audioConverter: ffmpeg || '',
    installSupported: process.platform === 'win32',
    whatsappAudioReady: engine.kind === 'template' || Boolean(ffmpeg)
  };
}

async function executeEngine(engine, full, language) {
  if (engine.kind === 'template') {
    const parts = tokenizeCommand(engine.commandLine);
    const command = parts.shift();
    const args = parts.map(part => part.replaceAll('{file}', full).replaceAll('{language}', language));
    if (!args.some(arg => arg.includes(full))) args.push(full);
    const result = await runCommand(command, args);
    return { transcript: result.stdout, command };
  }

  if (engine.kind === 'whisper-cpp') {
    const extension = path.extname(full).toLowerCase();
    let inputFile = full;
    let conversionDir = '';
    if (extension !== '.wav') {
      const ffmpeg = discoverFfmpeg();
      if (!ffmpeg) {
        const error = new Error('当前语音是 WhatsApp OGG/Opus 格式，但未检测到 ffmpeg，无法转换为 whisper.cpp 可读取的 WAV。');
        error.code = 'AUDIO_CONVERTER_NOT_CONFIGURED';
        throw error;
      }
      const tempRoot = PATHS.tmp || os.tmpdir();
      fs.mkdirSync(tempRoot, { recursive: true });
      conversionDir = fs.mkdtempSync(path.join(tempRoot, 'yance-audio-convert-'));
      inputFile = path.join(conversionDir, 'input-16khz-mono.wav');
      try {
        await runCommand(ffmpeg, ['-nostdin', '-y', '-i', full, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', inputFile], 120000);
      } catch (error) {
        cleanupTemporaryDirectory(conversionDir, 'transcription.convert.rollback');
        const wrapped = new Error(`WhatsApp 语音转换失败：${error.message}`);
        wrapped.code = 'AUDIO_CONVERSION_FAILED';
        throw wrapped;
      }
    }
    try {
      const args = ['-m', engine.model, '-f', inputFile, '-l', language === 'auto' ? 'auto' : language, '-nt'];
      const result = await runCommand(engine.command, args);
      return { transcript: result.stdout, command: engine.command };
    } finally {
      if (conversionDir) cleanupTemporaryDirectory(conversionDir, 'transcription.convert.finalize');
    }
  }

  if (engine.kind === 'openai-whisper-cli') {
    const tempRoot = PATHS.tmp || os.tmpdir();
    fs.mkdirSync(tempRoot, { recursive: true });
    const outputDir = fs.mkdtempSync(path.join(tempRoot, 'yance-whisper-'));
    try {
      const args = [full, '--output_dir', outputDir, '--output_format', 'txt'];
      if (language && language !== 'auto') args.push('--language', language);
      const result = await runCommand(engine.command, args);
      const expected = path.join(outputDir, `${path.parse(full).name}.txt`);
      const transcript = fs.existsSync(expected) ? fs.readFileSync(expected, 'utf8').trim() : result.stdout;
      return { transcript, command: engine.command };
    } finally {
      cleanupTemporaryDirectory(outputDir, 'transcription.whisper-output.finalize');
    }
  }
  throw Object.assign(new Error('不支持的语音转写引擎'), { code: 'TRANSCRIPTION_ENGINE_UNSUPPORTED' });
}

async function executeTranscriptionPhysical({ filePath, language = 'auto', translateToChinese = true }) {
  const full = path.resolve(String(filePath || ''));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw Object.assign(new Error('语音文件尚未恢复到本地'), { code: 'AUDIO_FILE_NOT_FOUND' });
  const engine = discoverEngine();
  if (!engine) {
    const error = new Error('未检测到本地 Whisper 转写引擎。点击“语音转写”后可自动安装，或设置 YANCE_WHISPER_COMMAND。');
    error.code = 'TRANSCRIPTION_ENGINE_NOT_CONFIGURED';
    error.status = 409;
    error.details = { searched: ['YANCE_WHISPER_COMMAND', 'models/whisper/whisper-cli.exe', 'tools/whisper/whisper-cli.exe', 'whisper-cli', 'whisper'] };
    throw error;
  }
  if (engine.kind === 'whisper-cpp' && !engine.model) {
    const error = new Error('检测到 Whisper 引擎，但没有多语言模型。点击“语音转写”后可自动补齐模型。');
    error.code = 'TRANSCRIPTION_MODEL_NOT_CONFIGURED';
    error.status = 409;
    throw error;
  }
  if (['whisper-cpp', 'openai-whisper-cli'].includes(engine.kind) && path.extname(full).toLowerCase() !== '.wav' && !discoverFfmpeg()) {
    const error = new Error('当前 WhatsApp 语音需要 FFmpeg 转换后才能转写。点击“语音转写”可自动安装。');
    error.code = 'AUDIO_CONVERTER_NOT_CONFIGURED';
    error.status = 409;
    throw error;
  }
  const started = Date.now();
  const result = await executeEngine(engine, full, language);
  const transcript = String(result.transcript || '').trim();
  if (!transcript) throw Object.assign(new Error('转写引擎没有返回文字'), { code: 'TRANSCRIPTION_EMPTY' });
  let chinese = '';
  if (translateToChinese && transcript) {
    try {
      const translated = await aiGateway.execute({
        task: 'translation',
        messages: [
          { role: 'system', content: '把语音转写准确翻译成中文，只输出中文译文，不补充事实。' },
          { role: 'user', content: transcript }
        ],
        options: { maxTokens: 1200, temperature: 0.1 }
      });
      chinese = translated.text;
    } catch (error) {
      logger.warn('speech', 'translation-failed', { filePath: full, error: error.message });
    }
  }
  const payload = {
    ok: true,
    transcript,
    chinese,
    language,
    confidence: null,
    durationMs: Date.now() - started,
    engine: result.command,
    engineKind: engine.kind,
    engineSource: engine.source
  };
  logger.info('speech', 'transcription-complete', { filePath: full, durationMs: payload.durationMs, chars: transcript.length, engineKind: engine.kind });
  return payload;
}

function transcriptionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 4096) {
  const result = String(value == null ? '' : value).trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw transcriptionError('WP_B_MEDIA_TRANSFER_FIELD_REQUIRED', `${field} is required`, { field });
  }
  return result;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function publicTranscriptionCommand(input = {}) {
  const mediaReference = requiredString(input.mediaReference || input.filePath, 'mediaReference');
  const language = String(input.language || 'auto').trim() || 'auto';
  const translateToChinese = input.translateToChinese !== false;
  const mediaDigest = sha256Text(mediaReference);
  const metadataSha256 = String(input.metadataSha256 || '').trim()
    || sha256Text(JSON.stringify({ language, translateToChinese }));
  const command = deepFreeze({
    transferKind: 'TRANSCRIBE',
    mediaReference,
    sourceScopeReference: String(input.sourceScopeReference || `local-media:${mediaDigest.slice(0, 32)}`).trim(),
    destinationScopeReference: String(input.destinationScopeReference || `local-transcription:${mediaDigest.slice(0, 32)}`).trim(),
    metadataSha256,
    custodyReference: String(input.custodyReference || `local-file-custody:${mediaDigest.slice(0, 32)}`).trim(),
    language,
    translateToChinese
  });
  return Object.freeze({
    command,
    idempotencyKey: String(input.idempotencyKey || `transcription:${sha256Text(JSON.stringify(command))}`).trim(),
    traceId: String(input.traceId || '').trim(),
    deadlineAt: String(input.deadlineAt || '').trim(),
    maxAttempts: Math.max(1, Number(input.maxAttempts || 2))
  });
}

function persistedTranscriptionAttempt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw transcriptionError('WP_B_MEDIA_TRANSFER_ATTEMPT_REQUIRED', 'Transcription requires one frozen persisted attempt');
  }
  for (const field of ['executionId', 'intentId', 'attemptId', 'claimId', 'ownerId']) {
    requiredString(value[field], `persistedAttempt.${field}`);
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const number = Number(value[field]);
    if (!Number.isSafeInteger(number) || number < 1) {
      throw transcriptionError('WP_B_MEDIA_TRANSFER_ATTEMPT_REQUIRED', `persistedAttempt.${field} is required`, { field });
    }
  }
  const request = value.request;
  if (!request || typeof request !== 'object' || !Object.isFrozen(request)
      || String(request.transferKind || '').toUpperCase() !== 'TRANSCRIBE') {
    throw transcriptionError('WP_B_MEDIA_TRANSFER_ATTEMPT_REQUIRED', 'Persisted transcription attempt request is invalid');
  }
  return value;
}

function createTranscriptionService({
  mediaTransferScheduler = Object.freeze({ prepare: input => mediaPipeline.prepareMediaTransfer(input) }),
  physicalRunner = executeTranscriptionPhysical
} = {}) {
  if (!mediaTransferScheduler || typeof mediaTransferScheduler.prepare !== 'function') {
    throw new TypeError('Transcription service requires a media transfer scheduler');
  }
  if (typeof physicalRunner !== 'function') {
    throw new TypeError('Transcription service requires a physical runner');
  }
  return Object.freeze({
    transcribe(input = {}) {
      return Promise.resolve(mediaTransferScheduler.prepare(publicTranscriptionCommand(input)));
    },
    executePersistedTranscription(input = {}) {
      const attempt = persistedTranscriptionAttempt(input.persistedAttempt);
      return Promise.resolve(physicalRunner({
        filePath: String(input.filePath || attempt.request.mediaReference || ''),
        language: String(input.language || attempt.request.language || 'auto'),
        translateToChinese: input.translateToChinese ?? attempt.request.translateToChinese,
        persistedAttempt: attempt
      }));
    }
  });
}

const defaultTranscriptionService = createTranscriptionService();

module.exports = {
  transcribe: input => defaultTranscriptionService.transcribe(input),
  executePersistedTranscription: input => defaultTranscriptionService.executePersistedTranscription(input),
  createTranscriptionService,
  persistedTranscriptionAttempt,
  publicTranscriptionCommand,
  runCommand,
  tokenizeCommand,
  discoverEngine,
  discoverModel,
  discoverFfmpeg,
  engineStatus,
  executableOnPath,
  executeEngine,
  sourceRoot
};
