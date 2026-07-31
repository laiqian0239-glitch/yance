'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AppRuntimeError } = require('./errors');

function nativeRealpath(target) {
  const fn = fs.realpathSync.native || fs.realpathSync;
  return fn(target);
}

function trimTrailingSeparators(value, pathImpl = path) {
  const parsed = pathImpl.parse(value);
  let result = value;
  while (result.length > parsed.root.length && /[\\/]$/.test(result)) result = result.slice(0, -1);
  return result;
}

function normalizePathIdentity(value, platform = process.platform) {
  let normalized = trimTrailingSeparators(path.normalize(String(value || '')));
  if (platform === 'win32') {
    normalized = normalized.replaceAll('/', '\\').toLowerCase();
    if (/^[a-z]:\\/.test(normalized)) normalized = `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function ensureDirectoryRealpath(inputPath, label) {
  const absolute = path.resolve(String(inputPath || ''));
  try {
    fs.mkdirSync(absolute, { recursive: true });
    return nativeRealpath(absolute);
  } catch (error) {
    throw new AppRuntimeError('RUNTIME_DATA_PATH_UNAVAILABLE', `Unable to prepare ${label}: ${absolute}`, {
      failedPhase: 'runtime_path_identity',
      details: { label, path: absolute, code: error.code || '' }
    });
  }
}

function isWithinRoot(rootPath, candidatePath, platform = process.platform) {
  const rootIdentity = normalizePathIdentity(rootPath, platform);
  const candidateIdentity = normalizePathIdentity(candidatePath, platform);
  if (candidateIdentity === rootIdentity) return true;
  const separator = platform === 'win32' ? '\\' : path.sep;
  return candidateIdentity.startsWith(`${rootIdentity}${separator}`);
}

function windowsDirectoryPhysicalIdentity(directoryPath, options = {}) {
  const statSync = options.statSync || fs.statSync;
  // On Windows, fs.statSync() can report a different st_dev for a junction or
  // 8.3 alias even when both names refer to the same directory. Resolve the
  // alias first and obtain the file identity from the canonical target path.
  // Tests that inject only statSync intentionally bypass the host filesystem;
  // they may inject realpathSync as well when alias resolution is under test.
  const realpathSync = options.realpathSync || (options.statSync ? null : nativeRealpath);
  let identityPath = directoryPath;
  if (realpathSync) {
    try {
      identityPath = realpathSync(directoryPath);
    } catch (error) {
      throw new AppRuntimeError('RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE', `Unable to resolve Windows runtime directory identity path: ${directoryPath}`, {
        failedPhase: 'runtime_path_identity',
        details: { path: directoryPath, code: error.code || '' }
      });
    }
  }
  let stat;
  try {
    stat = statSync(identityPath, { bigint: true });
  } catch (error) {
    throw new AppRuntimeError('RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE', `Unable to read Windows runtime directory identity: ${directoryPath}`, {
      failedPhase: 'runtime_path_identity',
      details: { path: directoryPath, identityPath, code: error.code || '' }
    });
  }
  const isDirectory = typeof stat?.isDirectory === 'function' && stat.isDirectory();
  let device = stat?.dev;
  const inode = stat?.ino;
  // Node on Windows can expose st_dev=0 for an 8.3 alias even though the
  // directory has the same file id as its long-path form. Recover the volume
  // identity from the resolved path's volume root in that case.
  if (device === 0n) {
    try {
      const volumeRoot = path.win32.parse(identityPath).root;
      const volumeStat = statSync(volumeRoot, { bigint: true });
      if (typeof volumeStat?.dev === 'bigint' && volumeStat.dev > 0n) device = volumeStat.dev;
    } catch (_) {}
  }
  if (!isDirectory || typeof device !== 'bigint' || typeof inode !== 'bigint' || device < 0n || inode <= 0n) {
    throw new AppRuntimeError('RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE', `Windows runtime directory did not expose a stable physical identity: ${directoryPath}`, {
      failedPhase: 'runtime_path_identity',
      details: {
        path: directoryPath,
        identityPath,
        isDirectory,
        deviceType: typeof device,
        inodeType: typeof inode,
        device: typeof device === 'bigint' ? device.toString() : '',
        inode: typeof inode === 'bigint' ? inode.toString() : ''
      }
    });
  }
  return `win32-directory-file-id-v1:${device.toString(16)}:${inode.toString(16)}`;
}

function runtimeMutexIdentity(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return options.dbPathIdentity;
  const pathImpl = platform === 'win32' ? path.win32 : path;
  const dbParent = pathImpl.dirname(options.canonicalDbPath);
  const physicalIdentityProvider = options.physicalIdentityProvider || windowsDirectoryPhysicalIdentity;
  let parentPhysicalIdentity;
  try {
    parentPhysicalIdentity = String(physicalIdentityProvider(dbParent, options.physicalIdentityOptions || {}));
  } catch (error) {
    if (error instanceof AppRuntimeError) throw error;
    throw new AppRuntimeError('RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE', `Unable to derive Windows runtime mutex identity: ${dbParent}`, {
      failedPhase: 'runtime_path_identity',
      details: { path: dbParent, code: error?.code || '', message: error?.message || String(error) }
    });
  }
  if (!/^win32-directory-file-id-v1:[0-9a-f]+:[0-9a-f]+$/i.test(parentPhysicalIdentity)) {
    throw new AppRuntimeError('RUNTIME_PATH_PHYSICAL_IDENTITY_INVALID', 'Windows runtime directory physical identity is invalid', {
      failedPhase: 'runtime_path_identity',
      details: { path: dbParent, physicalIdentity: parentPhysicalIdentity }
    });
  }
  const databaseFileName = pathImpl.basename(options.canonicalDbPath).toLowerCase();
  if (!databaseFileName || /[\\/\0]/.test(databaseFileName)) {
    throw new AppRuntimeError('RUNTIME_DB_PATH_UNAVAILABLE', 'Runtime database filename is invalid for mutex identity', {
      failedPhase: 'runtime_path_identity',
      details: { path: options.canonicalDbPath, databaseFileName }
    });
  }
  return `win32-database-file-id-v1:${parentPhysicalIdentity}:${databaseFileName}`;
}

function canonicalizeRuntimePaths(options = {}) {
  if (!options.dataRoot) throw new TypeError('dataRoot is required');
  const platform = options.platform || process.platform;
  const canonicalDataRoot = ensureDirectoryRealpath(options.dataRoot, 'runtime data directory');
  const rawDbPath = path.resolve(options.dbPath || path.join(canonicalDataRoot, 'store', 'yance-r32.db'));
  const canonicalDbParent = ensureDirectoryRealpath(path.dirname(rawDbPath), 'runtime database directory');
  let canonicalDbPath = path.join(canonicalDbParent, path.basename(rawDbPath));
  if (fs.existsSync(canonicalDbPath)) {
    try { canonicalDbPath = nativeRealpath(canonicalDbPath); }
    catch (error) {
      throw new AppRuntimeError('RUNTIME_DB_PATH_UNAVAILABLE', `Unable to resolve runtime database path: ${canonicalDbPath}`, {
        failedPhase: 'runtime_path_identity',
        details: { path: canonicalDbPath, code: error.code || '' }
      });
    }
  }
  if (!isWithinRoot(canonicalDataRoot, canonicalDbPath, platform)) {
    throw new AppRuntimeError('RUNTIME_DB_PATH_OUTSIDE_DATA_ROOT', 'Runtime database must resolve inside the canonical data root', {
      status: 400,
      failedPhase: 'runtime_path_identity',
      details: {
        dataRoot: canonicalDataRoot,
        dbPath: canonicalDbPath,
        suppliedDataRoot: path.resolve(options.dataRoot),
        suppliedDbPath: rawDbPath
      }
    });
  }
  const dataRootIdentity = normalizePathIdentity(canonicalDataRoot, platform);
  const dbPathIdentity = normalizePathIdentity(canonicalDbPath, platform);
  const mutexIdentity = runtimeMutexIdentity({
    platform,
    canonicalDbPath,
    dbPathIdentity,
    physicalIdentityProvider: options.physicalIdentityProvider,
    physicalIdentityOptions: options.physicalIdentityOptions
  });
  return Object.freeze({
    platform,
    suppliedDataRoot: path.resolve(options.dataRoot),
    suppliedDbPath: rawDbPath,
    dataRoot: canonicalDataRoot,
    dbPath: canonicalDbPath,
    dataRootIdentity,
    dbPathIdentity,
    mutexIdentityKind: platform === 'win32' ? 'WINDOWS_DIRECTORY_FILE_ID_PLUS_DATABASE_NAME_V1' : 'CANONICAL_DATABASE_PATH_V1',
    mutexIdentity
  });
}

module.exports = {
  canonicalizeRuntimePaths,
  ensureDirectoryRealpath,
  isWithinRoot,
  normalizePathIdentity,
  runtimeMutexIdentity,
  trimTrailingSeparators,
  windowsDirectoryPhysicalIdentity
};
