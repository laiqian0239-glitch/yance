'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const ROOT=path.resolve(__dirname,'../..'),p=x=>path.join(ROOT,...x.split('/')),read=x=>{assert.equal(fs.existsSync(p(x)),true,`missing ${x}`);return fs.readFileSync(p(x),'utf8')};
test('descriptor pins exact MIT LiteLLM base SDK source and lock',()=>{const s=read('config/upstreams/v21-model-brain-p0.json');for(const x of ['v1.95.0','72a4a55f43ea7266de589f005d0d33624fe5d555','cb54d17e6ce0a0ad98c992f9642957faa998bbca','08d10667fb1fde67211a74ad1d4c747c0fb84cf3','MIT','enterprise','proxy'])assert.match(s,new RegExp(x.replaceAll('.','\\.'),'iu'));});
test('worker uses upstream Router/ComplexityRouter with strict AND tags and no Yance scorer',()=>{const w=read('runtime/model-brain/yance_litellm_worker.py');assert.match(w,/from\s+litellm\s+import\s+Router|litellm\.Router/u);assert.match(w,/ComplexityRouter/u);assert.match(w,/enable_tag_filtering\s*=\s*True|["']enable_tag_filtering["']\s*:\s*True/u);assert.match(w,/tag_filtering_match_any\s*=\s*False|["']tag_filtering_match_any["']\s*:\s*False/u);assert.doesNotMatch(w,/familyQuality|qualityTier|roleScore|rankForRole|selectionScore|preferredRoute|frontierCandidate|def\s+(?:rank|score)_provider/iu);});
test('persistent child keeps provider secrets on private stdio only',()=>{const r=read('backend/services/modelBrainRuntime.js'),w=read('runtime/model-brain/yance_litellm_worker.py'),s=r+'\n'+w;assert.match(r,/stdin|stdio/iu);assert.match(r,/JSON\.stringify|NDJSON|newline/iu);assert.doesNotMatch(r,/OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|apiKey\s*:\s*process\.env/iu);assert.doesNotMatch(s,/console\.log\([^\n]*(?:apiKey|token|secret)|print\([^\n]*(?:api_key|token|secret)/iu);assert.match(w,/api_key|credential/iu);});
test('sealed Windows runtime excludes runtime resolution and open-core proxy/enterprise',()=>{const r=read('backend/services/modelBrainRuntime.js')+read('runtime/model-brain/yance_litellm_worker.py'),b=read('tools/model-brain/build-windows-runtime.ps1'),s=read('runtime/model-brain/generate_runtime_sbom.py'),w=read('.github/workflows/v21-model-brain-p0-windows.yml');assert.doesNotMatch(r,/\b(?:pip|uv)\s+(?:install|sync)|git\s+clone|curl\s+http|Invoke-WebRequest/iu);assert.doesNotMatch(b,/(?:pip|uv)[^\n]*(?:litellm\[proxy\]|litellm-enterprise|litellm-proxy-extras)/iu);assert.match(b,/uv\.lock|08d10667fb1fde67211a74ad1d4c747c0fb84cf3/iu);assert.match(b,/--no-dev/iu);assert.match(b,/--no-emit-workspace/iu);assert.match(b,/--no-emit-project/iu);assert.doesNotMatch(b,/--no-install-workspace/iu);assert.doesNotMatch(b,/--no-install-project/iu);assert.doesNotMatch(b,/--no-group\s+dev/iu);assert.match(s,/CycloneDX|cyclonedx/iu);assert.match(s,/1\.7/u);assert.match(w,/windows-latest/iu);assert.match(w,/Router|ComplexityRouter|tag_filtering/iu);assert.match(w,/offline|proxy|network/iu);});
test('cloud vision qualification performs a real multimodal Model Brain call',()=>{const e=read('backend/services/modelExecutor.js');assert.match(e,/data:image\/png;base64/iu);assert.match(e,/YANCE_VISION_OK/u);assert.match(e,/modelBrainRuntime\.execute\s*\(/u);assert.match(e,/image_url|image_url/iu);assert.doesNotMatch(e,/vision:\s*testVision\s*\?\s*result\s*:/u);});

test('persistent worker preserves LiteLLM Router cooldown and health authority across requests',()=>{const w=read('runtime/model-brain/yance_litellm_worker.py');assert.match(w,/_ROUTER_CACHE/u);assert.match(w,/def\s+_router_cache_key\s*\(/u);assert.match(w,/cached\s*=\s*_ROUTER_CACHE\.get\(/u);assert.match(w,/_ROUTER_CACHE_LIMIT/u);});
test('current Model Brain surfaces preserve projected hard-capability facts',()=>{const {modelBrainSnapshot}=require('../../backend/services/runtimeArtifactBootstrapService');const snap=modelBrainSnapshot({read:()=>({models:[{id:'vision-local',name:'vision-local',provider:'ollama',endpoint:'http://127.0.0.1:11434',qualification:'verified',allowedTasks:['quick_reply'],modalities:['vision'],languages:['de'],contextLength:131072}]})});const row=snap.models[0];assert.deepEqual(row.modalities,['text','vision']);assert.deepEqual(row.languages,['de']);assert.equal(row.contextLength,131072);assert.deepEqual(row.privacy,['local']);const s=read('backend/services/systemCenterService.js');for(const x of ['modalities','language','context','privacy'])assert.match(s,new RegExp(`capabilities\\.${x}`,'u'));});

test('runtime child inherits only safe OS bootstrap environment and never provider secrets',()=>{
  const os=require('node:os'),events=require('node:events');
  const {ModelBrainRuntime}=require('../../backend/services/modelBrainRuntime');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yance-model-brain-env-'));
  const executable=path.join(dir,'python.exe'),worker=path.join(dir,'worker.py');
  fs.writeFileSync(executable,'');fs.writeFileSync(worker,'');
  const previousSystemRoot=process.env.SystemRoot,previousKey=process.env.OPENAI_API_KEY;
  process.env.SystemRoot='C:\\Windows';process.env.OPENAI_API_KEY='must-not-leak';
  let options;
  const child=new events.EventEmitter();child.killed=false;
  child.stdout=Object.assign(new events.EventEmitter(),{setEncoding(){}});
  child.stderr=Object.assign(new events.EventEmitter(),{setEncoding(){}});
  child.stdin={write(){},end(){}};child.kill=()=>{};
  try {
    const runtime=new ModelBrainRuntime({executable:()=>executable,worker:()=>worker,spawn(_cmd,_args,value){options=value;return child;}});
    runtime.ensureChild();
    assert.equal(options.env.SystemRoot,'C:\\Windows');
    assert.equal(options.env.OPENAI_API_KEY,undefined);
    assert.equal(options.env.PATH,path.dirname(executable));
  } finally {
    if(previousSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=previousSystemRoot;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
