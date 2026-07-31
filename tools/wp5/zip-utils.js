'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xFFFF - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP_END_OF_CENTRAL_DIRECTORY_NOT_FOUND');
}

function readZipEntries(file) {
  const buffer = fs.readFileSync(file);
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP_CENTRAL_DIRECTORY_INVALID');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP_LOCAL_HEADER_INVALID:${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let value;
    if (method === 0) value = Buffer.from(compressed);
    else if (method === 8) value = zlib.inflateRawSync(compressed);
    else throw new Error(`ZIP_COMPRESSION_UNSUPPORTED:${method}:${name}`);
    if (value.length !== uncompressedSize) throw new Error(`ZIP_SIZE_MISMATCH:${name}`);
    entries.set(name.replace(/\\/g, '/'), value);
  }
  return { buffer, entries };
}

module.exports = { readZipEntries };
