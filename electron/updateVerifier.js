'use strict';

// Pure, Electron-independent verification of a downloaded update package.
// Used by electron/updateManager.js to produce honest rejection states
// (update_rejected) with human-readable Chinese reasons. No credentials,
// no network. All checks are individually unit-tested in tests/wp7/updater-verifier.test.js.

const fs = require('node:fs');
const crypto = require('node:crypto');

const AMD64 = 0x8664;
const IA32 = 0x014c;
const ARM64 = 0xaa64;

function sha512File(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function peMachineFromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 64) return null;
  const dosMagic = buf.readUInt16LE(0);
  if (dosMagic !== 0x5a4d) return null;
  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 4 > buf.length) return null;
  if (buf.readUInt32LE(peOffset) !== 0x00004550) return null;
  return buf.readUInt16LE(peOffset + 4);
}

function isExpectedExe(filePath) {
  if (typeof filePath !== 'string') return false;
  if (!filePath.toLowerCase().endsWith('.exe')) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function parseVersion(value) {
  const m = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0)];
}

function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

const REJECTION_REASONS = Object.freeze({
  NOT_INSTALLER: 'UPDATE_REJECTED_NOT_NSIS_INSTALLER',
  HASH_MISMATCH: 'UPDATE_REJECTED_HASH_MISMATCH',
  SIGNATURE_INVALID: 'UPDATE_REJECTED_SIGNATURE_INVALID',
  PUBLISHER_MISMATCH: 'UPDATE_REJECTED_PUBLISHER_MISMATCH',
  PRODUCT_MISMATCH: 'UPDATE_REJECTED_PRODUCT_MISMATCH',
  DOWNGRADE: 'UPDATE_REJECTED_DOWNGRADE',
  ARCH_MISMATCH: 'UPDATE_REJECTED_ARCH_MISMATCH',
  BLOCKMAP_MISMATCH: 'UPDATE_REJECTED_BLOCKMAP_MISMATCH',
  METADATA_MISMATCH: 'UPDATE_REJECTED_METADATA_MISMATCH'
});

const REJECTION_MESSAGES = Object.freeze({
  UPDATE_REJECTED_NOT_NSIS_INSTALLER: '下载的文件不是预期的安装包（应为 .exe 安装程序）。',
  UPDATE_REJECTED_HASH_MISMATCH: '安装包校验失败：SHA-256/SHA-512 与更新元数据不一致，文件可能被篡改。',
  UPDATE_REJECTED_SIGNATURE_INVALID: '安装包数字签名无效或缺失，无法确认发布者。',
  UPDATE_REJECTED_PUBLISHER_MISMATCH: '安装包发布者名称与当前产品不一致。',
  UPDATE_REJECTED_PRODUCT_MISMATCH: '安装包产品名称与当前产品不一致。',
  UPDATE_REJECTED_DOWNGRADE: '新版本低于当前已安装版本，已拒绝降级安装。',
  UPDATE_REJECTED_ARCH_MISMATCH: '安装包处理器架构与当前系统不匹配。',
  UPDATE_REJECTED_BLOCKMAP_MISMATCH: '增量更新校验文件（blockmap）与安装包不一致或缺失。',
  UPDATE_REJECTED_METADATA_MISMATCH: '更新元数据（latest.yml）与安装包不匹配。'
});

