'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { resolveNpmInvocation } = require('./npm-process-authority');
function fail(reasonCode, message, details = {}) { throw Object.assign(new Error(message), { reasonCode, details }); }
function readJson(file, reasonCode) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(reasonCode, `无法读取 JSON：${file}`, { file, cause: error.code || error.message }); } }
function digest(buffer, algorithm, encoding) { return crypto.createHash(algorithm).update(buffer).digest(encoding); }
function readNpmPackageMetadata(buffer, archivePath) {
  let tar;
  try { tar = zlib.gunzipSync(buffer); } catch (error) {
    fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子不是有效 gzip tarball：${archivePath}`, { archivePath, cause: error.code || error.message });
  }
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '');
    const entryName = prefix ? `${prefix}/${name}` : name;
    const normalizedEntryName = entryName.replace(/^\.\//u, '');
    const entrySegments = normalizedEntryName.split('/');
    if (
      normalizedEntryName.includes('\\') ||
      normalizedEntryName.startsWith('/') ||
      /^[A-Za-z]:/u.test(normalizedEntryName) ||
      entrySegments.includes('..')
    ) {
      fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子 tar 条目路径不安全：${archivePath}`, { archivePath, entryName });
    }
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子 tar 条目长度无效：${archivePath}`, { archivePath, entryName, sizeText });
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子 tar 条目越界：${archivePath}`, { archivePath, entryName });
    if (entrySegments.length === 2 && entrySegments[0] && entrySegments[1] === 'package.json') {
      let metadata;
      try { metadata = JSON.parse(tar.subarray(bodyStart, bodyEnd).toString('utf8')); } catch (error) {
        fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子 package.json 无效：${archivePath}`, { archivePath, cause: error.message });
      }
      return Object.freeze({ name: String(metadata.name || ''), version: String(metadata.version || '') });
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  fail('SOURCE_UAT_DEPENDENCY_SEED_ARCHIVE_INVALID', `依赖种子缺少安全的单根目录 package.json：${archivePath}`, { archivePath });
}
function verifyTrustedDependencySeeds(repoRoot, options = {}) {
  const policyPath = path.resolve(options.policyPath || path.join(repoRoot, 'governance/dependency-install-policy.json'));
  const lockPath = path.resolve(options.lockPath || path.join(repoRoot, 'package-lock.json'));
  const policy = readJson(policyPath, 'SOURCE_UAT_DEPENDENCY_SEED_POLICY_INVALID');
  const lock = readJson(lockPath, 'SOURCE_UAT_DEPENDENCY_LOCK_INVALID');
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.trustedCacheSeeds)) fail('SOURCE_UAT_DEPENDENCY_SEED_POLICY_INVALID', '依赖种子策略结构无效', { policyPath });
  const verified = policy.trustedCacheSeeds.map(seed => {
    const lockEntry = lock.packages?.[seed.lockPath];
    if (!lockEntry || lockEntry.version !== seed.version || lockEntry.resolved !== seed.resolved || lockEntry.integrity !== seed.integrity) fail('SOURCE_UAT_DEPENDENCY_SEED_LOCK_MISMATCH', `依赖种子与锁文件不一致：${seed.packageName}`, { seed, lockEntry: lockEntry || null });
    const archivePath = path.resolve(repoRoot, seed.archivePath);
    if (!archivePath.startsWith(path.resolve(repoRoot) + path.sep)) fail('SOURCE_UAT_DEPENDENCY_SEED_PATH_UNSAFE', '依赖种子路径越界', { archivePath });
    let buffer; try { buffer = fs.readFileSync(archivePath); } catch (error) { fail('SOURCE_UAT_DEPENDENCY_SEED_MISSING', `依赖种子不存在：${seed.archivePath}`, { cause: error.code }); }
    const sha256 = digest(buffer, 'sha256', 'hex');
    if (sha256 !== seed.archiveSha256) fail('SOURCE_UAT_DEPENDENCY_SEED_SHA256_MISMATCH', `依赖种子 SHA256 不匹配：${seed.packageName}`, { expected: seed.archiveSha256, actual: sha256 });
    const integrity = `sha512-${digest(buffer, 'sha512', 'base64')}`;
    if (integrity !== seed.integrity) fail('SOURCE_UAT_DEPENDENCY_SEED_INTEGRITY_MISMATCH', `依赖种子 npm integrity 不匹配：${seed.packageName}`, { expected: seed.integrity, actual: integrity });
    const packageMetadata = readNpmPackageMetadata(buffer, archivePath);
    if (packageMetadata.name !== seed.packageName || packageMetadata.version !== seed.version) {
      fail('SOURCE_UAT_DEPENDENCY_SEED_PACKAGE_METADATA_MISMATCH', `依赖种子包元数据不匹配：${seed.packageName}`, { expected: { name: seed.packageName, version: seed.version }, actual: packageMetadata });
    }
    return Object.freeze({ ...seed, archivePath, archiveBytes: buffer.length, verifiedSha256: sha256, packageMetadata });
  });
  return Object.freeze({ policyPath, lockPath, seeds: verified, seedCount: verified.length });
}
function dependencySeedBatches(seeds, options = {}) {
  const platform = options.platform || process.platform;
  const maxBatchSeeds = Math.max(1, Math.min(128, Number(options.maxBatchSeeds || 32)));
  const maxCommandChars = Math.max(1024, Number(options.maxCommandChars || (platform === 'win32' ? 7000 : 100000)));
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const seed of seeds) {
    const nextChars = seed.archivePath.length + 3;
    if (current.length && (current.length >= maxBatchSeeds || currentChars + nextChars > maxCommandChars)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(seed);
    currentChars += nextChars;
  }
  if (current.length) batches.push(current);
  return batches;
}
function seedTrustedDependencyCache(repoRoot, options = {}) {
  const verified = verifyTrustedDependencySeeds(repoRoot, options);
  const cacheRoot = path.resolve(options.cacheRoot || path.join(repoRoot, '.yance-cache', 'npm'));
  fs.mkdirSync(cacheRoot, { recursive: true });
  const run = options.spawn || spawnSync;
  const platform = options.platform || process.platform;
  const invocation = resolveNpmInvocation({
    platform,
    npmCliPath: options.npmCliPath,
    nodeExecutable: options.nodeExecutable,
    npmCommand: options.npmCommand,
    env: options.env,
    existsSync: options.existsSync
  });
  const receipts = [];
  const batchReceipts = [];
  const batches = dependencySeedBatches(verified.seeds, { ...options, platform });
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const result = run(invocation.command, [...invocation.argsPrefix, 'cache', 'add', ...batch.map(seed => seed.archivePath), '--cache', cacheRoot], { cwd: repoRoot, encoding: 'utf8', shell: invocation.shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) {
      fail('SOURCE_UAT_DEPENDENCY_CACHE_SEED_FAILED', `依赖缓存批次失败：${index + 1}/${batches.length}`, {
        batchIndex: index + 1,
        batchCount: batches.length,
        packageNames: batch.map(seed => seed.packageName),
        status: result.status,
        signal: result.signal,
        error: result.error?.message || '',
        stderr: String(result.stderr || '').slice(-4000)
      });
    }
    batchReceipts.push({
      batchIndex: index + 1,
      seedCount: batch.length,
      packageNames: batch.map(seed => seed.packageName)
    });
    for (const seed of batch) receipts.push({ packageName: seed.packageName, version: seed.version, archiveSha256: seed.archiveSha256 });
  }
  return Object.freeze({ ok: true, cacheRoot, seedCount: receipts.length, batchCount: batchReceipts.length, batches: batchReceipts, seeds: receipts });
}
module.exports = { seedTrustedDependencyCache, verifyTrustedDependencySeeds };
