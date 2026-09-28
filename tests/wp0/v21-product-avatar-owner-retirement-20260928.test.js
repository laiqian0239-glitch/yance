'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Product owns no parallel avatar hydration and delegates relationship avatars to live Element rooms', () => {
  const preload = read('electron/preload.js');
  const main = read('electron/main.js');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const types = read('integration/element-module/src/product-experience/experienceTypes.ts');
  const index = read('integration/element-module/src/index.tsx');
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const world = read('integration/element-module/src/product-experience/RelationshipWorld.tsx');

  assert.doesNotMatch(preload + main + projection, /resolveProductAvatar|desktop:resolve-product-avatar|resolveProductAvatarDataUrl/u);
  assert.doesNotMatch(people + shell + world, /relationship\.avatarUrl|row\.avatarUrl/u);
  assert.match(index, /getRoom\(normalizedRoomId\)[\s\S]*builtins\.renderRoomAvatar\(normalizedRoomId, size\)/u);
  assert.match(world, /renderRelationshipAvatar\?: \(relationship: RelationshipProjection, size\?: string\) => React\.ReactNode/u);
  assert.match(shell, /<RelationshipWorld[\s\S]{0,500}renderRelationshipAvatar=\{[\s\S]{0,220}conversationRelationshipAvatar/u);

  const conversationType = types.slice(types.indexOf('export type ConversationRef'), types.indexOf('export type GroupConversationProjection'));
  const relationshipType = types.slice(types.indexOf('export type RelationshipProjection'), types.indexOf('export type WorkspaceContactSearchResult'));
  assert.doesNotMatch(conversationType, /avatarUrl/u);
  assert.doesNotMatch(relationshipType, /avatarUrl/u);
});
