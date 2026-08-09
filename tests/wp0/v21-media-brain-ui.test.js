'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const workspacePath = path.join(ROOT, 'integration/element-module/src/MediaWorkspace.tsx');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Media is a visible top-level Yance capability with real runtime-backed actions', () => {
  assert.equal(fs.existsSync(workspacePath), true, 'MediaWorkspace.tsx must exist');
  const yance = read('integration/element-module/src/YanceWorkspace.tsx');
  const workspace = fs.readFileSync(workspacePath, 'utf8');

  assert.match(yance, /Media/u);
  for (const label of [
    'Import',
    'Search',
    'People',
    'Albums',
    'Generate',
    'Edit',
    'Preview',
    'Save back',
    'Send'
  ]) assert.match(workspace, new RegExp(label, 'iu'), `${label} action must be visible`);

  assert.match(workspace, /health|searchAssets|listPeople|listAlbums|queueWorkflow|saveWorkflowOutputToImmich|send/iu);
  assert.match(workspace, /missing model|degraded|unavailable/iu, 'upstream missing/degraded state must be visible');
});

test('Desktop preload and IPC manifest expose the Media runtime without creating a second send authority', () => {
  const preload = read('electron/preload.js');
  const manifest = JSON.parse(read('electron/m2/ipcManifest.json'));
  const manifestText = JSON.stringify(manifest);

  for (const token of [
    'getMediaBrainHealth',
    'importMediaAsset',
    'searchMediaAssets',
    'listMediaPeople',
    'listMediaAlbums',
    'queueMediaWorkflow',
    'getMediaWorkflowResult',
    'saveMediaWorkflowOutput'
  ]) {
    assert.match(preload, new RegExp(token, 'u'), `${token} must be exposed by preload`);
    assert.match(manifestText, /media-brain/u, 'Media IPC channels must be declared in the manifest');
  }

  assert.doesNotMatch(preload, /createMediaSendQueue|MediaSendAuthority/u, 'existing send authority must be reused');
});
