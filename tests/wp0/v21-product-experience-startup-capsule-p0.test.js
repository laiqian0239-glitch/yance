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

test('startup capsule verifier consumes canonical production diagnostics for server import proof', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-startup-capsule-proof-'));
  try {
    const logsRoot = path.join(root, 'logs');
    fs.mkdirSync(logsRoot, { recursive: true });
    const startedAtMs = Date.now() - 500;
    const at = new Date(startedAtMs + 100).toISOString();

    fs.writeFileSync(
      path.join(logsRoot, 'production-diagnostics.jsonl'),
      `${JSON.stringify({ type: 'event', name: 'backend-boot-started', at })}\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(logsRoot, 'server.jsonl'),
      `${JSON.stringify({
        at,
        channel: 'server',
        level: 'info',
        message: 'server-started',
        detail: {
          startupMigration: { ok: true, executed: true },
          startupTimings: { legacyMigrationReadyMs: 12 }
        }
      })}\n`,
      'utf8'
    );

    const Module = require('node:module');
    const source = `${fs.readFileSync(TOOL_PATH, 'utf8')}\nmodule.exports.__verifyStartupDiagnostics = verifyStartupDiagnostics;\n`;
    const isolated = new Module(TOOL_PATH, module);
    isolated.filename = TOOL_PATH;
    isolated.paths = Module._nodeModulePaths(path.dirname(TOOL_PATH));
    isolated._compile(source, TOOL_PATH);

    const result = isolated.exports.__verifyStartupDiagnostics(root, startedAtMs);
    assert.equal(result.recordCount, 2, 'canonical production diagnostics and server readiness records must both participate in startup proof');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('startup capsule disposable fixture excludes runtime owner claims and stale post-install evidence without widening secure projection', () => {
  const tool = read(TOOL_PATH);
  const Module = require('node:module');
  const source = `${tool}\nmodule.exports.__isRuntimeOwnerClaimArtifact = typeof isRuntimeOwnerClaimArtifact === 'function' ? isRuntimeOwnerClaimArtifact : null;\n`;
  const isolated = new Module(TOOL_PATH, module);
  isolated.filename = TOOL_PATH;
  isolated.paths = Module._nodeModulePaths(path.dirname(TOOL_PATH));
  isolated._compile(source, TOOL_PATH);

  const classify = isolated.exports.__isRuntimeOwnerClaimArtifact;
  assert.equal(typeof classify, 'function', 'startup-capsule helper must own an explicit runtime-state projection policy');

  for (const relative of [
    'secure/desktop-backend-owner.json',
    'secure/desktop-backend-owner.json.lock/claim',
    'secure/desktop-backend-owner.json.123.456.deadbeef.tmp',
    'secure/desktop-backend-owner.json.123.lock',
    'logs/post-install-launch.json',
    'logs/post-install-launch.pass'
  ]) {
    assert.equal(classify(relative), true, `runtime-only fixture state must be excluded: ${relative}`);
  }

  for (const relative of [
    'store/yance-r32.db',
    'secure/credentials.safe.json',
    'secure/other.json',
    'logs/server.jsonl'
  ]) {
    assert.equal(classify(relative), false, `durable fixture content must remain eligible: ${relative}`);
  }

  assert.match(tool, /function copyFixture[\s\S]*const relative = canonicalRelative\(path\.relative\(sourceDataRoot, sourceFile\)\);[\s\S]*if \(isRuntimeOwnerClaimArtifact\(relative\)\) continue;/u, 'copyFixture must apply the runtime-state exclusion before copying or recording the file');
  assert.match(tool, /originClass:\s*'disposable-r32-fixture'/u, 'retained fixture files must remain byte-origin recorded');
});

test('startup capsule preserves fixture child logs in helper-owned failure diagnostics', () => {
  const tool = read(TOOL_PATH);
  assert.match(tool, /function preserveFixtureFailureLogs\(fixtureDataRoot, capsuleRoot\)/u, 'helper must own fixture-log failure preservation');
  assert.match(tool, /catch \(error\) \{[\s\S]*preserveFixtureFailureLogs\(fixtureDataRoot, capsuleRoot\);[\s\S]*throw error;[\s\S]*\} finally \{/u, 'validateCapsuleLaunch must preserve fixture logs before rethrowing the original failure');

  const Module = require('node:module');
  const source = `${tool}\nmodule.exports.__preserveFixtureFailureLogs = typeof preserveFixtureFailureLogs === 'function' ? preserveFixtureFailureLogs : null;\n`;
  const isolated = new Module(TOOL_PATH, module);
  isolated.filename = TOOL_PATH;
  isolated.paths = Module._nodeModulePaths(path.dirname(TOOL_PATH));
  isolated._compile(source, TOOL_PATH);
  assert.equal(typeof isolated.exports.__preserveFixtureFailureLogs, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-startup-capsule-fixture-logs-'));
  try {
    const fixtureDataRoot = path.join(root, 'fixture', 'data');
    const logsRoot = path.join(fixtureDataRoot, 'logs');
    const capsuleRoot = path.join(root, 'startup-capsule');
    fs.mkdirSync(logsRoot, { recursive: true });
    const record = `${JSON.stringify({ at: '2026-08-27T10:39:30.000Z', event: 'fixture-child-started' })}\n`;
    fs.writeFileSync(path.join(logsRoot, 'desktop-bootstrap.jsonl'), record, 'utf8');

    isolated.exports.__preserveFixtureFailureLogs(fixtureDataRoot, capsuleRoot);

    const preserved = path.join(capsuleRoot, 'diagnostics', 'fixture-data-logs', 'desktop-bootstrap.jsonl');
    assert.equal(fs.readFileSync(preserved, 'utf8'), record, 'fixture child log bytes must be preserved in helper-owned diagnostics');
    assert.equal(fs.readFileSync(path.join(logsRoot, 'desktop-bootstrap.jsonl'), 'utf8'), record, 'diagnostic preservation must not mutate the source fixture');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
