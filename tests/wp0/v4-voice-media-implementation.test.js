'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const VOICE = path.join(ROOT, 'integration/element-module/src/VoiceWorkspace.tsx');
const MEDIA = path.join(ROOT, 'integration/element-module/src/MediaWorkspace.tsx');
const OVERLAY = path.join(ROOT, 'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('V4 settings voice/media is management-only and cannot bypass a real conversation route', () => {
  const shell = read(SHELL), voice = read(VOICE), media = read(MEDIA);
  assert.match(shell, /<VoiceWorkspace managementOnly/u);
  assert.match(shell, /<MediaWorkspace managementOnly/u);
  assert.match(voice, /managementOnly/u);
  assert.match(media, /managementOnly/u);
  assert.match(voice, /managementOnly \? false/u);
  assert.match(media, /managementOnly \? false/u);
});
test('V4 real conversation overlays retain route-bound voice/media sending', () => {
  const overlay = read(OVERLAY);
  assert.match(overlay, /<MediaWorkspace routeBinding=\{relationshipToolRoute\}/u);
  assert.match(overlay, /<VoiceWorkspace routeBinding=\{relationshipToolRoute\}/u);
});

test('V4 voice management keeps mature local profile, transcription and preview capabilities', () => {
  const voice = read(VOICE);
  for (const marker of ['录入声音','删除','转写语音文件','生成','测试声音','重新生成','预览','仅本机']) {
    assert.ok(voice.includes(marker), `missing voice capability: ${marker}`);
  }
  for (const seam of ['getVoiceBrainHealth','transcribeVoiceAudio','enrollVoiceProfile','listVoiceProfiles','deleteVoiceProfile','generateVoiceSpeech']) {
    assert.ok(voice.includes(seam), `missing mature voice seam: ${seam}`);
  }
});
test('V4 media management keeps library, people, albums, generate/edit, preview and save-back', () => {
  const media = read(MEDIA);
  for (const marker of ['媒体库','人物','相册','生成 / 编辑','提交任务','预览','保存到媒体库']) {
    assert.ok(media.includes(marker), `missing media capability: ${marker}`);
  }
  for (const seam of ['getMediaBrainHealth','importMediaAsset','searchMediaAssets','listMediaPeople','listMediaAlbums','queueMediaWorkflow','getMediaWorkflowResult','saveMediaWorkflowOutput']) {
    assert.ok(media.includes(seam), `missing mature media seam: ${seam}`);
  }
});

test('V4 management pages do not create a second send authority', () => {
  const shell = read(SHELL);
  assert.match(shell, /发送入口在此隐藏/u);
  assert.match(shell, /真实发送只能从已绑定对话进入/u);
});
