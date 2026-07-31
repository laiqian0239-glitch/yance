'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WINDOWS_SHELL_META_RE = /[&|<>^\r\n]/;

function assertStringArray(args) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    throw new TypeError('command arguments must be an array of NUL-free strings');
  }
}

function assertSafeWindowsShim(command) {
  const value = String(command || '');
  if (!value || value.includes('\0') || WINDOWS_SHELL_META_RE.test(value)) {
    throw new TypeError('Windows command shim path contains unsafe shell characters');
  }
  if (path.extname(value).toLowerCase() !== '.cmd') {
    throw new TypeError('Windows npm command must be an npm.cmd shim');
  }
  if (path.basename(value).toLowerCase() !== 'npm.cmd') {
    throw new TypeError('Windows npm command must resolve to npm.cmd');
  }
  return value;
}

function npmCommandForPlatform(platform = process.platform, explicitCommand) {
  if (platform === 'win32') return assertSafeWindowsShim(explicitCommand || 'npm.cmd');
  const command = explicitCommand || 'npm';
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new TypeError('npm command is invalid');
  return command;
}

function resolvePinnedNpmInvocation(options = {}) {
  const nodeExecutable = path.resolve(options.nodeExecutable || process.env.YANCE_NODE_EXE || process.execPath);
  const npmCli = options.npmCli || process.env.YANCE_NPM_CLI_JS || '';
  if (!npmCli) return null;
  const npmCliPath = path.resolve(npmCli);
  if (!fs.existsSync(npmCliPath) && options.allowMissingPinnedNpm !== true) {
    throw new Error(`pinned npm CLI is missing: ${npmCliPath}`);
  }
  return { command: nodeExecutable, prefixArgs: [npmCliPath], npmCliPath, nodeExecutable };
}

function npmInvocationForPlatform(platform = process.platform, options = {}) {
  const pinned = resolvePinnedNpmInvocation(options);
  if (pinned) return { ...pinned, shell: false, mode: 'PINNED_NODE_NPM_CLI' };
  return {
    command: npmCommandForPlatform(platform, options.command),
    prefixArgs: [],
    shell: platform === 'win32',
    mode: platform === 'win32' ? 'WINDOWS_NPM_CMD_SHIM' : 'DIRECT_NPM'
  };
}

function runNpmCommand(args, options = {}) {
  assertStringArray(args);
  const platform = options.platform || process.platform;
  const invocation = npmInvocationForPlatform(platform, options);
  const spawn = options.spawn || spawnSync;
  return spawn(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: options.cwd,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    env: options.env || process.env,
    shell: invocation.shell,
    windowsHide: true,
    timeout: options.timeout
  });
}

function spawnFailureDetails(result) {
  const value = result || {};
  return {
    status: Number.isInteger(value.status) ? value.status : null,
    signal: typeof value.signal === 'string' ? value.signal : null,
    errorCode: typeof value.error?.code === 'string' ? value.error.code : null,
    errorMessage: typeof value.error?.message === 'string' ? value.error.message : null,
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : ''
  };
}

module.exports = {
  npmCommandForPlatform,
  npmInvocationForPlatform,
  resolvePinnedNpmInvocation,
  runNpmCommand,
  spawnFailureDetails
};
