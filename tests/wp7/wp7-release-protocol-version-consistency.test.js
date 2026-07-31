'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {readReleaseSource}=require('../../tools/wp7/lib');
test('wp7-release-protocol-version-consistency.test',()=>assert.equal(readReleaseSource().credentialProtocolVersion,3));
