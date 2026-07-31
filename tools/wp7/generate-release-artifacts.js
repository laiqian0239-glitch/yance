'use strict';

// Generates RELEASE SUPPORT artifacts for the existing NSIS installer.
//
// IMPORTANT (release integrity):
//   `latest.yml` and `<setup>.blockmap` MUST be produced by the official
//   electron-builder / WP7 Windows Final Builder during the SAME real build
//   that produces the installer binary. They are NOT generated here, and any
//   code that pretended to compute them has been removed. This tool only
//   produces artifacts that are safe to derive locally from an already-built,
//   trusted installer:
//     - SHA256SUMS.txt           (sha256 of every release asset, incl. installer)
//     - RELEASE_NOTES_<ver>.md   (human release notes)
//     - upload-checklist.md      (operator steps for GitHub Releases publish)
//
// No GitHub token is read here. Publishing is done in a trusted environment.
//
// Usage:
//   node tools/wp7/generate-release-artifacts.js --installer <path> --version 29.2.7 \
//     --channel stable --prerelease false --out <dir> --notes <file>

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const RELEASE_SOURCE_PATH = path.resolve(__dirname, '..', '..', 'release', 'release-source.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function fileSize(file) {
  return fs.statSync(file).size;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const installer = args.installer;
  const version = args.version;
  const channel = args.channel || 'stable';
  const prerelease = String(args.prerelease || 'false') === 'true';
  const outDir = args.out || path.dirname(installer);
  const notesFile = args.notes;
  const releaseSource = JSON.parse(fs.readFileSync(RELEASE_SOURCE_PATH, 'utf8'));
  const publicVersion = String(args['public-version'] || releaseSource.publicVersion || version || '');
  const publicProductName = String(releaseSource.publicProductName || '言策');
  const publicProductNameEnglish = String(releaseSource.publicProductNameEnglish || 'Yance');
  if (!installer || !version) {
    process.stderr.write('usage: generate-release-artifacts.js --installer <exe> --version 29.2.7 [--channel stable] [--prerelease false] [--out <dir>] [--notes <md>]\n');
    process.exit(2);
  }
  if (!fs.existsSync(installer)) { process.stderr.write(`installer not found: ${installer}\n`); process.exit(2); }

  fs.mkdirSync(outDir, { recursive: true });
  const installerName = path.basename(installer);
  const size = fileSize(installer);
  const sha256 = sha256File(installer);

  // SHA256SUMS of all assets (installer is the only one we hash locally;
  // latest.yml / blockmap are emitted by the real builder and hashed there).
  const sums = [`${sha256}  ${installerName}`];
  const assets = [installerName];
  const sumPath = path.join(outDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sumPath, `${sums.join('\n')}\n`, 'utf8');

  // Release notes
  let notes = `# ${publicProductName} / ${publicProductNameEnglish} ${publicVersion}\n\n`;
  if (notesFile && fs.existsSync(notesFile)) notes += fs.readFileSync(notesFile, 'utf8').trim() + '\n';
  else notes += '- 本次更新包含自动更新链路与发布完整性改进。\n';
  const notesName = `RELEASE_NOTES_${publicVersion}.md`;
  fs.writeFileSync(path.join(outDir, notesName), notes, 'utf8');

  // Upload checklist for the trusted publish environment.
  const checklist = [
    '# GitHub Releases 上传清单（人工/CI 在受信任环境执行）',
    '',
    `公开版本: ${publicVersion}`,
    `技术更新版本: ${version}`,
    `通道: ${channel}${prerelease ? ' (prerelease)' : ''}`,
    '',
    '必须从同一次真实构建取得以下资产，且哈希一致：',
    `1. ${installerName}  (sha256: ${sha256}, size: ${size})`,
    '2. latest.yml      （由 electron-builder / WP7 Builder 在同一次构建生成）',
    `3. ${installerName}.blockmap  （同上）`,
    '4. SHA256SUMS.txt  （本地派生，见上）',
    `5. ${notesName}`,
    '',
    '校验：latest.yml.path == 安装包文件名；latest.yml.size == 安装包字节数；',
    'latest.yml.sha512 == base64(sha512(安装包))。所有资产须来自同一次构建。',
    '',
    '禁止：使用本工具或任何脚本伪造 latest.yml / blockmap；禁止客户端携带 GitHub Token。'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'upload-checklist.md'), checklist, 'utf8');

  const meta = {
    version,
    publicVersion,
    publicProductName,
    publicProductNameEnglish,
    channel,
    prerelease,
    installerName,
    installerSize: size,
    installerSha256: sha256,
    artifactsProduced: ['SHA256SUMS.txt', `RELEASE_NOTES_${publicVersion}.md`, 'upload-checklist.md'],
    artifactsDelegatedToBuilder: ['latest.yml', `${installerName}.blockmap`],
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outDir, 'release-metadata.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { sha256File, parseArgs };
