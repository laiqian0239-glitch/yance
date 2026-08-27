'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'v21-product-experience-shell-p0-final-validation.yml');
const TOOL_PATH = path.join(ROOT, 'tools', 'product-experience', 'create-startup-capsule.js');

function read(file) {
  assert.equal(fs.existsSync(file), true, `required startup-capsule path is missing: ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

test('Product Final creates one same-build startup capsule with populated disposable R32 startup proof and byte-origin verification', () => {
  const workflow = read(WORKFLOW_PATH);
  const builderNeedle = 'tools/wp7/create-pre-review-trusted-product.js';
  const capsuleNeedle = 'tools/product-experience/create-startup-capsule.js';
  const builderIndex = workflow.indexOf(builderNeedle);
  const capsuleIndex = workflow.indexOf(capsuleNeedle);

  assert.ok(capsuleIndex > builderIndex && builderIndex >= 0, 'startup capsule must be projected after the existing full WP7 application build from the same materialized-desktop job');
  assert.equal((workflow.match(/tools\/wp7\/create-pre-review-trusted-product\.js/gu) || []).length, 1, 'startup capsule must not introduce a second application build');
  assert.match(workflow, /Product-Experience-Startup-Capsule-\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/u);
  assert.match(workflow, /product-uat-packaged-launch/u, 'capsule projection must consume the extracted full application used by packaged launch');
  assert.match(workflow, /product-uat-element-validation-host/u, 'capsule projection must consume the exact same-job Element validation host output');
  assert.match(workflow, /populated[^\n]*R32|R32[^\n]*populated/iu, 'capsule validation must use a populated disposable R32 fixture rather than an empty profile');
  assert.match(workflow, /startup-capsule[\s\S]{0,1600}(?:server-import|server import)[\s\S]{0,1600}startup\.migrate[\s\S]{0,1600}backend-ready[\s\S]{0,1600}Element ModuleLoader[\s\S]{0,1600}post-install/iu, 'capsule execution must bind all mandatory startup checkpoints');
  assert.doesNotMatch(workflow, /startup-capsule[\s\S]{0,800}(?:AppData\\Roaming\\Yance|%APPDATA%|\$env:APPDATA)/iu, 'capsule CI must not read live AppData');

  const tool = read(TOOL_PATH);
  assert.match(tool, /Yance\.exe/u);
  assert.match(tool, /resources[\\/]app/u);
  assert.match(tool, /resources[\\/]runtime[\\/]node22/u);
  assert.match(tool, /parlant-runtime/u);
  assert.match(tool, /learning-runtime/u);
  assert.match(tool, /sha256|createHash\(['"]sha256['"]\)/iu);
  assert.match(tool, /origin/u);
  assert.match(tool, /full[-_ ]application/iu);
  assert.match(tool, /element[-_ ]host/iu);
  assert.match(tool, /size/u);
  assert.match(tool, /manifest/iu);
  assert.match(tool, /diagnostic/iu);
  assert.match(tool, /yance-r32\.db|R32/iu);
  assert.match(tool, /disposable/iu);
  assert.match(tool, /server-import|server import/iu);
  assert.match(tool, /startup\.migrate/u);
  assert.match(tool, /backend-ready|backend ready/iu);
  assert.match(tool, /Element ModuleLoader/u);
  assert.match(tool, /post-install/iu);
  assert.match(tool, /hash mismatch|byte identity|byte-identical/iu);
  assert.match(tool, /exclude|excluded/iu);
  assert.doesNotMatch(tool, /npm\s+(?:install|ci)|pnpm\s+(?:install|add)|electron-builder|create-pre-review-trusted-product/iu, 'capsule projection must not build or install a second application');
});

test('startup capsule persists its structured failure reason before nonzero exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-startup-capsule-failure-'));
  try {
    const applicationRoot = path.join(root, 'application');
    const elementHostRoot = path.join(root, 'element-host');
    const dataRoot = path.join(root, 'data');
    const outputRoot = path.join(root, 'output');
    for (const directory of [applicationRoot, elementHostRoot, dataRoot]) fs.mkdirSync(directory, { recursive: true });

    const result = spawnSync(process.execPath, [
      TOOL_PATH,
      '--application-root', applicationRoot,
      '--element-host-root', elementHostRoot,
      '--data-root', dataRoot,
      '--output-root', outputRoot,
      '--candidate-commit', 'not-a-git-object-id',
      '--candidate-tree', '0'.repeat(40)
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    });

    assert.notEqual(result.status, 0, 'fixture must exercise a real helper failure');
    assert.match(result.stderr, /STARTUP_CAPSULE_IDENTITY_INVALID/u, 'stderr must preserve the structured reason code');

    const failurePath = path.join(outputRoot, 'startup-capsule', 'diagnostics', 'startup-capsule-failure.json');
    assert.equal(fs.existsSync(failurePath), true, 'structured startup-capsule failure telemetry must be durable before nonzero exit');
    const failure = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
    assert.equal(failure.status, 'FAIL');
    assert.equal(failure.code, 'STARTUP_CAPSULE_IDENTITY_INVALID');
    assert.match(String(failure.message || ''), /candidate commit\/tree/u);
    assert.equal(typeof failure.details, 'object');
    assert.ok(Number.isFinite(Date.parse(String(failure.generatedAtUtc || ''))), 'failure telemetry must carry a parseable UTC timestamp');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
