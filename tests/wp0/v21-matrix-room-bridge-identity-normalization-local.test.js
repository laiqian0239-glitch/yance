const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_PATH = path.join(
  ROOT,
  'integration/element-module/src/product-experience/RelationshipOverlayHost.tsx',
);

function loadResolverFunctions() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('function record');
  const end = source.indexOf('function normalizedStoreRoute', start);
  assert.ok(start >= 0 && end > start, 'resolver utility block must remain extractable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-room-resolver-'));
  const tsPath = path.join(dir, 'resolver.ts');
  const outDir = path.join(dir, 'out');
  const snippet = `type ConversationRef = any;\ntype BridgeIdentity = any;\ntype ReadRoomStateEvents = any;\n${source.slice(start, end)}`;
  fs.writeFileSync(tsPath, snippet, 'utf8');
  const tsc = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  execFileSync(process.execPath, [
    tsc, tsPath, '--target', 'es2022', '--module', 'commonjs',
    '--skipLibCheck', '--outDir', outDir,
  ], { stdio: 'pipe' });
  return require(path.join(outDir, 'resolver.js'));
}
function bridgeState(receiver = '8638095739', peerId = 'user:7991006491') {
  return [{
    stateKey: 'yance.local/yance-mautrix-telegram',
    content: {
      protocol: { id: 'telegram', displayname: 'Telegram' },
      channel: {
        id: peerId,
        displayname: 'Marc Rotte',
        'fi.mau.receiver': receiver,
      },
      'com.beeper.room_type': 'dm',
      'com.beeper.room_type.v2': 'dm',
    },
  }];
}

const conversation = {
  id: 'te-b4ff7971-9187-4416-ac13-295227ebe02c:7991006491',
  sessionKey: 'te-b4ff7971-9187-4416-ac13-295227ebe02c:7991006491',
  platform: 'telegram',
  accountId: 'te-b4ff7971-9187-4416-ac13-295227ebe02c',
  chatJid: 'telegram:7991006491',
};

const marcRoomId = '!lyiCOwJAuQxvuHffmx:yance.local';
test('Telegram Product and Mautrix peer ids normalize to the same canonical chat id', () => {
  const { canonicalPlatformChatId } = loadResolverFunctions();
  assert.equal(canonicalPlatformChatId('telegram', 'telegram:7991006491'), '7991006491');
  assert.equal(canonicalPlatformChatId('telegram', 'user:7991006491'), '7991006491');
  assert.equal(canonicalPlatformChatId('telegram', '7991006491'), '7991006491');
});

test('Marc canonical conversation resolves only through the authoritative Mautrix receiver alias', () => {
  const { resolveCanonicalConversationRoom } = loadResolverFunctions();
  const readRoomStateEvents = (roomId, eventType) => (
    roomId === marcRoomId && ['m.bridge', 'uk.half-shot.bridge'].includes(eventType)
      ? bridgeState()
      : []
  );
  assert.deepEqual(
    resolveCanonicalConversationRoom(
      conversation,
      [marcRoomId],
      readRoomStateEvents,
      ['te-b4ff7971-9187-4416-ac13-295227ebe02c', '8638095739'],
    ),
    { status: 'resolved', roomId: marcRoomId },
  );
});
test('room resolution remains fail-closed for a wrong receiver or multiple matching rooms', () => {
  const { resolveCanonicalConversationRoom } = loadResolverFunctions();
  const wrongReceiver = (_roomId, eventType) => (
    ['m.bridge', 'uk.half-shot.bridge'].includes(eventType) ? bridgeState('9999999999') : []
  );
  assert.equal(
    resolveCanonicalConversationRoom(conversation, [marcRoomId], wrongReceiver, ['8638095739']).status,
    'unresolved',
  );

  const secondRoomId = '!secondMarcRoom:yance.local';
  const duplicateRooms = (_roomId, eventType) => (
    ['m.bridge', 'uk.half-shot.bridge'].includes(eventType) ? bridgeState() : []
  );
  assert.equal(
    resolveCanonicalConversationRoom(
      conversation,
      [marcRoomId, secondRoomId],
      duplicateRooms,
      ['8638095739'],
    ).status,
    'ambiguous',
  );
});
test('Element conversation navigation derives bridge receiver aliases from platform account authority', () => {
  const index = fs.readFileSync(
    path.join(ROOT, 'integration/element-module/src/index.tsx'),
    'utf8',
  );
  assert.match(index, /bridgeReceiverAliasesForAccount/u);
  assert.match(index, /listPlatformAccounts\(\{ matrixUserId \}\)/u);
  assert.match(
    index,
    /resolveCanonicalConversationRoom\([\s\S]*readRoomStateEvents,[\s\S]*bridgeReceiverAliases/u,
  );
});


test('explicit Matrix room ids are still verified against bridge peer and receiver identity', () => {
  const index = fs.readFileSync(
    path.join(ROOT, 'integration/element-module/src/index.tsx'),
    'utf8',
  );
  assert.doesNotMatch(index, /if \(explicitMatrixRoomId\)[\s\S]*resolvedRoomId = explicitMatrixRoomId/u);
  assert.match(index, /const candidateRoomIds = explicitMatrixRoomId[\s\S]*\[explicitMatrixRoomId\]/u);
  assert.match(index, /resolveCanonicalConversationRoom\([\s\S]*candidateRoomIds[\s\S]*readRoomStateEvents[\s\S]*bridgeReceiverAliases/u);
});
