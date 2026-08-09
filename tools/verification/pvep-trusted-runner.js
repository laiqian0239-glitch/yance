#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COMMIT_RE = /^[0-9a-f]{40}$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(code, details = '') {
  const suffix = details ? `:${details}` : '';
  const error = new Error(`${code}${suffix}`);
  error.code = code;
  throw error;
}

function git(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', shell: false });
  if (result.status !== 0) fail('EVIDENCE_GIT_COMMAND_FAILED', (result.stderr || '').trim());
  return (result.stdout || '').trim();
}

const POSIX_CHILD_ENV_ALLOWLIST = ['PATH', 'TMPDIR', 'TMP', 'TEMP'];
const WINDOWS_CHILD_ENV_ALLOWLIST = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'];

function trustedChildEnvironment(environment, platform = process.platform) {
  const allowedNames = platform === 'win32' ? WINDOWS_CHILD_ENV_ALLOWLIST : POSIX_CHILD_ENV_ALLOWLIST;
  const caseInsensitive = platform === 'win32';
  const allowed = new Map(allowedNames.map((name) => [caseInsensitive ? name.toUpperCase() : name, name]));
  const result = {};

  for (const [name, value] of Object.entries(environment)) {
    if (typeof value !== 'string') continue;
    const lookup = caseInsensitive ? name.toUpperCase() : name;
    const canonicalName = allowed.get(lookup);
    if (!canonicalName || Object.hasOwn(result, canonicalName)) continue;
    result[canonicalName] = value;
  }
  return result;
}

function parseStatus(raw) {
  if (!raw) return [];
  return raw.split('\0').filter(Boolean).map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
}

