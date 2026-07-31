'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Security = require('../../frontend/js/r32-security');
const { FakeDocument } = require('./fake-dom');

test('HTML text and HTML attribute contexts use distinct encoders', () => {
  const payload = '"`\n<img src=x onerror=1>&';
  assert.equal(Security.escapeHtmlText(payload), '"`\n&lt;img src=x onerror=1&gt;&amp;');
  assert.equal(Security.escapeHtmlAttribute(payload), '&quot;&#96;&#10;&lt;img src=x onerror=1&gt;&amp;');
});

test('URL sanitizer rejects executable schemes and allows explicitly approved image URLs', () => {
  assert.equal(Security.sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(Security.sanitizeUrl('data:text/html,<script>alert(1)</script>', { allowDataImage: true }), '');
  assert.equal(Security.sanitizeUrl('data:image/png;base64,AA==', { allowDataImage: true }), 'data:image/png;base64,AA==');
  assert.equal(Security.sanitizeUrl('blob:https://example.test/id'), '');
  assert.equal(Security.sanitizeUrl('blob:https://example.test/id', { allowBlob: true }), 'blob:https://example.test/id');
  assert.equal(Security.sanitizeUrl('/assets/avatar.png'), '/assets/avatar.png');
  assert.equal(Security.sanitizeUrl('https://example.test/avatar.png'), 'https://example.test/avatar.png');
});

test('CSS values are constrained by type-specific sanitizers', () => {
  assert.equal(Security.sanitizeCssNumber(150, { min: 0, max: 100, unit: '%' }), '100%');
  assert.equal(Security.sanitizeCssNumber('1;position:fixed', { unit: 'px' }), '');
  assert.equal(Security.sanitizeCssColor('#0af'), '#0af');
  assert.equal(Security.sanitizeCssColor('rgba(67,234,214,.7)'), 'rgba(67,234,214,.7)');
  assert.equal(Security.sanitizeCssColor('red;position:fixed'), '');
});

test('safe DOM attribute APIs reject event, style and URL context confusion', () => {
  const document = new FakeDocument();
  const node = document.createElement('a');
  assert.throws(() => Security.setAttribute(node, 'onclick', 'alert(1)'), /Unsafe attribute name/);
  assert.throws(() => Security.setAttribute(node, 'href', 'https://example.test'), /setUrlAttribute/);
  assert.throws(() => Security.setAttribute(node, 'style', 'color:red'), /setStyleNumber/);
  assert.equal(Security.setUrlAttribute(node, 'href', 'javascript:alert(1)'), '');
  assert.equal(node.attributes.has('href'), false);
});
