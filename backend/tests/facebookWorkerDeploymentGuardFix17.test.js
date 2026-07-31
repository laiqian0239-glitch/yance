'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deploy = require('../../tools/facebook/deploy-avatar-proxy-routes');
const preflight = require('../../tools/uat/sourceUatP0Preflight');

const root = path.resolve(__dirname, '..', '..');

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('Fix17 aligns P0 and deployment guard with exact Worker v11 evidence contract', () => {
  assert.equal(preflight.EXPECTED_WORKER_AVATAR_CONTRACT, 11);
  assert.equal(preflight.EXPECTED_WORKER_EVIDENCE_CONTRACT, 6);
  assert.equal(preflight.EXPECTED_WORKER_DEPLOYMENT_MARKER, 'facebook-avatar-translation-persistence-fix13-20260724');
  assert.equal(deploy.AVATAR_CONTRACT_VERSION, 11);
  assert.equal(deploy.EVIDENCE_CONTRACT_VERSION, 6);
  assert.equal(deploy.DEPLOYMENT_MARKER, preflight.EXPECTED_WORKER_DEPLOYMENT_MARKER);
});

test('Fix17 local Worker source matches the deploy contract and contains both avatar routes', () => {
  const local = deploy.localWorkerContract();
  assert.equal(local.matchesExpected, true);
  assert.equal(local.version, 11);
  assert.equal(local.evidenceContractVersion, 6);
  assert.equal(local.pageRoute, true);
  assert.equal(local.profileRoute, true);
});

test('Worker deployment remains read-only by default and obsolete root deployment launchers are quarantined', () => {
  assert.deepEqual(deploy.parseArgs([]), { deploy: false, confirmWorker: '' });
  assert.deepEqual(deploy.parseArgs(['--deploy', '--confirm-worker', 'yance-facebook-gateway']), { deploy: true, confirmWorker: 'yance-facebook-gateway' });
  for (const file of ['DEPLOY_FACEBOOK_AVATAR_PROXY_ROUTES.ps1','DEPLOY_FACEBOOK_AVATAR_PROXY_ROUTES.cmd','DEPLOY_FACEBOOK_AVATAR_PROXY_ROUTES_CONFIRMED.cmd']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must not be a product-root executable`);
  }
});

test('Fix17 deploy verifier rejects downgrades and verifies evidence marker, not only version', () => {
  const js = source('tools/facebook/deploy-avatar-proxy-routes.js');
  assert.match(js, /FACEBOOK_AVATAR_DEPLOY_DOWNGRADE_REFUSED/);
  assert.match(js, /evidenceContractVersion === EVIDENCE_CONTRACT_VERSION/);
  assert.match(js, /deploymentMarker === DEPLOYMENT_MARKER/);
  assert.match(js, /temporaryConfig/);
  assert.doesNotMatch(js, /const AVATAR_CONTRACT_VERSION = 2/);
});
