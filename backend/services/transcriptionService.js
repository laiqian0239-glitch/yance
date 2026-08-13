'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const aiGateway = require('./aiGateway');
const logger = require('./logger');
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

async function transcribe({ filePath, language = 'auto', translateToChinese = true }) {
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

    let chinese = '';
    if (translateToChinese && parsed.transcript) {
      try {
        const translated = await aiGateway.execute({
          task: 'translation',
          messages: [
            { role: 'system', content: '把语音转写准确翻译成中文，只输出中文译文，不补充事实。' },
            { role: 'user', content: parsed.transcript }
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
      transcript: parsed.transcript,
      chinese,
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

module.exports = {
  transcribe,
  runCommand,
  tokenizeCommand,
  discoverFfmpeg,
  engineStatus,
  executableOnPath,
  sourceRoot,
  resolveSenseVoiceLayout,
  parseSenseVoiceOutput
};
