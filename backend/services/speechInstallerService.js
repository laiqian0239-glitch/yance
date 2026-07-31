'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PATHS } = require('../config');
const logger = require('./logger');
const transcription = require('./transcriptionService');

let activeChild = null;
let activeStartedAt = '';

function sourceRoot() { return path.resolve(__dirname, '..', '..'); }
function installerScript() { return path.join(sourceRoot(), 'tools', 'runtime-delivery', 'install-local-whisper.ps1'); }
function statusPath() { return path.join(PATHS.models, 'whisper', 'install-status.json'); }
function logPath() { return path.join(PATHS.logs, 'speech-installer.log'); }
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') logger.warn('speech', 'installer-status-read-failed', { operation: 'speechInstaller.status', accountId: '', conversationId: '', reasonCode: error.code || 'SPEECH_INSTALLER_STATUS_READ_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', file, error: error.message });
    return fallback;
  }
}
function status() {
  const engine = transcription.engineStatus();
  const persisted = readJson(statusPath(), {});
  const running = Boolean(activeChild && activeChild.exitCode == null);
  return {
    ok: true,
    running,
    startedAt: activeStartedAt,
    installerScript: installerScript(),
    logFile: logPath(),
    install: persisted,
    engine
  };
}
function startInstall() {
  const current = status();
  if (current.engine.whatsappAudioReady) return { ...current, started: false, alreadyReady: true };
  if (current.running) return { ...current, started: false, alreadyRunning: true };
  if (process.platform !== 'win32') throw Object.assign(new Error('自动安装当前只支持 Windows。'), { code: 'SPEECH_INSTALL_PLATFORM_UNSUPPORTED', status: 409 });
  const script = installerScript();
  if (!fs.existsSync(script)) throw Object.assign(new Error('本地语音安装脚本不存在。'), { code: 'SPEECH_INSTALLER_SCRIPT_MISSING', status: 500 });
  fs.mkdirSync(PATHS.logs, { recursive: true });
  fs.mkdirSync(path.dirname(statusPath()), { recursive: true });
  const output = fs.openSync(logPath(), 'a');
  activeStartedAt = new Date().toISOString();
  activeChild = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DataRoot', PATHS.root], {
    windowsHide: true,
    detached: false,
    stdio: ['ignore', output, output]
  });
  fs.closeSync(output);
  activeChild.once('error', error => {
    logger.error('speech', 'installer-start-failed', { operation: 'speechInstaller.start', accountId: '', conversationId: '', reasonCode: error.code || 'SPEECH_INSTALLER_START_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', error: error.message });
  });
  activeChild.once('close', code => {
    logger.info('speech', 'installer-finished', { operation: 'speechInstaller.start', accountId: '', conversationId: '', reasonCode: code === 0 ? 'SPEECH_INSTALLER_READY' : 'SPEECH_INSTALLER_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', exitCode: Number(code || 0) });
    activeChild = null;
  });
  return { ...status(), started: true, pid: activeChild.pid };
}

module.exports = { status, startInstall, installerScript, statusPath, logPath };
