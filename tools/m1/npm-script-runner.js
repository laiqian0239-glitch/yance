'use strict';

const { spawnSync } = require('node:child_process');

/**
 * Run an npm script in a platform-compatible way.
 *
 * Windows exposes npm as npm.cmd. Node 22 may reject direct spawnSync of a
 * command shim with EINVAL, so the Windows path intentionally uses the shell.
 * Script names are internal constants, not user-controlled input.
 */
function runNpmScript(scriptName, options = {}) {
  if (typeof scriptName !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(scriptName)) {
    throw new TypeError('scriptName must be a non-empty npm script identifier');
  }

  const platform = options.platform || process.platform;
  const spawn = options.spawn || spawnSync;
  const npmExecutable = platform === 'win32' ? 'npm.cmd' : 'npm';

  return spawn(npmExecutable, ['run', scriptName], {
    cwd: options.cwd,
    stdio: options.stdio || 'inherit',
    env: options.env || process.env,
    shell: platform === 'win32',
    windowsHide: true
  });
}

module.exports = {
  runNpmScript
};
