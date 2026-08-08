'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const repositoryPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing Graphiti portable runtime file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}
const readJson = relativePath => JSON.parse(readText(relativePath));

test('Windows sealing verifies every external artifact and the Neo4j first-party checksum before extraction', () => {
  const script = readText('tools/graphiti/build-windows-runtime.ps1');
  const lock = readJson('config/upstreams/v21-graphiti-p0.json');
  assert.match(script, /neo4j-community-2026\.07\.1-windows\.zip\.sha256/u);
  assert.match(script, /d70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162/u);
  assert.match(script, /Get-FileHash[^\n]+SHA256/iu);
  assert.match(script, /GRAPHITI_NEO4J_CHECKSUM_MISMATCH/u);
  assert.match(script, /GRAPHITI_FIRST_PARTY_CHECKSUM_MISMATCH/u);
  assert.match(script, /871ec1a85fbcfc80b3919f4178818301981e43e2/u, 'exact upstream uv.lock blob must be verified');
  assert.match(script, /8ed8dbab39eec12d213076a5d8c937245ba065ed/u, 'exact upstream pyproject.toml blob must be verified');
  assert.equal(lock.upstreams.graphiti.uvLockGitBlob, '871ec1a85fbcfc80b3919f4178818301981e43e2');
  assert.equal(lock.upstreams.graphiti.pyprojectGitBlob, '8ed8dbab39eec12d213076a5d8c937245ba065ed');
  assert.equal(lock.upstreams.neo4jCommunity.allowedArtifactHosts.includes('dist.neo4j.org'), true);
});

test('portable runtime contains sealed Python, Graphiti source lock, Java, Neo4j and deterministic SBOM without runtime installers', () => {
  const script = readText('tools/graphiti/build-windows-runtime.ps1');
  const sbom = readText('runtime/graphiti/generate_runtime_sbom.py');
  for (const marker of ['python.exe', 'neo4j.bat', 'java.exe', 'yance_graphiti_server.py', 'runtime-sbom.cdx.json', 'runtime-seal.json']) {
    assert.match(script, new RegExp(marker.replace('.', '\\.'), 'u'));
  }
  assert.match(script, /uv\s+sync|uv\.exe[^\n]+sync/iu);
  assert.match(script, /--frozen/u);
  assert.match(script, /--offline/u);
  assert.doesNotMatch(script, /pip\s+install/iu);
  assert.match(sbom, /CycloneDX|cyclonedx/iu);
  assert.match(sbom, /specVersion['"]?\s*:\s*['"]1\.7['"]/u);
  assert.match(sbom, /sort_keys=True/u);
  assert.match(sbom, /871ec1a85fbcfc80b3919f4178818301981e43e2/u, 'SBOM must bind the exact Graphiti uv.lock Git blob');
  assert.match(sbom, /8ed8dbab39eec12d213076a5d8c937245ba065ed/u, 'SBOM must bind the exact Graphiti pyproject.toml Git blob');
  assert.match(sbom, /graphiti-pyproject-git-blob/u);
});

test('Windows Graphiti version probe avoids PowerShell native -c quote loss', () => {
  const script = readText('tools/graphiti/build-windows-runtime.ps1');
  assert.equal(
    script.includes("-c 'import importlib.metadata; print(importlib.metadata.version(\"graphiti-core\"))'"),
    false,
    'embedded quoted Python -c version probes are not stable across Windows PowerShell native argument marshalling'
  );
  assert.match(script, /graphiti-version-probe\.py/u);
  assert.match(script, /importlib\.metadata\.version/u);
  assert.match(script, /\$GraphitiVersionProbe\s*=\s*Join-Path\s+\$WorkRoot\s+['"]graphiti-version-probe\.py['"]/iu);
  assert.equal(script.includes("Invoke-Checked $VenvPython @('-I', $GraphitiVersionProbe, $GraphitiVersionOutput) 'probe installed graphiti-core version'"), true);
});

test('Windows workflow performs build-time online materialization then a network-isolated authenticated runtime closure', () => {
  const workflow = readText('.github/workflows/v21-graphiti-p0-windows.yml');
  assert.match(workflow, /windows-2025|windows-latest/u);
  assert.match(workflow, /build-windows-runtime\.ps1/u);
  assert.match(workflow, /neo4j-community-2026\.07\.1-windows\.zip/u);
  assert.match(workflow, /d70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162/u);
  assert.match(workflow, /127\.0\.0\.1:18766/u);
  assert.match(workflow, /YANCE_GRAPHITI_LOOPBACK_TOKEN/u);
  assert.match(workflow, /YANCE_GRAPHITI_NEO4J_PASSWORD/u);
  assert.match(workflow, /HTTP_PROXY|HTTPS_PROXY|ALL_PROXY/u);
  assert.match(workflow, /Test-NetConnection[^\n]+127\.0\.0\.1[^\n]+17687/iu, 'workflow must wait for the Neo4j Bolt listener before launching Graphiti');
  assert.match(workflow, /node --test tests\/wp0\/v21-graphiti-p0\.test\.js/u);
});
