'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  verifyProductDocumentationEntries
} = require('../../tools/layered-ci/product-documentation');

const ROOT = path.resolve(__dirname, '..', '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'), 'utf8'));

function entry(filePath, overrides = {}) {
  return {
    path: filePath,
    baseMode: null,
    headMode: '100644',
    headContent: Buffer.from('# Plan\n\nReviewed implementation plan.\n', 'utf8'),
    ...overrides
  };
}

test('regular UTF-8 Markdown product plans pass without execution authority', () => {
  const result = verifyProductDocumentationEntries({
    policy,
    entries: [
      entry('docs/superpowers/plans/2026-08-04-plan.md'),
      entry('docs/superpowers/specs/2026-08-04-design.md', {
        baseMode: '100644'
      })
    ]
  });

  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, 'PRODUCT_DOCUMENTATION_WP0');
  assert.deepEqual(result.changedFiles, [
    'docs/superpowers/plans/2026-08-04-plan.md',
    'docs/superpowers/specs/2026-08-04-design.md'
  ]);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.buildAuthorized, false);
  assert.equal(result.packageAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.publishAuthorized, false);
  assert.equal(result.productionUseAuthorized, false);
  assert.equal(result.readyForPromotion, false);
});

test('regular Markdown deletion remains documentation-only and carries no content authority', () => {
  const result = verifyProductDocumentationEntries({
    policy,
    entries: [entry('docs/superpowers/plans/retired-plan.md', {
      baseMode: '100644',
      headMode: null,
      headContent: null
    })]
  });

  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.deletedFiles, 1);
  assert.equal(result.executionAuthorized, false);
});

test('executable and symbolic-link modes fail closed', () => {
  for (const headMode of ['100755', '120000']) {
    const result = verifyProductDocumentationEntries({
      policy,
      entries: [entry('docs/superpowers/plans/unsafe.md', { headMode })]
    });
    assert.equal(result.pass, false, headMode);
    assert.equal(result.reasonCode, 'WP0_PRODUCT_DOCUMENTATION_MODE_INVALID', headMode);
  }
});

test('missing blobs and duplicate changed paths fail closed', () => {
  const missing = verifyProductDocumentationEntries({
    policy,
    entries: [entry('docs/superpowers/plans/missing.md', {
      baseMode: null,
      headMode: null,
      headContent: null
    })]
  });
  assert.equal(missing.pass, false);
  assert.equal(missing.reasonCode, 'WP0_PRODUCT_DOCUMENTATION_BLOB_MISSING');

  const duplicate = verifyProductDocumentationEntries({
    policy,
    entries: [
      entry('docs/superpowers/plans/duplicate.md'),
      entry('docs/superpowers/plans/duplicate.md')
    ]
  });
  assert.equal(duplicate.pass, false);
  assert.equal(duplicate.reasonCode, 'WP0_PRODUCT_DOCUMENTATION_ENTRIES_INVALID');
});

test('non-Markdown and mixed product changes cannot use the documentation route', () => {
  for (const entries of [
    [entry('docs/superpowers/plans/executable.js')],
    [
      entry('docs/superpowers/plans/plan.md'),
      entry('backend/runtime/AppRuntime.js')
    ],
    [
      entry('docs/superpowers/plans/plan.md'),
      entry('governance/layered-ci/risk-policy.json')
    ]
  ]) {
    const result = verifyProductDocumentationEntries({ policy, entries });
    assert.equal(result.pass, false, JSON.stringify(entries.map(value => value.path)));
    assert.equal(result.reasonCode, 'WP0_PRODUCT_DOCUMENTATION_ROUTE_INVALID');
  }
});

test('invalid UTF-8, empty content, NUL and disallowed control characters fail closed', () => {
  const cases = [
    {
      content: Buffer.from([0xc3, 0x28]),
      reasonCode: 'WP0_PRODUCT_DOCUMENTATION_UTF8_INVALID'
    },
    {
      content: Buffer.from('  \n\t', 'utf8'),
      reasonCode: 'WP0_PRODUCT_DOCUMENTATION_EMPTY'
    },
    {
      content: Buffer.from('# Plan\u0000hidden', 'utf8'),
      reasonCode: 'WP0_PRODUCT_DOCUMENTATION_CONTENT_INVALID'
    },
    {
      content: Buffer.from('# Plan\u0007bell', 'utf8'),
      reasonCode: 'WP0_PRODUCT_DOCUMENTATION_CONTENT_INVALID'
    }
  ];

  for (const item of cases) {
    const result = verifyProductDocumentationEntries({
      policy,
      entries: [entry('docs/superpowers/plans/content.md', {
        headContent: item.content
      })]
    });
    assert.equal(result.pass, false, item.reasonCode);
    assert.equal(result.reasonCode, item.reasonCode);
  }
});

test('existing head blobs require exact Buffer content', () => {
  for (const headContent of [null, '# text']) {
    const result = verifyProductDocumentationEntries({
      policy,
      entries: [entry('docs/superpowers/plans/not-a-buffer.md', { headContent })]
    });
    assert.equal(result.pass, false);
    assert.equal(result.reasonCode, 'WP0_PRODUCT_DOCUMENTATION_CONTENT_MISSING');
  }
});
