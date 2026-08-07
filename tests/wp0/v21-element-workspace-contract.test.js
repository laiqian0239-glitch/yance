'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 workspace file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function patchedPaths(patchText) {
  return [...patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)]
    .map(match => {
      assert.equal(match[1], match[2], 'Element patch may not rename upstream files');
      return match[1];
    })
    .sort();
}

test('Yance workspace is an Element runtime module built by the Element monorepo', () => {
  const pkg = readJson('integration/element-module/package.json');
  assert.equal(pkg.name, '@yance/element-module');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.dependencies['@element-hq/element-web-module-api']);
  assert.ok(pkg.peerDependencies.react || pkg.dependencies.react);

  const project = readJson('integration/element-module/project.json');
  assert.equal(project.name, 'yance-element-module');
  assert.equal(typeof project.targets.build, 'object');
  assert.match(readText('integration/element-module/vite.config.ts'), /vite/u);
  assert.match(readText('integration/element-module/tsconfig.json'), /jsx/u);
});

test('the official module owns Yance UI while the minimal patch only adds the missing global right-panel slot', () => {
  const entry = readText('integration/element-module/src/index.tsx');
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(entry, /registerGlobalRightPanel/u);
  assert.match(entry, /YanceWorkspace/u);
  assert.match(workspace, /data-yance-workspace/u);
  for (const capability of ['AI', 'Goal', 'Contact', 'Presence']) {
    assert.match(workspace, new RegExp(capability, 'u'));
  }
  for (const forbidden of ['stopClient', 'logout(', 'client.stop', 'sync.stop', 'mautrix.stop']) {
    assert.equal(workspace.includes(forbidden), false, `hiding/rendering Yance workspace must not control runtime: ${forbidden}`);
  }

  const patchText = readText('upstream-patches/element-web/0001-yance-global-right-workspace.patch');
  assert.deepEqual(patchedPaths(patchText), [
    'apps/web/src/components/structures/RightPanel.tsx',
    'apps/web/src/modules/customComponentApi.ts',
    'packages/module-api/element-web-module-api.api.md',
    'packages/module-api/src/api/custom-components.ts'
  ]);
  assert.match(patchText, /registerGlobalRightPanel/u);
  assert.match(patchText, /globalRightPanelRenderer/u);
  assert.doesNotMatch(patchText, /matrix-js-sdk\/src\/sync|stopClient|logout\(/u);
  assert.match(
    patchText,
    /diff --git a\/packages\/module-api\/element-web-module-api\.api\.md b\/packages\/module-api\/element-web-module-api\.api\.md\nindex 6557e89ac2949b6d6b46f991ebb4d64085f74d35\.\.bc4d73cc52e516be949a6a756d9e7227055c9ad4 100644\nGIT binary patch/u,
    'generated Element API report must replay the exact frozen CRLF blob with a Git binary patch'
  );
});

test('the right workspace remains inside the unified Element shell and is restoreable after hiding', () => {
  const entry = readText('integration/element-module/src/index.tsx');
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(entry, /addRoomHeaderButtonCallback/u);
  assert.match(entry, /openGlobalRightPanel/u);
  assert.match(workspace, /aria-label=.*Yance|Yance Workspace/u);
  assert.match(workspace, /localStorage|sessionStorage/u);
  assert.match(workspace, /yance\.workspace/u);
  assert.doesNotMatch(workspace, /WhatsAppPage|TelegramPage|SignalPage|FacebookPage|InstagramPage/u);
});

test('Electron boots the unified local Element shell instead of the legacy hand-built conversation page', () => {
  const main = readText('electron/main.js');
  assert.match(main, /YANCE_ELEMENT_URL/u);
  assert.match(main, /YANCE_ELEMENT_HEALTH_URL/u);
  assert.match(main, /loadURL\(.*element/iu);
  assert.doesNotMatch(main, /LOCAL_FRONTEND_URL/u);
  assert.doesNotMatch(main, /frontend[\\/]index\.html/u);
});
