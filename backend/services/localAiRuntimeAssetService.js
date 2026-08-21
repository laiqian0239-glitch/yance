'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, status: 400, ...details });
}
function normalizeSha(value) { return String(value || '').trim().toLowerCase(); }
function finite(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }

function validateMaterializationRequest(input = {}) {
  const consent = input.consent === true;
  const expectedSha256 = normalizeSha(input.expectedSha256);
  const actualSha256 = normalizeSha(input.actualSha256);
  const requiredBytes = finite(input.requiredBytes);
  const freeDiskBytes = finite(input.freeDiskBytes);
  if (!consent) fail('LOCAL_RUNTIME_CONSENT_REQUIRED', '安装本地运行时前需要明确确认。');
  if (!expectedSha256 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail('LOCAL_RUNTIME_ASSET_HASH_REQUIRED', '本地运行时缺少有效 SHA-256 来源证明。');
  if (!actualSha256 || expectedSha256 !== actualSha256) fail('LOCAL_RUNTIME_ASSET_HASH_MISMATCH', '本地运行时文件 SHA-256 与固定来源不一致。', { expectedSha256, actualSha256 });
  if (requiredBytes > 0 && freeDiskBytes > 0 && requiredBytes > freeDiskBytes) fail('LOCAL_RUNTIME_DISK_PREFLIGHT_FAILED', '本地磁盘空间不足，无法安全安装运行时。', { requiredBytes, freeDiskBytes });
  return Object.freeze({ ...input, consent, expectedSha256, actualSha256, requiredBytes, freeDiskBytes, ok: true });
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function nearestExistingDirectory(targetPath) {
  let current = path.dirname(path.resolve(targetPath));
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function diskFreeBytesFor(targetPath) {
  if (typeof fs.statfsSync !== 'function') fail('LOCAL_RUNTIME_DISK_PREFLIGHT_UNAVAILABLE', '当前运行环境无法读取目标磁盘剩余空间。');
  const stat = fs.statfsSync(nearestExistingDirectory(targetPath));
  const blockSize = finite(stat.bsize || stat.frsize);
  const freeBlocks = finite(stat.bavail ?? stat.bfree);
  const bytes = blockSize * freeBlocks;
  if (!bytes) fail('LOCAL_RUNTIME_DISK_PREFLIGHT_UNAVAILABLE', '目标磁盘剩余空间读取失败。');
  return bytes;
}

function provenancePath(destinationPath) { return `${destinationPath}.yance-provenance.json`; }
function extractedRootFor(destinationPath) { return `${destinationPath}.expanded`; }

function walkFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute));
    else if (entry.isFile()) out.push(absolute);
  }
  return out;
}

function assertChildOf(root, candidate) {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  if (!relative || relative === '.') return normalizedCandidate;
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('LOCAL_RUNTIME_EXTRACT_PATH_ESCAPE', '本地运行时解压路径越界。');
  return normalizedCandidate;
}

