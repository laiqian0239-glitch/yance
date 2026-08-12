import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const packageCreator = require(path.join(repoRoot, 'tools', 'facebook', 'create-public-windows-deploy-package.js'));

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('Facebook Public Windows production package is commit-bound and uses only canonical pinned Wrangler deployment', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-facebook-public-package-'));
  try {
    const result = packageCreator.createPackage(repoRoot, tempRoot);
    const packageRoot = result.packageRoot;
    const run = read(packageRoot, 'RUN.ps1');
    const readme = read(packageRoot, 'README.txt');
    const provenance = JSON.parse(read(packageRoot, 'PROVENANCE.json'));
    const manifest = read(packageRoot, 'SHA256SUMS.txt');

    assert.equal(provenance.sourceCommit, result.sourceCommit);
    assert.equal(provenance.wranglerVersion, '4.121.0');
    assert.match(run, /wrangler@4\.121\.0/u);
    assert.match(run, /\bwhoami\b/u);
    assert.match(run, /\blogin\b/u);
    assert.match(run, /secret list --config services\/facebook-worker\/wrangler\.jsonc/u);
    assert.match(run, /required-secrets\.json/u);
    assert.match(run, /deploy --dry-run --config services\/facebook-worker\/wrangler\.jsonc/u);
    assert.match(run, /deploy --config services\/facebook-worker\/wrangler\.jsonc/u);
    assert.match(run, /verify-formal-worker\.js/u);
    assert.doesNotMatch(run, /wrangler\.deploy\.local/u);
    assert.doesNotMatch(run, /deploy-(?:avatar|page).*hotfix/iu);
    assert.doesNotMatch(run, /npm(?:\.cmd)?\s+--prefix\s+services\/facebook-worker\s+test/iu, 'sealed deploy package must not rerun repository-scoped tests');
    assert.doesNotMatch(readme, /runs Facebook Public tests/iu, 'README must describe sealed deploy behavior, not unavailable repository tests');
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', 'tests')), false, 'production package must not contain repository-only tests');
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', 'wrangler.deploy.local.jsonc')), false);
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', '.dev.vars')), false);
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', '.dev.vars.example')), true);
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', 'wrangler.jsonc')), true);
    assert.equal(fs.existsSync(path.join(packageRoot, 'services', 'facebook-worker', 'required-secrets.json')), true);
    assert.equal(fs.existsSync(path.join(packageRoot, 'tools', 'facebook', 'prepare-production-config.js')), true);
    assert.equal(fs.existsSync(path.join(packageRoot, 'tools', 'facebook', 'verify-formal-worker.js')), true);
    assert.match(manifest, /RUN\.ps1/u);
    assert.match(manifest, /services\/facebook-worker\/wrangler\.jsonc/u);
    assert.match(manifest, /services\/facebook-worker\/required-secrets\.json/u);
    assert.doesNotMatch(manifest, /services\/facebook-worker\/tests\//u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
