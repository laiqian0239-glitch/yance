'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sealedExportError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function sanitizeGitEnvironment(sourceEnv = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(sourceEnv || {})) {
    if (/^GIT_/iu.test(key)) continue;
    if (value != null) environment[key] = String(value);
  }
  environment.LC_ALL = 'C';
  environment.LANG = 'C';
  return environment;
}

function canonicalizeSealedExportRoot(value) {
  let logicalRoot;
  try {
    logicalRoot = path.resolve(value);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份要求存在且可读取的密封导出目录',
      { logicalRoot: '', canonicalRoot: '', message: error.message }
    );
  }

  let rootLstat;
  try {
    rootLstat = fs.lstatSync(logicalRoot);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份要求存在且可读取的密封导出目录',
      { root: logicalRoot, logicalRoot, canonicalRoot: '', message: error.message }
    );
  }

  if (rootLstat.isSymbolicLink()) {
    let canonicalRoot = '';
    try { canonicalRoot = fs.realpathSync.native(logicalRoot); } catch (_) {}
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN',
      '派生源码身份根路径不能是符号链接、Windows junction 或其他链接型重解析入口',
      {
        root: logicalRoot,
        logicalRoot,
        canonicalRoot,
        relation: 'ROOT_SYMBOLIC_LINK_OR_REPARSE_POINT'
      }
    );
  }

  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync.native(logicalRoot);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '无法解析密封导出目录的物理规范路径',
      { root: logicalRoot, logicalRoot, canonicalRoot: '', message: error.message }
    );
  }

  let canonicalStat;
  try {
    canonicalStat = fs.statSync(canonicalRoot);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份要求存在且可读取的密封导出目录',
      { root: canonicalRoot, logicalRoot, canonicalRoot, message: error.message }
    );
  }
  if (!canonicalStat.isDirectory()) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_EXPORT_ROOT_INVALID',
      '派生源码身份根路径必须是目录',
      { root: canonicalRoot, logicalRoot, canonicalRoot }
    );
  }

  return Object.freeze({ logicalRoot, canonicalRoot });
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

function commandText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return String(value || '').trim();
}

function gitRepositoryContext(root, options = {}) {
  const execute = options.execFileSync || execFileSync;
  const environment = sanitizeGitEnvironment({
    ...process.env,
    ...(options.env || {})
  });
  const commandOptions = {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: environment
  };
  try {
    const gitDir = commandText(execute('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], commandOptions));
    let workTree = '';
    try {
      workTree = commandText(execute('git', ['-C', root, 'rev-parse', '--show-toplevel'], commandOptions));
    } catch (_) {}
    return Object.freeze({ detected: true, gitDir, workTree });
  } catch (error) {
    const stderr = commandText(error?.stderr);
    if (Number(error?.status) === 128 && /not a git repository/iu.test(stderr)) {
      return Object.freeze({ detected: false, gitDir: '', workTree: '' });
    }
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_PROBE_FAILED',
      '无法可靠判定导出目录是否受 Git 控制，拒绝生成派生源码身份',
      {
        root,
        status: Number.isInteger(error?.status) ? error.status : null,
        code: error?.code || '',
        message: error?.message || '',
        stderr: stderr.slice(0, 1000)
      }
    );
  }
}

function assertSealedExportRoot(value) {
  const { logicalRoot, canonicalRoot } = canonicalizeSealedExportRoot(value);
  const root = canonicalRoot;
  const commonDetails = { root, logicalRoot, canonicalRoot };

  const ancestorMarker = existingGitMetadataInAncestors(root);
  let gitContext;
  try {
    gitContext = gitRepositoryContext(root);
  } catch (error) {
    if (!ancestorMarker) throw error;
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN',
      '派生源码身份只能在完全不受 Git 工作树控制的密封导出目录生成',
      {
        ...commonDetails,
        gitMetadataPath: ancestorMarker,
        relation: 'ANCESTOR_OR_ROOT_GIT_METADATA',
        probeFailureReasonCode: error.reasonCode || error.code || ''
      }
    );
  }
  if (ancestorMarker || gitContext.detected) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN',
      '派生源码身份只能在完全不受 Git 工作树控制的密封导出目录生成',
      {
        ...commonDetails,
        gitMetadataPath: ancestorMarker || gitContext.gitDir,
        relation: gitContext.detected ? 'GIT_REV_PARSE_CONTEXT' : 'ANCESTOR_OR_ROOT_GIT_METADATA',
        gitWorkTree: gitContext.workTree || ''
      }
    );
  }

  let nestedMarker = '';
  try {
    nestedMarker = embeddedGitMetadata(root);
  } catch (error) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_PROBE_FAILED',
      '无法完整扫描导出目录中的嵌套 Git 元数据，拒绝生成派生源码身份',
      { ...commonDetails, message: error.message }
    );
  }
  if (nestedMarker) {
    throw sealedExportError(
      'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN',
      '派生源码身份不能覆盖包含嵌套 Git 元数据的目录树',
      {
        ...commonDetails,
        gitMetadataPath: nestedMarker,
        relation: 'EMBEDDED_GIT_METADATA'
      }
    );
  }
  return root;
}

module.exports = {
  assertSealedExportRoot,
  canonicalizeSealedExportRoot,
  embeddedGitMetadata,
  existingGitMetadataInAncestors,
  gitRepositoryContext,
  sanitizeGitEnvironment,
  sealedExportError
};
