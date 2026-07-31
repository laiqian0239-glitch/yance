'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REASON_CODE = 'WP2_API_SESSION_SECRET_LEAK_DETECTED';
const SKIP_ENV = 'WP2_SKIP_SERVER_MUTATION_META_GATE';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    spawnError: result.error ? String(result.error.message || result.error) : ''
  };
}

function listSourceTreeFiles(repoRoot) {
  const files = [];
  const excludedDirectories = new Set(['.git', 'node_modules']);
  function walk(directory, relativeDirectory = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (excludedDirectories.has(entry.name)) continue;
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative);
    }
  }
  walk(repoRoot);
  return files;
}

function listWorkingTreeFiles(repoRoot) {
  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, env: process.env });
  const files = result.exitCode === 0
    ? result.stdout.split('\0').filter(Boolean)
    : listSourceTreeFiles(repoRoot);
  return files.filter(relative => relative !== 'package-lock.json');
}

function copyWorkingTree(repoRoot, targetRoot) {
  for (const relative of listWorkingTreeFiles(repoRoot)) {
    const source = path.join(repoRoot, relative);
    const target = path.join(targetRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(source)) continue;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target);
    else fs.copyFileSync(source, target);
    try { if (!stat.isSymbolicLink()) fs.chmodSync(target, stat.mode); } catch (_) {}
  }
}

function git(targetRoot, args) {
  const result = run('git', args, { cwd: targetRoot, env: process.env });
  if (result.exitCode !== 0) {
    const error = new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    error.reasonCode = 'WP2_MUTATION_GIT_OPERATION_FAILED';
    throw error;
  }
  return result.stdout.trim();
}

function initializeMutationRepository(repoRoot) {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp2-real-server-mutation-'));
  copyWorkingTree(repoRoot, targetRoot);
  git(targetRoot, ['init', '-q']);
  git(targetRoot, ['config', 'user.name', 'WP2 Server Mutation Gate']);
  git(targetRoot, ['config', 'user.email', 'wp2-server-mutation@example.invalid']);
  git(targetRoot, ['add', '-A']);
  git(targetRoot, ['commit', '-q', '-m', 'WP2 mutation baseline']);
  return targetRoot;
}

function injectRealServerMutation(targetRoot) {
  const serverFile = path.join(targetRoot, 'backend', 'server.js');
  const marker = "const productionDiagnostics = require('./services/productionDiagnosticsService');";
  const source = fs.readFileSync(serverFile, 'utf8');
  if (!source.includes(marker)) {
    const error = new Error('Unable to locate the production diagnostics import in backend/server.js');
    error.reasonCode = 'WP2_SERVER_MUTATION_INJECTION_POINT_MISSING';
    throw error;
  }
  const mutation = `\nfunction wp2MutationRelay(opaqueValue) {\n  const state = require('node:crypto').createHash('sha256');\n  state.update(opaqueValue);\n  return state.digest('hex');\n}\nconst wp2MutationContextAlias = DESKTOP_STARTUP_CONTEXT;\nconst wp2MutationComputedField = ['api', 'Session', 'Token'].join('');\nproductionDiagnostics.recordEvent('wp2-real-server-mutation', {\n  severity: 'warning',\n  metadata: { fingerprint: wp2MutationRelay(wp2MutationContextAlias[wp2MutationComputedField]) }\n});\n`;
  fs.writeFileSync(serverFile, source.replace(marker, `${marker}${mutation}`), 'utf8');
  git(targetRoot, ['add', 'backend/server.js']);
  git(targetRoot, ['commit', '-q', '-m', 'Inject real backend server API session leak mutation']);
  return {
    file: 'backend/server.js',
    mutationCommit: git(targetRoot, ['rev-parse', 'HEAD']),
    mutationFeatures: [
      'DesktopHost startup context alias',
      'computed property access',
      'identifier names without token wording',
      'independent helper propagation',
      'cross-line SHA256 calculation',
      'real production diagnostics sink'
    ]
  };
}

function detected(result) {
  return `${result.stdout}\n${result.stderr}`.includes(REASON_CODE);
}

function runServerMutationGate(repoRoot, options = {}) {
  const sourceRoot = path.resolve(repoRoot);
  const targetRoot = initializeMutationRepository(sourceRoot);
  let mutation;
  try {
    mutation = injectRealServerMutation(targetRoot);
    const env = {
      ...process.env,
      NODE_PATH: path.join(sourceRoot, 'node_modules'),
      [SKIP_ENV]: '1'
    };
    delete env.NODE_TEST_CONTEXT;
    const requiredTest = run(process.execPath, [
      '--test',
      'tests/wp2/api-session-token-transport-leak-scan.test.js'
    ], { cwd: targetRoot, env });

    const evidenceOutput = path.join(os.tmpdir(), `yance-wp2-mutated-evidence-${process.pid}-${Date.now()}`);
    const evidenceGenerator = run(process.execPath, [
      'tools/wp2/generate-evidence.js',
      '--repo-root', targetRoot,
      '--output-dir', evidenceOutput
    ], { cwd: targetRoot, env });

    const summary = {
      schemaVersion: 1,
      status: requiredTest.exitCode !== 0 && evidenceGenerator.exitCode !== 0 && detected(requiredTest) && detected(evidenceGenerator) ? 'PASS' : 'FAIL',
      reasonCode: REASON_CODE,
      target: mutation.file,
      mutationCommit: mutation.mutationCommit,
      mutationFeatures: mutation.mutationFeatures,
      requiredTest: {
        exitCode: requiredTest.exitCode,
        reasonCodeObserved: detected(requiredTest)
      },
      evidenceGenerator: {
        exitCode: evidenceGenerator.exitCode,
        reasonCodeObserved: detected(evidenceGenerator)
      }
    };
    if (summary.status !== 'PASS') {
      const error = new Error('Real backend/server.js mutation was not rejected by every formal gate');
      error.reasonCode = 'WP2_SERVER_MUTATION_GATE_FAILED';
      error.details = {
        summary,
        requiredTestStdout: requiredTest.stdout.slice(-16000),
        requiredTestStderr: requiredTest.stderr.slice(-16000),
        evidenceStdout: evidenceGenerator.stdout.slice(-16000),
        evidenceStderr: evidenceGenerator.stderr.slice(-16000)
      };
      throw error;
    }
    return summary;
  } finally {
    if (options.keepTemporaryRepository !== true) fs.rmSync(targetRoot, { recursive: true, force: true });
  }
}

module.exports = { REASON_CODE, SKIP_ENV, runServerMutationGate };
