'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readJson, sha256File, validateEvidenceCommon } = require('../../tools/wp7/lib');
const { readFinalExecutionContext } = require('../../tools/wp7/final-context');

function isFinalExecution() { return ['FINAL_PACKAGING', 'FINAL_WINDOWS', 'ALL_FINAL'].includes(process.env.WP7_EXECUTION_PHASE); }

let cachedContext = null;
function finalContext() {
  assert.ok(isFinalExecution(), 'final context requested outside final execution');
  const contextPath = process.env.WP7_FINAL_EXECUTION_CONTEXT;
  assert.ok(contextPath, 'WP7_FINAL_EXECUTION_CONTEXT is required');
  if (!cachedContext) cachedContext = readFinalExecutionContext(path.resolve(contextPath), { mode: process.env.WP7_EXECUTION_PHASE });
  assert.equal(cachedContext.contextSha256, process.env.WP7_FINAL_CONTEXT_SHA256, 'final context digest mismatch');
  return cachedContext;
}

function evidenceRoot() {
  const root = finalContext().rawWindowsEvidenceRoot;
  assert.ok(fs.existsSync(root), `raw final evidence root missing: ${root}`);
  return root;
}

function load(relativePath) {
  const root = evidenceRoot();
  const file = path.resolve(root, ...relativePath.split('/'));
  assert.ok(file.startsWith(`${root}${path.sep}`), 'evidence path escaped root');
  assert.ok(fs.existsSync(file), `raw evidence file missing: ${relativePath}`);
  const document = readJson(file);
  validateEvidenceCommon(document, { final: true });
  assert.equal(document.status, 'PASS');
  assertWindows(document);
  assert.ok(document.provenance, 'raw evidence provenance missing');
  assert.equal(document.provenance.callerSuppliedObservations, false);
  assert.equal(document.provenance.callerSuppliedTestResults, false);
  assert.ok(Array.isArray(document.provenance.commandIds) && document.provenance.commandIds.length > 0);
  return document;
}

function assertWindows(document) {
  assert.equal(document.platform, 'win32', 'FINAL_WINDOWS evidence must claim win32');
  assert.equal(document.actualPlatform, 'win32', 'FINAL_WINDOWS evidence must originate on win32');
  assert.equal(document.fixtureMode, false, 'FINAL_WINDOWS evidence cannot be fixture-mode');
}

function assertBoolean(document, key, expected = true) { assert.equal(document[key], expected, `${key} mismatch`); }

function assertFinalArtifacts() {
  const context = finalContext();
  assert.ok(fs.existsSync(context.installerPath), 'final installer missing');
  assert.equal(sha256File(context.installerPath), context.installerSha256, 'final installer SHA256 mismatch');
  assert.ok(fs.existsSync(context.payloadRoot), 'final payload root missing');
  assert.ok(fs.existsSync(context.releaseManifestPath), 'release manifest missing');
  assert.ok(fs.existsSync(context.payloadFilesPath), 'payload files manifest missing');
  assert.ok(fs.existsSync(context.finalReleaseEvidencePath), 'final release evidence missing');
  return context;
}

module.exports = { isFinalExecution, finalContext, evidenceRoot, load, assertWindows, assertBoolean, assertFinalArtifacts };
