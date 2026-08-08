'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const readText = rel => { const p = path.join(ROOT, ...rel.split('/')); assert.equal(fs.existsSync(p), true, `missing Parlant portable file: ${rel}`); return fs.readFileSync(p,'utf8'); };
const readJson = rel => JSON.parse(readText(rel));
const PARLANT_COMMIT='61bba3b2b3fffd677d345e393e8c942dbd400297';
const LOCK_BLOB='aa2f7de8e858f19296df58efec56d72c8d3f50a5';
const UV_COMMIT='507230998c9541d67814b57463ac00e454ff6991';
const UV_ASSET='uv-x86_64-pc-windows-msvc.zip';
const UV_SHA='b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e';
const PBS_COMMIT='00c8a06113f11220667c3bcf5fab1672ff9e78ef';
const PY_ASSET='cpython-3.12.13+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz';
const PY_SHA='18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d';

const TIKTOKEN_COMMIT='97e49cbadd500b5cc9dbb51a486f0b42e6701bee';
const TIKTOKEN_ENCODING_URL='https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken';
const TIKTOKEN_ENCODING_SHA='446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d';
const TIKTOKEN_CACHE_KEY='fb374d419588a4632f3f557e76b4b70aebbca790';

test('portable sealing pins every downloadable runtime input', () => {
  const lock=readJson('config/upstreams/v21-parlant-p0.json');
  assert.equal(lock.upstreams.parlant.commit,PARLANT_COMMIT);
  assert.equal(lock.upstreams.parlant.uvLockGitBlob,LOCK_BLOB);
  assert.equal(lock.upstreams.uv.commit,UV_COMMIT);
  assert.equal(lock.upstreams.uv.windowsX64Asset,UV_ASSET);
  assert.equal(lock.upstreams.uv.windowsX64AssetSize,19013455);
  assert.equal(lock.upstreams.uv.windowsX64AssetSha256,UV_SHA);
  assert.equal(lock.upstreams.pythonBuildStandalone.commit,PBS_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64Asset,PY_ASSET);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64AssetSize,21962247);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64AssetSha256,PY_SHA);
});


test('portable sealing pins tiktoken offline encoding provenance and MIT evidence', () => {
  const lock=readJson('config/upstreams/v21-parlant-p0.json');
  assert.equal(lock.upstreams.tiktoken.version,'0.12.0');
  assert.equal(lock.upstreams.tiktoken.commit,TIKTOKEN_COMMIT);
  assert.equal(lock.upstreams.tiktoken.license,'MIT');
  assert.equal(lock.upstreams.tiktoken.encoding,'o200k_base');
  assert.equal(lock.upstreams.tiktoken.encodingUrl,TIKTOKEN_ENCODING_URL);
  assert.equal(lock.upstreams.tiktoken.encodingSha256,TIKTOKEN_ENCODING_SHA);
  assert.equal(lock.upstreams.tiktoken.cacheKeySha1,TIKTOKEN_CACHE_KEY);
  assert.equal(lock.upstreams.tiktoken.licenseEvidence.repository,'dotnet/machinelearning');
  assert.match(lock.upstreams.tiktoken.licenseEvidence.sourcePath,/Microsoft\.ML\.Tokenizers\.Data\.O200kBase/u);
});

test('Windows sealing pre-materializes and verifies tiktoken official cache', () => {
  const s=readText('tools/parlant/build-windows-runtime.ps1');
  for (const marker of ['TIKTOKEN_CACHE_DIR','o200k_base',TIKTOKEN_ENCODING_URL,TIKTOKEN_ENCODING_SHA,TIKTOKEN_CACHE_KEY,"importlib.metadata.version(sys.argv[1])",'tiktoken.get_encoding']) assert.ok(s.includes(marker), marker);
  assert.match(s,/Assert-Sha256\s+\$TiktokenCacheFile\s+\$TiktokenEncodingSha256/u);
});

test('Parlant bridge binds a sealed tiktoken cache before Parlant imports and fails closed', () => {
  const s=readText('runtime/parlant/yance_parlant_server.py');
  const cacheBind=s.indexOf('TIKTOKEN_CACHE_DIR');
  const cacheAssert=s.indexOf('_assert_sealed_tiktoken_cache()');
  const parlantImport=s.indexOf('from parlant.');
  assert.ok(cacheBind >= 0 && cacheBind < parlantImport, 'cache env must be bound before Parlant import');
  assert.ok(cacheAssert >= 0 && cacheAssert < parlantImport, 'cache integrity must be checked before Parlant import');
  for (const marker of [TIKTOKEN_ENCODING_SHA,TIKTOKEN_CACHE_KEY,'YANCE_PARLANT_TIKTOKEN_CACHE_MISSING','YANCE_PARLANT_TIKTOKEN_CACHE_HASH_MISMATCH']) assert.ok(s.includes(marker), marker);
});

