'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_OBJECT_RE = /^[0-9a-f]{40}$/;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_CREATOR_VERSION_UNIX = (3 << 8) | ZIP_VERSION;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 0x0021;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
    windowsHide: true,
    shell: false,
    env: options.env || process.env
  });
  if (result.error) {
    fail('RELEASE_SEAL_COMMAND_FAILED', `${command} could not be started`, {
      command,
      args,
      error: result.error.message
    });
  }
  if (result.status !== 0 && !options.allowFailure) {
    fail('RELEASE_SEAL_COMMAND_FAILED', `${command} exited with status ${result.status}`, {
      command,
      args,
      status: result.status,
      stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : result.stdout,
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    });
  }
  return result;
}

function git(repoRoot, args, options = {}) {
  return run('git', ['-C', repoRoot, ...args], options);
}

function gitText(repoRoot, args) {
  return String(git(repoRoot, args).stdout || '').trim();
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function blobObjectId(data) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${data.length}\0`, 'utf8')).update(data).digest('hex');
}

function crc32(data) {
  let value = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) value = CRC32_TABLE[(value ^ data[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function canonicalRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').normalize('NFC');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) {
    fail('RELEASE_SEAL_PATH_INVALID', 'path must be canonical and relative', { value });
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('RELEASE_SEAL_PATH_INVALID', 'path contains unsafe segments', { value });
  }
  return normalized;
}

function resolveRepositoryRoot(startPath = process.cwd()) {
  return gitText(path.resolve(startPath), ['rev-parse', '--show-toplevel']);
}

function readRepositoryIdentity(repoRoot, baseCommit) {
  const branch = gitText(repoRoot, ['branch', '--show-current']);
  if (!branch) fail('RELEASE_SEAL_DETACHED_HEAD_DENIED', 'source seal requires a named branch');
  const head = gitText(repoRoot, ['rev-parse', 'HEAD']);
  const tree = gitText(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const base = gitText(repoRoot, ['rev-parse', `${baseCommit}^{commit}`]);
  const baseTree = gitText(repoRoot, ['rev-parse', `${base}^{tree}`]);
  if (![head, tree, base, baseTree].every((value) => GIT_OBJECT_RE.test(value))) {
    fail('RELEASE_SEAL_IDENTITY_INVALID', 'Git identity is invalid', { head, tree, base, baseTree });
  }
  const status = gitText(repoRoot, ['status', '--porcelain=v1']);
  if (status) fail('RELEASE_SEAL_DIRTY_WORKTREE', 'source worktree must be clean', { status });
  const ancestor = git(repoRoot, ['merge-base', '--is-ancestor', base, head], { allowFailure: true });
  if (ancestor.status !== 0) fail('RELEASE_SEAL_BASE_NOT_ANCESTOR', 'base commit is not an ancestor of HEAD', { base, head });
  return Object.freeze({ branch, head, tree, baseCommit: base, baseTree });
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureExternalOutput(repoRoot, outputDir) {
  const resolved = path.resolve(outputDir);
  if (isPathInside(repoRoot, resolved)) {
    fail('RELEASE_SEAL_OUTPUT_INSIDE_REPOSITORY', 'seal output must be outside the source repository', { repoRoot, outputDir: resolved });
  }
  fs.mkdirSync(resolved, { recursive: true });
  if (fs.readdirSync(resolved).length !== 0) {
    fail('RELEASE_SEAL_OUTPUT_NOT_EMPTY', 'seal output directory must be empty', { outputDir: resolved });
  }
  return resolved;
}

function listGitBlobs(repoRoot, commit) {
  const result = git(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', commit], { encoding: null });
  const records = new Map();
  for (const chunk of result.stdout.toString('utf8').split('\0')) {
    if (!chunk) continue;
    const tab = chunk.indexOf('\t');
    const metadata = chunk.slice(0, tab).split(' ');
    const filePath = canonicalRelativePath(chunk.slice(tab + 1));
    const [mode, type, objectId] = metadata;
    if (type !== 'blob') fail('RELEASE_SEAL_UNSUPPORTED_GIT_OBJECT', 'only Git blobs are supported in source ZIP verification', { filePath, mode, type });
    records.set(filePath, Object.freeze({ path: filePath, mode, objectId }));
  }
  return records;
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
}

function createGitTreeZip(repoRoot, commit, outputPath, prefix) {
  const normalizedPrefix = `${canonicalRelativePath(prefix).replace(/\/+$/, '')}/`;
  const records = [...listGitBlobs(repoRoot, commit).values()].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))).map((record) => {
    const data = git(repoRoot, ['cat-file', 'blob', record.objectId], { encoding: null }).stdout;
    return {
      ...record,
      name: `${normalizedPrefix}${record.path}`,
      data,
      crc32: crc32(data),
      size: data.length
    };
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const fd = fs.openSync(outputPath, 'wx', 0o600);
  const central = [];
  let position = 0;
  try {
    for (const record of records) {
      const name = Buffer.from(record.name, 'utf8');
      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
      local.writeUInt16LE(ZIP_VERSION, 4);
      local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
      local.writeUInt16LE(ZIP_STORE_METHOD, 8);
      local.writeUInt16LE(ZIP_DOS_TIME, 10);
      local.writeUInt16LE(ZIP_DOS_DATE, 12);
      local.writeUInt32LE(record.crc32, 14);
      local.writeUInt32LE(record.size, 18);
      local.writeUInt32LE(record.size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      name.copy(local, 30);
      const localOffset = position;
      writeAll(fd, local);
      writeAll(fd, record.data);
      position += local.length + record.data.length;
      central.push({ record, name, localOffset });
    }
    const centralOffset = position;
    for (const item of central) {
      const { record, name, localOffset } = item;
      const header = Buffer.alloc(46 + name.length);
      header.writeUInt32LE(ZIP_CENTRAL_FILE_HEADER, 0);
      header.writeUInt16LE(ZIP_CREATOR_VERSION_UNIX, 4);
      header.writeUInt16LE(ZIP_VERSION, 6);
      header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
      header.writeUInt16LE(ZIP_STORE_METHOD, 10);
      header.writeUInt16LE(ZIP_DOS_TIME, 12);
      header.writeUInt16LE(ZIP_DOS_DATE, 14);
      header.writeUInt32LE(record.crc32, 16);
      header.writeUInt32LE(record.size, 20);
      header.writeUInt32LE(record.size, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(((Number.parseInt(record.mode, 8) << 16) | 0x20) >>> 0, 38);
      header.writeUInt32LE(localOffset, 42);
      name.copy(header, 46);
      writeAll(fd, header);
      position += header.length;
    }
    const comment = Buffer.from(commit, 'ascii');
    const end = Buffer.alloc(22 + comment.length);
    end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(records.length, 8);
    end.writeUInt16LE(records.length, 10);
    end.writeUInt32LE(position - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(comment.length, 20);
    comment.copy(end, 22);
    writeAll(fd, end);
  } finally {
    fs.closeSync(fd);
  }
  return Object.freeze({ outputPath, entryCount: records.length, sourcePrefix: normalizedPrefix, comment: commit });
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  fail('RELEASE_SEAL_ZIP_INVALID', 'ZIP end-of-central-directory record not found');
}

function readZipEntries(zipPath) {
  const bytes = fs.readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) fail('RELEASE_SEAL_ZIP_INVALID', 'ZIP central header signature is invalid', { index, cursor });
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const fileNameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength).toString((flags & 0x0800) ? 'utf8' : 'binary').replace(/\\/g, '/');
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) fail('RELEASE_SEAL_ZIP_INVALID', 'ZIP local header signature is invalid', { name, localOffset });
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else fail('RELEASE_SEAL_ZIP_METHOD_UNSUPPORTED', 'ZIP compression method is unsupported', { name, method });
    if (data.length !== uncompressedSize) fail('RELEASE_SEAL_ZIP_SIZE_MISMATCH', 'ZIP entry size is inconsistent', { name, expected: uncompressedSize, actual: data.length });
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    entries.push(Object.freeze({ name, data, unixMode }));
  }
  return entries;
}

function compareZipToTree(repoRoot, commit, zipPath, prefix) {
  const gitRecords = listGitBlobs(repoRoot, commit);
  const zipRecords = new Map();
  const normalizedPrefix = `${canonicalRelativePath(prefix).replace(/\/+$/, '')}/`;
  for (const entry of readZipEntries(zipPath)) {
    if (!entry.name.startsWith(normalizedPrefix)) fail('RELEASE_SEAL_ZIP_PREFIX_MISMATCH', 'ZIP entry is outside the expected source prefix', { entry: entry.name, prefix: normalizedPrefix });
    const relativePath = canonicalRelativePath(entry.name.slice(normalizedPrefix.length));
    zipRecords.set(relativePath, entry);
  }
  const missing = [];
  const extra = [];
  const blobMismatches = [];
  const modeMismatches = [];
  for (const [filePath, gitRecord] of gitRecords) {
    const zipRecord = zipRecords.get(filePath);
    if (!zipRecord) {
      missing.push(filePath);
      continue;
    }
    const actualBlob = blobObjectId(zipRecord.data);
    if (actualBlob !== gitRecord.objectId) blobMismatches.push({ path: filePath, expected: gitRecord.objectId, actual: actualBlob });
    const expectedMode = Number.parseInt(gitRecord.mode, 8);
    if (zipRecord.unixMode !== expectedMode) modeMismatches.push({ path: filePath, expected: gitRecord.mode, actual: zipRecord.unixMode.toString(8) });
  }
  for (const filePath of zipRecords.keys()) if (!gitRecords.has(filePath)) extra.push(filePath);
  return Object.freeze({
    pass: missing.length === 0 && extra.length === 0 && blobMismatches.length === 0 && modeMismatches.length === 0,
    gitPathCount: gitRecords.size,
    zipPathCount: zipRecords.size,
    missing,
    extra,
    blobMismatches,
    modeMismatches
  });
}

function writeStandardChecksums(directory, fileNames, outputName) {
  const lines = fileNames.slice().sort().map((fileName) => {
    const normalized = canonicalRelativePath(fileName);
    return `${sha256File(path.join(directory, normalized))}  ${normalized}`;
  });
  const outputPath = path.join(directory, outputName);
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
  return outputPath;
}

function verifyStandardChecksums(directory, checksumPath) {
  const lines = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail('RELEASE_SEAL_CHECKSUM_FORMAT_INVALID', 'checksum line is not in standard two-column format', { line });
    const relativePath = canonicalRelativePath(match[2]);
    const actual = sha256File(path.join(directory, relativePath));
    results.push({ path: relativePath, expected: match[1], actual, pass: match[1] === actual });
  }
  return Object.freeze({ pass: results.every((item) => item.pass), results });
}

function createTemporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function verifyBundleIndependently(bundlePath) {
  const tempRoot = createTemporaryDirectory('yance-bundle-verify-');
  try {
    run('git', ['init', '--bare', '--quiet', tempRoot]);
    return git(tempRoot, ['bundle', 'verify', bundlePath], { allowFailure: true });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifyBundleClone(bundlePath, identity) {
  const tempRoot = createTemporaryDirectory('yance-seal-clone-');
  const clonePath = path.join(tempRoot, 'clone');
  try {
    run('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--quiet', '--branch', identity.branch, bundlePath, clonePath]);
    const head = gitText(clonePath, ['rev-parse', 'HEAD']);
    const tree = gitText(clonePath, ['rev-parse', 'HEAD^{tree}']);
    const status = gitText(clonePath, ['status', '--porcelain=v1']);
    const fsck = git(clonePath, ['fsck', '--full', '--strict'], { allowFailure: true });
    return Object.freeze({ pass: head === identity.head && tree === identity.tree && status === '' && fsck.status === 0, head, tree, status, fsckExitCode: fsck.status, clonePath });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifyPatchRebuild(bundlePath, patchPath, identity) {
  const tempRoot = createTemporaryDirectory('yance-seal-patch-');
  const repoPath = path.join(tempRoot, 'repo');
  try {
    run('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--quiet', '--no-checkout', bundlePath, repoPath]);
    git(repoPath, ['checkout', '--quiet', '--detach', identity.baseCommit]);
    const apply = git(repoPath, ['apply', '--index', '--binary', '--whitespace=nowarn', patchPath], { allowFailure: true });
    if (apply.status !== 0) return Object.freeze({ pass: false, applyExitCode: apply.status, stderr: String(apply.stderr || '') });
    const rebuiltTree = gitText(repoPath, ['write-tree']);
    return Object.freeze({ pass: rebuiltTree === identity.tree, applyExitCode: 0, rebuiltTree });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifySourceSeal(sealDir, options = {}) {
  const identityPath = path.join(sealDir, options.identityFile || 'SOURCE_SEAL_IDENTITY.json');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const required = ['branch', 'head', 'tree', 'baseCommit', 'baseTree', 'bundleFile', 'sourceZipFile', 'patchFile', 'sourcePrefix'];
  for (const field of required) if (!identity[field]) fail('RELEASE_SEAL_IDENTITY_DOCUMENT_INVALID', `identity document is missing ${field}`);
  const bundlePath = path.join(sealDir, identity.bundleFile);
  const zipPath = path.join(sealDir, identity.sourceZipFile);
  const patchPath = path.join(sealDir, identity.patchFile);
  const bundleVerify = verifyBundleIndependently(bundlePath);
  const tempRoot = createTemporaryDirectory('yance-seal-verify-');
  const clonePath = path.join(tempRoot, 'clone');
  let clone;
  let zip;
  try {
    run('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--quiet', '--branch', identity.branch, bundlePath, clonePath]);
    const head = gitText(clonePath, ['rev-parse', 'HEAD']);
    const tree = gitText(clonePath, ['rev-parse', 'HEAD^{tree}']);
    const status = gitText(clonePath, ['status', '--porcelain=v1']);
    const fsck = git(clonePath, ['fsck', '--full', '--strict'], { allowFailure: true });
    clone = Object.freeze({
      pass: head === identity.head && tree === identity.tree && status === '' && fsck.status === 0,
      head,
      tree,
      status,
      fsckExitCode: fsck.status
    });
    zip = compareZipToTree(clonePath, identity.head, zipPath, identity.sourcePrefix);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const patch = verifyPatchRebuild(bundlePath, patchPath, identity);
  const patchBytes = fs.readFileSync(patchPath);
  const patchHasBom = patchBytes.length >= 3 && patchBytes[0] === 0xef && patchBytes[1] === 0xbb && patchBytes[2] === 0xbf;
  return Object.freeze({
    pass: bundleVerify.status === 0 && clone.pass && zip.pass && patch.pass && !patchHasBom,
    bundleVerifyExitCode: bundleVerify.status,
    bundleVerifyStdout: String(bundleVerify.stdout || ''),
    bundleVerifyStderr: String(bundleVerify.stderr || ''),
    clone,
    zip,
    patch,
    patchHasBom
  });
}

module.exports = {
  canonicalRelativePath,
  compareZipToTree,
  createGitTreeZip,
  ensureExternalOutput,
  fail,
  git,
  gitText,
  readRepositoryIdentity,
  resolveRepositoryRoot,
  run,
  sha256File,
  verifyBundleClone,
  verifyBundleIndependently,
  verifyPatchRebuild,
  verifySourceSeal,
  verifyStandardChecksums,
  writeStandardChecksums
};
