'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(ROOT, 'electron/mediaBrainRuntime.js');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Media runtime is a thin real upstream adapter for Immich and ComfyUI', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'electron/mediaBrainRuntime.js must exist');
  const source = fs.readFileSync(runtimePath, 'utf8');

  for (const method of [
    'health',
    'importAsset',
    'searchAssets',
    'listPeople',
    'listAlbums',
    'getAssetPreview',
    'uploadWorkflowInput',
    'queueWorkflow',
    'getWorkflowHistory',
    'getWorkflowOutput',
    'saveWorkflowOutputToImmich'
  ]) {
    assert.match(source, new RegExp(method, 'u'), `${method} must be part of the Media runtime contract`);
  }

  assert.match(source, /fetch|net\.request|http\.request|https\.request/u, 'runtime must call real upstream HTTP APIs');
  assert.doesNotMatch(source, /sqlite|better-sqlite3|CREATE TABLE|face.*model|embedding.*index|custom.*scheduler/iu, 'runtime must not recreate OSS authority');
});

test('ComfyUI generated or edited output is saved back to Immich before it is projected as a selectable asset', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'Media runtime must exist');
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /saveWorkflowOutputToImmich/u);
  assert.match(source, /IMMICH_SAVE_BACK_REQUIRED/u);
  assert.match(source, /COMFYUI_OUTPUT_NOT_IMPORTED/u);
});

test('Media workflows are pinned templates rather than a Yance execution engine', () => {
  for (const file of [
    'config/comfyui-workflows/v21-media-generate.json',
    'config/comfyui-workflows/v21-media-edit.json'
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);
    const workflow = JSON.parse(read(file));
    assert.equal(workflow.schemaVersion, 1);
    assert.equal(workflow.executor, 'comfyui');
  }
});
