"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(
    path.join(ROOT, rel),
    "utf8",
  );
}

test("successor-v11 canonical session binds person conversation and room", () => {
  const source = read(
    "integration/element-module/src/product-experience/experienceSession.ts",
  );

  assert.match(
    source,
    /selectedConversationSessionKey/u,
  );

  assert.match(
    source,
    /selectedConversationAccountId/u,
  );

  assert.match(
    source,
    /activeMatrixRoomId/u,
  );

  assert.match(
    source,
    /bindProductConversation/u,
  );
});

test("successor-v11 generic attachment remains real Element upload input", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductComposerAccessory.tsx",
  );

  assert.match(source, /type="file"/u);
  assert.match(source, /onAttachFiles/u);

  assert.doesNotMatch(
    source,
    /requestRelationshipOverlay\("attachment"\)/u,
  );
});

test("successor-v11 bilingual projection correlates by exact identity only", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductConversationProjection.tsx",
  );

  assert.match(
    source,
    /exactMessageIdentities/u,
  );

  assert.match(
    source,
    /externalMessageId/u,
  );

  assert.doesNotMatch(
    source,
    /messageText|body\s*===|text\s*===/u,
  );
});

test("successor-v11 Product media hides engineering settings outside standalone mode", () => {
  const source = read(
    "integration/element-module/src/MediaWorkspace.tsx",
  );

  assert.match(
    source,
    /standaloneMode\s*\?\s*\(/u,
  );

  assert.match(
    source,
    /高级媒体设置/u,
  );
});

test("successor-v11 ordinary settings expose user authorities without support-model internals", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx",
  );

  assert.match(source, /账户与个人资料/u);
  assert.match(source, /安全设置/u);
  assert.match(source, /已登录设备/u);
  assert.match(source, /检查更新/u);
  assert.match(source, /重启并执行恢复/u);

  assert.doesNotMatch(
    source,
    /LiteLLM|Ollama|GPU|Model Brain|API Key|SHA-?256|LearningWorkspace/u,
  );
});

test("successor-v11 composer mode presents explicit human takeover", () => {
  const source = read(
    "integration/element-module/src/product-experience/ProductComposerAccessory.tsx",
  );

  assert.match(source, /由我回复/u);
  assert.match(source, /建议我/u);
  assert.match(source, /自动处理/u);
  assert.match(
    source,
    /setConversationAutomationMode/u,
  );
});