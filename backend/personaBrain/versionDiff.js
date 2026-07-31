'use strict';

const { canonicalStringify, sha256Json, isPlainObject } = require('./canonicalJson');

function same(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function diffValues(before, after, path = '$', rows = [], options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options.limit || 500)));
  if (rows.length >= limit || same(before, after)) return rows;
  const beforeType = valueType(before);
  const afterType = valueType(after);
  if (beforeType !== afterType || (!isPlainObject(before) && !Array.isArray(before))) {
    rows.push({ path, kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed', before, after });
    return rows;
  }
  if (Array.isArray(before)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length && rows.length < limit; index += 1) {
      diffValues(before[index], after[index], `${path}[${index}]`, rows, options);
    }
    return rows;
  }
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  for (const key of keys) {
    if (rows.length >= limit) break;
    diffValues(before?.[key], after?.[key], `${path}.${key}`, rows, options);
  }
  return rows;
}

function buildDiff(before, after, options = {}) {
  const changes = diffValues(before, after, '$', [], options);
  const changedPaths = changes.map(row => row.path);
  return {
    beforeSha256: sha256Json(before),
    afterSha256: sha256Json(after),
    changed: changes.length > 0,
    changedCount: changes.length,
    truncated: changes.length >= Math.max(1, Math.min(2000, Number(options.limit || 500))),
    changedPaths,
    changes
  };
}

function buildPreviewReceipt(input = {}) {
  const base = {
    authority: 'YancePersonaVersionPreviewAuthority',
    version: 1,
    profileId: String(input.profileId || ''),
    currentVersion: Number(input.currentVersion || 0),
    currentContentSha256: String(input.currentContentSha256 || ''),
    proposedAuthoritativeSha256: String(input.proposedAuthoritativeSha256 || ''),
    changedPaths: Array.isArray(input.changedPaths) ? input.changedPaths : [],
    createdAt: String(input.createdAt || new Date().toISOString())
  };
  return { ...base, receiptSha256: sha256Json(base) };
}

module.exports = { diffValues, buildDiff, buildPreviewReceipt };
