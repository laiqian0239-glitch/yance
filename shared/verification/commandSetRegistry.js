'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalSha256 } = require('./jcs');
const { validRelativePath } = require('./canonicalEvidenceReceipt');
const { REASON_CODES } = require('./reasonCodes');

const COMMAND_SET_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const WRAPPERS = new Set(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const CONTROLLED_ROOTS = new Set(['shared', 'governance', 'tools', 'tests', 'backend', 'electron', 'services', 'scripts', 'release', '.github']);

function ok(value) { return { pass: true, value }; }
function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validCommandId(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/u.test(value); }
function containsShellSyntax(value) { return typeof value !== 'string' || /[*?\[\]|;&><`$\n\r]/u.test(value); }
function generatedRootAllowed(value) {
  if (!validRelativePath(value)) return false;
  return !CONTROLLED_ROOTS.has(value.split('/')[0]);
}

function validateCommandSet(commandSet) {
  if (!exactKeys(commandSet, ['schemaVersion', 'commandSetId', 'platform', 'commands'])) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
  if (commandSet.schemaVersion !== 1 || !COMMAND_SET_ID_RE.test(commandSet.commandSetId || '') || !['linux', 'windows'].includes(commandSet.platform) || !Array.isArray(commandSet.commands) || commandSet.commands.length === 0) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
  if (!commandSet.commandSetId.startsWith(`pvep-${commandSet.platform}-`)) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);

  const ids = new Set();
  for (const command of commandSet.commands) {
    if (!exactKeys(command, ['commandId', 'executable', 'argv', 'expectedExitCode', 'generatedRoots', 'artifacts'])) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (!validCommandId(command.commandId) || typeof command.executable !== 'string' || !command.executable || WRAPPERS.has(command.executable.toLowerCase()) || command.executable.includes('/') || command.executable.includes('\\')) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (ids.has(command.commandId)) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    ids.add(command.commandId);
    if (!Array.isArray(command.argv) || command.argv.some((arg) => containsShellSyntax(arg) || arg === '..' || arg.startsWith('../') || arg.includes('/../') || arg.includes('\\'))) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (!Number.isSafeInteger(command.expectedExitCode)) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (!Array.isArray(command.generatedRoots) || command.generatedRoots.some((root) => !generatedRootAllowed(root))) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (!Array.isArray(command.artifacts) || command.artifacts.some((artifact) => !validRelativePath(artifact) || !command.generatedRoots.some((root) => artifact === root || artifact.startsWith(`${root}/`)))) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    if (new Set(command.artifacts).size !== command.artifacts.length) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
  }
  return ok(commandSet);
}

function commandSetDigest(commandSet) {
  const result = validateCommandSet(commandSet);
  if (!result.pass) {
    const error = new Error(result.reasonCode);
    error.code = result.reasonCode;
    throw error;
  }
  return canonicalSha256(commandSet);
}

function loadCommandSet({ repoRoot, commandSetId }) {
  if (!COMMAND_SET_ID_RE.test(commandSetId || '')) {
    const error = new Error(REASON_CODES.EVIDENCE_COMMAND_SET_UNTRUSTED);
    error.code = REASON_CODES.EVIDENCE_COMMAND_SET_UNTRUSTED;
    throw error;
  }
  const file = path.join(path.resolve(repoRoot), 'governance', 'verification', 'command-sets', `${commandSetId}.json`);
  const commandSet = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validateCommandSet(commandSet);
  if (!validation.pass || commandSet.commandSetId !== commandSetId) {
    const error = new Error(validation.reasonCode || REASON_CODES.EVIDENCE_COMMAND_SET_INVALID);
    error.code = validation.reasonCode || REASON_CODES.EVIDENCE_COMMAND_SET_INVALID;
    throw error;
  }
  return commandSet;
}

module.exports = { COMMAND_SET_ID_RE, commandSetDigest, loadCommandSet, validateCommandSet };
