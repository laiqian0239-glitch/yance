'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Product room avatars delegate only through a live Element room guard', () => {
  const index = read('integration/element-module/src/index.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');

  assert.match(index, /const renderLiveRoomAvatar = \(roomId: string, size\?: string\): React\.ReactNode => \{[\s\S]*this\.api\.client\.getRoom\(normalizedRoomId\)[\s\S]*this\.api\.builtins\.renderRoomAvatar\(normalizedRoomId, size\)/u);
  assert.match(index, /renderRoomAvatar=\{renderLiveRoomAvatar\}/u);
  assert.match(shell, /conversationRelationshipAvatar\(relationship, renderRoomAvatar/u);
  assert.match(people, /relationshipAvatar\(relationship, renderRoomAvatar/u);
  assert.doesNotMatch(shell + people, /try \{[\s\S]{0,180}renderRoomAvatar/u);
  assert.doesNotMatch(index + shell + people, /renderDirectRoomAvatar|renderContactAvatar|ModuleDirectRoomAvatar|matrixDirectPeerUserId|matrixPeerUserByRoomId/u);
});
