'use strict';

// Shared async durability primitive for the Electron desktop host boot path.
//
// Converts the previously duplicated synchronous atomic-write helper into a
// single awaitable durable atomic replace with the exact crash-consistency
// ordering required before any downstream safety side effect (backend fork,
// admission release, credential mutation, containment release):
//
//   mkdir -> open -> write -> FileHandle.sync() -> close -> rename
//   -> directory durability -> resolve
//
// The primitive is fail-closed: any failure before/at rename cleans up the
// temporary file and rethrows; a rename/fsync failure is never swallowed.
//
// Windows directory-handle semantics are preserved: opening or fsyncing a
// directory handle may fail with EPERM/EISDIR/EACCES/ENOENT on NTFS/temp
// locations, which is tolerated for the *directory* phase only. File fsync
// failures and every non-tolerated directory failure still fail closed.

const path = require('node:path');
const crypto = require('node:crypto');
const nodeFs = require('node:fs');

function promisesOf(fsApi) {
  return (fsApi && fsApi.promises) || fsApi || nodeFs.promises;
}

function isDirectoryFsyncTolerated(code, platform) {
  if (platform === 'win32') {
    return code === 'EPERM' || code === 'EISDIR' || code === 'EACCES' || code === 'ENOENT';
  }
  return code === 'EINVAL' || code === 'EBADF' || code === 'ENOTSUP' || code === 'EISDIR';
}

async function mkdirAsync(dir, fsApi) {
  await promisesOf(fsApi).mkdir(dir, { recursive: true });
}

async function openAsync(file, flags, mode, fsApi) {
  return promisesOf(fsApi).open(file, flags, mode);
}

async function writeFileAsync(handle, data) {
  await handle.writeFile(data, 'utf8');
}

async function fileSyncAsync(handle, context, platform = process.platform) {
  try {
    await handle.sync();
  } catch (error) {
    if (context === 'directory' && isDirectoryFsyncTolerated(error?.code, platform)) return;
    throw error;
  }
}

async function closeAsync(handle) {
  if (!handle) return;
  try { await handle.close(); } catch (_) { /* close failures never mask the durable outcome */ }
}

async function renameAsync(oldPath, newPath, fsApi) {
  await promisesOf(fsApi).rename(oldPath, newPath);
}

// Windows transient-deletion retry semantics ported from the mature upstream
// behavior of Node's fs.rm (implemented in lib/internal/fs/rimraf.js), which
// rimraf v4 (https://github.com/isaacs/rimraf) delegates to via its `rm`
// option. Node retries removal when the operation fails with EBUSY, EMFILE,
// ENFILE, ENOTEMPTY or EPERM, using a linear backoff of retryDelay ms longer
// on each try, up to maxRetries (see https://nodejs.org/api/fs.html#fsrmpath-options).
// ENOENT means the target is already gone and is success. We deliberately do
// NOT probe existence before unlinking (no exists-before-unlink TOCTOU): a
// missing target surfaces as ENOENT from unlink itself. The budget is bounded
// and deterministic; once exhausted the final underlying error is rethrown so
// durable cleanup still fails closed. Unknown/non-transient codes fail
// immediately rather than being swallowed.
const UNLINK_RETRYABLE_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
const UNLINK_MAX_RETRIES = 5; // 6 total attempts (Node fs.rm maxRetries shape)
const UNLINK_RETRY_DELAY_MS = 100; // linear backoff base; worst case ~1.5 s added latency

async function sleepMillis(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function unlinkAsync(file, fsApi) {
  const p = promisesOf(fsApi);
  let attempt = 0;
  let lastError = null;
  for (;;) {
    try {
      await p.unlink(file);
      return;
    } catch (error) {
      const code = error && error.code;
      if (code === 'ENOENT') return; // already removed: success
      if (!UNLINK_RETRYABLE_CODES.has(code)) throw error; // non-transient: fail immediately
      lastError = error;
      attempt += 1;
      if (attempt > UNLINK_MAX_RETRIES) break; // budget exhausted: fail closed below
      await sleepMillis(UNLINK_RETRY_DELAY_MS * attempt); // linear backoff (Node fs.rm semantics)
    }
  }
  throw lastError;
}

async function existsAsync(file, fsApi) {
  const p = promisesOf(fsApi);
  try { await p.access(file); return true; }
  catch (_) { return false; }
}

async function readFileTextAsync(file, fsApi) {
  const p = promisesOf(fsApi);
  try { return await p.readFile(file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function readJsonAsync(file, fsApi) {
  const text = await readFileTextAsync(file, fsApi);
  if (text === null) return null;
  return JSON.parse(text);
}

async function atomicWriteJsonAsync(file, value, options = {}) {
  const fsApi = options.fsApi;
  const platform = options.platform || process.platform;
  const phaseHook = options.phaseHook || null;
  const p = promisesOf(fsApi);

  const dir = path.dirname(file);
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const invoke = phase => {
    if (typeof phaseHook !== 'function') return;
    try { phaseHook(phase, { file, temp }); } catch (_) { /* injection is observational */ }
  };

  let handle = null;
  let dirHandle = null;
  try {
    invoke('mkdir');
    await p.mkdir(dir, { recursive: true });
    invoke('open');
    handle = await p.open(temp, 'w', 0o600);
    invoke('write');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    invoke('fsync');
    await fileSyncAsync(handle, 'file', platform);
    invoke('close');
    await closeAsync(handle);
    handle = null;
    invoke('rename');
    await p.rename(temp, file);
    invoke('directory-open');
    try {
      dirHandle = await p.open(dir, 'r');
    } catch (error) {
      if (!isDirectoryFsyncTolerated(error?.code, platform)) throw error;
      dirHandle = null;
    }
    if (dirHandle) {
      invoke('directory-fsync');
      await fileSyncAsync(dirHandle, 'directory', platform);
      invoke('directory-close');
      await closeAsync(dirHandle);
      dirHandle = null;
    }
  } catch (error) {
    await closeAsync(handle);
    await closeAsync(dirHandle);
    await unlinkAsync(temp, fsApi);
    throw error;
  }
}

module.exports = {
  atomicWriteJsonAsync,
  closeAsync,
  directoryFsyncTolerated: isDirectoryFsyncTolerated,
  existsAsync,
  fileSyncAsync,
  mkdirAsync,
  openAsync,
  promisesOf,
  readFileTextAsync,
  readJsonAsync,
  renameAsync,
  unlinkAsync,
  writeFileAsync
};
