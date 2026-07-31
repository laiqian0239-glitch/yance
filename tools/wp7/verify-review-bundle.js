#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { Wp7Error, readJson, sha256File, writeCanonicalJson } = require('./lib');

const REQUIRED_TAG = 'stage-6.4.5.8-rejected-architecture';
const REQUIRED_TAG_TARGET = 'c150182219edea2faf49c714275e9921a21df742';

function bundleHeads(bundlePath) {
  const output = execFileSync('git', ['bundle', 'list-heads', bundlePath], { encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [objectId, ref] = line.trim().split(/\s+/, 2);
    return { objectId, ref };
  });
}

function verifyReviewBundle(bundlePath, options = {}) {
  const absolute = path.resolve(bundlePath || '');
  if (!bundlePath || !fs.existsSync(absolute)) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'review bundle is missing', { absolute });
  const verify = spawnSync('git', ['bundle', 'verify', absolute], { cwd: options.cwd || process.cwd(), encoding: 'utf8' });
  if (verify.status !== 0) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'git bundle verify failed', { stdout: verify.stdout, stderr: verify.stderr });
  const heads = bundleHeads(absolute);
  const branchRef = options.branchRef || 'refs/heads/stage/6.4.5.9-architecture-closure';
  const tagRef = `refs/tags/${REQUIRED_TAG}`;
  const branch = heads.find((row) => row.ref === branchRef);
  const tag = heads.find((row) => row.ref === tagRef);
  if (!branch) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'formal WP7 branch ref is absent from bundle', { branchRef, heads });
  if (!tag) throw new Wp7Error('WP7_BUNDLE_MISSING_REQUIRED_WP0_IMMUTABLE_TAG', 'required WP0 immutable annotated tag ref is absent from bundle', { tagRef, heads });

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-review-bundle-'));
  const repo = path.join(temp, 'repo');
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-checkout', absolute, repo], { stdio: 'ignore' });
    execFileSync('git', ['checkout', '--detach', branch.objectId], { cwd: repo, stdio: 'ignore' });
    const tagType = execFileSync('git', ['cat-file', '-t', tag.objectId], { cwd: repo, encoding: 'utf8' }).trim();
    if (tagType !== 'tag') throw new Wp7Error('WP7_BUNDLE_MISSING_REQUIRED_WP0_IMMUTABLE_TAG', 'required immutable ref is not an annotated tag object', { tagType, objectId: tag.objectId });
    const peeled = execFileSync('git', ['rev-parse', `${tagRef}^{}`], { cwd: repo, encoding: 'utf8' }).trim();
    if (peeled !== REQUIRED_TAG_TARGET) throw new Wp7Error('WP7_BUNDLE_MISSING_REQUIRED_WP0_IMMUTABLE_TAG', 'required immutable tag resolves to the wrong commit', { expected: REQUIRED_TAG_TARGET, actual: peeled });
    const fsck = spawnSync('git', ['fsck', '--full', '--strict'], { cwd: repo, encoding: 'utf8' });
    if (fsck.status !== 0) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'bundle-only git fsck failed', { stdout: fsck.stdout, stderr: fsck.stderr });
    const result = {
      schemaVersion: 1,
      documentType: 'WP7_REVIEW_BUNDLE_VERIFICATION',
      status: 'PASS',
      bundlePath: absolute,
      bundleSha256: sha256File(absolute),
      branchRef,
      branchHead: branch.objectId,
      immutableTagRef: tagRef,
      immutableTagObject: tag.objectId,
      immutableTagType: tagType,
      immutableTagTarget: peeled,
      gitFsck: 'PASS'
    };
    return result;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (require.main === module) {
  try {
    const result = verifyReviewBundle(arg('--bundle'), { branchRef: arg('--branch-ref') || undefined });
    const output = arg('--output');
    if (output) writeCanonicalJson(path.resolve(output), result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_REVIEW_BUNDLE_VERIFICATION_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  }
}

module.exports = { REQUIRED_TAG, REQUIRED_TAG_TARGET, verifyReviewBundle };
