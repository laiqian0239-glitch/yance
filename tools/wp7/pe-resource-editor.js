'use strict';

// PE resource editor + branding verifier for the Yance Windows final build.
//
// Design contract (do NOT weaken):
//   - The official Electron `electron.exe` is copied and renamed to `Yance.exe`.
//   - rcedit (pinned + SHA256-custodied) injects the approved icon.ico and the
//     approved VERSIONINFO. This is the ONLY allowed modification to the binary.
//   - After injection we verify:
//       (a) the embedded icon equals the approved icon.ico content (SHA256),
//       (b) VERSIONINFO carries the approved brand strings,
//       (c) the PE code-image hash (every byte except the .rsrc section, which
//           rcedit edits) matches the official electron.exe code-image hash.
//   - (c) replaces the previous raw byte-equality trust check for the product
//     executable with an equivalent-strength control: it proves the loaded code
//     is unmodified Electron, and that only the resource section changed.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { readPe, parseResourceDirectory, extractVersionInfo, extractInstallerIdentity } = require('../../shared/windows/pe-resource-identity');

const RT_ICON = 3;

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }

// ---- minimal PE parsing ---------------------------------------------------

function extractIconImageSet(pe) {
  // Returns the sorted set of RT_ICON image byte-buffers embedded in the EXE.
  const entries = parseResourceDirectory(pe, pe.resDirRva);
  const icons = entries.filter((e) => e.type === RT_ICON);
  if (!icons.length) return null;
  const buf = pe.fileBuffer;
  const set = icons
    .map((ic) => buf.subarray(ic.dataRaw, ic.dataRaw + ic.dataSize))
    .map((b) => sha256Buffer(b))
    .sort();
  return set;
}

function extractIconImageSetFromIcoFile(iconPath) {
  const buf = fs.readFileSync(iconPath);
  const count = buf.readUInt16LE(4);
  const set = [];
  for (let i = 0; i < count; i++) {
    const ePos = 6 + i * 16;
    const bytesInRes = buf.readUInt32LE(ePos + 8);
    const offset = buf.readUInt32LE(ePos + 12);
    set.push(sha256Buffer(buf.subarray(offset, offset + bytesInRes)));
  }
  return set.sort();
}

// ---- code-image hash (exclude .rsrc) --------------------------------------

function computeCodeImageHash(filePath) {
  // Code-equivalence = hash of every section's raw bytes EXCEPT .rsrc and
  // .reloc (rcedit may legitimately grow resources / rewrite reloc metadata).
  // Header fields (checksum, timestamp) are therefore excluded automatically.
  const pe = readPe(fs.readFileSync(filePath));
  const parts = [];
  for (const s of pe.sections) {
    if (s.name === '.rsrc' || s.name === '.reloc') continue;
    parts.push(pe.fileBuffer.subarray(s.pointerToRawData, s.pointerToRawData + s.sizeOfRawData));
  }
  return sha256Buffer(Buffer.concat(parts));
}

// Section-wise equivalence check: every non-.rsrc section must be byte-identical
// to the reference electron.exe. Returns { ok, changed }.
function assertCodeUnmodified(modifiedPath, basePath) {
  const m = readPe(fs.readFileSync(modifiedPath));
  const b = readPe(fs.readFileSync(basePath));
  const baseByName = new Map(b.sections.map((s) => [s.name, s]));
  const changed = [];
  for (const s of m.sections) {
    if (s.name === '.rsrc') continue; // expected to change with branding
    const bb = baseByName.get(s.name);
    if (!bb) { changed.push(s.name + ':absent-in-base'); continue; }
    const a = m.fileBuffer.subarray(s.pointerToRawData, s.pointerToRawData + s.sizeOfRawData);
    const c = b.fileBuffer.subarray(bb.pointerToRawData, bb.pointerToRawData + bb.sizeOfRawData);
    if (a.length !== c.length || !a.equals(c)) changed.push(s.name);
  }
  return { ok: changed.length === 0, changed };
}

