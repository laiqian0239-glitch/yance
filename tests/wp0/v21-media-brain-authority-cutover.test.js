'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const descriptorPath = path.join(ROOT, 'config/upstreams/v21-media-brain-p0.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('Media P0 binds the approved Immich and ComfyUI pins as the only product authorities', () => {
  assert.equal(fs.existsSync(descriptorPath), true, 'config/upstreams/v21-media-brain-p0.json must exist');
  const descriptor = readJson(descriptorPath);

  assert.equal(descriptor.workPackage, 'V21-MEDIA-BRAIN-P0-V1');
  assert.deepEqual(descriptor.authority, {
    assetLibrary: 'immich',
    imageWorkflow: 'comfyui',
    send: 'existing-yance-send-media-stream'
  });

  assert.equal(descriptor.upstreams?.immich?.version, 'v3.1.0');
  assert.equal(descriptor.upstreams?.immich?.commit, '8aa95c67470a02a8ddedf03c2e52963af33065ff');
  assert.equal(descriptor.upstreams?.immich?.license, 'AGPL-3.0');
  assert.equal(descriptor.upstreams?.comfyui?.version, 'v0.31.0');
  assert.equal(descriptor.upstreams?.comfyui?.commit, '43cb4fffc89bba20ab7bd61467a36d0339338dab');
  assert.equal(descriptor.upstreams?.comfyui?.license, 'GPL-3.0');

  assert.equal(descriptor.boundaries?.parallelAssetCatalogForbidden, true);
  assert.equal(descriptor.boundaries?.parallelSearchOrPeopleIndexForbidden, true);
  assert.equal(descriptor.boundaries?.parallelImageExecutorForbidden, true);
  assert.equal(descriptor.boundaries?.newCredentialStoreForbidden, true);
});

test('Media P0 preserves local-first privacy and requires ComfyUI outputs to return through Immich', () => {
  assert.equal(fs.existsSync(descriptorPath), true, 'Media upstream descriptor must exist');
  const descriptor = readJson(descriptorPath);
  assert.equal(descriptor.network?.defaultEndpointPolicy, 'LOOPBACK_ONLY');
  assert.equal(descriptor.network?.externalEndpointRequiresExplicitConfiguration, true);
  assert.deepEqual(descriptor.productFlow, [
    'IMMICH_ASSET',
    'COMFYUI_WORKFLOW',
    'IMMICH_SAVE_BACK',
    'YANCE_PREVIEW_SELECT_SEND'
  ]);
});
