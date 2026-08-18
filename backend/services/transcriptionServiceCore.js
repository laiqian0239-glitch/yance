'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const logger = require('./logger');
const mediaPipeline = require('./mediaPipeline');
const { deepFreeze } = require('../lib/deepFreeze');
const { PATHS } = require('../config');

const SENSEVOICE_AUTHORITY = 'SenseVoice';
const SENSEVOICE_EXECUTABLE = process.platform === 'win32' ? 'llama-funasr-sensevoice.exe' : 'llama-funasr-sensevoice';
const SENSEVOICE_MODEL = 'sense-voice-small-q8_0.gguf';
const SENSEVOICE_LANGUAGE = /<\|(zh|en|yue|ja|ko|nospeech)\|>/iu;

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
      reject(Object.assign(new Error('语音处理超时'), { code: 'TRANSCRIPTION_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Object.assign(new Error(stderr.trim() || `语音处理命令退出码 ${code}`), { code: 'TRANSCRIPTION_COMMAND_FAILED' }));
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
    path.join(PATHS.root, 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.join(PATHS.root, 'tools', 'ffmpeg.exe'),
    path.join(sourceRoot(), 'tools', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(process.cwd(), 'tools', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  ];
  return firstExisting(candidates) || executableOnPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function voiceRuntimeRoots() {
  const configured = String(process.env.YANCE_VOICE_BRAIN_RUNTIME_DIR || '').trim();
  return [
    configured,
    path.join(PATHS.root, 'runtime', 'voice-brain'),
    path.join(PATHS.models, 'voice-brain'),
    path.join(sourceRoot(), 'runtime', 'voice-brain'),
    path.join(process.cwd(), 'runtime', 'voice-brain')
  ].filter(Boolean).map(value => path.resolve(value));
}

function resolveSenseVoiceLayout() {
  const executableCandidates = [];
  const modelCandidates = [];
  for (const root of voiceRuntimeRoots()) {
    executableCandidates.push(
      path.join(root, 'sensevoice', 'bin', SENSEVOICE_EXECUTABLE),
      path.join(root, 'sensevoice', SENSEVOICE_EXECUTABLE),
      path.join(root, 'bin', SENSEVOICE_EXECUTABLE)
    );
    modelCandidates.push(
      path.join(root, 'sensevoice', 'models', SENSEVOICE_MODEL),
      path.join(root, 'sensevoice', SENSEVOICE_MODEL),
      path.join(root, 'models', SENSEVOICE_MODEL)
    );
  }
  const executable = firstExisting(executableCandidates);
  const model = firstExisting(modelCandidates);
  return Object.freeze({
    authority: SENSEVOICE_AUTHORITY,
    executable,
    model,
    available: Boolean(executable && model),
    reasonCode: !executable ? 'SENSEVOICE_RUNTIME_MISSING' : !model ? 'SENSEVOICE_MODEL_MISSING' : ''
  });
}

function engineStatus() {
  const runtime = resolveSenseVoiceLayout();
  const ffmpeg = discoverFfmpeg();
  return Object.freeze({
    available: runtime.available,
    kind: 'sensevoice',
    authority: SENSEVOICE_AUTHORITY,
    source: 'sealed-runtime',
    command: runtime.executable || '',
    model: runtime.model || '',
    audioConverterAvailable: Boolean(ffmpeg),
    audioConverter: ffmpeg || '',
    reasonCode: runtime.reasonCode,
    installSupported: false,
    sealedRuntimeRequired: true,
    whatsappAudioReady: runtime.available && Boolean(ffmpeg)
  });
}

function parseSenseVoiceOutput(output, requestedLanguage) {
  const raw = String(output || '').trim();
  const languageMatch = raw.match(SENSEVOICE_LANGUAGE);
  const detectedLanguage = languageMatch ? String(languageMatch[1]).toLowerCase() : '';
  const transcript = raw.replace(/<\|[^|>]+\|>/gu, '').trim();
  return Object.freeze({
    transcript,
    detectedLanguage: detectedLanguage && detectedLanguage !== 'nospeech' ? detectedLanguage : '',
    language: detectedLanguage && detectedLanguage !== 'nospeech' ? detectedLanguage : requestedLanguage
  });
}

async function prepareSenseVoiceInput(full) {
  const ffmpeg = discoverFfmpeg();
  if (!ffmpeg && path.extname(full).toLowerCase() === '.wav') return { inputFile: full, conversionDir: '' };
  if (!ffmpeg) {
    const error = new Error('SenseVoice requires a 16 kHz mono PCM WAV input and FFmpeg is unavailable for conversion.');
    error.code = 'AUDIO_CONVERTER_NOT_CONFIGURED';
    error.status = 409;
    throw error;
  }
  const tempRoot = PATHS.tmp || os.tmpdir();
  fs.mkdirSync(tempRoot, { recursive: true });
  const conversionDir = fs.mkdtempSync(path.join(tempRoot, 'yance-sensevoice-'));
  const inputFile = path.join(conversionDir, 'input-16khz-mono.wav');
  try {
    await runCommand(ffmpeg, ['-nostdin', '-y', '-i', full, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', inputFile], 120000);
    return { inputFile, conversionDir };
  } catch (error) {
    cleanupTemporaryDirectory(conversionDir, 'sensevoice.convert.rollback');
    const wrapped = new Error(`SenseVoice audio conversion failed: ${error.message}`);
    wrapped.code = 'AUDIO_CONVERSION_FAILED';
    throw wrapped;
  }
}

async function runSenseVoice(runtime, inputFile) {
  const result = await runCommand(runtime.executable, ['-m', runtime.model, '-a', inputFile, '--keep-tags']);
  return result.stdout;
}

async function executeTranscriptionPhysical({ filePath, language = 'auto', translateToChinese = true }) {
  const full = path.resolve(String(filePath || ''));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw Object.assign(new Error('语音文件尚未恢复到本地'), { code: 'AUDIO_FILE_NOT_FOUND' });
  const runtime = resolveSenseVoiceLayout();
  if (!runtime.available) {
    const error = new Error('SenseVoice sealed runtime or model is unavailable. Provision the verified Voice Brain runtime before transcription.');
    error.code = runtime.reasonCode || 'SENSEVOICE_RUNTIME_MISSING';
    error.status = 409;
    throw error;
  }

  const started = Date.now();
  const prepared = await prepareSenseVoiceInput(full);
  try {
    const parsed = parseSenseVoiceOutput(await runSenseVoice(runtime, prepared.inputFile), language);
    if (!parsed.transcript) throw Object.assign(new Error('SenseVoice did not return transcript text.'), { code: 'TRANSCRIPTION_EMPTY' });

    const payload = {
      ok: true,
      transcript: parsed.transcript,
      chinese: '',
      translationRequested: translateToChinese === true && Boolean(parsed.transcript),
      language: parsed.language || language,
      detectedLanguage: parsed.detectedLanguage,
      confidence: null,
      durationMs: Date.now() - started,
      engine: runtime.executable,
      engineKind: 'sensevoice',
      engineSource: 'sealed-runtime',
      authority: SENSEVOICE_AUTHORITY
    };
    logger.info('speech', 'transcription-complete', {
      filePath: full,
      durationMs: payload.durationMs,
      chars: payload.transcript.length,
      engineKind: payload.engineKind,
      detectedLanguage: payload.detectedLanguage
    });
    return payload;
  } finally {
    if (prepared.conversionDir) cleanupTemporaryDirectory(prepared.conversionDir, 'sensevoice.convert.finalize');
  }
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
  discoverFfmpeg,
  engineStatus,
  executableOnPath,
  sourceRoot,
  resolveSenseVoiceLayout,
  parseSenseVoiceOutput
};
