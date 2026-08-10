'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PRODUCT_SENTINEL = 'integration/element-module/src/product-experience/ProductExperienceShell.tsx';

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

function hasProductExperienceLayout() {
  return fs.existsSync(repositoryPath(PRODUCT_SENTINEL));
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

  if (hasProductExperienceLayout()) {
    const shell = readText(PRODUCT_SENTINEL);
    assert.match(workspace, /ProductExperienceShell/u, 'YanceWorkspace must stay a thin Product Experience composition root');
    assert.match(shell, /data-yance-workspace/u, 'ProductExperienceShell must own the Yance workspace identity');
    assert.match(shell, /aria-label=["']Yance Living Relationship OS["']/u, 'ProductExperienceShell must expose an accessible Yance label');
    for (const authority of ['PeopleSurface', 'RelationshipAssistant', 'RelationshipOverlayHost']) {
      assert.match(shell, new RegExp(authority, 'u'), `ProductExperienceShell must compose ${authority}`);
    }
    for (const forbidden of ['stopClient', 'logout(', 'client.stop', 'sync.stop', 'mautrix.stop']) {
      assert.equal((workspace + shell).includes(forbidden), false, `hiding/rendering Yance workspace must not control runtime: ${forbidden}`);
    }
  } else {
    assert.match(workspace, /data-yance-workspace/u);
    for (const capability of ['AI', 'Goal', 'Contact', 'Presence']) {
      assert.match(workspace, new RegExp(capability, 'u'));
    }
    for (const forbidden of ['stopClient', 'logout(', 'client.stop', 'sync.stop', 'mautrix.stop']) {
      assert.equal(workspace.includes(forbidden), false, `hiding/rendering Yance workspace must not control runtime: ${forbidden}`);
    }
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

  if (hasProductExperienceLayout()) {
    const shell = readText(PRODUCT_SENTINEL);
    const preferences = readText('integration/element-module/src/product-experience/experiencePreferences.ts');
    assert.match(workspace, /ProductExperienceShell/u);
    assert.match(shell, /aria-label=["']Yance Living Relationship OS["']/u);
    assert.match(shell, /data-yance-workspace/u);
    assert.match(preferences, /localStorage\.getItem/u);
    assert.match(preferences, /localStorage\.setItem/u);
    for (const key of [
      'yance.product-experience.sound',
      'yance.product-experience.motion',
      'yance.product-experience.atmosphere'
    ]) assert.match(preferences, new RegExp(key.replaceAll('.', '\\.'), 'u'));
    assert.doesNotMatch(preferences, /goal|parlant|journey|contactId|message|relationshipId/iu, 'Product persistence must stay limited to experience preferences');
    assert.doesNotMatch(shell, /WhatsAppPage|TelegramPage|SignalPage|FacebookPage|InstagramPage/u);
  } else {
    assert.match(workspace, /aria-label=.*Yance|Yance Workspace/u);
    assert.match(workspace, /localStorage|sessionStorage/u);
    assert.match(workspace, /yance\.workspace/u);
    assert.doesNotMatch(workspace, /WhatsAppPage|TelegramPage|SignalPage|FacebookPage|InstagramPage/u);
  }
});

test('Electron boots the unified local Element shell instead of the legacy hand-built conversation page', () => {
  const main = readText('electron/main.js');
  assert.match(main, /YANCE_ELEMENT_URL/u);
  assert.match(main, /YANCE_ELEMENT_HEALTH_URL/u);
  assert.match(main, /loadURL\(.*element/iu);
  assert.doesNotMatch(main, /LOCAL_FRONTEND_URL/u);
  assert.doesNotMatch(main, /frontend[\\/]index\.html/u);
});

test('Yance Element module is delivered through the official Element /modules runtime path', () => {
  const runtimePatch = readText('upstream-patches/element-web/0012-yance-element-module-runtime.patch');
  assert.deepEqual(patchedPaths(runtimePatch), ['apps/web/Dockerfile']);
  assert.match(runtimePatch, /RUN pnpm exec nx build yance-element-module/u);
  assert.match(runtimePatch, /COPY --from=builder \/src\/modules\/yance\/package\.json \/modules\/yance\/package\.json/u);
  assert.match(runtimePatch, /COPY --from=builder \/src\/modules\/yance\/lib \/modules\/yance\/lib/u);
  assert.doesNotMatch(runtimePatch, /build_config\.yaml|apps\/web\/src\/vector\/init\.tsx|config\/matrix\/element-config\.json|@matrix-org\/react-sdk-module-api/u);

  const bootstrap = readText('tools/matrix/bootstrap.js');
  const moduleCopy = "fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });";
  const checkRuntimePatch = "run(element, 'git', ['apply', '--check', RUNTIME_PATCH]);";
  const applyRuntimePatch = "run(element, 'git', ['apply', RUNTIME_PATCH]);";
  const moduleCopyIndex = bootstrap.indexOf(moduleCopy);
  const runtimeCheckIndex = bootstrap.indexOf(checkRuntimePatch);
  const runtimeApplyIndex = bootstrap.indexOf(applyRuntimePatch);
  assert.ok(moduleCopyIndex >= 0, 'bootstrap must copy Yance module into pinned Element workspace');
  assert.ok(runtimeCheckIndex > moduleCopyIndex, '0012 replay check must run only after module workspace copy');
  assert.ok(runtimeApplyIndex > runtimeCheckIndex, '0012 runtime patch must apply only after its replay check');
});