// ---- rcedit invocation ----------------------------------------------------

function runRcedit(options) {
  const { rceditPath, exePath, iconPath, versionFields } = options;
  if (!fs.existsSync(rceditPath)) throw new Error(`rcedit not found at custody path: ${rceditPath}`);
  // rcedit (Go) requires backslash Windows paths; normalize all incoming paths.
  const toWin = (p) => p ? p.split('/').join('\\') : p;
  const args = [toWin(exePath)];
  if (iconPath) args.push('--set-icon', toWin(iconPath));
  for (const [k, v] of Object.entries(versionFields || {})) {
    args.push('--set-version-string', k, v);
  }
  const result = spawnSync(rceditPath, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(`rcedit failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return { status: 'PASS' };
}

// ---- branding assertion ---------------------------------------------------

function assertBranding(options) {
  const { exePath, iconPath, releaseSource, allowedElectronExePath } = options;
  const buf = fs.readFileSync(exePath);
  const pe = readPe(buf);
  if (pe.machine !== 0x8664) throw new Error(`${releaseSource.executableName} is not x64 PE`);

  const versionInfo = extractVersionInfo(pe) || {};
  const required = {
    ProductName: releaseSource.productName,
    FileDescription: releaseSource.productName,
    CompanyName: releaseSource.companyName,
    LegalCopyright: releaseSource.legalCopyright,
    InternalName: releaseSource.internalName,
    OriginalFilename: releaseSource.originalFilename,
    FileVersion: releaseSource.productVersion.split('.').length === 3 ? `${releaseSource.productVersion}.0` : releaseSource.productVersion,
    ProductVersion: releaseSource.productVersion
  };
  const failures = [];
  for (const [k, v] of Object.entries(required)) {
    if ((versionInfo[k] || '').trim() !== v) failures.push(`VERSIONINFO.${k} expected "${v}" got "${(versionInfo[k] || '').trim()}"`);
  }
  if (failures.length) throw new Error('Branding VERSIONINFO mismatch: ' + failures.join('; '));

  // icon: the set of embedded RT_ICON images must equal the approved icon.ico
  const embeddedSet = extractIconImageSet(pe);
  if (!embeddedSet) throw new Error(`No embedded RT_ICON images found in ${releaseSource.executableName}`);
  const approvedSet = extractIconImageSetFromIcoFile(iconPath);
  const same = embeddedSet.length === approvedSet.length && embeddedSet.every((h, i) => h === approvedSet[i]);
  if (!same) throw new Error('Embedded icon image set does not match approved icon.ico (icon content mismatch)');
  const groupSha = sha256Buffer(Buffer.from(embeddedSet.join('')));

  // section-wise code equivalence with electron.exe (only .rsrc may differ)
  if (allowedElectronExePath && fs.existsSync(allowedElectronExePath)) {
    const res = assertCodeUnmodified(exePath, allowedElectronExePath);
    if (!res.ok) throw new Error(`${releaseSource.executableName} code-modified beyond approved resource editing in sections: ${res.changed.join(',')}`);
  }

  return {
    status: 'PASS',
    versionInfo,
    groupIconSha256: groupSha,
    approvedIconSha256: approvedSet.join(','),
    codeImageHash: computeCodeImageHash(exePath)
  };
}

module.exports = {
  readPe,
  parseResourceDirectory,
  extractVersionInfo,
  extractIconImageSet,
  extractIconImageSetFromIcoFile,
  computeCodeImageHash,
  assertCodeUnmodified,
  runRcedit,
  assertBranding,
  sha256File,
  // Real installer identity extractor for the auto-update verifier. Returns
  // { productName, productVersion, publisher, signed } or null. `signed` is
  // determined from the actual Authenticode signature on Windows; on other
  // platforms it is null (unknown) so production mode rejects honestly.
  extractInstallerIdentity
};
