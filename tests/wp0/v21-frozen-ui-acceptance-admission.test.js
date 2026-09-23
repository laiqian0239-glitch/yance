"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const guard = read("tools/product-experience/frozen-acceptance-admission.js");
const agents = read("AGENTS.md");
const pkg = JSON.parse(read("package.json"));

test("frozen UI acceptance has canonical repository entrypoints", () => {
  assert.equal(
    pkg.scripts["admit:ui-acceptance:runtime"],
    "node tools/product-experience/frozen-acceptance-admission.js runtime",
  );
  assert.equal(
    pkg.scripts["admit:ui-acceptance:build"],
    "node tools/product-experience/frozen-acceptance-admission.js build",
  );
  assert.equal(
    pkg.scripts["reload:ui-acceptance:safe"],
    "node tools/product-experience/frozen-acceptance-admission.js reload",
  );
});

test("acceptance guard cannot mutate Docker lifecycle or install toolchains", () => {
  assert.doesNotMatch(guard, /run\("docker", \["build"/u);
  assert.doesNotMatch(guard, /run\("docker", \["compose"/u);
  assert.doesNotMatch(guard, /run\("docker", \["restart"/u);
  assert.doesNotMatch(guard, /run\("docker", \["stop"/u);
  assert.doesNotMatch(guard, /\b(?:npm|pnpm)\s+install\b/u);
  assert.doesNotMatch(guard, /corepack\s+enable/u);
});
test("runtime admission proves frozen owner/session/materialization before acceptance", () => {
  assert.ok(guard.includes('fetchJson(backendUrl + "/api/health", readyTimeoutMs)'));
  assert.match(guard, /health\?\.readiness\?\.ready !== true/u);
  assert.match(guard, /health\?\.runtimeMode !== "production"/u);
  assert.match(guard, /ELEMENT_HOMESERVER_ORIGIN_DRIFT/u);
  assert.match(guard, /ACCEPTANCE_RUNTIME_CONTAINER_BOUNDARY_INCOMPLETE/u);
  assert.match(guard, /ACCEPTANCE_MATERIALIZED_MOUNTS_INCOMPLETE/u);
  assert.match(guard, /YANCE_MATERIALIZED_LIB_IDENTITY_DRIFT/u);
  assert.match(guard, /ACCEPTANCE_LOGIN_ROUTE_FORBIDDEN/u);
  assert.match(
    guard,
    /last\.productShell && !last\.personalAccess && last\.userId && last\.deviceId/u,
  );
  assert.match(guard, /ACCEPTANCE_CONVERSATION_GEOMETRY_NOT_READY/u);
  assert.match(guard, /conversationRailCount === 1/u);
  assert.match(guard, /outerRailCount === 0/u);
  assert.match(guard, /conversationWorkspaceHeight >= Math\.max\(320, last\.viewportHeight \* 0\.75\)/u);
  assert.match(guard, /conversationPeopleHeight >= Math\.max\(180, last\.viewportHeight \* 0\.35\)/u);
  assert.match(guard, /conversationRoomHeight >= Math\.max\(240, last\.viewportHeight \* 0\.55\)/u);
  assert.match(guard, /ACCEPTANCE_CONVERSATION_PRESENTATION_NOT_READY/u);
  assert.match(guard, /conversationPresentation === true/u);
  assert.match(guard, /conversationIdentityCard === true/u);
  assert.match(guard, /conversationInspectorTabCount === 4/u);
  assert.match(guard, /conversationPaneToggleCount === 2/u);
  assert.match(guard, /conversationRichReplyToolCount === 4/u);
  assert.match(guard, /conversationComposerPresent === true/u);
  assert.match(guard, /conversationNewRoomIntroCount === 0/u);
  assert.match(guard, /conversationCryptoEventCount === 0/u);
  assert.match(guard, /conversationSystemSummaryCount === 0/u);
  assert.match(guard, /ACCEPTANCE_CONVERSATION_SYSTEM_CHROME_VISIBLE/u);
  assert.match(guard, /ACCEPTANCE_AUTHENTICATED_MEDIA_PATH_NOT_READY/u);
  assert.match(guard, /serviceWorkerControlled/u);
  assert.match(guard, /ACCEPTANCE_CONTACT_AVATAR_PROJECTION_NOT_READY/u);
  assert.match(guard, /conversationFacebookRowCount >= 3/u);
  assert.match(guard, /conversationFacebookAvatarImageCount === last\.conversationFacebookRowCount/u);
  assert.match(guard, /conversationFacebookAvatarImageCount !== last\.conversationFacebookRowCount/u);
  assert.match(guard, /img\.complete===true&&img\.naturalWidth>0&&img\.naturalHeight>0/u);
  assert.match(guard, /style\.display!=="none"&&style\.visibility!=="hidden"&&Number\(style\.opacity\)>0/u);
  assert.match(guard, /conversationFacebookAvatarLoadedVisibleCount === last\.conversationFacebookRowCount/u);
  assert.match(guard, /conversationFacebookAvatarLoadedVisibleCount !== last\.conversationFacebookRowCount/u);
});

test("build admission resolves mature toolchain before build starts", () => {
  assert.match(guard, /ROOT_PACKAGE_MANAGER_DRIFT/u);
  assert.match(guard, /ROOT_COREPACK_NPM_UNAVAILABLE/u);
  assert.match(guard, /ROOT_NPM_VERSION_DRIFT/u);
  assert.match(guard, /cmd\.exe/u);
  assert.match(guard, /corepack npm --version/u);
  assert.match(guard, /corepack pnpm --version/u);
  assert.match(guard, /COREPACK_PNPM_UNAVAILABLE/u);
  assert.match(guard, /ELEMENT_PNPM_VERSION_DRIFT/u);
  assert.match(guard, /ELEMENT_SH_UNAVAILABLE/u);
  assert.match(guard, /ELEMENT_NX_NOT_MATERIALIZED/u);
  const buildBody = guard.match(/if \(mode === "build"\) \{([\s\S]*?)\n  \}/u)?.[1] || "";
  assert.match(buildBody, /await runtimeBoundaryAdmission\(\)/u);
  assert.doesNotMatch(buildBody, /runtimeAdmission|waitForReady|openCdp/u);
});

test("safe reload is admission gated on both sides of renderer reload", () => {
  const reloadBody = guard.match(/async function safeReload\(\) \{([\s\S]*?)\n\}/u)?.[1] || "";
  const boundaryIndex = reloadBody.indexOf("await runtimeBoundaryAdmission()");
  const sessionIndex = reloadBody.indexOf("await waitForSessionReady(cdp)");
  const reloadIndex = reloadBody.indexOf('expression: "window.location.reload()"');
  const postIndex = reloadBody.indexOf("await waitForReady(cdp)");
  assert.ok(boundaryIndex >= 0, "pre-reload runtime boundary admission missing");
  assert.ok(sessionIndex > boundaryIndex, "pre-reload session admission must follow runtime boundary admission");
  assert.ok(reloadIndex > sessionIndex, "renderer reload must follow pre-session admission");
  assert.ok(postIndex > reloadIndex, "full post-reload readiness must follow reload");
  assert.doesNotMatch(reloadBody, /Page\.reload/u);
  assert.match(reloadBody, /prePage\.conversationActive && !postSession\.conversationActive/u);
  assert.match(reloadBody, /await waitForConversationActive\(cdp\)/u);
  assert.match(reloadBody, /ACCEPTANCE_CONVERSATION_RESTORE_NOT_READY/u);
  assert.match(reloadBody, /renderer_only/u);
});
test("AGENTS makes the executable admission gate non-optional across chats", () => {
  for (const marker of [
    "FROZEN_ACCEPTANCE_RUNTIME=mandatory_during_real_ui_acceptance",
    "UI_ACCEPTANCE_RUNTIME_REBUILD=forbidden_by_default",
    "ACCEPTANCE_LAUNCH_ADMISSION=mandatory_before_showing_ui_to_owner",
    "UI_ACCEPTANCE_ADMISSION_COMMAND=corepack_npm_run_admit_ui_acceptance_runtime",
    "UI_ACCEPTANCE_BUILD_ADMISSION_COMMAND=corepack_npm_run_admit_ui_acceptance_build",
    "UI_ACCEPTANCE_SAFE_RELOAD_COMMAND=corepack_npm_run_reload_ui_acceptance_safe",
    "UI_ACCEPTANCE_ROOT_PACKAGE_MANAGER=corepack_exact_packageManager",
    "AMBIENT_NPM_VERSION_IS_AUTHORITY=false",
    "UI_ACCEPTANCE_DIRECT_RENDERER_RELOAD=forbidden",
    "UI_ACCEPTANCE_TOOLCHAIN_DISCOVERY_DURING_BUILD=controller_execution_failure",
    "UI_ACCEPTANCE_TRANSIENT_AUTH_SCREEN_IS_READY=false",
  ]) {
    assert.ok(agents.includes(marker), "missing durable marker: " + marker);
  }
});
