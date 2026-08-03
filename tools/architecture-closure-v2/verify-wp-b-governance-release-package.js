#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_RELATIVE_PATH = 'release/architecture-closure-v2/wp-b-governance-package.json';
const WP7_LIBRARY_PATH = 'tools/wp7/lib.js';
const REQUIRED_DOCUMENT_TYPE = 'YANCE_ACV2_WP_B_APPLICATION_GOVERNANCE_PACKAGE';
const SOURCE_ROOT = 'governance/architecture-closure-v2/';
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;

function gitBlobSha(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from(`blob ${buffer.length}\0`),
    buffer
  ])).digest('hex');
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return Object.freeze({
      __governanceReadFailure: true,
      code: error.code === 'ENOENT' ? 'FILE_MISSING' : 'JSON_INVALID',
      message: error.message
    });
  }
}

function wp7ApplicationRoots(repositoryRoot) {
  const sourcePath = path.join(repositoryRoot, WP7_LIBRARY_PATH);
  let source;
  try {
    source = fs.readFileSync(sourcePath, 'utf8');
  } catch (_) {
    return [];
  }
  const start = source.indexOf('function assembleWindowsApplication');
  const end = source.indexOf('function buildFinalWindowsPayload', start + 1);
  if (start < 0 || end < 0) return [];
  const implementation = source.slice(start, end);
  const match = implementation.match(/for\s*\(const\s+rootName\s+of\s+\[([^\]]+)\]\)/u);
  if (!match) return [];
  return [...match[1].matchAll(/['"]([^'"]+)['"]/gu)].map(item => item[1]);
}

function validateGovernanceFlags(document, violations) {
  const governance = document && document.governance;
  if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
    violations.push({ code: 'WP_B_PACKAGED_GOVERNANCE_FLAGS_MISSING' });
    return;
  }
  if (governance.reviewGate1 !== 'CHANGES_REQUIRED') {
    violations.push({ code: 'WP_B_PACKAGED_REVIEW_GATE_INVALID', actual: governance.reviewGate1 || null });
  }
  if (governance.milestone1 !== 'NOT_SEALED' || governance.milestone2 !== 'NOT_STARTED') {
    violations.push({
      code: 'WP_B_PACKAGED_MILESTONE_STATE_INVALID',
      milestone1: governance.milestone1 || null,
      milestone2: governance.milestone2 || null
    });
  }
  for (const field of ['productionUseAuthorized', 'formalRelease', 'publish', 'wpCAuthorized', 'temporaryBypassAllowed']) {
    if (governance[field] !== false) {
      violations.push({ code: 'WP_B_PACKAGED_AUTHORIZATION_EXPANDED', field, actual: governance[field] });
    }
  }
}

