'use strict';

const path = require('node:path');

const DEFAULT_EXPLORER_DESTINATION = String.raw`C:\Users\12345678901234567890\Downloads`;
const DEFAULT_MAX_PATH_LENGTH = 240;
const WINDOWS_MAX_COMPONENT_LENGTH = 255;

function authorityError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}

function normalizeArchiveName(value, field) {
  const name = String(value || '').trim().replace(/\.zip$/iu, '');
  if (!name || /[<>:"/\\|?*]/u.test(name) || name === '.' || name === '..') {
    throw authorityError('WINDOWS_EXPLORER_ARCHIVE_NAME_INVALID', `${field} is not a safe Windows path component`, { field, value });
  }
  if (name.length > WINDOWS_MAX_COMPONENT_LENGTH) {
    throw authorityError('WINDOWS_EXPLORER_COMPONENT_TOO_LONG', `${field} exceeds the Windows path component limit`, { field, length: name.length });
  }
  return name;
}

function normalizeEntry(value) {
  const raw = String(value || '').replace(/\\/gu, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/u.test(raw)) {
    throw authorityError('WINDOWS_EXPLORER_ARCHIVE_PATH_UNSAFE', `unsafe archive path: ${raw || '[empty]'}`, { entry: raw });
  }
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) {
    throw authorityError('WINDOWS_EXPLORER_ARCHIVE_PATH_UNSAFE', `unsafe archive path: ${raw}`, { entry: raw });
  }
  for (const segment of segments) {
    if (/[<>:"|?*]/u.test(segment)) {
      throw authorityError('WINDOWS_EXPLORER_ARCHIVE_PATH_UNSAFE', `unsafe archive path component: ${segment}`, { entry: raw, segment });
    }
    if (segment.length > WINDOWS_MAX_COMPONENT_LENGTH) {
      throw authorityError('WINDOWS_EXPLORER_COMPONENT_TOO_LONG', `path component exceeds the Windows limit: ${segment.slice(0, 80)}`, { entry: raw, segmentLength: segment.length });
    }
  }
  return segments.join('\\');
}

function evaluateWindowsExplorerPaths({
  archiveRootName,
  archiveFileBase = archiveRootName,
  entries = [],
  explorerDestination = DEFAULT_EXPLORER_DESTINATION,
  maxAllowedPathLength = DEFAULT_MAX_PATH_LENGTH,
} = {}) {
  const rootName = normalizeArchiveName(archiveRootName, 'archiveRootName');
  const fileBase = normalizeArchiveName(archiveFileBase, 'archiveFileBase');
  if (!Array.isArray(entries) || !entries.length) throw authorityError('WINDOWS_EXPLORER_ARCHIVE_ENTRIES_REQUIRED', 'entries must contain at least one archive path');
  const destination = String(explorerDestination || DEFAULT_EXPLORER_DESTINATION).replace(/[\\/]+$/u, '');
  const rows = entries.map(entry => {
    const normalized = normalizeEntry(entry);
    // Windows Explorer's "Extract All" normally creates a folder named after the ZIP,
    // then preserves the archive's own top-level source folder.
    const expandedPath = path.win32.join(destination, fileBase, rootName, normalized);
    return { entry: String(entry), normalized, expandedPath, expandedPathLength: expandedPath.length };
  }).sort((a, b) => b.expandedPathLength - a.expandedPathLength || a.entry.localeCompare(b.entry));
  const worst = rows[0];
  const allowed = Math.max(180, Number(maxAllowedPathLength) || DEFAULT_MAX_PATH_LENGTH);
  return {
    schemaVersion: 1,
    authority: 'WindowsExplorerPathAuthority',
    ok: worst.expandedPathLength <= allowed,
    reasonCode: worst.expandedPathLength <= allowed ? 'WINDOWS_EXPLORER_PATH_BUDGET_PASSED' : 'WINDOWS_EXPLORER_PATH_BUDGET_EXCEEDED',
    archiveRootName: rootName,
    archiveFileBase: fileBase,
    explorerDestination: destination,
    maxAllowedPathLength: allowed,
    maxExpandedPathLength: worst.expandedPathLength,
    worstEntry: worst.entry,
    worstExpandedPath: worst.expandedPath,
    entryCount: rows.length,
  };
}

function assertWindowsExplorerSafe(options) {
  const result = evaluateWindowsExplorerPaths(options);
  if (!result.ok) {
    throw authorityError(result.reasonCode, `Windows Explorer extraction path budget exceeded: ${result.maxExpandedPathLength} > ${result.maxAllowedPathLength}`, result);
  }
  return result;
}

module.exports = {
  DEFAULT_EXPLORER_DESTINATION,
  DEFAULT_MAX_PATH_LENGTH,
  WINDOWS_MAX_COMPONENT_LENGTH,
  assertWindowsExplorerSafe,
  evaluateWindowsExplorerPaths,
  normalizeEntry,
};
