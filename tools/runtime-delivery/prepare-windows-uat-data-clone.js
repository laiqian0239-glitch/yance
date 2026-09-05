'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER_FILE = '.yance-source-uat-clone.json';
const RECEIPT_FILE = 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT.json';
const WHATSAPP_AUTH_DIRECTORIES = Object.freeze(['whatsapp-auth', 'baileys-auth']);
const COPY_EXCLUDED_NAMES = Object.freeze(['SingletonLock', 'SingletonCookie', 'SingletonSocket', MARKER_FILE, RECEIPT_FILE]);
const COPY_EXCLUDED_RELATIVE_PATHS = Object.freeze(['store/yance-r32.db.lock']);

function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith('--source=')) result.source = arg.slice('--source='.length);
    else if (arg.startsWith('--target=')) result.target = arg.slice('--target='.length);
    else if (arg.startsWith('--whatsapp-source=')) result.whatsappSource = arg.slice('--whatsapp-source='.length);
    else if (arg.startsWith('--whatsapp-session-source=')) result.whatsappSessionSource = arg.slice('--whatsapp-session-source='.length);
    else if (arg.startsWith('--whatsapp-target-account=')) result.whatsappTargetAccount = arg.slice('--whatsapp-target-account='.length);
    else if (arg.startsWith('--report=')) result.report = arg.slice('--report='.length);
    else throw Object.assign(new Error(`不支持的参数：${arg}`), { reasonCode: 'SOURCE_UAT_DATA_CLONE_ARGUMENT_INVALID' });
  }
  return result;
}
function assertSafePaths(source, target, whatsappSource) {
  if (!source || !target) throw Object.assign(new Error('必须同时提供 --source 和 --target'), { reasonCode: 'SOURCE_UAT_DATA_CLONE_PATH_REQUIRED' });
  const sourceRoot = path.resolve(source);
  const targetRoot = path.resolve(target);
  const whatsappSourceRoot = path.resolve(whatsappSource || sourceRoot);
  if (sourceRoot === targetRoot || whatsappSourceRoot === targetRoot) {
    throw Object.assign(new Error('UAT 克隆目录不能与任何真实数据来源目录相同'), { reasonCode: 'SOURCE_UAT_DATA_CLONE_SAME_PATH' });
  }
  for (const realRoot of [...new Set([sourceRoot, whatsappSourceRoot])]) {
    const targetInsideSource = path.relative(realRoot, targetRoot);
    if (targetInsideSource && !targetInsideSource.startsWith('..') && !path.isAbsolute(targetInsideSource)) {
      throw Object.assign(new Error('UAT 克隆目录不能位于真实数据目录内部'), { reasonCode: 'SOURCE_UAT_DATA_CLONE_NESTED_TARGET' });
    }
    const sourceInsideTarget = path.relative(targetRoot, realRoot);
    if (sourceInsideTarget && !sourceInsideTarget.startsWith('..') && !path.isAbsolute(sourceInsideTarget)) {
      throw Object.assign(new Error('真实数据目录不能位于 UAT 克隆目录内部'), { reasonCode: 'SOURCE_UAT_DATA_CLONE_NESTED_SOURCE' });
    }
  }
  return { sourceRoot, targetRoot, whatsappSourceRoot };
}
function listFiles(root, options = {}) {
  const rows = [];
  if (!fs.existsSync(root)) return rows;
  const excludedNames = new Set(options.excludedNames || []);
  const excludedRelativePaths = new Set(options.excludedRelativePaths || []);
  const isExcludedRelativePath = relative => [...excludedRelativePaths].some(excluded =>
    relative === excluded || relative.startsWith(`${excluded}/`)
  );
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excludedNames.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (isExcludedRelativePath(relative)) continue;
      if (entry.isSymbolicLink()) {
        throw Object.assign(new Error(`UAT 数据克隆拒绝符号链接：${file}`), { reasonCode: 'SOURCE_UAT_DATA_CLONE_SYMLINK_REJECTED' });
      }
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows.push(relative);
    }
  };
  walk(root);
  return rows.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}
