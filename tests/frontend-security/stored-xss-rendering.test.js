'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const renderers = require('../../frontend/js/r32-contact-safe-renderers');
const { FakeDocument, walk, effectiveAttributes } = require('./fake-dom');

const payloads = {
  name: '<img src=x onerror="globalThis.pwned=1">',
  phone: '+855 " autofocus onfocus="globalThis.pwned=2',
  platform: '<svg onload=globalThis.pwned=3>WhatsApp</svg>',
  latest: '</p><script>globalThis.pwned=4</script><p>',
  note: '<iframe srcdoc="<script>globalThis.pwned=5</script>"></iframe>',
  tag: '<math href="javascript:globalThis.pwned=6">VIP</math>',
  merge: '<details open ontoggle=globalThis.pwned=7>Merge</details>'
};

function assertTreeIsInert(root) {
  const nodes = walk(root);
  const forbiddenTags = new Set(['script', 'svg', 'iframe', 'math', 'details', 'object', 'embed']);
  for (const node of nodes) {
    assert.equal(forbiddenTags.has(node.tagName), false, `unexpected parsed executable tag: ${node.tagName}`);
    for (const [name, value] of effectiveAttributes(node)) {
      assert.equal(name.startsWith('on'), false, `unexpected event handler attribute ${name}`);
      if (['src', 'href', 'poster', 'action', 'formaction'].includes(name)) {
        assert.equal(/^\s*(?:javascript|vbscript|data:text\/html):/i.test(value), false, `unsafe URL attribute: ${value}`);
      }
    }
  }
}

test('stored XSS payloads remain text across identity list, detail, notes, tags and recent message', () => {
  const document = new FakeDocument();
  const list = document.createElement('div');
  const hero = document.createElement('div');
  const grid = document.createElement('div');
  const contact = {
    id: 'contact-xss',
    name: payloads.name,
    phone: payloads.phone,
    platform: payloads.platform,
    source: payloads.platform,
    stableId: payloads.phone,
    snippet: payloads.latest,
    note: payloads.note,
    tags: [payloads.tag],
    time: '05:10',
    confidence: 88,
    unread: 4,
    pending: true,
    maintained: true,
    bound: false,
    duplicate: true,
    archived: false,
    online: true,
    system: false
  };
  const latest = { cn: payloads.latest, text: payloads.latest, side: 'in' };
  const auditRows = [{ time: '现在', title: payloads.name, detail: payloads.note }];
  const avatarResolver = () => 'javascript:globalThis.pwned=8';
  const primaryState = row => row.pending ? '待确认' : '已确认';
  const nextAction = () => payloads.merge;

  renderers.renderIdentityList(document, list, [contact], contact.id, avatarResolver, primaryState);
  renderers.renderIdentityDetail(document, hero, grid, contact, latest, auditRows, avatarResolver, primaryState, nextAction);

  assertTreeIsInert(list);
  assertTreeIsInert(hero);
  assertTreeIsInert(grid);
  assert.equal(walk(list).filter(node => node.tagName === 'img').length, 1);
  assert.equal(walk(hero).filter(node => node.tagName === 'img').length, 1);
  assert.equal(walk(list).find(node => node.tagName === 'img').attributes.has('src'), false);
  assert.equal(walk(hero).find(node => node.tagName === 'img').attributes.has('src'), false);

  const combinedText = [list.textContent, hero.textContent, grid.textContent].join('\n');
  for (const value of Object.values(payloads)) assert.equal(combinedText.includes(value), true, `payload missing from textContent: ${value}`);
});

test('merge dialog and workbench queue keep malicious names, phones and tags inert', () => {
  const document = new FakeDocument();
  const select = document.createElement('select');
  const sourceCard = document.createElement('div');
  const targetCard = document.createElement('div');
  const checklist = document.createElement('div');
  const queue = document.createElement('div');
  const source = { id: 'source', name: payloads.name, phone: payloads.phone, stableId: payloads.platform, unread: 2, tags: [payloads.tag], duplicate: true };
  const target = { id: 'target', name: payloads.merge, phone: payloads.phone, stableId: payloads.platform, unread: 3, tags: [payloads.tag], duplicate: false };

  renderers.renderMergeOptions(document, select, [target], target.id);
  renderers.renderMergeCard(document, sourceCard, source);
  renderers.renderMergeCard(document, targetCard, target);
  renderers.renderMergeChecklist(document, checklist, target.name);
  renderers.renderWorkbenchQueue(document, queue, [source, target], source.id);

  for (const root of [select, sourceCard, targetCard, checklist, queue]) assertTreeIsInert(root);
  const combinedText = [select, sourceCard, targetCard, checklist, queue].map(node => node.textContent).join('\n');
  for (const key of ['name', 'phone', 'platform', 'tag', 'merge']) assert.equal(combinedText.includes(payloads[key]), true);
});
