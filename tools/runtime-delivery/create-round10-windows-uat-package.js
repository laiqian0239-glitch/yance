'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function git(repoRoot, args) { return String(execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })).trim(); }
function replaceAll(template, values) {
  let output = template;
  for (const [key, value] of Object.entries(values)) output = output.split(key).join(String(value));
  const unresolved = output.match(/__[A-Z0-9_]+__/gu);
  if (unresolved) throw new Error(`unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  return output;
}
function writeRendered(templateRoot, packageRoot, templateName, outputName, values, options = {}) {
  let rendered = replaceAll(fs.readFileSync(path.join(templateRoot, templateName), 'utf8'), values);
  if (options.crlf) rendered = rendered.replace(/\r?\n/gu, '\r\n');
  if (options.ascii) {
    if (!/^[\x00-\x7F]*$/u.test(rendered)) throw new Error(`${outputName} must remain ASCII-only`);
    fs.writeFileSync(path.join(packageRoot, outputName), Buffer.from(rendered, 'ascii'));
  } else fs.writeFileSync(path.join(packageRoot, outputName), rendered, 'utf8');
}

function createPackage(repoRoot, outputRoot) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']);
  const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const parent = git(repoRoot, ['rev-parse', 'HEAD^']);
  const branch = git(repoRoot, ['branch', '--show-current']);
  if (git(repoRoot, ['status', '--porcelain'])) throw new Error('working tree must be clean');
  const shortCommit = commit.slice(0, 7);
  const packageRoot = path.join(path.resolve(outputRoot), `YANCE_ROUND10_WINDOWS_PLATFORM_UAT_${shortCommit}`);
  const payloadRoot = path.join(packageRoot, 'payload');
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  const checkpoint = JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_CHECKPOINT',
    branch, commit, tree, parent,
    tag: 'audit-round10-platform-production-closure-20260726',
    artifactClass: 'ROUND10_PLATFORM_PRODUCTION_WINDOWS_UAT_CANDIDATE'
  }, null, 2) + '\n';
  const payloadName = `Yance_ROUND10_UAT_SOURCE_${shortCommit}.zip`;
  const payloadPath = path.join(payloadRoot, payloadName);
  execFileSync('git', ['-C', repoRoot, 'archive', '--format=zip', `--output=${payloadPath}`, `--add-virtual-file=YANCE_SOURCE_CHECKPOINT.json:${checkpoint}`, 'HEAD'], { stdio: 'inherit' });
  const payloadSha256 = sha256File(payloadPath);
  const values = {
    '__EXPECTED_COMMIT__': commit,
    '__EXPECTED_TREE__': tree,
    '__EXPECTED_BRANCH__': branch,
    '__SHORT_COMMIT__': shortCommit,
    '__PAYLOAD_NAME__': payloadName,
    '__PAYLOAD_SHA256__': payloadSha256
  };
  const templateRoot = path.join(repoRoot, 'tools', 'runtime-delivery', 'templates');
  writeRendered(templateRoot, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.cmd.template', 'INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.cmd', values, { ascii: true, crlf: true });
  writeRendered(templateRoot, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.ps1.template', 'INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.ps1', values, { ascii: true, crlf: true });
  writeRendered(templateRoot, packageRoot, 'COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.cmd.template', 'COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.cmd', values, { ascii: true, crlf: true });
  writeRendered(templateRoot, packageRoot, 'COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.ps1.template', 'COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.ps1', values, { ascii: true, crlf: true });
  writeRendered(templateRoot, packageRoot, 'YANCE_ROUND10_UAT_README_ZH.md.template', 'README_FIRST_ZH.md', values);

  const manifest = {
    schemaVersion: 1,
    documentType: 'YANCE_ROUND10_WINDOWS_PLATFORM_UAT_PACKAGE',
    generatedAtUtc: new Date().toISOString(),
    artifactClass: 'ROUND10_PLATFORM_PRODUCTION_WINDOWS_UAT_CANDIDATE',
    branch, commit, tree, parent,
    payload: { fileName: payloadName, sha256: payloadSha256 },
    formalRelease: false,
    realWindowsUatRequired: true,
    secretsIncluded: false,
    windowsPowerShell51Compatible: true,
    installerEncoding: 'ASCII-CRLF',
    dataRootSelection: 'largest-existing-database',
    topLevelInstallEntry: 'INSTALL_TEST_AND_START_YANCE_ROUND10_UAT.cmd',
    evidenceEntry: 'COLLECT_YANCE_ROUND10_PLATFORM_EVIDENCE.cmd'
  };
  fs.writeFileSync(path.join(packageRoot, 'ROUND10_UAT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const files = [];
  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.isFile()) files.push({ name: entry.name, sha256: sha256File(path.join(packageRoot, entry.name)) });
  }
  files.push({ name: `payload/${payloadName}`, sha256: payloadSha256 });
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS.txt'), `${files.sort((a,b)=>a.name.localeCompare(b.name)).map(row => `${row.sha256}  ${row.name}`).join('\n')}\n`, 'utf8');
  return { packageRoot, manifest };
}

if (require.main === module) {
  try {
    const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
    const outputRoot = path.resolve(process.argv[3] || path.join(repoRoot, '.tmp', 'round10-uat-package'));
    process.stdout.write(`${JSON.stringify(createPackage(repoRoot, outputRoot), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { createPackage, replaceAll, sha256File };