function directoryDigest(root, options = {}) {
  const files = listFiles(root, options);
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    const file = path.join(root, ...relative.split('/'));
    hash.update(relative);
    hash.update('\0');
    hash.update(sha256File(file));
    hash.update('\n');
  }
  return { fileCount: files.length, sha256: hash.digest('hex') };
}
function readCredentialSummary(root) {
  const summaries = [];
  for (const directoryName of WHATSAPP_AUTH_DIRECTORIES) {
    const directory = path.join(root, directoryName);
    const files = listFiles(directory);
    for (const relative of files) {
      if (path.basename(relative).toLowerCase() !== 'creds.json') continue;
      let usable = false;
      let registered = false;
      try {
        const value = JSON.parse(fs.readFileSync(path.join(directory, ...relative.split('/')), 'utf8') || '{}');
        usable = Boolean(value?.me?.id || value?.me?.lid);
        registered = value?.registered === true;
      } catch (_) {}
      summaries.push({ directoryName, relative, usable, registered });
    }
  }
  return {
    credentialCount: summaries.length,
    usableCredentialCount: summaries.filter(row => row.usable).length,
    registeredCredentialCount: summaries.filter(row => row.registered).length
  };
}
function criticalSnapshot(root) {
  const candidates = [
    'store/yance-r32.db',
    'store/yance-r32.db-wal',
    'store/yance-r32.db-shm',
    'secure/credentials.safe.json'
  ];
  const files = {};
  for (const relative of candidates) {
    const file = path.join(root, ...relative.split('/'));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      files[relative] = { bytes: fs.statSync(file).size, sha256: sha256File(file) };
    }
  }
  const auth = {};
  for (const directoryName of WHATSAPP_AUTH_DIRECTORIES) {
    auth[directoryName] = directoryDigest(path.join(root, directoryName));
  }
  return { files, auth, whatsappCredentials: readCredentialSummary(root) };
}
function copyTree(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    dereference: false,
    filter(sourcePath) {
      if (COPY_EXCLUDED_NAMES.includes(path.basename(sourcePath))) return false;
      const relative = path.relative(source, sourcePath).replace(/\\/g, '/');
      return !COPY_EXCLUDED_RELATIVE_PATHS.some(excluded =>
        relative === excluded || relative.startsWith(`${excluded}/`)
      );
    }
  });
  return true;
}
function overlayWhatsappAuth(whatsappSourceRoot, targetRoot) {
  const copied = [];
  for (const directoryName of WHATSAPP_AUTH_DIRECTORIES) {
    const source = path.join(whatsappSourceRoot, directoryName);
    const target = path.join(targetRoot, directoryName);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (copyTree(source, target)) copied.push(directoryName);
  }
  return copied;
}

function safeAccountDirectory(value = '.') {
  const normalized = String(value || '.').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.';
  if (normalized === '.') return '.';
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('WhatsApp 目标账号目录无效'), { reasonCode: 'SOURCE_UAT_WHATSAPP_TARGET_ACCOUNT_INVALID' });
  }
  return normalized;
}
function overlayWhatsappSession(sessionSource, targetRoot, targetAccountDirectory = '.') {
  const source = path.resolve(sessionSource || '');
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw Object.assign(new Error(`WhatsApp 会话目录不存在：${source}`), { reasonCode: 'SOURCE_UAT_WHATSAPP_SESSION_SOURCE_MISSING' });
  }
  const creds = path.join(source, 'creds.json');
  if (!fs.existsSync(creds)) {
    throw Object.assign(new Error(`WhatsApp 会话目录缺少 creds.json：${source}`), { reasonCode: 'SOURCE_UAT_WHATSAPP_SESSION_CREDS_MISSING' });
  }
  const accountDirectory = safeAccountDirectory(targetAccountDirectory);
  const authRoot = path.join(targetRoot, 'whatsapp-auth');
  const target = accountDirectory === '.' ? authRoot : path.join(authRoot, ...accountDirectory.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  copyTree(source, target);
  return { source, target, accountDirectory, sourceDigest: directoryDigest(source), targetDigest: directoryDigest(target) };
}

