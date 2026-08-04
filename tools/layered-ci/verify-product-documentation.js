#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

function gitPathMode(commit, file) {
  const output = execFileSync('git', ['ls-tree', commit, '--', file], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if (!output) return null;
  const match = /^([0-9]{6})\s+(blob|tree|commit)\s+[0-9a-f]{40}\t/u.exec(output);
  if (!match) {
    const error = new Error(`unable to parse git tree entry for ${file} at ${commit}`);
    error.reasonCode = 'WP0_PRODUCT_DOCUMENTATION_TREE_ENTRY_INVALID';
    throw error;
  }
  return match[1];
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
  main
};
