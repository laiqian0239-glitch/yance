'use strict';

// Production-safe Windows PE metadata reader used by the packaged updater.
// This module intentionally contains no WP7 fixture or branding authorization
// logic, so the installed Electron runtime never depends on tools/ or tests/.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const RT_VERSION = 16;

function readPe(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('PE input must be a Buffer');
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) throw new Error('not a PE (MZ missing)');
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) throw new Error('PE header out of range');
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('PE signature missing');
  const machine = buffer.readUInt16LE(peOffset + 4);
  const numSections = buffer.readUInt16LE(peOffset + 6);
  const optHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optOffset = peOffset + 24;
  if (optOffset + optHeaderSize > buffer.length) throw new Error('PE optional header out of range');
  const magic = buffer.readUInt16LE(optOffset);
  const isPe32Plus = magic === 0x20b;
  if (!isPe32Plus && magic !== 0x10b) throw new Error('unsupported PE optional header');
  const dataDirBase = optOffset + (isPe32Plus ? 112 : 96);
  const numRvaAndSizesOffset = optOffset + (isPe32Plus ? 108 : 92);
  if (numRvaAndSizesOffset + 4 > buffer.length) throw new Error('PE data directory count out of range');
  const numRvaAndSizes = buffer.readUInt32LE(numRvaAndSizesOffset);
  const hasResourceDirectory = numRvaAndSizes > 2 && dataDirBase + 24 <= buffer.length;
  const resDirRva = hasResourceDirectory ? buffer.readUInt32LE(dataDirBase + 16) : 0;
  const resDirSize = hasResourceDirectory ? buffer.readUInt32LE(dataDirBase + 20) : 0;
  const sections = [];
  const sectionTableOffset = optOffset + optHeaderSize;
  if (sectionTableOffset + numSections * 40 > buffer.length) throw new Error('PE section table out of range');
  for (let i = 0; i < numSections; i += 1) {
    const base = sectionTableOffset + i * 40;
    const name = buffer.toString('ascii', base, base + 8).replace(/\0+$/, '');
    const virtualSize = buffer.readUInt32LE(base + 8);
    const virtualAddress = buffer.readUInt32LE(base + 12);
    const sizeOfRawData = buffer.readUInt32LE(base + 16);
    const pointerToRawData = buffer.readUInt32LE(base + 20);
    if (pointerToRawData + sizeOfRawData > buffer.length) throw new Error(`PE section ${name || i} out of range`);
    sections.push({ name, virtualSize, virtualAddress, sizeOfRawData, pointerToRawData });
  }
  function rvaToRaw(rva) {
    for (const section of sections) {
      const virtualSpan = section.virtualSize || section.sizeOfRawData;
      if (rva >= section.virtualAddress && rva < section.virtualAddress + virtualSpan) {
        const raw = section.pointerToRawData + (rva - section.virtualAddress);
        return raw < buffer.length ? raw : -1;
      }
    }
    return -1;
  }
  const rsrc = sections.find(section => section.name === '.rsrc');
  const resBaseRaw = rsrc ? rsrc.pointerToRawData : 0;
  const resBaseRva = rsrc ? rsrc.virtualAddress : 0;
  function resOffsetToRaw(offset) {
    if (!rsrc) return -1;
    const relative = offset >= resBaseRva ? offset - resBaseRva : offset;
    const raw = resBaseRaw + relative;
    return raw >= 0 && raw < buffer.length ? raw : -1;
  }
  return {
    machine,
    numSections,
    resDirRva,
    resDirSize,
    sections,
    rvaToRaw,
    resBaseRaw,
    resBaseRva,
    resOffsetToRaw,
    fileBuffer: buffer
  };
}

function parseResourceDirectory(pe, dirRva) {
  if (!pe || !Buffer.isBuffer(pe.fileBuffer) || !pe.resBaseRaw || !dirRva) return [];
  const buffer = pe.fileBuffer;
  const base = dirRva >= pe.resBaseRva ? dirRva - pe.resBaseRva : dirRva;
  const visited = new Set();
  function readDirectory(offset) {
    const raw = pe.resOffsetToRaw(offset);
    if (raw < 0 || raw + 16 > buffer.length) return null;
    const numNamed = buffer.readUInt16LE(raw + 12);
    const numId = buffer.readUInt16LE(raw + 14);
    const total = numNamed + numId;
    if (total > 65535 || raw + 16 + total * 8 > buffer.length) return null;
    const entries = [];
    for (let i = 0; i < total; i += 1) {
      const entryOffset = raw + 16 + i * 8;
      const nameOrId = buffer.readUInt32LE(entryOffset);
      const target = buffer.readUInt32LE(entryOffset + 4);
      entries.push({ nameOrId, isDir: (target & 0x80000000) !== 0, ref: target & 0x7fffffff });
    }
    return entries;
  }
  function walk(offset, depth, resourceType) {
    if (depth > 8) return [];
    const key = `${offset}:${depth}:${resourceType}`;
    if (visited.has(key)) return [];
    visited.add(key);
    const entries = readDirectory(offset);
    if (!entries) return [];
    const output = [];
    for (const entry of entries) {
      const type = depth === 0 ? entry.nameOrId : resourceType;
      if (entry.isDir) {
        output.push(...walk(entry.ref, depth + 1, type));
        continue;
      }
      const raw = pe.resOffsetToRaw(entry.ref);
      if (raw < 0 || raw + 16 > buffer.length) continue;
      const dataRva = buffer.readUInt32LE(raw);
      const dataSize = buffer.readUInt32LE(raw + 4);
      const dataRaw = pe.rvaToRaw(dataRva);
      if (dataRaw < 0 || dataSize < 0 || dataRaw + dataSize > buffer.length) continue;
      output.push({ type, nameOrId: entry.nameOrId, dataRva, dataSize, dataRaw });
    }
    return output;
  }
  return walk(base, 0, 0);
}

