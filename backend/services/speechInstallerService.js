'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');
const logger = require('./logger');
const transcription = require('./transcriptionService');

function sourceRoot() { return path.resolve(__dirname, '..', '..'); }
function runtimeRoot() {
  const configured = String(process.env.YANCE_VOICE_BRAIN_RUNTIME_DIR || '').trim();
  return path.resolve(configured || path.join(PATHS.root, 'runtime', 'voice-brain'));
}
function statusPath() { return path.join(PATHS.models, 'voice-brain', 'sealed-runtime-status.json'); }
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') logger.warn('speech', 'voice-brain-status-read-failed', {
      operation: 'speechInstaller.status',
      accountId: '',
      conversationId: '',
      reasonCode: error.code || 'VOICE_BRAIN_STATUS_READ_FAILED',
      httpStatus: 0,
      attempt: 1,
      nextRetryAt: '',
      file,
      error: error.message
    });
    return fallback;
  }
}

function cosyVoiceRuntimeStatus() {
  const roots = [
    runtimeRoot(),
    path.join(sourceRoot(), 'runtime', 'voice-brain')
  ];
  const pythonName = process.platform === 'win32' ? 'python.exe' : 'python';
  const candidates = roots.flatMap(root => [
    path.join(root, 'cosyvoice', 'python', pythonName),
    path.join(root, 'cosyvoice', 'runtime', pythonName),
    path.join(root, 'python', pythonName)
  ]);
  const executable = candidates.find(file => {
    try { return fs.statSync(file).isFile(); } catch (_) { return false; }
  }) || '';
  return Object.freeze({ authority: 'CosyVoice', available: Boolean(executable), executable });
}

function status() {
  const asr = transcription.engineStatus();
  const tts = cosyVoiceRuntimeStatus();
  const persisted = readJson(statusPath(), {});
  const ready = asr.available === true && tts.available === true;
  return Object.freeze({
    ok: true,
    product: 'Voice Brain',
    authority: { asr: 'SenseVoice', tts: 'CosyVoice' },
    available: ready,
    running: false,
    installSupported: false,
    provisionMode: 'sealed-build-only',
    runtimeRoot: runtimeRoot(),
    statusFile: statusPath(),
    install: persisted,
    engine: asr,
    cosyVoice: tts,
    reasonCode: ready ? '' : !asr.available ? asr.reasonCode : 'COSYVOICE_RUNTIME_MISSING'
  });
}

function startInstall() {
  const current = status();
  if (current.available) return { ...current, started: false, alreadyReady: true };
  const error = new Error('Voice Brain runtime is provisioned only by the sealed build pipeline; dynamic application-time installation is disabled.');
  error.code = 'VOICE_BRAIN_SEALED_RUNTIME_MISSING';
  error.reasonCode = 'VOICE_BRAIN_SEALED_RUNTIME_MISSING';
  error.status = 409;
  error.details = { runtimeRoot: current.runtimeRoot, reasonCode: current.reasonCode };
  throw error;
}

module.exports = { status, startInstall, runtimeRoot, statusPath, cosyVoiceRuntimeStatus };
