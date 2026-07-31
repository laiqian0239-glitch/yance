'use strict';
const path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');const {acquireExclusiveLease}=require('../../tools/wp7/lib');const {temp,expectReason}=require('./helpers');
test('wp7-build-session-exclusive.test',()=>{const lease=path.join(temp('wp7-lease-'),'lock'),release=acquireExclusiveLease(lease);try{expectReason(assert,()=>acquireExclusiveLease(lease),'WP7_BUILD_SESSION_BUSY');}finally{release();}});