function readUtf16LeString(buffer, offset, maxBytes) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= buffer.length) return '';
  const limit = Math.min(buffer.length - offset, Math.max(0, Number(maxBytes) || 0));
  let value = '';
  for (let i = 0; i + 1 < limit; i += 2) {
    const code = buffer.readUInt16LE(offset + i);
    if (code === 0) break;
    value += String.fromCharCode(code);
  }
  return value;
}

function extractVersionInfo(pe) {
  const entries = parseResourceDirectory(pe, pe.resDirRva);
  const versionResource = entries.find(entry => entry.type === RT_VERSION);
  if (!versionResource) return null;
  const buffer = pe.fileBuffer;
  const start = versionResource.dataRaw;
  const end = Math.min(buffer.length, start + versionResource.dataSize);
  if (start < 0 || start + 38 > end) return null;
  const valueLength = buffer.readUInt16LE(start + 2);
  const align4 = value => (value % 4 === 0 ? value : value + (4 - (value % 4)));
  let cursor = align4(start + 6 + 32);
  if (valueLength > 0) cursor += valueLength;
  const result = {};
  function keyLengthAt(base) {
    if (base < start || base >= end) return 0;
    const max = Math.min(512, end - base);
    for (let i = 0; i + 1 < max; i += 2) {
      if (buffer.readUInt16LE(base + i) === 0) return i + 2;
    }
    return 0;
  }
  function readStringEntries(position, tableEnd) {
    let entryPosition = position;
    let guard = 0;
    while (entryPosition + 6 <= tableEnd && entryPosition + 6 <= end && guard < 1024) {
      guard += 1;
      const entryLength = buffer.readUInt16LE(entryPosition);
      const entryValueLength = buffer.readUInt16LE(entryPosition + 2);
      if (entryLength < 6 || entryPosition + entryLength > end) break;
      const keyBase = entryPosition + 6;
      const keyLength = keyLengthAt(keyBase);
      if (!keyLength) break;
      const name = readUtf16LeString(buffer, keyBase, keyLength);
      const valuePosition = align4(keyBase + keyLength);
      const value = readUtf16LeString(buffer, valuePosition, entryValueLength * 2);
      if (name) result[name] = value;
      entryPosition = align4(entryPosition + entryLength);
    }
  }
  let guard = 0;
  while (cursor + 6 <= end && guard < 64) {
    guard += 1;
    const blockLength = buffer.readUInt16LE(cursor);
    if (blockLength < 6 || cursor + blockLength > end) break;
    const keyBase = cursor + 6;
    const keyLength = keyLengthAt(keyBase);
    if (!keyLength) break;
    const key = readUtf16LeString(buffer, keyBase, keyLength);
    if (key === 'StringFileInfo') {
      let tablePosition = align4(keyBase + keyLength);
      let tableGuard = 0;
      while (tablePosition + 6 <= cursor + blockLength && tablePosition + 6 <= end && tableGuard < 256) {
        tableGuard += 1;
        const tableLength = buffer.readUInt16LE(tablePosition);
        if (tableLength < 6 || tablePosition + tableLength > end) break;
        const tableKeyBase = tablePosition + 6;
        const tableKeyLength = keyLengthAt(tableKeyBase);
        if (!tableKeyLength) break;
        readStringEntries(align4(tableKeyBase + tableKeyLength), tablePosition + tableLength);
        tablePosition = align4(tablePosition + tableLength);
      }
      break;
    }
    cursor = align4(cursor + blockLength);
  }
  return result;
}

function detectAuthenticodeSigned(filePath) {
  if (process.platform !== 'win32') return null;
  try {
    const escapedPath = String(filePath).replace(/'/g, "''");
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `try { $s = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; if ($s -and $s.Status -eq 'Valid') { 'VALID' } else { 'INVALID:' + $s.Status } } catch { 'ERROR:' + $_.Exception.Message }`
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const output = String(result.stdout || '').trim();
    if (output === 'VALID') return true;
    if (output.startsWith('INVALID') || output.startsWith('ERROR')) return false;
    return null;
  } catch {
    return null;
  }
}

function extractInstallerIdentity(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  let info = {};
  try {
    info = extractVersionInfo(readPe(buffer)) || {};
  } catch {
    info = {};
  }
  return {
    productName: String(info.ProductName || '').trim() || null,
    productVersion: String(info.ProductVersion || '').trim() || null,
    publisher: String(info.CompanyName || '').trim() || null,
    signed: detectAuthenticodeSigned(filePath)
  };
}

module.exports = {
  readPe,
  parseResourceDirectory,
  extractVersionInfo,
  detectAuthenticodeSigned,
  extractInstallerIdentity
};
