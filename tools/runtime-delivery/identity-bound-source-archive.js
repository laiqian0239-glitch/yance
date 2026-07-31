'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const CHECKPOINT_FILE = 'YANCE_SOURCE_CHECKPOINT.json';
const DESCRIPTOR_FILE = 'YANCE_ARTIFACT_DESCRIPTOR.json';
const IDENTITY_FILES = Object.freeze([CHECKPOINT_FILE, DESCRIPTOR_FILE]);

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertIdentity(identity) {
  if (!identity || typeof identity !== 'object') throw new TypeError('identity is required');
  for (const field of ['commit', 'tree']) {
    if (!/^[0-9a-f]{40}$/u.test(String(identity[field] || ''))) {
      throw new Error(`identity.${field} must be a 40-character lowercase Git object id`);
    }
  }
  if (identity.parent != null && !/^[0-9a-f]{40}$/u.test(String(identity.parent))) {
    throw new Error('identity.parent must be null or a 40-character lowercase Git object id');
  }
  if (!String(identity.branch || '').trim()) throw new Error('identity.branch is required');
}

function renderIdentityDocuments(identity, artifact) {
  assertIdentity(identity);
  if (!artifact || typeof artifact !== 'object') throw new TypeError('artifact is required');
  if (!String(artifact.artifactClass || '').trim()) throw new Error('artifact.artifactClass is required');
  if (!String(artifact.artifactId || '').trim()) throw new Error('artifact.artifactId is required');

  const generatedAtUtc = artifact.generatedAtUtc || new Date().toISOString();
  const checkpoint = {
    schemaVersion: 2,
    documentType: 'YANCE_SOURCE_CHECKPOINT',
    generatedAtUtc,
    branch: String(identity.branch),
    commit: String(identity.commit),
    tree: String(identity.tree),
    parent: identity.parent == null ? null : String(identity.parent),
    artifactClass: String(artifact.artifactClass),
    artifactId: String(artifact.artifactId),
    formalRelease: artifact.formalRelease === true,
    readyForPromotion: artifact.readyForPromotion === true,
  };
  const descriptor = {
    schemaVersion: 1,
    documentType: 'YANCE_ARTIFACT_DESCRIPTOR',
    generatedAtUtc,
    project: '言策 Yance',
    artifactType: String(artifact.artifactType || 'WINDOWS_UI_SOURCE_CANDIDATE'),
    artifactClass: String(artifact.artifactClass),
    artifactId: String(artifact.artifactId),
    sourceIdentity: {
      branch: String(identity.branch),
      commit: String(identity.commit),
      tree: String(identity.tree),
      parent: identity.parent == null ? null : String(identity.parent),
    },
    governance: {
      formalRelease: artifact.formalRelease === true,
      readyForPromotion: artifact.readyForPromotion === true,
      windowsUiUat: artifact.windowsUiUat === true,
    },
    identityProtocol: {
      generatedAtArchiveTime: true,
      trackedIdentityDocumentsReplaced: true,
      exactArchiveContentVerified: true,
    },
  };
  return {
    [CHECKPOINT_FILE]: `${JSON.stringify(checkpoint, null, 2)}\n`,
    [DESCRIPTOR_FILE]: `${JSON.stringify(descriptor, null, 2)}\n`,
  };
}

function zipEntries(zipPath) {
  const bytes = fs.readFileSync(zipPath);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const lowerBound = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`ZIP end-of-central-directory was not found: ${zipPath}`);
  const count = bytes.readUInt16LE(eocdOffset + 10);
  let offset = bytes.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralSignature) {
      throw new Error(`Invalid ZIP central-directory entry ${index}: ${zipPath}`);
    }
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, entries };
}

function readZipTextEntry(zipPath, entryName) {
  const { bytes, entries } = zipEntries(zipPath);
  const matches = entries.filter(entry => entry.name === entryName);
  if (matches.length !== 1) throw new Error(`ZIP entry ${entryName} count must be 1; actual=${matches.length}`);
  const entry = matches[0];
  const offset = entry.localHeaderOffset;
  if (bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Invalid ZIP local header for ${entryName}`);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  let data;
  if (entry.compressionMethod === 0) data = compressed;
  else if (entry.compressionMethod === 8) data = zlib.inflateRawSync(compressed);
  else throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entryName}`);
  if (data.length !== entry.uncompressedSize) {
    throw new Error(`ZIP entry ${entryName} size mismatch: expected=${entry.uncompressedSize} actual=${data.length}`);
  }
  return data.toString('utf8');
}

function verifyIdentityBoundSourceArchive({ archivePath, identity, artifactId }) {
  assertIdentity(identity);
  const { entries } = zipEntries(archivePath);
  const names = entries.map(entry => entry.name);
  if (new Set(names).size !== names.length) throw new Error('ZIP contains duplicate entries');
  for (const file of IDENTITY_FILES) {
    const count = names.filter(name => name === file).length;
    if (count !== 1) throw new Error(`ZIP entry ${file} count must be 1; actual=${count}`);
  }
  const checkpoint = JSON.parse(readZipTextEntry(archivePath, CHECKPOINT_FILE));
  const descriptor = JSON.parse(readZipTextEntry(archivePath, DESCRIPTOR_FILE));
  for (const field of ['branch', 'commit', 'tree']) {
    if (checkpoint[field] !== identity[field]) throw new Error(`${field} mismatch in ${CHECKPOINT_FILE}`);
    if (descriptor.sourceIdentity?.[field] !== identity[field]) throw new Error(`${field} mismatch in ${DESCRIPTOR_FILE}`);
  }
  const expectedParent = identity.parent == null ? null : identity.parent;
  if ((checkpoint.parent ?? null) !== expectedParent) throw new Error(`parent mismatch in ${CHECKPOINT_FILE}`);
  if ((descriptor.sourceIdentity?.parent ?? null) !== expectedParent) throw new Error(`parent mismatch in ${DESCRIPTOR_FILE}`);
  if (artifactId != null && descriptor.artifactId !== artifactId) throw new Error(`artifactId mismatch in ${DESCRIPTOR_FILE}`);
  return {
    ok: true,
    archivePath: path.resolve(archivePath),
    sha256: sha256File(archivePath),
    entryCount: names.length,
    checkpoint,
    descriptor,
  };
}

function createIdentityBoundSourceArchive({ repoRoot, outputPath, identity, artifact }) {
  const root = path.resolve(repoRoot);
  const archive = path.resolve(outputPath);
  const documents = renderIdentityDocuments(identity, artifact);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.rmSync(archive, { force: true });
  const args = ['-C', root, 'archive', '--format=zip', `--output=${archive}`];
  for (const file of IDENTITY_FILES) args.push(`--add-virtual-file=${file}:${documents[file]}`);
  args.push('HEAD', '--', '.');
  for (const file of IDENTITY_FILES) args.push(`:(exclude)${file}`);
  execFileSync('git', args, { stdio: 'inherit' });
  return {
    outputPath: archive,
    verification: verifyIdentityBoundSourceArchive({ archivePath: archive, identity, artifactId: artifact.artifactId }),
  };
}

module.exports = {
  CHECKPOINT_FILE,
  DESCRIPTOR_FILE,
  IDENTITY_FILES,
  createIdentityBoundSourceArchive,
  readZipTextEntry,
  renderIdentityDocuments,
  sha256File,
  verifyIdentityBoundSourceArchive,
  zipEntries,
};
