'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Home exposes one generic Conversation entry that converges on the existing continue path', () => {
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
  assert.match(people, /onOpenConversationWorkspace:\s*\(\) => void/u);
  assert.match(people, /className="yance-home-primary"/u);
  assert.match(people, /<strong>继续对话<\/strong>/u);
  assert.match(people, /homePrimaryRelationship && homePrimaryConversation\) onContinueConversation\(homePrimaryRelationship, homePrimaryConversation\)/u);
  assert.match(people, /else onOpenConversationWorkspace\(\)/u);
});

test('Conversation presentation intent can open an empty workspace without fabricating a room id', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /conversationWorkspaceRequested,\s*setConversationWorkspaceRequested/u);
  assert.match(shell, /conversationSurfaceActive\s*=\s*Boolean\([\s\S]{0,220}conversationWorkspaceRequested/u);
  assert.match(shell, /data-conversation-surface-active=\{!settingsVisible && session\.conversationNavigationPending \? "true" : undefined\}/u);
  assert.match(shell, /data-conversation-presentation-active=\{!settingsVisible && conversationSurfaceActive \? "true" : undefined\}/u);
  const styles = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  const compact = styles.slice(styles.indexOf('/* YANCE_COMPACT_CONVERSATION_WORKSPACE_20260927 */'));
  assert.match(compact, /data-conversation-presentation-active="true"[\s\S]{0,180}padding-left:\s*0\s*!important/u);
  assert.doesNotMatch(shell, /setSelectedConversationId\([^)]*conversationWorkspaceRequested/u);
});

test('Conversation hides the single global rail and exposes a compact return-home control', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /!conversationSurfaceActive\s*\?\s*<nav className="yance-desktop-rail"/u);
  assert.equal((shell.match(/className="yance-desktop-rail"/gu) || []).length, 1);
  assert.match(shell, /onReturnHome:\s*\(\) => void/u);
  assert.match(shell, /aria-label="返回首页"[\s\S]{0,180}onReturnHome/u);
  assert.match(shell, /aria-label="返回首页"[\s\S]{0,180}<span>首页<\/span>/u);
});

test('returning Home changes Product presentation without clearing mature conversation identity', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /const returnToHomeFromConversation = \(\): void => \{[\s\S]{0,260}setConversationWorkspaceRequested\(false\)/u);
  const blockStart = shell.indexOf('const returnToHomeFromConversation');
  const blockEnd = shell.indexOf('\n  };', blockStart);
  const block = shell.slice(blockStart, blockEnd);
  assert.doesNotMatch(block, /activeMatrixRoomId\s*=|selectedConversationId\s*=|clear.*Conversation|reset.*Session/iu);
  assert.match(shell, /onReturnHome=\{returnToHomeFromConversation\}/u);
});

test('Home presentation owns rail current state even when mature relationship selection remains', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /aria-current=\{homeSurfaceActive \? "page" : undefined\}/u);
  assert.match(shell, /aria-current=\{!settingsVisible && !homeSurfaceActive && !conversationSurfaceActive && Boolean\(selectedRelationship\) \? "page" : undefined\}/u);
});