function unexpectedWorkspaceEntries(repoRoot, generatedRoots) {
  const entries = parseStatus(git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  return entries.filter((entry) => {
    if (entry.status !== '??') return true;
    return !generatedRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`));
  });
}

function validateCommandSet(commandSet) {
  if (!commandSet || commandSet.schemaVersion !== 1 || typeof commandSet.commandSetId !== 'string') fail('EVIDENCE_COMMAND_SET_INVALID');
  if (!['linux', 'windows'].includes(commandSet.platform)) fail('EVIDENCE_COMMAND_SET_INVALID');
  if (!Array.isArray(commandSet.commands) || commandSet.commands.length === 0) fail('EVIDENCE_COMMAND_SET_INVALID');
  const ids = new Set();
  for (const command of commandSet.commands) {
    if (!command || typeof command.commandId !== 'string' || ids.has(command.commandId)) fail('EVIDENCE_COMMAND_SET_INVALID');
    ids.add(command.commandId);
    if (command.executable !== 'node' || !Array.isArray(command.argv) || command.argv.length === 0) fail('EVIDENCE_COMMAND_SET_INVALID');
    if (!Number.isSafeInteger(command.expectedExitCode)) fail('EVIDENCE_COMMAND_SET_INVALID');
    if (!Array.isArray(command.generatedRoots) || !Array.isArray(command.artifacts)) fail('EVIDENCE_COMMAND_SET_INVALID');
    for (const value of [...command.argv, ...command.generatedRoots, ...command.artifacts]) {
      if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')) fail('EVIDENCE_COMMAND_SET_INVALID');
    }
  }
}

function parseArgs(argv) {
  if (argv[0] !== 'run') fail('EVIDENCE_CLI_ARGUMENT_INVALID');
  const allowed = new Set(['--repo-root', '--trusted-command-set-root', '--repository', '--work-package', '--gate-id', '--base', '--head', '--command-set', '--output', '--subject-output']);
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!allowed.has(key) || value === undefined || Object.hasOwn(values, key)) fail('EVIDENCE_CLI_ARGUMENT_INVALID');
    values[key] = value;
  }
  if (Object.keys(values).length !== allowed.size) fail('EVIDENCE_CLI_ARGUMENT_INVALID');
  if (!COMMIT_RE.test(values['--base']) || !COMMIT_RE.test(values['--head'])) fail('EVIDENCE_CLI_ARGUMENT_INVALID');
  return values;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args['--repo-root']);
  const trustedCommandSetRoot = path.resolve(args['--trusted-command-set-root']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  if (head !== args['--head']) fail('EVIDENCE_WORKSPACE_HEAD_MISMATCH');

  const commandSetPath = path.resolve(trustedCommandSetRoot, args['--command-set']);
  if (!(commandSetPath === trustedCommandSetRoot || commandSetPath.startsWith(`${trustedCommandSetRoot}${path.sep}`))) fail('EVIDENCE_PATH_INVALID');
  const commandSetBytes = fs.readFileSync(commandSetPath);
  const commandSet = JSON.parse(commandSetBytes.toString('utf8'));
  validateCommandSet(commandSet);
  const platform = process.platform === 'win32' ? 'windows' : 'linux';
  if (commandSet.platform !== platform) fail('EVIDENCE_PLATFORM_MISMATCH');

  const generatedRoots = [...new Set(commandSet.commands.flatMap((command) => command.generatedRoots))].sort();
  const preUnexpected = unexpectedWorkspaceEntries(repoRoot, generatedRoots);
  if (preUnexpected.length !== 0) fail('EVIDENCE_WORKSPACE_DIRTY');

  const commands = [];
  let allPassed = true;
  for (const command of commandSet.commands) {
    const startedAt = new Date().toISOString();
    const child = spawnSync(command.executable, command.argv, {
      cwd: repoRoot,
      shell: false,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
      env: trustedChildEnvironment(process.env)
    });
    const completedAt = new Date().toISOString();
    const stdout = child.stdout || Buffer.alloc(0);
    const stderr = child.stderr || Buffer.alloc(0);
    const exitCode = Number.isSafeInteger(child.status) ? child.status : -1;
    const passed = exitCode === command.expectedExitCode && !child.signal && !child.error;
    if (!passed) allPassed = false;
    commands.push({
      commandId: command.commandId,
      executable: command.executable,
      argv: command.argv,
      expectedExitCode: command.expectedExitCode,
      exitCode,
      signal: child.signal || null,
      errorCode: child.error && typeof child.error.code === 'string' ? child.error.code : null,
      startedAt,
      completedAt,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
      passed
    });
  }

  const postHead = git(repoRoot, ['rev-parse', 'HEAD']);
  if (postHead !== args['--head']) fail('EVIDENCE_WORKSPACE_HEAD_MISMATCH');
  const postUnexpected = unexpectedWorkspaceEntries(repoRoot, generatedRoots);
  if (postUnexpected.length !== 0) fail('EVIDENCE_WORKSPACE_DIRTY');

  const evidence = {
    schemaVersion: 1,
    recordType: 'YANCE_PVEP_VERIFICATION_EVIDENCE',
    repository: args['--repository'],
    workPackage: args['--work-package'],
    gateId: args['--gate-id'],
    baseCommit: args['--base'],
    headCommit: args['--head'],
    platform,
    commandSet: {
      path: args['--command-set'],
      commandSetId: commandSet.commandSetId,
      sha256: sha256(commandSetBytes)
    },
    execution: { commands },
    workspace: {
      preHead: head,
      postHead,
      allowedGeneratedRoots: generatedRoots
    },
    verificationStatus: allPassed ? 'VERIFIED_PASS' : 'VERIFIED_FAIL'
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const subjectText = `YANCE_PVEP_SUBJECT_V1\nrepository=${args['--repository']}\nhead=${args['--head']}\nplatform=${platform}\ncommandSetSha256=${evidence.commandSet.sha256}\n`;
  const subjectOutput = path.resolve(args['--subject-output']);
  fs.mkdirSync(path.dirname(subjectOutput), { recursive: true });
  fs.writeFileSync(subjectOutput, subjectText, 'utf8');
  const output = path.resolve(args['--output']);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, 'utf8');
  if (!HASH_RE.test(sha256(Buffer.from(serialized)))) fail('EVIDENCE_INTERNAL_DIGEST_INVALID');
  if (!allPassed) {
    for (const command of commands) {
      if (command.passed) continue;
      const diagnostic = {
        commandId: command.commandId,
        expectedExitCode: command.expectedExitCode,
        exitCode: command.exitCode,
        signal: command.signal,
        errorCode: command.errorCode,
        stdoutSha256: command.stdoutSha256,
        stderrSha256: command.stderrSha256
      };
      process.stderr.write(`EVIDENCE_COMMAND_FAILED ${JSON.stringify(diagnostic)}\n`);
    }
    process.exitCode = 1;
  }
  return evidence;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run, trustedChildEnvironment, validateCommandSet };
