'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sealedExportError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function existingGitMetadataInAncestors(root) {
  let cursor = path.resolve(root);
  while (true) {
    const marker = path.join(cursor, '.git');
    if (fs.existsSync(marker)) return marker;
    const parent = path.dirname(cursor);
    if (parent === cursor) return '';
    cursor = parent;
  }
}

function embeddedGitMetadata(root) {
  const pending = [path.resolve(root)];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.name.toLowerCase() === '.git') return fullPath;
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return '';
}

function assertSealedExportRoot(value) {
  const root = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份要求存在且可读取的密封导出目录',
      { root, message: error.message }
    );
  }
  if (!stat.isDirectory()) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份根路径必须是目录',
      { root }
    );
  }

  const ancestorMarker = existingGitMetadataInAncestors(root);
  const nestedMarker = ancestorMarker ? '' : embeddedGitMetadata(root);
  const gitMetadataPath = ancestorMarker || nestedMarker;
  if (gitMetadataPath) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN',
      '派生源码身份只能在完全不受 Git 工作树或嵌套 Git 元数据控制的密封导出目录生成',
      {
        root,
        gitMetadataPath,
        relation: ancestorMarker ? 'ANCESTOR_OR_ROOT_GIT_METADATA' : 'EMBEDDED_GIT_METADATA'
      }
    );
  }
  return root;
}

module.exports = {
  assertSealedExportRoot,
  embeddedGitMetadata,
  existingGitMetadataInAncestors,
  sealedExportError
};
