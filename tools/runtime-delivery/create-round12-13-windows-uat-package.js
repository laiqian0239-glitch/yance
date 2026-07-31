'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const zlib = require('node:zlib');

const CHECKPOINT_FILE = 'YANCE_SOURCE_CHECKPOINT.json';
const UAT_TAG = 'architecture-round12-round13-final-governance-windows-uat-20260727';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(root, args) {
  return String(execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })).trim();
}

function render(file, values) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(values)) source = source.split(key).join(String(value));
  if (/__[A-Z0-9_]+__/u.test(source)) throw new Error(`unresolved placeholder in ${file}`);
  return source;
}

function write(templateRoot, packageRoot, template, output, values, { ascii = false, crlf = false } = {}) {
  let source = render(path.join(templateRoot, template), values);
  if (crlf) source = source.replace(/\r?\n/gu, '\r\n');
  if (ascii) {
    if (!/^[\x00-\x7F]*$/u.test(source)) throw new Error(`${output} must be ASCII`);
    fs.writeFileSync(path.join(packageRoot, output), Buffer.from(source, 'ascii'));
    return;
  }
  fs.writeFileSync(path.join(packageRoot, output), source, 'utf8');
}

function listZipEntryNames(zipPath) {
  const bytes = fs.readFileSync(zipPath);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  let eocdOffset = -1;
  const lowerBound = Math.max(0, bytes.length - 65_557);

  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`ZIP end-of-central-directory was not found: ${zipPath}`);

  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  let offset = bytes.readUInt32LE(eocdOffset + 16);
  const names = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralSignature) {
      throw new Error(`Invalid ZIP central-directory entry ${index}: ${zipPath}`);
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function assertUniqueZipEntries(zipPath) {
  const names = listZipEntryNames(zipPath);
  const seen = new Set();
  const duplicates = new Set();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    throw new Error(`ZIP contains duplicate entries: ${[...duplicates].sort().join(', ')}`);
  }
  const checkpointCount = names.filter(name => name === CHECKPOINT_FILE).length;
  if (checkpointCount !== 1) {
    throw new Error(`ZIP must contain exactly one ${CHECKPOINT_FILE}; actual=${checkpointCount}`);
  }
  return names;
}

function crc32(buffer) {
  let value = 0xFFFFFFFF;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xEDB88320 : 0);
    }
  }
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function assertSafeArchivePath(file) {
  const normalized = String(file || '').replace(/\\/gu, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`unsafe archive path: ${JSON.stringify(file)}`);
  }
  const parts = normalized.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`unsafe archive path: ${JSON.stringify(file)}`);
  }
  return normalized;
}

function listHeadBlobs(repoRoot) {
  const raw = execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', '-z', 'HEAD']);
  const entries = [];
  for (const record of raw.toString('binary').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('invalid git ls-tree record');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const file = assertSafeArchivePath(Buffer.from(record.slice(tab + 1), 'binary').toString('utf8'));
    if (type !== 'blob') throw new Error(`unsupported Git tree entry ${type}: ${file}`);
    entries.push({ mode, object, file });
  }
  return entries;
}

