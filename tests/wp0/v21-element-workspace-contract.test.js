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

  const apiReportMarker = 'diff --git a/packages/module-api/element-web-module-api.api.md b/packages/module-api/element-web-module-api.api.md';
  const apiReportStart = patchText.indexOf(apiReportMarker);
  assert.ok(apiReportStart >= 0, '0001 must patch the generated Element API report');
  const nextPatchStart = patchText.indexOf('\ndiff --git ', apiReportStart + apiReportMarker.length);
  const apiReportPatch = patchText.slice(apiReportStart, nextPatchStart === -1 ? patchText.length : nextPatchStart);

  assert.match(
    apiReportPatch,
    /^index 6557e89ac2949b6d6b46f991ebb4d64085f74d35\.\.[a-f0-9]{40} 100644$/mu,
    'generated API report textual diff must remain bound to the exact pinned Element old blob'
  );
  assert.match(apiReportPatch, /^--- a\/packages\/module-api\/element-web-module-api\.api\.md$/mu);
  assert.match(apiReportPatch, /^\+\+\+ b\/packages\/module-api\/element-web-module-api\.api\.md$/mu);
  assert.match(apiReportPatch, /^@@ /mu, 'generated API report must use an ordinary textual hunk');
  assert.doesNotMatch(apiReportPatch, /^GIT binary patch$/mu, 'generated text API report must never use a Git binary patch');
  assert.doesNotMatch(apiReportPatch, /^(?:literal|delta) \d+$/mu, 'generated text API report must not carry binary payload records');
  assert.match(apiReportPatch, /^\+    openGlobalRightPanel\(\): void;$/mu);
  assert.match(apiReportPatch, /^\+    registerGlobalRightPanel\(renderer: CustomGlobalRightPanelRenderFunction\): void;$/mu);
  assert.match(apiReportPatch, /^\+export type CustomGlobalRightPanelRenderFunction = \(\) => JSX\.Element;$/mu);
});

test('pinned Element declares its own pnpm authority before nested postinstall commands execute', () => {
  const authorityPatch = readText('upstream-patches/element-web/0002-yance-package-manager-authority.patch');
  assert.deepEqual(patchedPaths(authorityPatch), ['package.json']);
  assert.match(
    authorityPatch,
    /^index 1458c14e3e59f6fa7c948b5ffb7de4404c1cb5f5\.\.[a-f0-9]{40} 100644$/mu,
    'package-manager authority patch must remain bound to the exact pinned Element package.json old blob'
  );
  assert.match(authorityPatch, /^--- a\/package\.json$/mu);
  assert.match(authorityPatch, /^\+\+\+ b\/package\.json$/mu);
  assert.match(authorityPatch, /^@@ /mu, 'package-manager authority patch must be an ordinary textual hunk');

  const addedLines = authorityPatch.split(/\r?\n/u).filter(line => line.startsWith('+') && !line.startsWith('+++'));
  const deletedLines = authorityPatch.split(/\r?\n/u).filter(line => line.startsWith('-') && !line.startsWith('---'));
  assert.deepEqual(addedLines, ['+    "packageManager": "pnpm@11.5.2",']);
  assert.deepEqual(deletedLines, [], 'Element package-manager authority repair must not rewrite pinned manifest content');
  assert.equal(
    authorityPatch.match(/pnpm@11\.5\.2/gu)?.length ?? 0,
    1,
    'package-manager authority patch must introduce exactly one pnpm@11.5.2 authority mutation'
  );
  assert.doesNotMatch(authorityPatch, /^\+.*"(?:dependencies|devDependencies|engines|devEngines)"/mu);
  assert.doesNotMatch(authorityPatch, /COREPACK_ENABLE_STRICT|COREPACK_ENABLE_PROJECT_SPEC|COREPACK_HOME|PATH=/u);

  const bootstrap = readText('tools/matrix/bootstrap.js');
  const workspaceApply = "applyPatch(element, ELEMENT_WORKSPACE_PATCH, 'Element workspace patch');";
  const authorityApply = "applyPatch(element, ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH, 'Element package-manager authority patch');";
  const moduleCopy = "fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });";
  assert.match(
    bootstrap,
    /const ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH = path\.join\(ROOT, 'upstream-patches\/element-web\/0002-yance-package-manager-authority\.patch'\);/u
  );
  const workspaceApplyIndex = bootstrap.indexOf(workspaceApply);
  const authorityApplyIndex = bootstrap.indexOf(authorityApply);
  const moduleCopyIndex = bootstrap.indexOf(moduleCopy);
  assert.ok(workspaceApplyIndex >= 0, 'bootstrap must keep the global-right-workspace patch');
  assert.ok(authorityApplyIndex > workspaceApplyIndex, 'package-manager authority patch must replay after 0001');
  assert.ok(moduleCopyIndex > authorityApplyIndex, 'package-manager authority must be established before Product module copy and frozen install overlays');
  assert.doesNotMatch(bootstrap, /COREPACK_ENABLE_STRICT|COREPACK_ENABLE_PROJECT_SPEC|--no-frozen-lockfile|--lockfile-only/u);
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
  const checkDeliveryPatch = "run(element, 'git', ['apply', '--check', MODULE_DELIVERY_PATCH]);";
  const applyDeliveryPatch = "run(element, 'git', ['apply', MODULE_DELIVERY_PATCH]);";
  const moduleCopyIndex = bootstrap.indexOf(moduleCopy);
  const deliveryCheckIndex = bootstrap.indexOf(checkDeliveryPatch);
  const deliveryApplyIndex = bootstrap.indexOf(applyDeliveryPatch);
  assert.ok(moduleCopyIndex >= 0, 'bootstrap must copy Yance module into pinned Element workspace');
  assert.ok(deliveryCheckIndex > moduleCopyIndex, '0012 replay check must run only after module workspace copy');
  assert.ok(deliveryApplyIndex > deliveryCheckIndex, '0012 module delivery patch must apply only after its replay check');
  assert.doesNotMatch(
    bootstrap,
    /runtime[ _-]?patch/iu,
    'upstream module delivery must not be mislabeled as the forbidden legacy runtime-patch release mechanism'
  );
});
