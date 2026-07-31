'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function bridgeError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}

function resolveTrustedNodeRuntime(options = {}) {
  const requested = String(options.executablePath || options.trustedNodeExecutablePath || '').trim();
  if (!requested || !path.isAbsolute(requested) || !fs.existsSync(requested)) {
    throw bridgeError('WP7_SQLITE_BRIDGE_RUNTIME_BYPASS_DETECTED', 'SQLite bridge requires an explicit trusted Node executable', { executablePath: requested });
  }
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw bridgeError('WP7_SQLITE_BRIDGE_RUNTIME_BYPASS_DETECTED', 'SQLite bridge runtime must be a regular non-symlink file', { executablePath: requested });
  }
  return Object.freeze({ executablePath: fs.realpathSync(requested) });
}

class SqliteSettingsBridge {
  constructor(options = {}) {
    this.runtime = resolveTrustedNodeRuntime(options);
    this.workerPath = path.resolve(options.workerPath || path.join(__dirname, 'sqliteSettingsWorker.js'));
    if (!fs.existsSync(this.workerPath) || !fs.lstatSync(this.workerPath).isFile() || fs.lstatSync(this.workerPath).isSymbolicLink()) {
      throw bridgeError('WP7_SQLITE_BRIDGE_WORKER_INVALID', 'SQLite settings worker must be a regular reviewed file', { workerPath: this.workerPath });
    }
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 5000));
    this.environment = { ...(options.environment || process.env) };
    delete this.environment.ELECTRON_RUN_AS_NODE;
    const dataRoot = String(this.environment.YANCE_DATA_DIR || this.environment.WORKBUDDY_DATA_DIR || '').trim();
    const settingsDbPath = String(options.settingsDbPath || this.environment.YANCE_SETTINGS_SQLITE_PATH || (dataRoot ? path.join(dataRoot, 'settings', 'desktop-settings.db') : '')).trim();
    if (!dataRoot || !settingsDbPath || !path.isAbsolute(settingsDbPath)) {
      throw bridgeError('WP7_SQLITE_BRIDGE_TRUSTED_PATH_REQUIRED', 'SQLite settings bridge requires a trusted data root and settings DB path');
    }
    this.settingsDbPath = path.resolve(settingsDbPath);
    this.environment.YANCE_SETTINGS_SQLITE_PATH = this.settingsDbPath;
    this.environment.YANCE_PRIMARY_SQLITE_PATH = String(this.environment.YANCE_PRIMARY_SQLITE_PATH || path.join(dataRoot, 'store', 'yance-r32.db'));
  }

  run(operation, payload = {}) {
    delete this.environment.ELECTRON_RUN_AS_NODE;
    const request = JSON.stringify({ operation, ...payload, dbPath: this.settingsDbPath });
    const result = spawnSync(this.runtime.executablePath, [this.workerPath], {
      cwd: path.dirname(this.workerPath),
      env: this.environment,
      input: request,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    let response = null;
    try { response = JSON.parse(String(result.stdout || '{}')); } catch (_) {}
    if (result.status !== 0 || !response || response.ok === false) {
      const reasonCode = response?.reasonCode || result.error?.code || 'SQLITE_SETTINGS_WORKER_FAILED';
      const error = bridgeError(reasonCode, response?.message || String(result.stderr || result.error?.message || `sqlite settings worker failed with status ${result.status}`), {
        status: result.status,
        signal: result.signal || null,
        stderr: String(result.stderr || '')
      });
      throw error;
    }
    return response;
  }

  probe() { return this.run('probe'); }
}

module.exports = { SqliteSettingsBridge, resolveTrustedNodeRuntime };
