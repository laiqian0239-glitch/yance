(()=>{
'use strict';

const DEMO_PREFIX=/^(?:demo|mock|sample|seed)(?:[-_:]|$)/i;
const LEGACY_DATA_KEYS=[
  ['YANCE27','R26','SHARED','TIMELINE','STATE'].join('_'),
  ['YANCE27','R29','RELATIONSHIP','INSIGHTS'].join('_'),
  ['Y27','R30','AI','WORKBENCH'].join('_')
];
const ACTIVE_KEYS=[
  'yance27:r32:workspace-state',
  'yance27:r32:ai-workbench',
  'yance27:r32:relationship-insights'
];

function explicitDemo(value){
  if(!value||typeof value!=='object')return false;
  if(value.isDemo===true||value.demo===true||value.mock===true||value.seeded===true)return true;
  if(DEMO_PREFIX.test(String(value.id||'')))return true;
  if(/^(?:demo|mock|sample|seed|fixture|preview)$/i.test(String(value.source||'')))return true;
  return false;
}

function sanitize(value){
  if(Array.isArray(value))return value.filter(item=>!explicitDemo(item)).map(sanitize);
  if(!value||typeof value!=='object')return value;
  const next={};
  for(const [key,item] of Object.entries(value)){
    if(DEMO_PREFIX.test(key)||explicitDemo(item))continue;
    next[key]=sanitize(item);
  }
  return next;
}

try{
  // Old data-bearing browser states are never promoted into R32 production.
  // Authoritative migration is performed by the backend SQLite migrators.
  for(const key of LEGACY_DATA_KEYS)localStorage.removeItem(key);
  for(const key of ACTIVE_KEYS){
    const raw=localStorage.getItem(key);
    if(!raw)continue;
    try{localStorage.setItem(key,JSON.stringify(sanitize(JSON.parse(raw))))}catch(_){localStorage.removeItem(key)}
  }
}catch(_){/* localStorage may be unavailable in hardened contexts */}

window.__YANCE_RUNTIME_MODE='production';
})();
