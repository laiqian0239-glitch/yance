'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const world = () => read('integration/element-module/src/product-experience/RelationshipWorld.tsx');
const people = () => read('integration/element-module/src/product-experience/PeopleSurface.tsx');
const settings = () => read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
const css = () => read('integration/element-module/src/product-experience/ProductExperienceShell.css');

test('Product primary composition defaults to People or Relationship, never inline Settings workbench', () => {
  const source = shell();
  assert.match(source, /const \[settingsVisible, setSettingsVisible\] = useState\(false\)/u);
  assert.match(source, /aria-label="言策主导航"/u);
  assert.match(source, /aria-controls="yance-secondary-settings"/u);
  assert.match(source, /settingsVisible \? \([\s\S]*id="yance-secondary-settings"/u);
  assert.match(source, /!settingsVisible \? \([\s\S]*<AnimatePresence/u);
  assert.doesNotMatch(source, /<details[\s\S]{0,120}className="yance-experience-settings"/u);
});
test('Relationship World keeps real conversation primary and advanced workbench behind one closed disclosure', () => {
  const source = world();
  assert.match(source, /className="yance-relationship-conversations yance-relationship-primary"/u);
  assert.match(source, /<details className="yance-relationship-details">/u);
  assert.match(source, /<summary>[\s\S]{0,120}关系详情/u);
  assert.match(source, /aria-label="今天想聊什么"/u);
  assert.match(source, /aria-label="今日回顾"/u);
  assert.match(source, /aria-label="人物设定"/u);
  assert.match(source, /aria-label="关系数据"/u);
  assert.doesNotMatch(source, /<details className="yance-relationship-details"\s+open/u);
  assert.match(source, /真实对话/u);
});

test('People Home exposes a styled filtered-empty state instead of a blank lane', () => {
  const source = people();
  assert.match(source, /visibleRelationships\.length/u);
  assert.match(source, /当前筛选下暂无关系/u);
  assert.match(source, /className="yance-people-filter"/u);
});

test('System and account controls use progressive disclosure inside the secondary Settings destination', () => {
  const source = settings();
  for (const label of ['账户与安全', '运行安全与恢复', '桌面行为', '外观主题', '通知与声音', '数据保护', '关于言策']) {
    assert.match(source, new RegExp(`<summary>${label}</summary>`, 'u'));
  }
  assert.match(shell(), /<PlatformAccountsSurface \/>/u);
  assert.match(shell(), /learningAdminVisible \? <LearningWorkspace \/> : null/u);
  assert.match(shell(), /modelSupportVisible &&/u);
});
test('Mature Element conversation composer and post-login security remain the only physical owners', () => {
  const entry = read('integration/element-module/src/index.tsx');
  const composerPatch = read('upstream-patches/element-web/0016-yance-composer-accessory-slot.patch');
  const conversationPatch = read('upstream-patches/element-web/0017-yance-product-conversation-control.patch');
  const securityPatch = read('upstream-patches/element-web/0018-yance-post-login-security-shell.patch');
  assert.match(entry, /registerComposerAccessory/u);
  assert.doesNotMatch(entry, /createMessageComposer|replaceComposer|new\s+Composer/u);
  assert.match(composerPatch, /mx_MessageComposer_row/u);
  assert.match(conversationPatch, /productConversationMode/u);
  assert.match(conversationPatch, /PageTypes\.HomePage \|\| this\.props\.page_type === "yance"/u);
  assert.match(securityPatch, /renderPostLoginSecurity/u);
  assert.match(securityPatch, /return originalComponent\(props\)/u);
  assert.match(securityPatch, /yance-product-security-toast/u);
  assert.match(securityPatch, /yance-product-security-toast-container/u);
  assert.match(securityPatch, /yance-product-security-dialog/u);
  assert.match(css(), /\.yance-product-security-toast-container/u);
  assert.match(css(), /\.yance-product-security-dialog/u);
  assert.doesNotMatch(css(), /\.mx_[A-Za-z0-9_-]*/u);
});

test('Product Final presentation explicitly covers focus, reduced motion and compact geometry', () => {
  const styles = css();
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(styles, /\.yance-secondary-settings/u);
  assert.match(styles, /\.yance-relationship-details/u);
  assert.match(styles, /@media \(max-width: 620px\)/u);
});