function expandVerifiedWindowsZip(archivePath, destinationPath) {
  if (process.platform !== 'win32') return { extracted: false, extractedRoot: '', runtimeExecutablePath: '' };
  const extractedRoot = extractedRootFor(destinationPath);
  fs.rmSync(extractedRoot, { recursive: true, force: true });
  fs.mkdirSync(extractedRoot, { recursive: true });
  const escapedArchive = archivePath.replace(/'/gu, "''");
  const escapedTarget = extractedRoot.replace(/'/gu, "''");
  const command = `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedTarget}' -Force`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  } catch (error) {
    fs.rmSync(extractedRoot, { recursive: true, force: true });
    fail('LOCAL_RUNTIME_ARCHIVE_EXTRACT_FAILED', '已验证的本地运行时压缩包解压失败。', { detail: String(error.stderr || error.message || '').slice(0, 2000) });
  }
  for (const absolute of walkFiles(extractedRoot)) assertChildOf(extractedRoot, absolute);
  const executables = walkFiles(extractedRoot).filter(file => /(?:^|[\\/])llama-server\.exe$/iu.test(file));
  if (!executables.length) {
    fs.rmSync(extractedRoot, { recursive: true, force: true });
    fail('LLAMA_CPP_SERVER_EXECUTABLE_MISSING', '固定上游运行时压缩包中没有找到 llama-server.exe。');
  }
  const runtimeExecutablePath = assertChildOf(extractedRoot, executables[0]);
  return { extracted: true, extractedRoot, runtimeExecutablePath };
}

function materializationExpansion(destinationPath) {
  if (/\.zip$/iu.test(destinationPath)) return expandVerifiedWindowsZip(destinationPath, destinationPath);
  const basename = path.basename(destinationPath).toLowerCase();
  return { extracted: false, extractedRoot: '', runtimeExecutablePath: basename === 'llama-server.exe' ? destinationPath : '' };
}

async function materializeLocalArtifact(input = {}) {
  const rawSource = String(input.localAssetPath || '').trim();
  if (!rawSource) fail('LOCAL_RUNTIME_ASSET_NOT_FOUND', '请选择已经下载到本机的运行时文件。');
  const localAssetPath = path.resolve(rawSource);
  if (!fs.existsSync(localAssetPath)) fail('LOCAL_RUNTIME_ASSET_NOT_FOUND', '请选择已经下载到本机的运行时文件。');
  const sourceStat = fs.statSync(localAssetPath);
  if (!sourceStat.isFile()) fail('LOCAL_RUNTIME_ASSET_NOT_FILE', '运行时来源必须是本机文件。');
  const rawDestination = String(input.destinationPath || '').trim();
  if (!rawDestination) fail('LOCAL_RUNTIME_DESTINATION_REQUIRED', '缺少本地运行时安装目标。');
  const destinationPath = path.resolve(rawDestination);
  const requiredBytes = finite(input.requiredBytes || sourceStat.size) || sourceStat.size;
  const freeDiskBytes = finite(input.freeDiskBytes) || diskFreeBytesFor(destinationPath);
  const actualSha256 = await sha256File(localAssetPath);
  const checked = validateMaterializationRequest({ ...input, actualSha256, requiredBytes, freeDiskBytes });
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(localAssetPath, destinationPath);
  let expansion;
  try {
    expansion = materializationExpansion(destinationPath);
  } catch (error) {
    fs.rmSync(destinationPath, { force: true });
    throw error;
  }
  const receipt = {
    schemaVersion: 1,
    targetName: path.basename(destinationPath),
    destinationPath,
    sourceFileName: path.basename(localAssetPath),
    sha256: actualSha256,
    bytes: sourceStat.size,
    expectedSha256: checked.expectedSha256,
    provenanceVerified: true,
    explicitConsent: true,
    extracted: expansion.extracted === true,
    extractedRoot: expansion.extractedRoot || '',
    runtimeExecutablePath: expansion.runtimeExecutablePath || '',
    materializedAt: new Date().toISOString()
  };
  fs.writeFileSync(provenancePath(destinationPath), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return Object.freeze({ ok: true, source: localAssetPath, destinationPath, sha256: actualSha256, bytes: sourceStat.size, freeDiskBytes, provenanceVerified: true, consent: true, extracted: receipt.extracted, extractedRoot: receipt.extractedRoot, runtimeExecutablePath: receipt.runtimeExecutablePath });
}

function removeMaterializedArtifact(targetPath) {
  const absolute = path.resolve(String(targetPath || ''));
  let receipt = null;
  const receiptPath = provenancePath(absolute);
  if (receiptPath && fs.existsSync(receiptPath)) {
    try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (_) {}
  }
  let removed = false;
  if (absolute && fs.existsSync(absolute)) {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) fs.rmSync(absolute, { recursive: true, force: true });
    else fs.rmSync(absolute, { force: true });
    removed = true;
  }
  const extractedRoot = String(receipt?.extractedRoot || extractedRootFor(absolute));
  if (extractedRoot && fs.existsSync(extractedRoot)) fs.rmSync(extractedRoot, { recursive: true, force: true });
  if (receiptPath && fs.existsSync(receiptPath)) fs.rmSync(receiptPath, { force: true });
  return { ok: true, removed, path: absolute, extractedRemoved: Boolean(extractedRoot) };
}

function listMaterializedArtifacts(runtimeRoot) {
  const root = path.resolve(String(runtimeRoot || ''));
  if (!root || !fs.existsSync(root)) return [];
  const rows = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.yance-provenance.json')) continue;
    const receiptPath = path.join(root, name);
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const destinationPath = path.resolve(String(receipt.destinationPath || path.join(root, name.replace(/\.yance-provenance\.json$/u, ''))));
      const runtimeExecutablePath = receipt.runtimeExecutablePath ? path.resolve(String(receipt.runtimeExecutablePath)) : '';
      rows.push({ ...receipt, destinationPath, runtimeExecutablePath, installed: fs.existsSync(destinationPath), executableReady: Boolean(runtimeExecutablePath && fs.existsSync(runtimeExecutablePath)) });
    } catch (_) {}
  }
  return rows.sort((a, b) => String(b.materializedAt || '').localeCompare(String(a.materializedAt || '')));
}

module.exports = {
  validateMaterializationRequest,
  sha256File,
  diskFreeBytesFor,
  materializeLocalArtifact,
  removeMaterializedArtifact,
  listMaterializedArtifacts,
  expandVerifiedWindowsZip
};