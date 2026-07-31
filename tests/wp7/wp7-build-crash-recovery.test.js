'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {assertSessionSealed}=require('../../tools/wp7/lib');const {temp,expectReason}=require('./helpers');
test('wp7-build-crash-recovery.test',()=>{const d=temp('wp7-partial-');fs.writeFileSync(path.join(d,'partial.bin'),'x');expectReason(assert,()=>assertSessionSealed(d),'WP7_PARTIAL_BUILD_REUSE_DENIED');});
