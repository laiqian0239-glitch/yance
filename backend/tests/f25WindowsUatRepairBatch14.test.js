'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectSource } = require('../../tools/runtime-delivery/select-whatsapp-auth-source');
const { prepareClone } = require('../../tools/runtime-delivery/prepare-windows-uat-data-clone');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b14-'));

function extractStylesheetHrefs(html) {
  return [...String(html).matchAll(/<link\b[^>]*>/giu)]
    .map(match => match[0])
    .filter(tag => /\brel\s*=\s*["']stylesheet["']/iu.test(tag))
    .map(tag => tag.match(/\bhref\s*=\s*["']([^"']+\.css)["']/iu)?.[1] || '')
    .filter(Boolean);
}

function writeBaseData(root, label = 'base') {
  fs.mkdirSync(path.join(root, 'store'), { recursive: true });
  fs.mkdirSync(path.join(root, 'secure'), { recursive: true });
  fs.writeFileSync(path.join(root, 'store', 'yance-r32.db'), `db-${label}`);
  fs.writeFileSync(path.join(root, 'secure', 'credentials.safe.json'), JSON.stringify({ label }));
}
function writeWhatsapp(root, account, { registered = true, usable = true, stamp = Date.now() } = {}) {
  const directory = path.join(root, 'whatsapp-auth', account);
  fs.mkdirSync(directory, { recursive: true });
  const value = { registered };
  if (usable) value.me = { id: `${account}@s.whatsapp.net` };
  const file = path.join(directory, 'creds.json');
  fs.writeFileSync(file, JSON.stringify(value));
  fs.utimesSync(file, new Date(stamp), new Date(stamp));
}

test('Batch14 selects the most complete registered WhatsApp session across normal and prior UAT roots', () => {
  const root = tempRoot();
  const normal = path.join(root, 'normal');
  const priorUat = path.join(root, 'prior-uat');
  const stale = path.join(root, 'stale');
  writeBaseData(normal, 'normal');
  writeWhatsapp(normal, 'normal-account', { registered: false, usable: true, stamp: 1000 });
  writeWhatsapp(priorUat, 'current-account', { registered: true, usable: true, stamp: 3000 });
  writeWhatsapp(stale, 'stale-account', { registered: true, usable: true, stamp: 2000 });

  const result = selectSource([normal, stale, priorUat]);
  assert.equal(result.status, 'PASS');
  assert.equal(result.selectedRoot, path.resolve(priorUat));
  assert.equal(result.selectedSummary.registeredCredentialCount, 1);
  assert.equal(result.selectedSummary.usableCredentialCount, 1);
});

test('Batch14 clone keeps Facebook/database authority from normal data and overlays WhatsApp auth from prior UAT without mutating either source', () => {
  const root = tempRoot();
  const base = path.join(root, 'base');
  const whatsapp = path.join(root, 'whatsapp-source');
  const target = path.join(root, 'target');
  writeBaseData(base, 'facebook-authority');
  writeWhatsapp(base, 'old-session', { registered: false, usable: false, stamp: 1000 });
  writeWhatsapp(whatsapp, 'connected-session', { registered: true, usable: true, stamp: 5000 });
  const baseBefore = fs.readFileSync(path.join(base, 'store', 'yance-r32.db'));
  const waBefore = fs.readFileSync(path.join(whatsapp, 'whatsapp-auth', 'connected-session', 'creds.json'));

  const receipt = prepareClone({ source: base, whatsappSource: whatsapp, target });

  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.sourceUntouched, true);
  assert.equal(receipt.whatsappSourceUntouched, true);
  assert.equal(receipt.baseFilesMatch, true);
  assert.equal(receipt.whatsappAuthMatch, true);
  assert.equal(receipt.criticalFilesMatch, true);
  assert.equal(receipt.whatsappOverlayApplied, true);
  assert.deepEqual(receipt.copiedWhatsappDirectories, ['whatsapp-auth']);
  assert.equal(fs.readFileSync(path.join(target, 'store', 'yance-r32.db'), 'utf8'), 'db-facebook-authority');
  assert.equal(fs.readFileSync(path.join(target, 'secure', 'credentials.safe.json'), 'utf8'), '{"label":"facebook-authority"}');
  assert.equal(fs.existsSync(path.join(target, 'whatsapp-auth', 'old-session', 'creds.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'whatsapp-auth', 'connected-session', 'creds.json')), true);
  assert.deepEqual(fs.readFileSync(path.join(base, 'store', 'yance-r32.db')), baseBefore);
  assert.deepEqual(fs.readFileSync(path.join(whatsapp, 'whatsapp-auth', 'connected-session', 'creds.json')), waBefore);
});

test('Batch14 production page authority removes embedded side pages and nested outer scrolling', () => {
  const index = read('frontend/index.html');
  const css = read('frontend/r32-production-workspace-layout.css');

  assert.deepEqual(
    extractStylesheetHrefs(`<link rel="stylesheet" href="/a.css"><link href='/b.css' media="all" rel="stylesheet"/>`),
    ['/a.css', '/b.css'],
    'stylesheet parsing must not depend on attribute order, quote style, or self-closing syntax'
  );
  const stylesheetOrder = extractStylesheetHrefs(index);
  const layoutIndex = stylesheetOrder.indexOf('/r32-production-workspace-layout.css');
  const authorityIndex = stylesheetOrder.indexOf('/r32-theme-authority.css');

  assert.ok(layoutIndex >= 0, 'production workspace layout stylesheet must be loaded');
  assert.ok(authorityIndex > layoutIndex, 'theme authority must load after production workspace layout');
  assert.equal(stylesheetOrder.at(-1), '/r32-theme-authority.css');
  assert.match(css, /\.sc32-summary\{[\s\S]*repeat\(7,minmax\(0,1fr\)\)/u);
  assert.match(css, /\.app\.system-center-open \.sc32-body\{[\s\S]*grid-template-columns:minmax\(0,1fr\)/u);
  assert.match(css, /\.sc32-nav\{display:flex!important/u);
  assert.match(css, /\.sr32-side\{[\s\S]*flex-direction:row!important/u);
  assert.match(css, /\.aiw30-sidebar\{[\s\S]*grid-template-columns:minmax\(205px,.75fr\) minmax\(0,2.5fr\) auto!important/u);
  assert.match(css, /\.insight29-detail-hero\{[\s\S]*z-index:2!important[\s\S]*overflow:visible!important/u);
  assert.match(css, /\.insight29-detail-scroll\{[\s\S]*z-index:1!important[\s\S]*overflow:auto!important/u);
  assert.match(css, /\.app\.account-center-open \.account-center-workspace\{[\s\S]*overflow:hidden!important/u);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/u);
});
