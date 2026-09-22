const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');

function loadRouteHelpers() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const start = source.indexOf('function canonicalPlatformChatId');
  const end = source.indexOf('function matrixDirectRelationship', start);
  assert.ok(start >= 0 && end > start, 'route helper block must remain extractable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-product-route-'));
  const tsPath = path.join(dir, 'route.ts');
  const outDir = path.join(dir, 'out');
  fs.writeFileSync(tsPath, `type ConversationRef = any;\n${source.slice(start, end)}\nexport { canonicalPlatformChatId, directRouteKey };`, 'utf8');
  const tsc = path.join(path.dirname(require.resolve('typescript')), 'tsc.js');
  execFileSync(process.execPath, [tsc, tsPath, '--target', 'es2022', '--module', 'commonjs', '--skipLibCheck', '--outDir', outDir]);
  return require(path.join(outDir, 'route.js'));
}
test('Telegram store and Mautrix user peer ids collapse to one Product route', () => {
  const { canonicalPlatformChatId, directRouteKey } = loadRouteHelpers();
  assert.equal(canonicalPlatformChatId('telegram', 'telegram:5990644655'), '5990644655');
  assert.equal(canonicalPlatformChatId('telegram', 'user:5990644655'), '5990644655');
  assert.equal(
    directRouteKey({ platform: 'telegram', accountId: 'te-canonical', chatJid: 'telegram:5990644655' }),
    directRouteKey({ platform: 'telegram', accountId: 'te-canonical', chatJid: 'user:5990644655' }),
  );
});
