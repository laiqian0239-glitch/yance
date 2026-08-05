#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const {
  argValue,
  diffChangedFiles,
  runJsonCli
} = require('./cli-support');
const {
  verifyProductDocumentationEntries
} = require('./product-documentation');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'layered-ci', 'wp0-routing-policy.json');
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const TREE_ENTRY_REASON = 'WP0_PRODUCT_DOCUMENTATION_TREE_ENTRY_INVALID';

function treeEntryError(message) {
  return Object.assign(new Error(message), { reasonCode: TREE_ENTRY_REASON });
}

function parseLsTreeMode(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value[value.length - 1] !== 0) {
    throw treeEntryError('git tree entry must be one non-empty NUL-terminated record');
  }
  const payload = value.subarray(0, -1);
  if (payload.includes(0)) {
    throw treeEntryError('git tree lookup returned more than one record');
  }

  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    throw treeEntryError('git tree entry must be valid UTF-8');
  }

  const match = /^([0-9]{6})\s+(blob|tree|commit)\s+([0-9a-f]{40})\t[^\0]+$/u.exec(decoded);
  if (!match || match[2] !== 'blob') {
    throw treeEntryError('git tree entry must identify exactly one blob');
  }
  return match[1];
}

function gitPathMode(commit, file) {
  const output = execFileSync('git', ['ls-tree', '-z', commit, '--', file], {
    cwd: REPO_ROOT,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (output.length === 0) return null;
  return parseLsTreeMode(output);
}

function gitBlob(commit, file) {
  return execFileSync('git', ['show', `${commit}:${file}`], {
    cwd: REPO_ROOT,
    encoding: null,
    maxBuffer: MAX_DOCUMENT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function main(argv = process.argv.slice(2)) {
  const base = argValue(argv, '--base');
  const head = argValue(argv, '--head');
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const changedFiles = diffChangedFiles({
    repoRoot: REPO_ROOT,
    base,
    head,
    reasonCode: 'WP0_PRODUCT_DOCUMENTATION_DIFF_INVALID'
  });
  const entries = changedFiles.map(file => {
    const baseMode = gitPathMode(base, file);
    const headMode = gitPathMode(head, file);
    return {
      path: file,
      baseMode,
      headMode,
      headContent: headMode === null ? null : gitBlob(head, file)
    };
  });
  return verifyProductDocumentationEntries({ policy, entries });
}

if (require.main === module) {
  runJsonCli(() => main(), 'WP0_PRODUCT_DOCUMENTATION_VERIFY_FAILED');
}

module.exports = {
  gitPathMode,
  main,
  parseLsTreeMode
};
