'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'assets', 'branding', 'yance', 'brand-assets-manifest.json');
const ATTRIBUTES = path.join(ROOT, '.gitattributes');

function gitAttribute(attribute, file) {
  const result = spawnSync('git', ['check-attr', attribute, '--', file], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) return '';
  const output = String(result.stdout || '').trim();
  return output.slice(output.lastIndexOf(':') + 1).trim();
}

function rootAttributeContract() {
  const contract = fs.readFileSync(ATTRIBUTES, 'utf8');
  return {
    contract,
    rootTextAutoLf: /^\* text=auto eol=lf$/m.test(contract)
  };
}

test('repository forces deterministic LF checkout for manifest-tracked text brand assets', () => {
  const { contract, rootTextAutoLf } = rootAttributeContract();
  assert.equal(rootTextAutoLf, true, 'root .gitattributes must force LF for repository text');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const textAssets = (manifest.files || []).filter((entry) => /\.svg$/i.test(entry.path));
  assert.ok(textAssets.length > 0, 'brand manifest must contain SVG assets');

  for (const entry of textAssets) {
    const textAttribute = gitAttribute('text', entry.path);
    const eolAttribute = gitAttribute('eol', entry.path);
    if (textAttribute || eolAttribute) {
      assert.equal(textAttribute, 'auto', `${entry.path} must be classified as text`);
      assert.equal(eolAttribute, 'lf', `${entry.path} must materialize with LF on Windows`);
    } else {
      assert.equal(rootTextAutoLf, true, `${entry.path} must inherit the root LF text contract in source ZIPs without .git`);
    }

    const bytes = fs.readFileSync(path.join(ROOT, entry.path));
    assert.equal(bytes.includes(0x0d), false, `${entry.path} must not contain CR bytes in the canonical tree`);
  }
});
