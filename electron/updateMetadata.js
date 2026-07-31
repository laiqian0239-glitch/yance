'use strict';

const path = require('node:path');

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function fileNameFromUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://updates.invalid/');
    const base = path.posix.basename(parsed.pathname || '');
    return decodeURIComponent(base);
  } catch {
    return path.basename(raw.replace(/\\/g, '/'));
  }
}

function normalizeUpdateFile(file = {}) {
  const url = clean(file.url || file.path);
  const fileName = fileNameFromUrl(url);
  const size = finiteNonNegative(file.size);
  const sha512 = clean(file.sha512);
  return { url, fileName, size, sha512 };
}

function selectInstallerFile(info = {}) {
  const files = Array.isArray(info.files) ? info.files.map(normalizeUpdateFile) : [];
  const fallback = normalizeUpdateFile({
    url: info.path,
    size: info.size,
    sha512: info.sha512
  });
  if (fallback.url || fallback.sha512 || fallback.size != null) files.push(fallback);
  const usable = files.filter(item => item.url || item.fileName);
  return usable.find(item => item.fileName.toLowerCase().endsWith('.exe')) || usable[0] || null;
}

function normalizeUpdateInfo(info = {}) {
  const file = selectInstallerFile(info);
  const releaseName = clean(info.releaseName);
  const publicVersion = clean(info.publicVersion) || clean((releaseName.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/) || [])[1]);
  return {
    version: clean(info.version),
    publicVersion,
    releaseName,
    releaseDate: clean(info.releaseDate),
    file
  };
}

function compareUpdateMetadata(available, downloaded) {
  const reasons = [];
  if (!available || !downloaded) return { ok: true, reasons };
  if (available.version && downloaded.version && available.version !== downloaded.version) reasons.push('version mismatch');
  if (available.publicVersion && downloaded.publicVersion && available.publicVersion !== downloaded.publicVersion) reasons.push('public version mismatch');
  const a = available.file;
  const b = downloaded.file;
  if (a && b) {
    if (a.fileName && b.fileName && a.fileName !== b.fileName) reasons.push('file name mismatch');
    if (a.sha512 && b.sha512 && a.sha512 !== b.sha512) reasons.push('sha512 mismatch');
    if (a.size != null && b.size != null && a.size !== b.size) reasons.push('size mismatch');
  }
  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  clean,
  finiteNonNegative,
  fileNameFromUrl,
  normalizeUpdateFile,
  selectInstallerFile,
  normalizeUpdateInfo,
  compareUpdateMetadata
};
