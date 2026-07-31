(()=>{
'use strict';
// Only display/safety preferences are eligible for browser-storage migration.
// Contacts, conversations, customer profiles and AI assets are migrated by the
// backend SQLite migration pipeline and are never copied from legacy localStorage.
const legacyUiKey=['YANCE27','R28','UI','AND','SAFETY'].join('_');
const currentUiKey='yance27:r32:ui-safety';
try{
  const value=localStorage.getItem(legacyUiKey);
  if(!localStorage.getItem(currentUiKey)&&value)localStorage.setItem(currentUiKey,value);
  localStorage.removeItem(legacyUiKey);
}catch(_){/* storage may be unavailable */}
})();