function validateUpdatePackage(options = {}) {
  const {
    filePath,
    expectedSha512,
    expectedVersion,
    currentVersion,
    expectedProductName,
    expectedPublisher,
    expectedArch = 'x64',
    expectedManifestArch = null,
    extractedExePath = null,
    allowDowngrade = false,
    blockmapConsistent = true,
    metadataConsistent = true,
    mode = 'production',
    extractVersionInfo = null
  } = options;

  const reasons = [];
  const details = {};

  if (!isExpectedExe(filePath)) {
    reasons.push(REJECTION_REASONS.NOT_INSTALLER);
    return { ok: false, reasons, messages: toMessages(reasons), details };
  }

  if (!expectedSha512) {
    reasons.push(REJECTION_REASONS.METADATA_MISMATCH);
    details.expectedSha512Missing = true;
  } else {
    let actual;
    try { actual = sha512File(filePath); } catch (error) { actual = null; details.hashError = String(error.message); }
    if (actual !== expectedSha512) {
      reasons.push(REJECTION_REASONS.HASH_MISMATCH);
      details.expectedSha512 = expectedSha512;
      details.actualSha512 = actual;
    }
  }

  if (expectedManifestArch && expectedManifestArch !== expectedArch) {
    reasons.push(REJECTION_REASONS.ARCH_MISMATCH);
    details.expectedArch = expectedArch;
    details.manifestArch = expectedManifestArch;
  }
  if (extractedExePath && fs.existsSync(extractedExePath)) {
    const m = peMachineFromFile(extractedExePath);
    const okExeArch = expectedArch === 'x64' ? m === AMD64
      : expectedArch === 'ia32' ? m === IA32
      : expectedArch === 'arm64' ? m === ARM64 : false;
    if (m === null || !okExeArch) {
      reasons.push(REJECTION_REASONS.ARCH_MISMATCH);
      details.packagedExeMachine = m;
      details.expectedArch = expectedArch;
    }
  }

  if (expectedVersion && currentVersion) {
    const cmp = compareVersion(expectedVersion, currentVersion);
    if (cmp !== null && cmp < 0 && !allowDowngrade) {
      reasons.push(REJECTION_REASONS.DOWNGRADE);
      details.expectedVersion = expectedVersion;
      details.currentVersion = currentVersion;
    }
  }

  // Current owner-authorized policy: Authenticode signing is deferred.
  // Production still requires real embedded product/company/version identity,
  // plus SHA-512, metadata, architecture and downgrade checks.
  if (typeof extractVersionInfo === 'function') {
    let info = null;
    try { info = extractVersionInfo(filePath); } catch (error) { details.extractError = String(error.message); }
    details.installerIdentity = info || null;
    if (!info) {
      if (mode === 'production') reasons.push(REJECTION_REASONS.SIGNATURE_INVALID);
      else details.signatureWarning = 'installer identity unavailable in internal-test environment';
    } else {
      if (expectedProductName && info.productName !== expectedProductName) {
        reasons.push(REJECTION_REASONS.PRODUCT_MISMATCH);
        details.actualProductName = info.productName || null;
      }
      if (expectedPublisher && info.publisher !== expectedPublisher) {
        reasons.push(REJECTION_REASONS.PUBLISHER_MISMATCH);
        details.actualPublisher = info.publisher || null;
      }
      if (expectedVersion && info.productVersion && compareVersion(info.productVersion, expectedVersion) !== 0) {
        reasons.push(REJECTION_REASONS.PRODUCT_MISMATCH);
        details.actualProductVersion = info.productVersion;
        details.expectedProductVersion = expectedVersion;
      }
      if (mode === 'production' && info.signed !== true) {
        details.signatureWarning = 'unsigned Windows update accepted because Authenticode signing is currently deferred';
      } else if (mode !== 'production' && info.signed !== true) {
        details.signatureWarning = 'internal-test build without verified Authenticode signature';
      }
    }
  } else if (mode === 'production') {
    reasons.push(REJECTION_REASONS.SIGNATURE_INVALID);
    details.extractorMissing = true;
  }

  if (!blockmapConsistent) reasons.push(REJECTION_REASONS.BLOCKMAP_MISMATCH);
  if (!metadataConsistent) reasons.push(REJECTION_REASONS.METADATA_MISMATCH);

  return { ok: reasons.length === 0, reasons, messages: toMessages(reasons), details };
}

function toMessages(reasons) {
  return reasons.map(r => REJECTION_MESSAGES[r] || r);
}

function validateReleaseMetadata(options = {}) {
  let { metadata, downloadedFilePath, metadataComparison } = options;

  if (!metadata && options.latestYml) {
    metadata = {
      version: options.latestYml.version || '',
      file: {
        fileName: options.latestYml.path || options.installerFileName || '',
        size: typeof options.latestYml.size === 'number' ? options.latestYml.size : options.installerSize,
        sha512: options.latestYml.sha512 || options.installerSha512 || ''
      }
    };
    downloadedFilePath = downloadedFilePath || options.installerFilePath || '';
  }

  const details = {};
  const mismatches = [];
  const file = metadata && metadata.file;
  if (!metadata || !metadata.version) mismatches.push('missing version');
  if (!file) {
    mismatches.push('missing installer file metadata');
  } else {
    if (!file.fileName || !String(file.fileName).toLowerCase().endsWith('.exe')) mismatches.push('invalid installer file name');
    if (!file.sha512) mismatches.push('missing sha512');
    if (!Number.isFinite(file.size) || file.size <= 0) mismatches.push('missing or invalid size');
  }
  if (metadataComparison && metadataComparison.ok === false) {
    mismatches.push(...(metadataComparison.reasons || ['available/downloaded metadata mismatch']));
  }
  if (downloadedFilePath && file) {
    try {
      const actualSize = fs.statSync(downloadedFilePath).size;
      details.actualSize = actualSize;
      details.expectedSize = file.size;
      if (Number.isFinite(file.size) && actualSize !== file.size) mismatches.push('downloaded size mismatch');
      const actualName = require('node:path').basename(downloadedFilePath);
      details.actualFileName = actualName;
      details.expectedFileName = file.fileName;
      if (file.fileName && actualName !== file.fileName) mismatches.push('downloaded file name mismatch');
    } catch (error) {
      mismatches.push('downloaded file unavailable');
      details.statError = String(error.message);
    }
  } else if (!downloadedFilePath) {
    mismatches.push('missing downloaded file path');
  }

  details.mismatches = [...new Set(mismatches)];
  return {
    ok: details.mismatches.length === 0,
    reasons: details.mismatches.length === 0 ? [] : [REJECTION_REASONS.METADATA_MISMATCH],
    details
  };
}

module.exports = {
  REJECTION_REASONS,
  REJECTION_MESSAGES,
  sha512File,
  peMachineFromFile,
  isExpectedExe,
  parseVersion,
  compareVersion,
  validateUpdatePackage,
  validateReleaseMetadata
};
