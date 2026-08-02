'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDerivedSourceIdentity } = require('./source-uat-delivery');

function value(argv, name) {
  const prefix = `--${name}=`;
  return argv.find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

function identityError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, details });
}

function assertGitFreeExportRoot(root) {
  const gitPath = path.join(root, '.git');
  if (fs.existsSync(gitPath)) {
    throw identityError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN',
      '派生源码身份只能在不含 .git 的密封导出目录生成；可变仓库必须使用运行时 Git HEAD/Tree 身份',
      { root, gitPath }
    );
  }
  return root;
}

function main() {
  const argv = process.argv.slice(2);
  const exportRoot = assertGitFreeExportRoot(path.resolve(value(argv, 'root') || process.cwd()));
  const document = createDerivedSourceIdentity(exportRoot, {
    derivedVersion: value(argv, 'derived-version'),
    releaseBatch: value(argv, 'release-batch'),
    baseCommit: value(argv, 'base-commit'),
    baseTree: value(argv, 'base-tree')
  });
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_DERIVED_IDENTITY_CREATE_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2)}\n`);
  process.exitCode = 1;
}
