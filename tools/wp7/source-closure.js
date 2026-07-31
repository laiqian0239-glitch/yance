#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { REPO_ROOT, gitIdentity, assertActivationBinding, listTracked, readReleaseSource, verifyRuntimeProtocolConvergence, validateAllGovernance, verifyRequiredTestImplementations } = require('./lib');

function checkJavaScriptSyntax(relative) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', relative], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ path: relative, stderr: error.message }));
    child.on('close', (code) => resolve(code === 0 ? null : { path: relative, stderr }));
  });
}

async function checkSyntaxWithPool(files, concurrency = 12) {
  const failures = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const failure = await checkJavaScriptSyntax(files[index]);
      if (failure) failures.push(failure);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
  return failures;
}

async function main() {
  const identity = gitIdentity();
  const result = { schemaVersion: 1, documentType: 'WP7_SOURCE_CLOSURE_RESULT', sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, branch: identity.branch, repositoryClean: identity.repositoryClean, status: 'PASS', checks: {} };
  try {
    result.checks.activationBinding = assertActivationBinding(REPO_ROOT, { identity, requireClean: true, requireBranch: true });
    result.checks.releaseSource = { status: 'PASS', credentialProtocolVersion: readReleaseSource().credentialProtocolVersion };
    result.checks.protocolConvergence = verifyRuntimeProtocolConvergence();
    result.checks.governance = validateAllGovernance();
    result.checks.requiredTestImplementations = verifyRequiredTestImplementations();
    const requiredTools = [
      'tools/wp7/final-evidence.js',
      'tools/wp7/generate-final-evidence.js',
      'tools/wp7/windows-final-harness.js',
      'tools/wp7/convergence-correction-matrix.js',
      'tools/wp7/production-dependency-binding.js',
      'tools/wp7/generate-production-dependency-binding.js',
      'release/production-dependency-binding.json',
      'tools/wp7/packaged-payload-closure.js',
      'tools/wp7/packaged-product-trust.js',
      'tools/wp7/run-packaged-electron-probe-integration.js',
      'installer/wp7/YanceFinalInstaller.nsi'
    ];
    const missingTools = requiredTools.filter((name) => !fs.existsSync(path.join(REPO_ROOT, name)));
    if (missingTools.length) throw Object.assign(new Error('WP7 final closure tooling missing'), { reasonCode: 'WP7_FINAL_EVIDENCE_CLOSURE_TOOLING_INCOMPLETE', details: { missingTools } });
    result.checks.finalClosureTooling = { status: 'PASS', requiredTools };
    const tracked = listTracked();
    const js = tracked.filter((name) => /\.(?:js|cjs|mjs)$/.test(name));
    const syntaxFailures = await checkSyntaxWithPool(js);
    if (syntaxFailures.length) throw Object.assign(new Error('JavaScript syntax failures'), { reasonCode: 'WP7_JAVASCRIPT_SYNTAX_FAILED', details: syntaxFailures });
    result.checks.javascriptSyntax = { status: 'PASS', total: js.length, passed: js.length, failed: 0 };
    const forbidden = tracked.filter((name) => /(?:WP7.*FINAL.*\.exe|phase1-acceptance-evidence\.json)$/i.test(name));
    if (forbidden.length) throw Object.assign(new Error('Final artifacts are forbidden before preacceptance'), { reasonCode: 'WP7_PRE_REVIEW_FINAL_ARTIFACT_FORBIDDEN', details: forbidden });
    result.checks.noPrematureFinalArtifacts = { status: 'PASS', forbiddenFound: 0 };
    result.trackedFileCount = tracked.length;
  } catch (error) {
    result.status = 'FAIL'; result.reasonCode = error.reasonCode || 'WP7_SOURCE_CLOSURE_FAILED'; result.message = error.message; result.details = error.details || {};
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