function validateSourceBindings(repositoryRoot, document, violations) {
  const bindings = document && document.sourceBindings;
  if (!Array.isArray(bindings) || bindings.length < 6) {
    violations.push({ code: 'WP_B_GOVERNANCE_SOURCE_BINDINGS_INCOMPLETE' });
    return 0;
  }
  const seen = new Set();
  for (const binding of bindings) {
    const relativePath = String(binding && binding.path || '').split(path.sep).join('/');
    if (!relativePath.startsWith(SOURCE_ROOT) || relativePath.includes('..') || seen.has(relativePath)) {
      violations.push({ code: 'WP_B_GOVERNANCE_SOURCE_BINDING_PATH_INVALID', path: relativePath });
      continue;
    }
    seen.add(relativePath);
    const expectedSha = String(binding.gitBlobSha || '').toLowerCase();
    if (!SHA1_PATTERN.test(expectedSha)) {
      violations.push({ code: 'WP_B_GOVERNANCE_SOURCE_BINDING_SHA_INVALID', path: relativePath });
      continue;
    }
    const absolutePath = path.join(repositoryRoot, relativePath);
    let bytes;
    try {
      bytes = fs.readFileSync(absolutePath);
    } catch (_) {
      violations.push({ code: 'WP_B_GOVERNANCE_SOURCE_BINDING_MISSING', path: relativePath });
      continue;
    }
    const actualSha = gitBlobSha(bytes);
    if (actualSha !== expectedSha) {
      violations.push({
        code: 'WP_B_GOVERNANCE_SOURCE_BINDING_MISMATCH',
        path: relativePath,
        expectedGitBlobSha: expectedSha,
        actualGitBlobSha: actualSha
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch (_) {
      violations.push({ code: 'WP_B_GOVERNANCE_SOURCE_DOCUMENT_INVALID', path: relativePath });
      continue;
    }
    if (parsed.documentType !== binding.documentType) {
      violations.push({
        code: 'WP_B_GOVERNANCE_SOURCE_DOCUMENT_TYPE_MISMATCH',
        path: relativePath,
        expected: binding.documentType || null,
        actual: parsed.documentType || null
      });
    }
  }
  return bindings.length;
}

function validatePackagingContract(document, applicationRoots, violations) {
  const packaging = document && document.packaging;
  if (!packaging || typeof packaging !== 'object' || Array.isArray(packaging)) {
    violations.push({ code: 'WP_B_APPLICATION_PACKAGING_CONTRACT_MISSING' });
    return false;
  }
  if (packaging.applicationRoot !== 'resources/app'
      || packaging.inclusionRoot !== 'release'
      || packaging.packagedRelativePath !== PACKAGE_RELATIVE_PATH
      || packaging.bytesMustMatchReviewedPackage !== true
      || packaging.symlinkAllowed !== false) {
    violations.push({ code: 'WP_B_APPLICATION_PACKAGING_CONTRACT_INVALID', packaging });
  }
  const releaseIncluded = applicationRoots.includes('release');
  if (!releaseIncluded) violations.push({ code: 'WP_B_WP7_RELEASE_ROOT_NOT_PACKAGED' });
  return releaseIncluded;
}

function verifyGovernanceReleasePackage(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || path.resolve(__dirname, '..', '..'));
  const packagePath = path.join(repositoryRoot, PACKAGE_RELATIVE_PATH);
  const violations = [];
  let sourcePackageBytes = null;
  let packageDocument = options.packageDocument;

  if (packageDocument === undefined) {
    try {
      sourcePackageBytes = fs.readFileSync(packagePath);
      packageDocument = JSON.parse(sourcePackageBytes.toString('utf8'));
    } catch (error) {
      violations.push({
        code: error.code === 'ENOENT'
          ? 'WP_B_GOVERNANCE_RELEASE_PACKAGE_MISSING'
          : 'WP_B_GOVERNANCE_RELEASE_PACKAGE_INVALID',
        message: error.message
      });
      packageDocument = null;
    }
  } else {
    try {
      sourcePackageBytes = fs.readFileSync(packagePath);
    } catch (_) {
      sourcePackageBytes = null;
    }
  }

  if (!packageDocument || packageDocument.documentType !== REQUIRED_DOCUMENT_TYPE
      || packageDocument.workPackage !== 'WP-B'
      || packageDocument.status !== 'EVIDENCE_BOUND_RELEASE_CLOSED') {
    violations.push({ code: 'WP_B_GOVERNANCE_RELEASE_PACKAGE_IDENTITY_INVALID' });
  }

  validateGovernanceFlags(packageDocument, violations);
  const sourceBindingCount = validateSourceBindings(repositoryRoot, packageDocument, violations);
  const applicationRoots = wp7ApplicationRoots(repositoryRoot);
  const wp7ReleaseRootIncluded = validatePackagingContract(packageDocument, applicationRoots, violations);

  let packagedBytesMatch = options.payloadRoot ? false : null;
  if (options.payloadRoot) {
    const packagedPath = path.join(path.resolve(options.payloadRoot), 'resources', 'app', PACKAGE_RELATIVE_PATH);
    let packagedBytes;
    try {
      const stat = fs.lstatSync(packagedPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        violations.push({ code: 'WP_B_PACKAGED_GOVERNANCE_PATH_INVALID', path: packagedPath });
      } else {
        packagedBytes = fs.readFileSync(packagedPath);
      }
    } catch (_) {
      violations.push({ code: 'WP_B_PACKAGED_GOVERNANCE_MISSING', path: packagedPath });
    }
    if (packagedBytes && sourcePackageBytes) {
      packagedBytesMatch = packagedBytes.equals(sourcePackageBytes);
      if (!packagedBytesMatch) {
        violations.push({ code: 'WP_B_PACKAGED_GOVERNANCE_BYTES_MISMATCH', path: packagedPath });
      }
    }
  }

  const governance = packageDocument && packageDocument.governance || {};
  return Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_APPLICATION_GOVERNANCE_PACKAGE_VERIFICATION',
    ok: violations.length === 0,
    packageRelativePath: PACKAGE_RELATIVE_PATH,
    sourceBindingCount,
    applicationRoots,
    wp7ReleaseRootIncluded,
    packagedBytesMatch,
    productionUseAuthorized: governance.productionUseAuthorized === true,
    formalRelease: governance.formalRelease === true,
    publish: governance.publish === true,
    wpCAuthorized: governance.wpCAuthorized === true,
    violations
  });
}

if (require.main === module) {
  const report = verifyGovernanceReleasePackage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  PACKAGE_RELATIVE_PATH,
  REQUIRED_DOCUMENT_TYPE,
  SOURCE_ROOT,
  gitBlobSha,
  validateGovernanceFlags,
  validatePackagingContract,
  validateSourceBindings,
  verifyGovernanceReleasePackage,
  wp7ApplicationRoots
};
