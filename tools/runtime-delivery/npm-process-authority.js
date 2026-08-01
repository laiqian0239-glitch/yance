'use strict';
const fs = require('node:fs');
const path = require('node:path');

function clean(value) { return String(value || '').trim(); }
function authorityError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, details });
}

function resolveNpmInvocation(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    return Object.freeze({ command: clean(options.npmCommand) || 'npm', argsPrefix: [], shell: false, npmCliPath: '' });
  }
  const nodeExecutable = path.resolve(clean(options.nodeExecutable) || process.execPath);
  const env = options.env || process.env;
  const exists = options.existsSync || fs.existsSync;
  const candidates = [
    clean(options.npmCliPath),
    clean(env.npm_execpath),
    path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean).map(candidate => path.resolve(candidate));
  const npmCliPath = candidates.find(candidate => exists(candidate));
  if (!npmCliPath) {
    throw authorityError('SOURCE_UAT_NPM_CLI_NOT_FOUND', '无法定位受信任的 npm-cli.js，拒绝通过 Windows 命令 shell 拼接参数', {
      nodeExecutable,
      candidates
    });
  }
  return Object.freeze({ command: nodeExecutable, argsPrefix: [npmCliPath], shell: false, npmCliPath });
}

module.exports = { resolveNpmInvocation };
