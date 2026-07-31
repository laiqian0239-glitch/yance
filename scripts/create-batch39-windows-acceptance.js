#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function write(file, value) {
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createArchive(sourceDir, outputFile) {
  if (process.platform === 'win32') {
    const pattern = path.join(sourceDir, '*');
    const command = `Compress-Archive -Path '${pattern.replace(/'/g, "''")}' -DestinationPath '${outputFile.replace(/'/g, "''")}' -Force`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Compress-Archive failed');
    return;
  }
  const files = fs.readdirSync(sourceDir).sort();
  const result = spawnSync('zip', ['-q', '-j', outputFile, ...files.map(name => path.join(sourceDir, name))], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'zip failed');
}

function main() {
  const commit = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const short = commit.slice(0, 7);
  const outputRoot = path.resolve(process.argv.includes('--output-dir')
    ? process.argv[process.argv.indexOf('--output-dir') + 1]
    : path.join(ROOT, 'artifacts'));
  fs.mkdirSync(outputRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch39-acceptance-'));
  const archive = path.join(outputRoot, `YANCE_BATCH39_WINDOWS_ACCEPTANCE_${short}.zip`);

  const manifest = {
    schemaVersion: 2,
    packageKind: 'YANCE_BATCH39_WINDOWS_ACCEPTANCE',
    generatedAtUtc: new Date().toISOString(),
    sourceCommit: commit,
    sourceTree: tree,
    requiredPlatform: 'win32',
    requiredFiles: [
      'tools/wp3/test-summary.js',
      'tools/wp3/windows-named-mutex-evidence.js',
      'tools/wp3/generate-evidence.js',
      'tests/wp3/test-summary-contract.test.js',
      'tests/wp3/windows-named-mutex-real.test.js'
    ],
    strictSummary: { exitCode: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 },
    governance: {
      WINDOWS_UAT_BLOCKED: true,
      readyForPromotion: false,
      formalRelease: false,
      releaseCondition: 'Clear only after real Windows evidence passes and source commit/tree match this manifest.'
    }
  };
  write(path.join(staging, 'BATCH39_WINDOWS_ACCEPTANCE_MANIFEST.json'), manifest);
  write(path.join(staging, 'RUN_BATCH39_WINDOWS_ACCEPTANCE.cmd'), [
    '@echo off',
    'setlocal enabledelayedexpansion',
    'cd /d "%~dp0\\.."',
    "for /f %%i in ('git rev-parse HEAD') do set ACTUAL_COMMIT=%%i",
    `if /I not "!ACTUAL_COMMIT!"=="${commit}" ( echo SOURCE_COMMIT_MISMATCH & exit /b 20 )`,
    "for /f %%i in ('git rev-parse HEAD^^{tree}') do set ACTUAL_TREE=%%i",
    `if /I not "!ACTUAL_TREE!"=="${tree}" ( echo SOURCE_TREE_MISMATCH & exit /b 21 )`,
    'call npm ci --ignore-scripts --no-audit --no-fund || exit /b 30',
    'node --test --test-reporter=tap --test-concurrency=1 tests/wp3/test-summary-contract.test.js tests/wp3/evidence-generator-isolation.test.js || exit /b 31',
    'node tools/wp3/windows-named-mutex-evidence.js --output evidence\\wp3\\windows-named-mutex-real.json || exit /b 32',
    'node tools/wp3/generate-evidence.js --windows-evidence evidence\\wp3\\windows-named-mutex-real.json || exit /b 33',
    'echo BATCH39_WINDOWS_ACCEPTANCE_PASS',
    'exit /b 0',
    ''
  ].join('\r\n'));
  write(path.join(staging, 'BATCH39_WINDOWS_ACCEPTANCE_ZH.md'), [
    '# Batch39 Windows 验收说明',
    '',
    `本验收包绑定 commit \`${commit}\` 和 tree \`${tree}\`。`,
    '必须在真实 Windows 主机、清单完全一致的 Git 工作树上运行；Linux 结果不能替代 Windows Named Mutex 证据。',
    '',
    '## 执行',
    '',
    '1. 将 ZIP 解压到仓库目录的直接子目录。',
    '2. 运行 `RUN_BATCH39_WINDOWS_ACCEPTANCE.cmd`。',
    '3. 保存完整 stdout、stderr、退出码和 `evidence/wp3/`。',
    '',
    '## 通过条件',
    '',
    '- 所有命令退出码为 0；',
    '- 最终汇总 `fail/skipped/cancelled/todo` 均为 0；',
    '- Windows 与 WP3 evidence 的 commit/tree 与清单一致；',
    '- `windows-named-mutex-real.json` 的全部 checks 为 true。',
    '',
    '真实证据通过并经独立复核前必须保持：',
    '',
    '```text',
    'WINDOWS_UAT_BLOCKED=true',
    'readyForPromotion=false',
    'formalRelease=false',
    '```',
    ''
  ].join('\n'));

  try {
    createArchive(staging, archive);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const checksum = `${archive}.sha256`;
  write(checksum, `${sha256}  ${path.basename(archive)}\n`);
  process.stdout.write(`${JSON.stringify({ archive, checksum, sha256, sourceCommit: commit, sourceTree: tree })}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  }
}

module.exports = { main, createArchive };
