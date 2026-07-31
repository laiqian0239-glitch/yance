'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TARGET_ENV = 'YANCE_WINDOWS_SHORT_PATH_TARGET';

function normalizeWindowsPathLexically(value) {
  const raw = String(value || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '\\');
  if (!raw) return '';
  const normalized = path.win32.normalize(raw);
  const root = path.win32.parse(normalized).root;
  let result = normalized;
  while (result.length > root.length && result.endsWith('\\')) result = result.slice(0, -1);
  return result.toLowerCase();
}

function resolveWindowsShortPath(target, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    return {
      applicable: false,
      status: 'NOT_APPLICABLE',
      reasonCode: 'WINDOWS_SHORT_PATH_NOT_APPLICABLE'
    };
  }

  const spawn = options.spawn || spawnSync;
  const exists = options.exists || fs.existsSync;
  const absolute = path.resolve(target);
  const commandInterpreter = options.commandInterpreter || process.env.ComSpec || 'cmd.exe';
  const command = `for %I in ("%${TARGET_ENV}%") do @echo %~sI`;
  const result = spawn(commandInterpreter, ['/d', '/c', command], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true,
    env: { ...process.env, [TARGET_ENV]: absolute }
  });

  const stdout = String(result?.stdout || '').trim();
  const stderr = String(result?.stderr || '').trim();
  const exitCode = Number.isInteger(result?.status) ? result.status : null;
  if (result?.error || exitCode !== 0) {
    return {
      applicable: true,
      status: 'FAIL',
      reasonCode: 'WINDOWS_SHORT_PATH_COMMAND_FAILED',
      targetPath: absolute,
      commandInterpreter,
      exitCode,
      stdout,
      stderr,
      error: result?.error?.message || ''
    };
  }

  const candidate = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || '';
  const outputValid = Boolean(candidate) && path.win32.isAbsolute(candidate) && !candidate.includes('\"');
  const lexicalCandidate = outputValid ? normalizeWindowsPathLexically(candidate) : '';
  const lexicalTarget = normalizeWindowsPathLexically(absolute);
  const lexicallyDistinct = Boolean(lexicalCandidate) && lexicalCandidate !== lexicalTarget;
  const shortPathExists = outputValid ? exists(candidate) : false;
  const available = outputValid && lexicallyDistinct && shortPathExists;
  return {
    applicable: true,
    status: available ? 'PASS' : 'FAIL',
    reasonCode: available
      ? 'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE'
      : (!outputValid
          ? 'WINDOWS_SHORT_PATH_COMMAND_OUTPUT_INVALID'
          : (candidate && !shortPathExists ? 'WINDOWS_SHORT_PATH_ALIAS_NOT_RESOLVABLE' : 'WINDOWS_SHORT_PATH_ALIAS_UNAVAILABLE')),
    targetPath: absolute,
    shortPath: candidate,
    commandInterpreter,
    exitCode,
    stdout,
    stderr,
    outputValid,
    shortPathExists,
    lexicallyDistinct,
    invocationMethod: 'CMD_ENV_FOR_WITH_WINDOWS_VERBATIM_ARGUMENTS',
    comparisonMethod: 'LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION'
  };
}

module.exports = {
  TARGET_ENV,
  normalizeWindowsPathLexically,
  resolveWindowsShortPath
};
