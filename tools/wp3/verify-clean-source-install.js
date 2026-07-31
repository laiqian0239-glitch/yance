#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const get = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : '';
  return { sourceZip: get('--source-zip'), gitBundle: get('--git-bundle'), sourceCommit: get('--source-commit'), sourceTree: get('--source-tree'), sourceBranch: get('--source-branch'), output: get('--output'), windowsEvidence: get('--windows-evidence') };
}
function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...(options.env || {}) } });
  return { command: [command, ...args].join(' '), status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const args = parseArgs(process.argv.slice(2));
if (!args.sourceZip) { process.stderr.write('WP3_CLEAN_SOURCE_ZIP_REQUIRED --source-zip is required\n'); process.exit(2); }
if (!args.gitBundle) { process.stderr.write('WP3_CLEAN_SOURCE_GIT_BUNDLE_REQUIRED --git-bundle is required\n'); process.exit(2); }
if (!/^[0-9a-f]{40}$/.test(args.sourceCommit)) { process.stderr.write('WP3_CLEAN_SOURCE_COMMIT_REQUIRED --source-commit must be a full lowercase Git commit\n'); process.exit(2); }
if (!/^[0-9a-f]{40}$/.test(args.sourceTree)) { process.stderr.write('WP3_CLEAN_SOURCE_TREE_REQUIRED --source-tree must be a full lowercase Git tree\n'); process.exit(2); }
if (!/^[0-9A-Za-z._/-]+$/.test(args.sourceBranch) || args.sourceBranch.startsWith('-') || args.sourceBranch.includes('..')) { process.stderr.write('WP3_CLEAN_SOURCE_BRANCH_REQUIRED --source-branch must be a safe Git branch name\n'); process.exit(2); }
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-clean-install-'));
const sourceRoot = path.join(tempRoot, 'source');
fs.mkdirSync(sourceRoot, { recursive: true });
const steps = [];
try {
  let extract;
  if (process.platform === 'win32') extract = run('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `Expand-Archive -LiteralPath '${path.resolve(args.sourceZip).replaceAll("'", "''")}' -DestinationPath '${sourceRoot.replaceAll("'", "''")}' -Force`], tempRoot);
  else extract = run('unzip', ['-q', path.resolve(args.sourceZip), '-d', sourceRoot], tempRoot);
  steps.push(extract);
  if (extract.status !== 0) throw Object.assign(new Error('Source ZIP extraction failed'), { reasonCode: 'WP3_SOURCE_ZIP_EXTRACT_FAILED' });
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  const repo = entries.length === 1 && entries[0].isDirectory() && fs.existsSync(path.join(sourceRoot, entries[0].name, 'package.json')) ? path.join(sourceRoot, entries[0].name) : sourceRoot;
  if (fs.existsSync(path.join(repo, 'node_modules'))) throw Object.assign(new Error('Clean Source ZIP unexpectedly contains node_modules'), { reasonCode: 'WP3_SOURCE_ZIP_CONTAINS_NODE_MODULES' });
  if (fs.existsSync(path.join(repo, '.git'))) throw Object.assign(new Error('Clean Source ZIP unexpectedly contains .git metadata'), { reasonCode: 'WP3_SOURCE_ZIP_CONTAINS_GIT_METADATA' });
  for (const [command, commandArgs] of [
    ['git', ['init','-q']],
    ['git', ['fetch','-q',path.resolve(args.gitBundle),`+refs/heads/${args.sourceBranch}:refs/remotes/bundle/${args.sourceBranch}`,'+refs/tags/*:refs/tags/*']],
    ['git', ['reset','--mixed',args.sourceCommit]],
    ['git', ['branch','-M',args.sourceBranch]],
    ['git', ['diff','--exit-code','--','.']],
    ['git', ['status','--porcelain=v1','--untracked-files=all']],
    ['git', ['rev-parse','HEAD']],
    ['git', ['rev-parse','HEAD^{tree}']]
  ]) {
    const step = run(command, commandArgs, repo);
    steps.push(step);
    if (step.status !== 0) throw Object.assign(new Error(`Source ZIP and Git bundle identity attachment failed: ${step.command}`), { reasonCode: 'WP3_CLEAN_SOURCE_IDENTITY_FAILED' });
    if (commandArgs[0] === 'status' && step.stdout.trim()) throw Object.assign(new Error(`Source ZIP differs from Git bundle: ${step.stdout}`), { reasonCode: 'WP3_SOURCE_ZIP_BUNDLE_MISMATCH' });
    if (commandArgs[0] === 'rev-parse' && commandArgs[1] === 'HEAD' && step.stdout.trim() !== args.sourceCommit) throw Object.assign(new Error('Restored source commit does not match expected commit'), { reasonCode: 'WP3_CLEAN_SOURCE_IDENTITY_MISMATCH' });
    if (commandArgs[0] === 'rev-parse' && commandArgs[1] === 'HEAD^{tree}' && step.stdout.trim() !== args.sourceTree) throw Object.assign(new Error('Restored source tree does not match expected tree'), { reasonCode: 'WP3_CLEAN_SOURCE_IDENTITY_MISMATCH' });
  }
  for (const [command, commandArgs] of [
    ['npm', ['ci','--ignore-scripts','--no-audit','--no-fund']],
    [process.execPath, ['--test', ...fs.readdirSync(path.join(repo,'tests','wp3')).filter(name => name.endsWith('.test.js')).map(name => `tests/wp3/${name}`)]],
    ['npm', ['run','test:wp2','--silent']],
    ['npm', ['run','test:wp1','--silent']],
    ['npm', ['run','test:wp0','--silent']],
    ['npm', ['run','verify:wp0:gate','--silent']]
  ]) {
    const step = run(command, commandArgs, repo);
    steps.push(step);
    if (step.status !== 0) throw Object.assign(new Error(`Clean source validation failed: ${step.command}`), { reasonCode: 'WP3_CLEAN_SOURCE_VALIDATION_FAILED' });
  }
  const evidenceArgs = ['tools/wp3/generate-evidence.js', '--output-dir', path.join(repo, 'evidence', 'wp3-clean-install')];
  if (args.windowsEvidence) evidenceArgs.push('--windows-evidence', path.resolve(args.windowsEvidence));
  const evidence = run(process.execPath, evidenceArgs, repo);
  steps.push(evidence);
  if (evidence.status !== 0) throw Object.assign(new Error('Clean source evidence generator failed'), { reasonCode: /WP3_WINDOWS_NAMED_MUTEX_NOT_EXECUTED/.test(evidence.stderr) ? 'WP3_WINDOWS_NAMED_MUTEX_NOT_EXECUTED' : 'WP3_CLEAN_SOURCE_EVIDENCE_FAILED' });
  const report = { schemaVersion: 1, workPackage: 'WP3', status: 'PASS', generatedAtUtc: new Date().toISOString(), sourceZip: path.resolve(args.sourceZip), gitBundle: path.resolve(args.gitBundle), sourceCommit: args.sourceCommit, sourceTree: args.sourceTree, sourceBranch: args.sourceBranch, nodeModulesPresentBeforeInstall: false, gitIdentityRestoredFromBundleWithoutSourceReplacement: true, packageManagerCommand: 'npm ci --ignore-scripts --no-audit --no-fund', steps: steps.map(row => ({ command: row.command, status: row.status })) };
  if (args.output) { fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true }); fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`); }
  process.stdout.write(`WP3_CLEAN_SOURCE_INSTALL_PASS ${JSON.stringify(report)}\n`);
} catch (error) {
  if (args.output) fs.writeFileSync(path.resolve(args.output), `${JSON.stringify({ schemaVersion: 1, workPackage: 'WP3', status: 'FAIL', reasonCode: error.reasonCode || 'WP3_CLEAN_SOURCE_INSTALL_FAILED', generatedAtUtc: new Date().toISOString(), steps: steps.map(row => ({ command: row.command, status: row.status, stdoutTail: row.stdout.slice(-2000), stderrTail: row.stderr.slice(-2000) })) }, null, 2)}\n`);
  process.stderr.write(`${error.reasonCode || 'WP3_CLEAN_SOURCE_INSTALL_FAILED'} ${error.stack || error.message}\n`);
  process.exit(1);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