function readGitBlobs(repoRoot, objectIds) {
  const unique = [...new Set(objectIds)];
  const result = spawnSync('git', ['-C', repoRoot, 'cat-file', '--batch'], {
    input: Buffer.from(`${unique.join('\n')}\n`, 'ascii'),
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git cat-file failed: ${String(result.stderr || '')}`);
  const blobs = new Map();
  let offset = 0;
  for (const expected of unique) {
    const newline = result.stdout.indexOf(0x0A, offset);
    if (newline < 0) throw new Error(`missing git cat-file header for ${expected}`);
    const header = result.stdout.subarray(offset, newline).toString('ascii').split(' ');
    if (header.length !== 3 || header[0] !== expected || header[1] !== 'blob') {
      throw new Error(`unexpected git cat-file header: ${header.join(' ')}`);
    }
    const size = Number(header[2]);
    const start = newline + 1;
    const finish = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || finish >= result.stdout.length) {
      throw new Error(`invalid git blob size for ${expected}`);
    }
    blobs.set(expected, Buffer.from(result.stdout.subarray(start, finish)));
    if (result.stdout[finish] !== 0x0A) throw new Error(`missing git cat-file delimiter for ${expected}`);
    offset = finish + 1;
  }
  if (offset !== result.stdout.length) throw new Error('unexpected trailing git cat-file output');
  return blobs;
}

function createZipArchive(outputPath, entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const utf8Flag = 0x0800;
  const method = 8;
  const dosTime = 0;
  const dosDate = 0x0021;

  for (const entry of entries) {
    const name = Buffer.from(assertSafeArchivePath(entry.file), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((Number.parseInt(entry.mode || '100644', 8) & 0xFFFF) * 0x10000, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  if (entries.length > 0xFFFF) throw new Error('ZIP64 is required for this archive entry count');
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  fs.writeFileSync(outputPath, Buffer.concat([...localParts, centralBytes, end]));
}

function createIdentityBoundArchive(repoRoot, payloadPath, checkpoint) {
  const treeEntries = listHeadBlobs(repoRoot);
  const blobs = readGitBlobs(repoRoot, treeEntries.map(entry => entry.object));
  const entries = treeEntries
    .filter(entry => entry.file !== CHECKPOINT_FILE)
    .map(entry => ({ file: entry.file, mode: entry.mode, data: blobs.get(entry.object) }));
  entries.push({ file: CHECKPOINT_FILE, mode: '100644', data: Buffer.from(checkpoint, 'utf8') });
  entries.sort((left, right) => Buffer.from(left.file).compare(Buffer.from(right.file)));
  createZipArchive(payloadPath, entries);
  const names = assertUniqueZipEntries(payloadPath);
  const expectedNames = treeEntries.map(entry => entry.file).sort();
  const actualNames = [...names].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const expected = new Set(expectedNames);
    const actual = new Set(actualNames);
    const missing = expectedNames.filter(name => !actual.has(name));
    const extra = actualNames.filter(name => !expected.has(name));
    throw new Error(`ZIP does not match Git HEAD; missing=${missing.join(', ')}; extra=${extra.join(', ')}`);
  }
}

function createPackage(repoRoot, outputRoot) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']);
  const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const parent = git(repoRoot, ['rev-parse', 'HEAD^']);
  const branch = git(repoRoot, ['branch', '--show-current']);
  if (git(repoRoot, ['status', '--porcelain'])) throw new Error('working tree must be clean');

  const short = commit.slice(0, 7);
  const packageRoot = path.join(path.resolve(outputRoot), `YANCE_ROUND12_13_WINDOWS_UAT_${short}`);
  const payloadRoot = path.join(packageRoot, 'payload');
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  const checkpoint = JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_CHECKPOINT',
    branch,
    commit,
    tree,
    parent,
    tag: UAT_TAG,
    artifactClass: 'ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_CANDIDATE',
  }, null, 2) + '\n';

  const payloadName = `Yance_ROUND12_13_UAT_SOURCE_${short}.zip`;
  const payloadPath = path.join(payloadRoot, payloadName);
  createIdentityBoundArchive(repoRoot, payloadPath, checkpoint);

  const payloadSha256 = sha256File(payloadPath);
  const values = {
    '__EXPECTED_COMMIT__': commit,
    '__EXPECTED_TREE__': tree,
    '__EXPECTED_BRANCH__': branch,
    '__SHORT_COMMIT__': short,
    '__PAYLOAD_NAME__': payloadName,
    '__PAYLOAD_SHA256__': payloadSha256,
  };
  const templates = path.join(repoRoot, 'tools', 'runtime-delivery', 'templates');
  write(templates, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.cmd.template', 'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.cmd', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1.template', 'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'COLLECT_YANCE_ROUND12_13_EVIDENCE.cmd.template', 'COLLECT_YANCE_ROUND12_13_EVIDENCE.cmd', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'COLLECT_YANCE_ROUND12_13_EVIDENCE.ps1.template', 'COLLECT_YANCE_ROUND12_13_EVIDENCE.ps1', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'YANCE_ROUND12_13_UAT_README_ZH.md.template', 'README_FIRST_ZH.md', values);

  const manifest = {
    schemaVersion: 1,
    documentType: 'YANCE_ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_PACKAGE',
    generatedAtUtc: new Date().toISOString(),
    artifactClass: 'ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_CANDIDATE',
    branch,
    commit,
    tree,
    parent,
    payload: { fileName: payloadName, sha256: payloadSha256 },
    formalRelease: false,
    realWindowsUatRequired: true,
    realPlatformUatRequired: true,
    realOpenRouterQualificationRequired: true,
    windowsPowerShell51Compatible: true,
    dataRootSelection: 'largest-existing-database',
    topLevelInstallEntry: 'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.cmd',
    evidenceEntry: 'COLLECT_YANCE_ROUND12_13_EVIDENCE.cmd',
    payloadEntryUniquenessVerified: true,
    runtimeGovernanceBinding: {
      authorizationRecordEnvironment: 'YANCE_WINDOWS_UAT_AUTHORIZATION_RECORD',
      authorizationIdEnvironment: 'YANCE_WINDOWS_UAT_AUTHORIZATION_ID',
      authorizedEnvironment: 'YANCE_WINDOWS_UAT_AUTHORIZED',
      expectedCommitEnvironment: 'YANCE_UAT_EXPECTED_COMMIT',
      expectedTreeEnvironment: 'YANCE_UAT_EXPECTED_TREE',
      prelaunchGateReceipt: 'YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT.json',
      independentReviewAndOwnerAuthorizationRequired: true,
      formalRelease: false
    },
  };
  fs.writeFileSync(path.join(packageRoot, 'ROUND12_13_UAT_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  const files = [];
  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.isFile()) files.push({ name: entry.name, sha256: sha256File(path.join(packageRoot, entry.name)) });
  }
  files.push({ name: `payload/${payloadName}`, sha256: payloadSha256 });
  fs.writeFileSync(
    path.join(packageRoot, 'SHA256SUMS.txt'),
    files.sort((a, b) => a.name.localeCompare(b.name)).map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n',
  );
  return { packageRoot, manifest };
}

if (require.main === module) {
  try {
    const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
    const output = path.resolve(process.argv[3] || path.join(repo, '.tmp', 'round12-13-uat-package'));
    process.stdout.write(JSON.stringify(createPackage(repo, output), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertUniqueZipEntries,
  createIdentityBoundArchive,
  createPackage,
  createZipArchive,
  listHeadBlobs,
  listZipEntryNames,
  readGitBlobs,
  sha256File,
};
