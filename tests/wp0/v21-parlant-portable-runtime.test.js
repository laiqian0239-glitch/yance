'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PARLANT_COMMIT = '61bba3b2b3fffd677d345e393e8c942dbd400297';
const PARLANT_UV_LOCK_BLOB = 'aa2f7de8e858f19296df58efec56d72c8d3f50a5';
const UV_COMMIT = '507230998c9541d67814b57463ac00e454ff6991';
const UV_ASSET = 'uv-x86_64-pc-windows-msvc.zip';
const UV_SHA256 = 'b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e';
const PYTHON_BUILD_STANDALONE_COMMIT = '00c8a06113f11220667c3bcf5fab1672ff9e78ef';
const PYTHON_ASSET = 'cpython-3.12.13+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz';
const PYTHON_SHA256 = '18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d';

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing Parlant portable runtime file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('portable sealing pins every downloadable runtime input by exact version, commit, size and SHA-256', () => {
  const lock = readJson('config/upstreams/v21-parlant-p0.json');
  assert.equal(lock.upstreams.parlant.commit, PARLANT_COMMIT);
  assert.equal(lock.upstreams.parlant.uvLockGitBlob, PARLANT_UV_LOCK_BLOB);
  assert.equal(lock.upstreams.uv.commit, UV_COMMIT);
  assert.equal(lock.upstreams.uv.windowsX64Asset, UV_ASSET);
  assert.equal(lock.upstreams.uv.windowsX64AssetSize, 19013455);
  assert.equal(lock.upstreams.uv.windowsX64AssetSha256, UV_SHA256);
  assert.equal(lock.upstreams.pythonBuildStandalone.commit, PYTHON_BUILD_STANDALONE_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64Asset, PYTHON_ASSET);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64AssetSize, 21962247);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64AssetSha256, PYTHON_SHA256);
});

test('Windows sealing script verifies exact assets and Parlant lock before materializing dependencies', () => {
  const script = readText('tools/parlant/build-windows-runtime.ps1');
  for (const required of [
    PARLANT_COMMIT,
    PARLANT_UV_LOCK_BLOB,
    UV_COMMIT,
    UV_ASSET,
    UV_SHA256,
    PYTHON_BUILD_STANDALONE_COMMIT,
    PYTHON_ASSET,
    PYTHON_SHA256,
    'Get-FileHash',
    'SHA256',
    'uv.lock',
    '--frozen'
  ]) assert.ok(script.includes(required), `portable sealing script must bind ${required}`);

  assert.match(script, /git\s+(?:checkout|switch|reset)[^\n]*61bba3b2b3fffd677d345e393e8c942dbd400297|git[^\n]*61bba3b2b3fffd677d345e393e8c942dbd400297/iu);
  assert.match(script, /rev-parse[^\n]*HEAD|Get-FileHash/iu);
  assert.doesNotMatch(script, /--no-verify|continue\s*on\s*error|SilentlyContinue[^\n]*(?:hash|sha)/iu, 'hash and provenance failures must be fail-closed');
});

test('shipped Parlant runtime excludes build resolvers and mutable source-control state', () => {
  const script = readText('tools/parlant/build-windows-runtime.ps1');
  assert.match(script, /Remove-Item[^\n]*(?:uv\.exe|\.git|cache)|runtime[^\n]*(?:uv\.exe|\.git)/iu, 'build tooling/source metadata must be excluded from the shipped runtime');
  assert.match(script, /yance_parlant_server\.py/u);
  assert.match(script, /generate_runtime_sbom\.py/u);
  assert.doesNotMatch(readText('electron/parlantRelationshipRuntime.js'), /\buv(?:\.exe)?\b|\bpip(?:\.exe)?\b|git\s+clone/iu, 'application runtime must never invoke dependency/build tools');
});

test('runtime SBOM generator is deterministic CycloneDX 1.7 and records the sealed authorities', () => {
  const source = readText('runtime/parlant/generate_runtime_sbom.py');
  for (const required of ['CycloneDX', '1.7', PARLANT_COMMIT, UV_COMMIT, PYTHON_BUILD_STANDALONE_COMMIT, '3.12.13']) {
    assert.ok(source.includes(required), `runtime SBOM must bind ${required}`);
  }
  assert.match(source, /sort_keys\s*=\s*True/u);
  assert.match(source, /separators\s*=|json\.dumps/u);
  assert.doesNotMatch(source, /datetime\.now|time\.time|uuid\.uuid4/iu, 'SBOM output must not contain nondeterministic timestamps/identifiers');
});

test('Windows workflow performs build-time sealing and a network-independent runtime health/import closure', () => {
  const workflow = readText('.github/workflows/v21-parlant-p0-windows.yml');
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /build-windows-runtime\.ps1/u);
  assert.match(workflow, /PARLANT_DATA_COLLECTION/u);
  assert.match(workflow, /false/u);
  assert.match(workflow, /healthz|health/u);
  assert.match(workflow, /yance_parlant_server|parlant/iu);
  assert.match(workflow, /offline|network/iu, 'workflow must make the offline closure explicit');
  assert.doesNotMatch(workflow, /OPENROUTER_API_KEY:\s*\$\{\{\s*secrets\./u, 'portable health closure must not require a provider secret');
});

test('portable runtime startup is self-contained and rooted under Yance application data', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const server = readText('runtime/parlant/yance_parlant_server.py');
  assert.match(runtime, /process\.resourcesPath|resourcesPath/u);
  assert.match(runtime, /parlant-runtime/u);
  assert.match(runtime, /YANCE_PARLANT_DATA_ROOT/u);
  assert.match(server, /YANCE_PARLANT_DATA_ROOT/u);
  assert.match(server, /127\.0\.0\.1/u);
  assert.doesNotMatch(server, /0\.0\.0\.0/u);
});
