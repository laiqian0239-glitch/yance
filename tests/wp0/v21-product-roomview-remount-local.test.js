'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(root, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx'),
  'utf8',
);

test('Conversation remounts Element RoomView whenever the resolved Matrix room changes', () => {
  assert.match(
    source,
    /className="yance-product-conversation__room-view"[\s\S]{0,120}key=\{session\.activeMatrixRoomId\}/u,
    'RoomView host must be keyed by activeMatrixRoomId because Element RoomView does not support changing rooms in place',
  );
});