function prepareClone(options = {}) {
  const { sourceRoot, targetRoot, whatsappSourceRoot } = assertSafePaths(options.source, options.target, options.whatsappSource);
  const sourceDb = path.join(sourceRoot, 'store', 'yance-r32.db');
  if (!fs.existsSync(sourceDb)) {
    throw Object.assign(new Error(`未找到真实言策 SQLite：${sourceDb}`), { reasonCode: 'SOURCE_UAT_DATA_CLONE_SOURCE_DATABASE_MISSING' });
  }
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw Object.assign(new Error(`真实数据目录不存在：${sourceRoot}`), { reasonCode: 'SOURCE_UAT_DATA_CLONE_SOURCE_MISSING' });
  }
  if (!fs.existsSync(whatsappSourceRoot) || !fs.statSync(whatsappSourceRoot).isDirectory()) {
    throw Object.assign(new Error(`WhatsApp 凭据来源目录不存在：${whatsappSourceRoot}`), { reasonCode: 'SOURCE_UAT_WHATSAPP_SOURCE_MISSING' });
  }
  if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length) {
    throw Object.assign(new Error(`目标 UAT 数据目录必须为空：${targetRoot}`), { reasonCode: 'SOURCE_UAT_DATA_CLONE_TARGET_NOT_EMPTY' });
  }

  const digestOptions = { excludedNames: COPY_EXCLUDED_NAMES, excludedRelativePaths: COPY_EXCLUDED_RELATIVE_PATHS };
  const sourceBefore = criticalSnapshot(sourceRoot);
  const sourceTreeBefore = directoryDigest(sourceRoot, digestOptions);
  const whatsappSourceBefore = criticalSnapshot(whatsappSourceRoot);
  const whatsappSourceTreeBefore = directoryDigest(whatsappSourceRoot, digestOptions);
  if (path.resolve(whatsappSourceRoot) !== path.resolve(sourceRoot) && whatsappSourceBefore.whatsappCredentials.usableCredentialCount === 0) {
    throw Object.assign(new Error('指定的 WhatsApp 凭据来源没有可识别的登录身份'), { reasonCode: 'SOURCE_UAT_WHATSAPP_SOURCE_UNUSABLE' });
  }

  fs.mkdirSync(targetRoot, { recursive: true });
  copyTree(sourceRoot, targetRoot);
  const targetBaseTree = directoryDigest(targetRoot, digestOptions);
  const baseTreeMatch = JSON.stringify(sourceTreeBefore) === JSON.stringify(targetBaseTree);
  if (!baseTreeMatch) {
    throw Object.assign(new Error('UAT 数据基础复制树摘要校验失败，已停止启动'), { reasonCode: 'SOURCE_UAT_DATA_CLONE_BASE_TREE_VERIFICATION_FAILED' });
  }
  const selectedSessionSource = options.whatsappSessionSource ? path.resolve(options.whatsappSessionSource) : '';
  const whatsappSessionOverlay = selectedSessionSource
    ? overlayWhatsappSession(selectedSessionSource, targetRoot, options.whatsappTargetAccount || '.')
    : null;
  const whatsappOverlayApplied = Boolean(whatsappSessionOverlay) || path.resolve(whatsappSourceRoot) !== path.resolve(sourceRoot);
  const copiedWhatsappDirectories = whatsappSessionOverlay
    ? ['whatsapp-auth']
    : (whatsappOverlayApplied ? overlayWhatsappAuth(whatsappSourceRoot, targetRoot) : []);

  const copiedAtUtc = new Date().toISOString();
  const marker = {
    schemaVersion: 2,
    documentType: 'YANCE_SOURCE_UAT_DATA_CLONE',
    sourceDataRoot: sourceRoot,
    whatsappAuthSourceRoot: whatsappSourceRoot,
    targetDataRoot: targetRoot,
    copiedAtUtc,
    sourceUntouched: true,
    whatsappSourceUntouched: true,
    whatsappOverlayApplied,
    whatsappSessionOverlayApplied: Boolean(whatsappSessionOverlay),
    whatsappSessionSource: whatsappSessionOverlay?.source || '',
    whatsappTargetAccountDirectory: whatsappSessionOverlay?.accountDirectory || '',
    copiedWhatsappDirectories,
    resetSafeModeInClone: true,
    realDataMutationAllowed: false
  };
  const markerPath = path.join(targetRoot, MARKER_FILE);
  fs.writeFileSync(markerPath, canonicalJson(marker), { encoding: 'utf8', flag: 'wx' });

  const sourceAfter = criticalSnapshot(sourceRoot);
  const sourceTreeAfter = directoryDigest(sourceRoot, digestOptions);
  const whatsappSourceAfter = criticalSnapshot(whatsappSourceRoot);
  const whatsappSourceTreeAfter = directoryDigest(whatsappSourceRoot, digestOptions);
  const targetSnapshot = criticalSnapshot(targetRoot);
  const criticalSnapshotMatch = JSON.stringify(sourceBefore.files) === JSON.stringify(targetSnapshot.files);
  const baseFilesMatch = baseTreeMatch;
  const whatsappAuthMatch = whatsappSessionOverlay
    ? JSON.stringify(whatsappSessionOverlay.sourceDigest) === JSON.stringify(directoryDigest(whatsappSessionOverlay.target))
    : (JSON.stringify(whatsappSourceBefore.auth) === JSON.stringify(targetSnapshot.auth)
      && JSON.stringify(whatsappSourceBefore.whatsappCredentials) === JSON.stringify(targetSnapshot.whatsappCredentials));
  const sourceUnchanged = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter)
    && JSON.stringify(sourceTreeBefore) === JSON.stringify(sourceTreeAfter);
  const whatsappSourceUnchanged = JSON.stringify(whatsappSourceBefore) === JSON.stringify(whatsappSourceAfter)
    && JSON.stringify(whatsappSourceTreeBefore) === JSON.stringify(whatsappSourceTreeAfter);
  if (!baseFilesMatch || !criticalSnapshotMatch || !whatsappAuthMatch || !sourceUnchanged || !whatsappSourceUnchanged) {
    throw Object.assign(new Error('UAT 数据合并克隆校验失败，已停止启动'), {
      reasonCode: !sourceUnchanged || !whatsappSourceUnchanged
        ? 'SOURCE_UAT_DATA_CLONE_SOURCE_CHANGED'
        : (!baseFilesMatch ? 'SOURCE_UAT_DATA_CLONE_BASE_TREE_VERIFICATION_FAILED'
          : (!criticalSnapshotMatch ? 'SOURCE_UAT_DATA_CLONE_CRITICAL_VERIFICATION_FAILED' : 'SOURCE_UAT_WHATSAPP_OVERLAY_VERIFICATION_FAILED'))
    });
  }

  const receipt = {
    schemaVersion: 2,
    documentType: 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT',
    status: 'PASS',
    sourceDataRoot: sourceRoot,
    whatsappAuthSourceRoot: whatsappSourceRoot,
    targetDataRoot: targetRoot,
    markerPath,
    copiedAtUtc,
    verifiedAtUtc: new Date().toISOString(),
    sourceUntouched: sourceUnchanged,
    whatsappSourceUntouched: whatsappSourceUnchanged,
    baseFilesMatch,
    baseTreeMatch,
    criticalSnapshotMatch,
    whatsappAuthMatch,
    criticalFilesMatch: baseFilesMatch && criticalSnapshotMatch && whatsappAuthMatch,
    sourceTreeDigest: sourceTreeBefore,
    targetBaseTreeDigest: targetBaseTree,
    whatsappOverlayApplied,
    whatsappSessionOverlayApplied: Boolean(whatsappSessionOverlay),
    whatsappSessionSource: whatsappSessionOverlay?.source || '',
    whatsappTargetAccountDirectory: whatsappSessionOverlay?.accountDirectory || '',
    copiedWhatsappDirectories,
    criticalSnapshot: targetSnapshot,
    sourceFileCount: listFiles(sourceRoot).length,
    whatsappSourceFileCount: listFiles(whatsappSourceRoot).length,
    targetFileCountBeforeReceipt: listFiles(targetRoot).length
  };
  const receiptPath = options.report ? path.resolve(options.report) : path.join(targetRoot, RECEIPT_FILE);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, canonicalJson(receipt), 'utf8');
  return { ...receipt, receiptPath };
}

function main() {
  const result = prepareClone(parseArgs(process.argv.slice(2)));
  process.stdout.write(canonicalJson(result));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(canonicalJson({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_DATA_CLONE_FAILED', message: error.message }));
    process.exitCode = 1;
  }
}

module.exports = {
  MARKER_FILE,
  RECEIPT_FILE,
  WHATSAPP_AUTH_DIRECTORIES,
  COPY_EXCLUDED_NAMES,
  criticalSnapshot,
  directoryDigest,
  readCredentialSummary,
  overlayWhatsappAuth,
  overlayWhatsappSession,
  safeAccountDirectory,
  prepareClone
};
