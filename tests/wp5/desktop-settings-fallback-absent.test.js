'use strict';
const assert=require('node:assert/strict'); const test=require('node:test'); const { normalize, BOOLEAN_KEYS }=require('../../shared/desktopSettings'); const schema=require('../../electron/desktopSettingsSchema');
test('safeMode is forbidden as Electron desktop persistence and absent from legacy normalized settings',()=>{assert.equal(BOOLEAN_KEYS.includes('safeMode'),false); assert.equal(Object.hasOwn(normalize({safeMode:true}),'safeMode'),false); assert.throws(()=>schema.sanitizeDesktopSettingsPatch({safeMode:true}),e=>e.reasonCode==='DESKTOP_BUSINESS_SETTING_FORBIDDEN');});
