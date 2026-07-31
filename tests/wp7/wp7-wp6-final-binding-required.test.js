'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {assertWp6Binding,WP6_ACCEPTED_HEAD,WP6_ACCEPTED_TREE}=require('../../tools/wp7/lib');
test('wp7-wp6-final-binding-required.test',()=>{const r=assertWp6Binding();assert.equal(r.wp6AcceptedHead,WP6_ACCEPTED_HEAD);assert.equal(r.wp6AcceptedTree,WP6_ACCEPTED_TREE);});
