#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runNpmCommand, spawnFailureDetails } = require('./host-command-runner');
const { BINDING_RELATIVE_PATH, canonicalBuffer, createBindingDocument, createPlatformBinding, platformKey, validateBindingDocument } = require('./production-dependency-binding');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TARGETS = Object.freeze([{ platform: 'linux', arch: 'x64' }, { platform: 'win32', arch: 'x64' }]);

function runNpmInstall(repoRoot, target, npmVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp7-dependency-binding-${target.platform}-${target.arch}-`));
  fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
  fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(root, 'package-lock.json'));
  const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-bin-links', `--os=${target.platform}`, `--cpu=${target.arch}`];
  const result = runNpmCommand(args, { cwd: root });
  if (result.status !== 0) throw new Error(`npm production dependency install failed for ${platformKey(target.platform, target.arch)}\n${JSON.stringify(spawnFailureDetails(result), null, 2)}`);
  fs.rmSync(path.join(root, 'node_modules', '.package-lock.json'), { force: true });
  return { root, npmVersion };
}

function main() {
  const versionResult = runNpmCommand(['--version']);
  if (versionResult.status !== 0) throw new Error(`npm --version failed
${JSON.stringify(spawnFailureDetails(versionResult), null, 2)}`);
  const npmVersion = versionResult.stdout.trim();
  const hostOnly = process.argv.includes('--host-only');
  const outputPath = path.join(REPO_ROOT, ...BINDING_RELATIVE_PATH.split('/'));
  const platforms = hostOnly && fs.existsSync(outputPath)
    ? { ...validateBindingDocument(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).platforms }
    : {};
  const targets = hostOnly ? [{ platform: process.platform, arch: 'x64' }] : TARGETS;
  const roots = [];
  try {
    for (const target of targets) {
      const installed = runNpmInstall(REPO_ROOT, target, npmVersion);
      roots.push(installed.root);
      const key = platformKey(target.platform, target.arch);
      platforms[key] = createPlatformBinding({ repoRoot: REPO_ROOT, appRoot: installed.root, platform: target.platform, arch: target.arch, npmVersion });
    }
    const document = createBindingDocument({ repoRoot: REPO_ROOT, platforms, npmVersion });
    fs.writeFileSync(outputPath, canonicalBuffer(document));
    process.stdout.write(`${JSON.stringify({ status: 'PASS', outputPath, platforms: Object.fromEntries(Object.entries(platforms).map(([key, row]) => [key, { packageCount: row.packageCount, fileCount: row.fileCount, directoryCount: row.directoryCount, packageGraphSha256: row.packageGraphSha256, dependencyFileTreeSha256: row.dependencyFileTreeSha256, dependencyModeTreeSha256: row.dependencyModeTreeSha256, dependencyDirectoryModeTreeSha256: row.dependencyDirectoryModeTreeSha256, modeBoundFileCount: row.modeBoundFileCount, modeBoundDirectoryCount: row.modeBoundDirectoryCount, fileModePolicy: row.fileModePolicy, directoryModePolicy: row.directoryModePolicy }])) }, null, 2)}\n`);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); }