test('runtime SBOM binds the sealed o200k data component', () => {
  const s=readText('runtime/parlant/generate_runtime_sbom.py');
  for (const marker of ['o200k_base.tiktoken','"type": "data"',TIKTOKEN_ENCODING_URL,TIKTOKEN_ENCODING_SHA,TIKTOKEN_CACHE_KEY,'0.12.0']) assert.ok(s.includes(marker), marker);
});

test('Windows sealing script verifies exact assets and official Parlant lock before materialization', () => {
  const s=readText('tools/parlant/build-windows-runtime.ps1');
  for (const marker of [PARLANT_COMMIT,LOCK_BLOB,UV_COMMIT,UV_ASSET,UV_SHA,PBS_COMMIT,PY_ASSET,PY_SHA,'Get-FileHash','SHA256','uv.lock','--frozen','--no-dev','--no-editable']) assert.ok(s.includes(marker), marker);
  assert.match(s, /\$ErrorActionPreference\s*=\s*['"]Stop['"]/u, 'script must fail closed with ErrorActionPreference = Stop');
  assert.match(s, /if\s*\([^)]*-ne[^)]*\)\s*\{\s*throw/iu, 'digest comparison must throw on mismatch');
});

test('Windows Parlant version probe uses argv instead of nested native quotes', () => {
  const s=readText('tools/parlant/build-windows-runtime.ps1');
  assert.match(s,/import importlib\.metadata, sys; print\(importlib\.metadata\.version\(sys\.argv\[1\]\)\)/u);
  assert.match(s,/-c '[^']*sys\.argv\[1\][^']*' 'parlant'/u);
  assert.equal(s.includes('version(\"parlant\")'), false);
  assert.equal(s.includes("version('parlant')"), false);
});


test('Windows Parlant runtime sealing avoids .NET Core-only GetRelativePath', () => {
  const s=readText('tools/parlant/build-windows-runtime.ps1');
  assert.doesNotMatch(s, /::GetRelativePath/u, 'script must not use GetRelativePath regardless of type qualifier');
  assert.match(s,/MakeRelativeUri/u);
  assert.match(s,/UnescapeDataString/u);
});

test('shipped runtime excludes resolvers, VCS state and caches', () => {
  const s=readText('tools/parlant/build-windows-runtime.ps1');
  assert.match(s,/Remove-Item -LiteralPath \$ToolRoot[\s\S]*Remove-Item -LiteralPath \$ParlantRepo[\s\S]*Remove-Item -LiteralPath \$DownloadRoot/iu);
  assert.match(s,/yance_parlant_server\.py/u);
  assert.match(s,/generate_runtime_sbom\.py/u);
  assert.doesNotMatch(readText('electron/parlantRelationshipRuntime.js'),/\buv(?:\.exe)?\b|\bpip(?:\.exe)?\b|git\s+clone/iu);
});

test('runtime SBOM is deterministic CycloneDX 1.7 and binds sealed authorities', () => {
  const s=readText('runtime/parlant/generate_runtime_sbom.py');
  for (const marker of ['CycloneDX','1.7',PARLANT_COMMIT,UV_COMMIT,PBS_COMMIT,'3.12.13']) assert.ok(s.includes(marker));
  assert.match(s,/sort_keys\s*=\s*True/u);
  assert.doesNotMatch(s,/datetime\.now|time\.time|uuid\.uuid4/iu);
});

test('dedicated Windows workflow seals runtime and proves network-independent self-test', () => {
  const w=readText('.github/workflows/v21-parlant-p0-windows.yml');
  assert.match(w,/windows-latest/u);
  assert.match(w,/build-windows-runtime\.ps1/u);
  assert.match(w,/PARLANT_DATA_COLLECTION/u);
  assert.match(w,/offline|network/iu);
  assert.match(w,/--self-test/u);
  assert.doesNotMatch(w,/OPENROUTER_API_KEY:\s*\$\{\{\s*secrets\./u);
});

test('real WP7 application payload must carry the sealed Parlant runtime as an explicit trusted product addition', () => {
  const lib=readText('tools/wp7/lib.js');
  const trust=readText('tools/wp7/packaged-product-trust.js');
  const preReview=readText('tools/wp7/create-pre-review-trusted-product.js');
  assert.match(lib,/parlant-runtime/u, 'WP7 builder must copy the sealed Parlant runtime into application resources');
  assert.match(trust,/resources\/parlant-runtime/u, 'Electron distribution trust must explicitly authorize and hash the Parlant runtime addition');
  assert.match(preReview,/parlant-runtime/u, 'pre-review trusted product must require an explicit sealed Parlant runtime input');
});
