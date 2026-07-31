'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function git(repoRoot, args) {
  return String(execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })).trim();
}

function replaceAll(template, values) {
  let output = template;
  for (const [key, value] of Object.entries(values)) output = output.split(key).join(String(value));
  const unresolved = output.match(/__[A-Z0-9_]+__/gu);
  if (unresolved) throw new Error(`unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  return output;
}

function createPackage(repoRoot, outputRoot) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']);
  const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const branch = git(repoRoot, ['branch', '--show-current']);
  const dirty = git(repoRoot, ['status', '--porcelain']);
  if (dirty) throw new Error('working tree must be clean');
  const shortCommit = commit.slice(0, 7);
  const packageRoot = path.join(path.resolve(outputRoot), `YANCE_ROUND6_WINDOWS_REAL_UAT_${shortCommit}`);
  const payloadRoot = path.join(packageRoot, 'payload');
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  const checkpoint = JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_CHECKPOINT',
    branch,
    commit,
    tree,
    tag: 'audit-round6-bootstrap-closure-20260725',
    artifactClass: 'ROUND6_REAL_WINDOWS_UAT_BOOTSTRAP_CLOSURE_CANDIDATE'
  }, null, 2) + '\n';
  const payloadName = `Yance_ROUND6_UAT_SOURCE_${shortCommit}.zip`;
  const payloadPath = path.join(payloadRoot, payloadName);
  execFileSync('git', [
    '-C', repoRoot,
    'archive',
    '--format=zip',
    `--output=${payloadPath}`,
    `--add-virtual-file=YANCE_SOURCE_CHECKPOINT.json:${checkpoint}`,
    'HEAD'
  ], { stdio: 'inherit' });
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
  const render = (templateName, outputName, options = {}) => {
    const template = fs.readFileSync(path.join(templateRoot, templateName), 'utf8');
    let rendered = replaceAll(template, values);
    if (options.crlf) rendered = rendered.replace(/\r?\n/gu, '\r\n');
    if (options.ascii) {
      if (!/^[\x00-\x7F]*$/u.test(rendered)) throw new Error(`${outputName} must remain ASCII-only`);
      fs.writeFileSync(path.join(packageRoot, outputName), Buffer.from(rendered, 'ascii'));
      return;
    }
    fs.writeFileSync(path.join(packageRoot, outputName), rendered, 'utf8');
  };
  render('INSTALL_TEST_AND_START_YANCE_UAT.cmd.template', 'INSTALL_TEST_AND_START_YANCE_ROUND6_UAT.cmd', { ascii: true, crlf: true });
  render('INSTALL_TEST_AND_START_YANCE_UAT.ps1.template', 'INSTALL_TEST_AND_START_YANCE_ROUND6_UAT.ps1', { ascii: true, crlf: true });
  render('YANCE_ROUND6_UAT_README_ZH.md.template', 'README_FIRST_ZH.md');

  const manifest = {
    schemaVersion: 3,
    documentType: 'YANCE_ROUND6_WINDOWS_REAL_UAT_PACKAGE',
    generatedAtUtc: new Date().toISOString(),
    artifactClass: 'ROUND6_REAL_WINDOWS_UAT_BOOTSTRAP_CLOSURE_CANDIDATE',
    branch,
    commit,
    tree,
    payload: { fileName: payloadName, sha256: payloadSha256 },
    formalRelease: false,
    realWindowsUatRequired: true,
    secretsIncluded: false,
    bootstrapRevision: 3,
    windowsPowerShell51Compatible: true,
    installerEncoding: 'ASCII-CRLF',
    nativeStderrPolicy: 'exit-code-only',
    dataRootBinding: 'process-environment',
    topLevelInstallEntry: 'INSTALL_TEST_AND_START_YANCE_ROUND6_UAT.cmd'
  };
  fs.writeFileSync(path.join(packageRoot, 'ROUND6_UAT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const rows = fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => ({ name: entry.name, sha256: sha256File(path.join(packageRoot, entry.name)) }));
  rows.push({ name: `payload/${payloadName}`, sha256: payloadSha256 });
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS.txt'), `${rows.map(row => `${row.sha256}  ${row.name}`).join('\n')}\n`, 'utf8');
  return { packageRoot, manifest };
}

if (require.main === module) {
  try {
    const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
    const outputRoot = path.resolve(process.argv[3] || path.join(repoRoot, '.tmp', 'round6-uat-package'));
    const result = createPackage(repoRoot, outputRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createPackage, replaceAll, sha256File };
