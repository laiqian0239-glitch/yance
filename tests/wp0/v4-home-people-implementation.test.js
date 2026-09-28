'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PEOPLE = 'integration/element-module/src/product-experience/PeopleSurface.tsx';
const SHELL = 'integration/element-module/src/product-experience/ProductExperienceShell.tsx';
const PROJECTION = 'integration/element-module/src/product-experience/experienceProjection.ts';

test('Home/People v4 keeps Settings on the unique Global Rail while Add Contact and search stay live', () => {
  const people = read(PEOPLE);
  const shell = read(SHELL);
  const rail = shell.match(/<nav className="yance-desktop-rail"[\s\S]*?<\/nav>/u)?.[0] || '';

  assert.doesNotMatch(people, /className="yance-v4-rail"|onOpenSettings/u);
  assert.match(people, /onRefreshRelationships:\s*\(\)\s*=>\s*Promise<void>/u);
  assert.match(rail, /setSettingsVisible\(true\)[\s\S]{0,180}setSettingsSection\("general"\)[\s\S]{0,180}>设置</u);
  assert.match(people, /onClick=\{openAddContact\}[\s\S]{0,180}>[^<]*添加联系人/u);
  assert.match(people, /value=\{query\}[\s\S]{0,180}onChange=\{\(event\)\s*=>\s*setQuery\(event\.target\.value\)\}/u);
  assert.doesNotMatch(people, /搜索联系人（即将开放）|添加联系人将在 RED I|设置在当前冻结批次/u);
});
test('Home/People v4 Add Contact delegates to the mature platform-account/direct-chat seam', () => {
  const people = read(PEOPLE);
  const projection = read(PROJECTION);

  assert.match(projection, /export async function loadPlatformAccounts/u);
  assert.match(projection, /export async function runPlatformAccountCommand/u);
  assert.match(people, /loadPlatformAccounts/u);
  assert.match(people, /runPlatformAccountCommand/u);
  assert.match(people, /"provisioning-direct-chat-ensure"/u);
  assert.match(people, /authority\.toLowerCase\(\)\.startsWith\("mautrix-"\)/u);
  assert.match(people, /role="dialog"[\s\S]*aria-modal="true"/u);
  assert.match(people, /onRefreshRelationships\(\)/u);

  // The Product UI may own transient form state, never a second contact/message authority.
  assert.doesNotMatch(people, /createContact|insertContact|new\s+Room\s*\(|localStorage\.setItem\([^\n]*(?:contact|relationship)/iu);
});

test('Home/People shell keeps Settings on the unique Global Rail and refresh on People', () => {
  const shell = read(SHELL);
  const peopleMount = shell.match(/<PeopleSurface[\s\S]*?\/>/u)?.[0] || '';
  const rail = shell.match(/<nav className="yance-desktop-rail"[\s\S]*?<\/nav>/u)?.[0] || '';

  assert.doesNotMatch(peopleMount, /onOpenSettings/u);
  assert.match(rail, /setSettingsVisible\(true\)[\s\S]{0,180}setSettingsSection\("general"\)[\s\S]{0,180}>设置/u);
  assert.match(peopleMount, /onRefreshRelationships=\{refreshRelationships\}/u);
  assert.doesNotMatch(peopleMount, /onAddContact=\{\(\)\s*=>\s*\{\s*setSettingsVisible\(true\);\s*setSettingsSection\("platforms"\)/u);
});
test('Home/People v4 uses the shared desktop top bar and wires every visible top-bar action without a second Home navigation owner', () => {
  const people = read(PEOPLE);
  const shell = read(SHELL);
  assert.doesNotMatch(people, /className="yance-v4-topbar"|className="yance-v4-rail"|onOpenSettings/u);
  assert.match(shell, /className="yance-desktop-topbar yance-product-nav"/u);
  assert.match(shell, />Yance<\/strong>[\s\S]{0,180}Conversation Workspace v4/u);
  assert.match(shell, /\u9996\u9875 \u00b7 People/u);
  assert.match(shell, /\u5148\u770b\u4eba\uff0c\u518d\u8fdb\u5165\u5173\u7cfb\u4e0e\u5bf9\u8bdd/u);
  assert.match(shell, /<BilingualSearchPanel[\s\S]{0,420}onNavigateRelationship=\{navigateSearchResult\}/u);
  assert.match(shell, /aria-label="\u6253\u5f00\u8bbe\u7f6e"[\s\S]{0,260}setSettingsVisible\(true\)[\s\S]{0,180}setSettingsSection\("general"\)/u);
  assert.doesNotMatch(shell, /className="yance-desktop-topbar yance-product-nav"[\s\S]{0,1800}onClick=\{\(\)\s*=>\s*\{\s*\}\}/u);
});
