'use strict';

const { TextDecoder } = require('node:util');
const {
  ROUTES,
  classifyWp0Route,
  normalizePath
} = require('./wp0-routing');

const REGULAR_FILE_MODE = '100644';
const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function outcome(values = {}) {
  return Object.freeze({
    pass: false,
    reasonCode: 'WP0_PRODUCT_DOCUMENTATION_INVALID',
    route: null,
    changedFiles: [],
    deletedFiles: 0,
    ...values,
    executionAuthorized: false,
    buildAuthorized: false,
    packageAuthorized: false,
    releaseAuthorized: false,
    publishAuthorized: false,
    productionUseAuthorized: false,
    readyForPromotion: false
  });
}

function fail(reasonCode, details = {}) {
  return outcome({ reasonCode, ...details });
}

function decodeUtf8(content) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch (_) {
    return null;
  }
}

function verifyProductDocumentationEntries({ policy, entries } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return fail('WP0_PRODUCT_DOCUMENTATION_ENTRIES_INVALID');
  }

  const normalizedPaths = entries.map(entry => normalizePath(entry?.path));
  if (normalizedPaths.some(value => !value) || new Set(normalizedPaths).size !== normalizedPaths.length) {
    return fail('WP0_PRODUCT_DOCUMENTATION_ENTRIES_INVALID');
  }

  const routeResult = classifyWp0Route(policy, normalizedPaths);
  if (!routeResult.pass || routeResult.route !== ROUTES.PRODUCT_DOCUMENTATION) {
    return fail('WP0_PRODUCT_DOCUMENTATION_ROUTE_INVALID', {
      route: routeResult.route,
      routeReasonCode: routeResult.reasonCode,
      changedFiles: [...new Set(normalizedPaths)].sort()
    });
  }

  let deletedFiles = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const baseMode = entry?.baseMode ?? null;
    const headMode = entry?.headMode ?? null;
    const details = { path: normalizedPaths[index], entryIndex: index };

    if (baseMode === null && headMode === null) {
      return fail('WP0_PRODUCT_DOCUMENTATION_BLOB_MISSING', details);
    }
    if ((baseMode !== null && baseMode !== REGULAR_FILE_MODE)
      || (headMode !== null && headMode !== REGULAR_FILE_MODE)) {
      return fail('WP0_PRODUCT_DOCUMENTATION_MODE_INVALID', {
        ...details,
        baseMode,
        headMode
      });
    }

    if (headMode === null) {
      deletedFiles += 1;
      if (entry?.headContent !== null) {
        return fail('WP0_PRODUCT_DOCUMENTATION_CONTENT_MISSING', details);
      }
      continue;
    }

    if (!Buffer.isBuffer(entry?.headContent)) {
      return fail('WP0_PRODUCT_DOCUMENTATION_CONTENT_MISSING', details);
    }
    const decoded = decodeUtf8(entry.headContent);
    if (decoded === null) {
      return fail('WP0_PRODUCT_DOCUMENTATION_UTF8_INVALID', details);
    }
    if (!decoded.trim()) {
      return fail('WP0_PRODUCT_DOCUMENTATION_EMPTY', details);
    }
    if (DISALLOWED_CONTROL_CHARACTERS.test(decoded)) {
      return fail('WP0_PRODUCT_DOCUMENTATION_CONTENT_INVALID', details);
    }
  }

  return outcome({
    pass: true,
    reasonCode: null,
    route: ROUTES.PRODUCT_DOCUMENTATION,
    changedFiles: [...normalizedPaths].sort(),
    deletedFiles
  });
}

module.exports = {
  REGULAR_FILE_MODE,
  verifyProductDocumentationEntries
};
