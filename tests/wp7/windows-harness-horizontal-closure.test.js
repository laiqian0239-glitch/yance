'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { classifyCommandResult, parseTapSummary } = require('../../tools/wp7/tap-summary');

const ROOT = path.resolve(__dirname, '..', '..');

function source(relative) {
  return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
}

function walkJs(relativeRoot) {
  const base = path.join(ROOT, relativeRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  };
  visit(base);
  return files;
}

test('every test/tool Git checkout producer pins LF before materializing source bytes', () => {
  const offenders = [];
  for (const file of [...walkJs('tests'), ...walkJs('tools')]) {
    if (file === __filename) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/(?:execFileSync|spawnSync|spawn|run)\(\s*['"]git['"]|\b(?:const|let)\s+args\s*=/.test(line)) return;
      for (const command of ['clone', 'worktree', 'archive']) {
        const commandToken = line.search(new RegExp(`['\"]${command}['\"]`));
        if (commandToken < 0) continue;
        if (command === 'worktree' && !/['\"]worktree['\"]\s*,\s*['\"]add['\"]/.test(line)) continue;
        const autocrlfToken = line.indexOf('core.autocrlf=false');
        const eolToken = line.indexOf('core.eol=lf');
        const persistentCloneConfigMissing = command === 'clone' && !/['"]--config['"][\s\S]*core\.autocrlf=false[\s\S]*['"]--config['"][\s\S]*core\.eol=lf/.test(line);
        if (autocrlfToken < 0 || eolToken < 0 || autocrlfToken > commandToken || eolToken > commandToken || persistentCloneConfigMissing) {
          offenders.push(`${path.relative(ROOT, file)}:${index + 1}:${command}:${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `Git checkout producers must pin core.autocrlf=false and core.eol=lf before materialization:\n${offenders.join('\n')}`);
  const builder = source('tools/wp7/RUN_WINDOWS_FINAL_BUILDER.ps1');
  assert.match(builder, /git -c core\.autocrlf=false -c core\.eol=lf clone/);
  const helpers = source('tests/wp7/helpers.js');
  assert.match(helpers, /clone[\s\S]*--config[\s\S]*core\.autocrlf=false[\s\S]*--config[\s\S]*core\.eol=lf/);
});

test('Windows WP7 npm, rcedit and trusted Node fixtures use production-shaped execution paths', () => {
  const verify = source('tools/wp7/verify.js');
  assert.match(verify, /npmInvocationForPlatform/);
  assert.deepEqual(verify.split(/\r?\n/).filter((line) => line.includes('recordCommand(') && /['"]npm['"]/.test(line)), []);
  assert.match(verify, /CONVERGENCE:\s*1800000/);
  assert.match(verify, /ADVERSARIAL:\s*2700000/);


  const mergedTap = parseTapSummary([
    'TAP version 13', 'not ok 1 - first failure', '1..1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0',
    'TAP version 13', 'ok 1 - second command', '1..1', '# tests 1', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0'
  ].join('\n'));
  assert.equal(mergedTap.tests, 2);
  assert.equal(mergedTap.passed, 1);
  assert.equal(mergedTap.failed, 1);
  assert.deepEqual(mergedTap.firstFailure, { testNumber: 1, name: 'first failure' });
  const classifiedFailure = classifyCommandResult({ status: 1, signal: null, stdout: ['TAP version 13', 'not ok 29 - real child normal and force exit leave no orphan PID', '1..37', '# tests 37', '# pass 36', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0'].join('\n'), stderr: '' }, { tap: true });
  assert.equal(classifiedFailure.outcome, 'TEST_FAILURE');
  assert.equal(classifiedFailure.tap.tests, 37);
  assert.equal(classifiedFailure.tap.firstFailure.name, 'real child normal and force exit leave no orphan PID');
  const missingSummary = classifyCommandResult({ status: 1, signal: null, stdout: 'npm wrapper output only', stderr: '' }, { tap: true });
  assert.equal(missingSummary.outcome, 'TAP_PARSE_FAILURE');

  const installed = source('tests/wp7/installed-application-probe-entry-integration.test.js');
  const convergence = source('tools/wp7/convergence-correction-matrix.js');
  assert.match(installed, /createReviewFixtureBrandingOptions\(createFakeRceditRunner\(\)\)/);
  assert.match(convergence, /createReviewFixtureBrandingOptions\(createFakeRceditRunner\(\)\)/);

  for (const required of [
    source('tests/wp7/final-build-source-freeze-match.test.js'),
    source('tests/wp7/final-installer-build-id-consistency.test.js'),
    installed,
    convergence,
    source('tests/wp7/wp7-installer-branding-ux.test.js')
  ]) {
    assert.match(required, /createReviewFixtureBrandingOptions\(createFakeRceditRunner\(\)\)/);
    assert.doesNotMatch(required, /(?:^|[,{]\s*)testRceditRunner\s*:\s*createFakeRceditRunner\(\)/m);
  }
  assert.match(convergence, /const ELECTRON_ARCHIVE_EXECUTABLE = process\.platform === 'win32' \? 'electron\.exe' : 'electron'/);
  assert.match(convergence, /const PRODUCT_EXECUTABLE_NAME = process\.platform === 'win32' \? RELEASE_SOURCE\.executableName : path\.parse\(RELEASE_SOURCE\.executableName\)\.name/);
  assert.doesNotMatch(convergence, /archiveExecutableEntry: 'electron', productExecutableName: 'Yance'/);

  const helpers = source('tests/wp7/helpers.js');
  assert.match(helpers, /process\.platform === 'win32'[\s\S]*fs\.copyFileSync\(process\.execPath, executable\)/);
});

test('every fake rcedit caller uses the explicit review-fixture capability', () => {
  const offenders = [];
  for (const file of [...walkJs('tests'), ...walkJs('tools')]) {
    if (file === __filename) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes('testRceditRunner')) continue;
    if (!content.includes('createReviewFixtureBrandingOptions')) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `fake rcedit callers missing explicit review capability:\n${offenders.join('\n')}`);

  const lib = source('tools/wp7/lib.js');
  assert.match(lib, /reviewFixtureBrandingCapability !== REVIEW_FIXTURE_BRANDING_CAPABILITY/);
  assert.match(lib, /WP7_REVIEW_FIXTURE_BRANDING_NOT_AUTHORIZED/);
  assert.match(lib, /reviewFixtureBrandingCapability: options\.reviewFixtureBrandingCapability[\s\S]*testRceditRunner: options\.testRceditRunner/);
  assert.doesNotMatch(lib, /options\.allowNonWindows === true && typeof options\.testRceditRunner/);
});

test('platform exclusions are explicit and are never counted as killed mutations', () => {
  const installed = source('tests/wp7/installed-application-probe-entry-integration.test.js');
  assert.match(installed, /Git 100755 and 100644 modes[\s\S]*skip: process\.platform === 'win32'/);
  assert.match(installed, /Electron unixMode[\s\S]*skip: process\.platform === 'win32'/);

  const matrix = source('tools/wp7/convergence-correction-matrix.js');
  assert.doesNotMatch(matrix, /status: 'KILLED'[^\n]*NOT_APPLICABLE/);
  assert.match(matrix, /const notApplicable = results\.filter\(\(row\) => row\.status === 'NOT_APPLICABLE'\)\.length/);
  assert.match(matrix, /\n    notApplicable,/);
  assert.match(matrix, /!\['KILLED', 'NOT_APPLICABLE'\]\.includes\(row\.status\)/);
});



test('Windows acceptance harness consumes only controlled-builder output and fails closed on BLOCKED evidence', () => {
  const harness = source('tools/wp-windows/acceptance-harness.js');
  assert.match(harness, /provide --installer-exe from the controlled Windows Final Builder/);
  assert.match(harness, /expectedName = `\$\{RELEASE_SOURCE\.installerBaseName\}-\$\{RELEASE_SOURCE\.publicVersion\}-x64\.exe`/);
  assert.doesNotMatch(harness, /run\(CFG\.makensis|makensis unavailable|CFG\.nsisScript/);
  assert.match(harness, /process\.exit\(failed > 0 \|\| blocked > 0 \? 1 : 0\)/);
});

test('preview runner runtime verifier invocation and parameter contract remain aligned', () => {
  const runner = source('tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1');
  const verifier = source('tools/windows/VERIFY_RUNTIME_IDENTITY.ps1');
  const invocation = runner.match(/& \$verifyScript([^\r\n]+)/)?.[1] || '';
  const switches = [...invocation.matchAll(/-(Expected[A-Za-z0-9]+)/g)].map((match) => match[1]);
  assert.ok(switches.length >= 5, 'runner must bind Commit, Tree, Electron, executable path and launched process ID');
  for (const name of switches) assert.match(verifier, new RegExp(`\\$${name}\\b`), `verifier is missing -${name}`);
  assert.match(invocation, /-ExpectedExecutablePath \$uatExe/);
  assert.match(invocation, /-ExpectedProcessId \$uatProcess\.Id/);
  assert.match(verifier, /GetFullPath\(\$ExpectedExecutablePath\)/);
  assert.match(verifier, /Equals\(\$expectedExecutableFullPath, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(verifier, /\$mainCandidates[\s\S]*ProcessId -eq \$ExpectedProcessId/);
  assert.doesNotMatch(verifier, /222e36fc6ff1733c84274f414365dbb920551efb|a9ecce12d13bb978ae40ee47a686ffce2d8611a1/);

  const pkg = JSON.parse(source('package.json'));
  assert.match(String(pkg.scripts?.['test:wp7:installed-probes'] || ''), /windows-harness-horizontal-closure\.test\.js/);
});
