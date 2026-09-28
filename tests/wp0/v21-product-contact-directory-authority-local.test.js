'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('Element exposes Matrix space room summaries so invite-only contacts do not require Room materialization', () => {
  const contract = read('services/matrix/.runtime/element-web/packages/module-api/src/api/client.ts');
  const implementation = read('services/matrix/.runtime/element-web/apps/web/src/modules/ClientApi.ts');
  assert.match(contract, /SpaceHierarchyRoomSummary/u);
  assert.match(contract, /getSpaceHierarchyRooms:\s*\(spaceRoomId: string\) => Promise<SpaceHierarchyRoomSummary\[\]>/u);
  assert.match(implementation, /getSpaceHierarchyRooms\(spaceRoomId: string\)/u);
  assert.match(implementation, /roomId:\s*String\(room\.room_id/u);
  assert.match(implementation, /name:\s*String\(room\.name/u);
  const summarySeam = between(implementation, 'getSpaceHierarchyRooms(spaceRoomId: string)', 'getSpaceHierarchyRoomIds(spaceRoomId: string)');
  assert.doesNotMatch(summarySeam, /joinRoom/u,
    'directory enumeration must stay read-only; only selecting a contact may join its exact room');
});

test('People enumerates mature Matrix space summaries without auto-joining every contact', () => {
  const index = read('integration/element-module/src/index.tsx');
  const loader = between(index, 'const loadMatrixDirectRooms', 'const runConversationNavigation');

  assert.match(loader, /clientApi\.getSpaceHierarchyRooms\(spaceRoom\)/u);
  assert.match(loader, /hierarchySummariesByRoomId/u);
  assert.match(loader, /ownerByRoomId\.set\(roomId, nextOwner\)/u);
  assert.match(loader, /roomById\.get\(roomId\) \|\| clientApi\.getRoom\(roomId\)/u);
  assert.match(loader, /else if \(summary\)[\s\S]*projections\.set\(roomId/u,
    'an invite-only child must remain visible even when Element has not materialized a Room object');
  assert.match(loader, /if \(!owner && !chatJid\) return/u,
    'a space-owned invited room may project without readable m.bridge route state');
  assert.doesNotMatch(loader, /ensureRoomJoined\?\.\(roomId\)/u,
    'enumerating contacts must not join every invited direct room');
});

test('People keeps invite-only contacts by exact Matrix room identity without requiring a route id', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /roomIdentity/u,
    'directory merge needs exact room identity when an invite has no readable m.bridge state yet');
  assert.match(shell, /matrixRoomId/u);
});

test('opening an invite-only Product contact joins in background and never navigates through raw Element room UI', () => {
  const index = read('integration/element-module/src/index.tsx');
  const activate = between(index, 'const activateCanonicalConversation', 'const activateProductConversation');
  assert.match(activate, /explicitMatrixRoomId[\s\S]*ensureRoomJoined\?\.\(explicitMatrixRoomId\)/u,
    'an existing invited room must be joined directly instead of provisioning a second room');
  assert.doesNotMatch(activate, /navigationApi\.openRoom/u,
    'Product navigation must stay on Yance while mature Element joins the exact room in background');
  assert.match(activate, /navigationApi\.navigateToLocation\?\.\("yance"\)/u);
});


test('persistent Element patch carries the hierarchy summary public seam used by Product', () => {
  const patch = read('upstream-patches/element-web/0021-yance-space-hierarchy-summary.patch');
  assert.match(patch, /SpaceHierarchyRoomSummary/u);
  assert.match(patch, /getSpaceHierarchyRooms\(spaceRoomId: string\)/u);
  assert.match(patch, /getSpaceHierarchyRooms:\s*\(spaceRoomId: string\) => Promise<SpaceHierarchyRoomSummary\[\]>/u);
  assert.match(patch, /roomId:\s*String\(room\.room_id/u);
  assert.match(patch, /name:\s*String\(room\.name/u);
  assert.match(patch, /return \(await this\.getSpaceHierarchyRooms\(spaceRoomId\)\)\.map/u,
    'legacy room-id seam must delegate to the mature hierarchy summary seam');
  const bootstrap = read('tools/matrix/bootstrap.js');
  assert.match(bootstrap, /SPACE_HIERARCHY_SUMMARY_PATCH/u);
  assert.match(bootstrap, /applyPatch\(element, SPACE_HIERARCHY_SUMMARY_PATCH/u,
    'persistent hierarchy-summary patch must remain in the Element materialization sequence');
});


test('Home can mount People immediately after clearing the selected relationship', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /<AnimatePresence initial=\{false\}>\s*\{!selectedRelationship \? \(/u,
    'People/Relationship scene switching must not wait on a stale RelationshipWorld exit before mounting People');
});
