
(()=>{
const $=id=>document.getElementById(id), app=$('app');
const activeContactStore=window.YanceActiveContactStore||null;
const syncStability=window.YanceSyncStability||null;
const workspaceRouteAuthority=window.YanceWorkspaceRouteAuthority||null;
const conversationRouteAuthority=window.YanceConversationRouteAuthority||null;
const replyGenerationAuthority=window.YanceReplyGenerationAuthority?.createAuthority?.()||null;
function applyWorkspaceRoute(view,source='r32-ui-runtime'){
 if(workspaceRouteAuthority?.applyRoute)return workspaceRouteAuthority.applyRoute(app,view,{source});
 const classes=['contact-page-open','profile-page-open','timeline-page-open','insights-page-open','aiwork-page-open','account-center-open','system-center-open','settings-recovery-open','theme-workspace-open'];
 app.classList.remove('immersive','contacts-hidden','ai-hidden','compact','ai-open-small',...classes);
 const routeClass={contacts:'contact-page-open',profiles:'profile-page-open',timeline:'timeline-page-open',insights:'insights-page-open','ai-workbench':'aiwork-page-open',accounts:'account-center-open',system:'system-center-open',settings:'settings-recovery-open',theme:'theme-workspace-open'}[view];
 if(routeClass)app.classList.add(routeClass);
 return {pass:true,actual:view};
}
const {escapeHtmlText:htmlText,escapeHtmlAttribute:htmlAttr,escapeUrlAttribute:urlAttr,sanitizeCssNumber,setUrlAttribute}=window.YanceSecurity;
let applyingCanonicalContact=false,lastDiagnosticSnapshot=null;
let activeId='', filter='all', pendingAvatar='', toastTimer=0, immersiveScrollTop=0, drafts={}, messageScroll={}, auditLog=[], lastMerge=null, currentView='conversation', composerOwnerId='', selectedProfile='', profileFilter='all', selectedTimeline='', timelineRange='30d', timelineFilter='all', readInFlight=new Map(),historyRequestControllers=new Map(),replyCandidateRequestControllers=new Map(),conversationContextRequestToken=0,messageRequestSequence=0,storeSocialContextRefreshTimer=0,storeSocialContextRefreshId='',messageScrollRestoreUntil=0,messageScrollUserIntentUntil=0;
const messageBottomLock={};
const historyMeta={};
const historyPerformance={messagePageSize:120,streamChunkSize:40,maxMessagesPerConversation:800,maxCachedConversations:8,inactiveConversationRetain:80};
const conversationPagingState={limit:250,nextOffset:0,hasMore:true,loading:false,lastError:''};
const conversationRefreshDiagnostics={summaryRequests:0,summaryCommits:0,summaryNoops:0,fullConversationReloads:0,mediaPatches:0,mediaPatchMisses:0,lastEventTypes:[],lastSummaryChangedAt:'',lastSummaryNoopAt:'',lastMediaPatchedAt:''};
function refreshDiagnosticsSnapshot(){return Object.freeze({...conversationRefreshDiagnostics,lastEventTypes:[...conversationRefreshDiagnostics.lastEventTypes]})}
window.YanceConversationRefreshDiagnostics=Object.freeze({snapshot:refreshDiagnosticsSnapshot});
const contacts=[];
const histories={};
const runtimeAccounts=[];
const lastGoodConversationRoutes=new Map();
const candidateBase=[];
let candidateFailureState=null;
const replyLearningCache={};
const REPLY_PREFERENCES_KEY='yance.reply-preferences-v1';
const CONVERSATION_LAYOUT_KEY='yance.conversation-center-layout-v2';
const LEGACY_CONVERSATION_LAYOUT_KEY='yance29.conversation-center-layout-v2';
const outboundLanguageByConversation={};
function composerTextIsChinese(value){const compact=String(value||'').replace(/\s+/g,'');if(!compact)return false;const count=(compact.match(/[\u3400-\u9fff]/g)||[]).length;return count>0&&count/compact.length>=0.2}
function outboundLanguageLabel(authority={}){const code=profileText(authority.code,'unknown').toLowerCase();return {de:'德',en:'英',fr:'法',es:'西',it:'意',pt:'葡',ru:'俄',tr:'土',ar:'阿',zh:'中'}[code]||profileText(authority.labelZh,authority.name,code==='unknown'?'?':code)}
function updateComposerTranslationIndicator(){
 const host=$('composerTranslationChip'),title=$('composerTranslationTitle'),detail=$('composerTranslationDetail'),contact=activeContactById(activeId),text=$('composerText')?.value||'',record=outboundLanguageByConversation[activeId]||{},authority=record.authority||{};
 if(!host||!title||!detail)return;host.dataset.state='idle';host.title='中文输入将自动翻译，只向对方发送目标语言；原文保留在本机审计。';
 if(!contact){title.textContent='中 → 自动';detail.textContent='选择会话后识别目标语言';host.dataset.state='disabled';return}
 if(authority.verifiable!==true||!authority.code||authority.code==='unknown'){title.textContent=composerTextIsChinese(text)?'中 → 待确认':'原文';detail.textContent=composerTextIsChinese(text)?'目标语言待确认，已阻止直接发送中文':'目标语言待确认';host.dataset.state=composerTextIsChinese(text)?'error':'idle';return}
 const label=outboundLanguageLabel(authority);
 if(!composerTextIsChinese(text)){title.textContent=`原文 → ${label}`;detail.textContent='当前输入无需翻译';return}
 if(authority.code==='zh'){title.textContent='中 → 中';detail.textContent='当前联系人语言为中文';host.dataset.state='active';return}
 title.textContent=`中 → ${label}`;detail.textContent=`自动翻译后仅发送${label}语`;host.dataset.state='active';
}
async function loadOutboundLanguage(id=activeId){
 if(!id)return null;try{const result=await apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(id)}/outbound-language`);outboundLanguageByConversation[id]=result;if(id===activeId)updateComposerTranslationIndicator();return result}catch(error){outboundLanguageByConversation[id]={ok:false,authority:{code:'unknown',verifiable:false},error:profileText(error.message,'目标语言识别失败')};if(id===activeId)updateComposerTranslationIndicator();return null}
}
function readConversationLayoutState(){
 try{const current=localStorage.getItem(CONVERSATION_LAYOUT_KEY),legacy=current?null:localStorage.getItem(LEGACY_CONVERSATION_LAYOUT_KEY);if(!current&&legacy)localStorage.setItem(CONVERSATION_LAYOUT_KEY,legacy);const saved=JSON.parse(current||legacy||'{}');return {navMode:['expanded','compact','hidden'].includes(saved.navMode)?saved.navMode:(innerWidth>=1640?'expanded':'compact'),contactMode:['normal','compact','hidden'].includes(saved.contactMode)?saved.contactMode:'normal',aiVisible:saved.aiVisible!==false,translationMode:['both','original','translation'].includes(saved.translationMode)?saved.translationMode:'both'}}catch(_){return {navMode:innerWidth>=1640?'expanded':'compact',contactMode:'normal',aiVisible:true,translationMode:'both'}}
}
let conversationLayoutState=readConversationLayoutState(),aiOverlayOpen=false,lastOverlayMode=innerWidth<1360;
function writeConversationLayoutState(){try{localStorage.setItem(CONVERSATION_LAYOUT_KEY,JSON.stringify(conversationLayoutState))}catch(_){}}
let lastAnalysis=null,lastAnalysisContactId='',analysisPhase='idle',workspacePersistTimer=0,workspaceBootstrapped=false,activeTypingSnapshot={};
const messageInteraction=window.YanceMessageInteractionRuntime||{};
const aiTaskRuntime=window.YanceAiTaskRuntime||{};
const aiTaskCoordinator=aiTaskRuntime.createCoordinator?.()||null;
const safeUiText=(value,fallback='')=>aiTaskRuntime.safeDisplayText?.(value,fallback)||((typeof value==='string'&&value.trim())?value.trim():fallback);
const runtimeErrors=window.YanceRuntimeErrors||{};
const businessPresentation=window.YanceBusinessPresentation||{};
const aiBusinessPresentation=window.YanceAiBusinessPresentation||{};
function aiSummaryLines(value,fallback='尚未执行真实分析',limit=6){return aiBusinessPresentation.summaryLines?.(value,fallback,limit)||[safeUiText(value,fallback)]}
function aiSummaryText(value,fallback='尚未执行真实分析'){return aiBusinessPresentation.summaryText?.(value,fallback)||safeUiText(value,fallback)}
function aiSummaryHtml(value,fallback='尚未执行真实分析'){return `<ul class="ai-business-summary-list">${aiSummaryLines(value,fallback).map(row=>`<li>${htmlText(row)}</li>`).join('')}</ul>`}
function businessLabel(domain,value,fallback=''){return businessPresentation.label?.(domain,value,fallback)||profileText(value,fallback)}
function businessIdentity(value,options={}){return businessPresentation.businessIdentity?.(value,options)||profileText(value,options.fallback||'身份待确认')}
function businessTechnicalDetails(record={}){return businessPresentation.technicalDetails?.(record)||Object.entries(record).filter(([,value])=>profileText(value))}
function hasDesktopSessionBridge(){return runtimeErrors.hasDesktopSessionBridge?.(window)||Boolean(window.yanceDesktop?.getState)}
function runtimeErrorCode(value){return runtimeErrors.reasonCode?.(value)||profileText(value?.reasonCode||value?.code,'')}
function userFacingRuntimeError(value,fallback='请求失败'){return runtimeErrors.userMessage?.(value,{rootObject:window,fallback})||safeUiText(value?.message||value,fallback)}
function rendererEnvironmentSnapshot(){
 const viewport=window.visualViewport;
 return {devicePixelRatio:Number(window.devicePixelRatio||1),visualViewportScale:Number(viewport?.scale||1),viewportWidth:Number(viewport?.width||window.innerWidth||0),viewportHeight:Number(viewport?.height||window.innerHeight||0),screenWidth:Number(window.screen?.width||0),screenHeight:Number(window.screen?.height||0),readingMode:document.documentElement.dataset.reading||'comfortable',density:document.documentElement.dataset.density||'comfortable'}
}
async function hydrateRuntimeEnvironment(){
 const renderer=rendererEnvironmentSnapshot();let state=null;
 try{state=await window.yanceDesktop?.getState?.()}catch(error){console.warn('[言策 runtime identity] 无法读取桌面运行身份',error)}
 const application=state?.application||{},runtime=state?.runtime||{};
 const productName=profileText(application.publicProductName||application.productName,'言策'),version=profileText(application.publicVersion||application.version,'1.0.0');
 if($('titleProductName'))$('titleProductName').textContent=productName;
 if($('titleProductVersion'))$('titleProductVersion').textContent=version;
 const host=$('titlebarProductIdentity');if(host){host.dataset.runtimeVerified=state?'true':'false';host.dataset.sourceCommit=profileText(application.sourceCommit,'');host.title=[`${productName} ${version}`,application.buildId||application.build,application.sourceCommit?`Commit ${application.sourceCommit}`:'Commit 未确认',application.sourceTree?`Tree ${application.sourceTree}`:'',runtime.electron?`Electron ${runtime.electron}`:'',`DPR ${renderer.devicePixelRatio}`,`Viewport ${Math.round(renderer.viewportWidth)}×${Math.round(renderer.viewportHeight)} @ ${renderer.visualViewportScale}`].filter(Boolean).join('\n')}
 const snapshot={application,runtime,renderer,capturedAt:new Date().toISOString()};window.YanceRuntimeEnvironment=Object.freeze(snapshot);
 console.info('[言策 runtime identity]',snapshot);
 try{await window.yanceDesktop?.reportRuntimeEnvironment?.(renderer)}catch(error){console.warn('[言策 runtime environment report]',error)}
 return snapshot
}

const invalidProfileText=new Set(['undefined','null','nan','none','[object object]','-','--']);
const internalProfileFactKeys=new Set(['profilecompleteness','profile_completeness','whatsappaccountid','whatsapp_account_id','accountid','account_id','chatjid','chat_jid','jid','lid','contactid','contact_id','externalid','external_id','sessionkey','session_key','conversationid','conversation_id','name','displayname','display_name']);
const profileFactLabels={age:'年龄',birthday:'生日',address:'地址',city:'城市',country:'国家/地区',job:'职业',occupation:'职业',languages:'语言',family:'家庭情况',stage:'关系阶段',interests:'兴趣',note:'长期备注',company:'公司',timezone:'时区'};
function profileText(...values){for(const value of values){if(Array.isArray(value)){const rows=value.map(v=>profileText(v)).filter(Boolean);if(rows.length)return rows.join('、');continue}if(value==null||typeof value==='object')continue;const text=String(value).trim();if(text&&!invalidProfileText.has(text.toLowerCase()))return text}return''}
function mergeLocalizedContent(base,overlay){if(overlay==null)return base;if(Array.isArray(base)||Array.isArray(overlay)){const left=Array.isArray(base)?base:[],right=Array.isArray(overlay)?overlay:[];return Array.from({length:Math.max(left.length,right.length)},(_,index)=>mergeLocalizedContent(left[index],right[index]))}if((base&&typeof base==='object')||(overlay&&typeof overlay==='object')){const left=base&&typeof base==='object'&&!Array.isArray(base)?base:{},right=overlay&&typeof overlay==='object'&&!Array.isArray(overlay)?overlay:{};const output={...left};Object.entries(right).forEach(([key,value])=>{output[key]=mergeLocalizedContent(left[key],value)});return output}return overlay===''?base:overlay}
function chineseFirstContent(value={}){const source=value&&typeof value==='object'?value:{},overlay=source.chineseUnderstanding&&typeof source.chineseUnderstanding==='object'?source.chineseUnderstanding:{};return mergeLocalizedContent(source,overlay)}
function profileKey(value){return profileText(value).toLowerCase().replace(/[\s.-]+/g,'_').replace(/[^a-z0-9_\u4e00-\u9fff]/g,'')}
function publicProfileKey(value){const key=profileKey(value);return key&&!internalProfileFactKeys.has(key)?key:''}
function profileLabel(key,fallback=''){const normalized=profileKey(key);return profileFactLabels[normalized]||profileText(fallback)||normalized.replace(/_/g,' ')}
function internalProfileText(value){const text=profileText(value);if(!text)return true;const match=text.match(/^([^:：=]+)[:：=]/);return Boolean(match&&internalProfileFactKeys.has(profileKey(match[1])))}
function cleanFactRows(rows,status='confirmed'){return (Array.isArray(rows)?rows:[]).map((raw,index)=>{if(raw==null)return null;if(typeof raw!=='object'){const text=profileText(raw);return text&&!internalProfileText(text)?{id:`${status}-${index}`,key:'',title:'客户事实',text,source:'客户档案',status}:null}const rawKey=raw.key??raw.factKey??raw.fact_key??raw.field??raw.fieldKey??raw.field_key;const key=publicProfileKey(rawKey);if(rawKey&&!key)return null;const value=profileText(raw.value??raw.factValue??raw.fact_value??raw.fieldValue??raw.field_value);let text=profileText(raw.text??raw.fact??raw.content??raw.summary);if(text&&internalProfileText(text))return null;if(!text&&key&&value)text=`${profileLabel(key,raw.label??raw.title)}：${value}`;if(!text)return null;const title=profileLabel(key,raw.title??raw.label)||'客户事实';return {...raw,id:profileText(raw.id,`${status}-${index}`),key,title,label:title,text,value:value||text,source:profileText(raw.source,'客户档案'),status:profileText(raw.status,status),confidence:Math.max(0,Math.min(100,Number(raw.confidence)||0))}}).filter(Boolean)}
function cleanProfileObject(profile={}){const next={...defaultProfile(),...(profile||{})};next.confirmed=cleanFactRows(next.confirmed,'confirmed');next.inferences=cleanFactRows(next.inferences,'pending');next.commitments=Array.isArray(next.commitments)?next.commitments.filter(Boolean):[];next.boundaries=Array.isArray(next.boundaries)?next.boundaries.filter(Boolean):[];next.milestones=Array.isArray(next.milestones)?next.milestones.filter(Array.isArray):[];return next}
function pendingProfileReviewSummary(profile={}){const source=profile&&profile.reviewStatus==='ai-pending-review'&&profile.pendingReview&&typeof profile.pendingReview==='object'?profile.pendingReview:null;if(!source)return null;const rawProposal=source.profile&&typeof source.profile==='object'?source.profile:{},proposal=mergeLocalizedContent(rawProposal,rawProposal.payload?.chineseUnderstanding||profile.chineseUnderstanding||{});const facts=proposal.facts&&typeof proposal.facts==='object'?Object.entries(proposal.facts).map(([key,value],index)=>{const safeKey=publicProfileKey(key);const text=profileText(value);return safeKey&&text?{id:`pending-fact-${index}`,title:profileLabel(safeKey),text,source:'AI画像建议',status:'pending'}:null}).filter(Boolean):[];const confirmed=cleanFactRows(proposal.confirmedFacts||proposal.confirmed||[],'pending');const inferred=cleanFactRows(proposal.inferredFacts||proposal.inferences||[],'pending');return {...source,proposal,rows:[...facts,...confirmed,...inferred].slice(0,12),modelName:profileText(source.modelName||source.modelId,'本地/已授权模型'),createdAt:profileText(source.createdAt||source.analyzedThroughAt,''),sourceMessageCount:Number(source.sourceMessageCount||0)}}

const feedbackPreferenceLabels={replyLength:'回复长度',questionFrequency:'提问频率',emojiLevel:'表情使用',formality:'正式程度',tone:'语气风格'};
const feedbackPreferenceValues={short:'偏短',medium:'适中',long:'偏长',low:'较少',high:'较多',casual:'更口语自然',formal:'更正式礼貌',flirty:'更暧昧调情',neutral:'更中性克制'};
function feedbackPreferenceRows(profile={}){const effective=profile?.socialPreferences?.userFeedback&&typeof profile.socialPreferences.userFeedback==='object'?profile.socialPreferences.userFeedback:{};return Object.entries(effective).map(([key,row])=>{const value=profileText(row?.value);if(!value)return null;return {key,label:feedbackPreferenceLabels[key]||key,value:feedbackPreferenceValues[value]||value,confidence:Math.round(Math.max(0,Math.min(1,Number(row?.confidence||0)))*100),evidenceCount:Number(row?.evidenceCount||0),updatedAt:profileText(row?.updatedAt,'')}}).filter(Boolean)}
function cleanTrajectoryObject(trajectory={}){const next={...defaultTrajectory(),...(trajectory||{})};for(const key of ['points','events','topics','evidence'])next[key]=Array.isArray(next[key])?next[key].filter(Array.isArray):[];next.reply=profileText(next.reply,'未计算');next.stage=profileText(next.stage,'待分析');next.next=profileText(next.next,'等待真实互动与人工确认后生成建议。');next.opportunityText=profileText(next.opportunityText,'暂无可确认的推进信号。');next.riskText=profileText(next.riskText,'目前没有可确认的高风险信号。');return next}
function bilingualPresentationRowHtml(row={},options={}){const title=profileText(row.title,options.title||'关系信息'),source=profileText(row.sourceText||row.originalText||row.text,''),translated=profileText(row.translatedZh||row.translationZh,''),pending=row.translationPending===true||row.translationStatus==='pending',primary=profileText(row.displayText||translated||(source&&/[\u3400-\u9fff]/u.test(source)?source:''),pending?'中文理解待生成':profileText(source,'暂无内容')),originalVisible=Boolean(source&&source!==primary),confidence=Number(row.confidence);return `<article class="bilingual-memory-card ${htmlAttr(pending?'translation-pending':'')}"><header><div><small>${htmlText(title)}</small><b>${htmlText(primary)}</b></div><span>${htmlText(pending?'待生成中文':businessLabel('status',options.badge||row.status,businessLabel('source',row.source,'中文优先')))}</span></header>${originalVisible?`<details open><summary>外语原文</summary><p>${htmlText(source)}</p></details>`:''}<footer>${Number.isFinite(confidence)&&confidence>0?`<em>置信度 ${htmlText(Math.round(confidence*100))}%</em>`:''}<i>${htmlText(businessLabel('source',row.source,options.source||'权威原始数据'))}</i></footer></article>`}
function bilingualMemorySectionHtml(title,subtitle,rows=[],options={}){const list=Array.isArray(rows)?rows.filter(Boolean):[];return `<section class="profile27-section wide bilingual-memory-section"><header><h3>${htmlText(title)}</h3><span>${htmlText(subtitle)}</span></header><div class="profile27-body"><div class="bilingual-memory-grid">${list.length?list.map(row=>bilingualPresentationRowHtml(row,options)).join(''):`<article class="bilingual-memory-card empty"><b>暂无可展示内容</b><p>等待真实聊天、人工资料或中文理解生成。</p></article>`}</div></div></section>`}
function relationshipScalarCardHtml(label,row={}){const source=profileText(row.sourceText,''),primary=profileText(row.displayText,row.translationPending?'中文理解待生成':'暂无可确认内容'),pending=row.translationPending===true||row.translationStatus==='pending';return `<article class="relationship-bilingual-card ${htmlAttr(pending?'translation-pending':'')}"><small>${htmlText(label)}</small><b>${htmlText(primary)}</b>${source&&source!==primary?`<p><span>原文</span>${htmlText(source)}</p>`:''}<em>${htmlText(pending?'缺少中文翻译，未伪造译文':'中文展示层 · 原始数据保持不变')}</em></article>`}
function relationshipPresentationHtml(relationship={}){const rows=[['关系摘要',relationship.summary],['关系阶段',relationship.stage],['机会判断',relationship.opportunity],['风险判断',relationship.risk],['下一步建议',relationship.next]].filter(([,row])=>row&&typeof row==='object');const evidence=Array.isArray(relationship.evidence)?relationship.evidence:[],events=Array.isArray(relationship.events)?relationship.events:[],topics=Array.isArray(relationship.topics)?relationship.topics:[];if(!rows.length&&!evidence.length&&!events.length&&!topics.length)return '';return `<section class="timeline27-section wide relationship-bilingual-section"><header><h3>中文关系理解与权威原文</h3><span>中文仅用于展示；事实、证据和外语原文不会被覆盖</span></header><div class="timeline27-body"><div class="relationship-bilingual-grid">${rows.map(([label,row])=>relationshipScalarCardHtml(label,row)).join('')}</div>${topics.length?`<div class="relationship-bilingual-list"><h4>关键话题</h4>${topics.map(row=>bilingualPresentationRowHtml({title:row.title||'话题',displayText:row.title,sourceText:row.sourceTitle,translationPending:row.translationPending,source:'关系话题'},{})).join('')}</div>`:''}${events.length?`<div class="relationship-bilingual-list"><h4>关系事件</h4>${events.map(row=>bilingualPresentationRowHtml(row,{title:'关系事件'})).join('')}</div>`:''}${evidence.length?`<div class="relationship-bilingual-list"><h4>证据原句</h4>${evidence.map(row=>bilingualPresentationRowHtml(row,{title:row.label||'真实消息证据'})).join('')}</div>`:''}</div></section>`}
function themeColor(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()}
function svgAvatar(name,color){const initials=name.split(/\s+/).map(x=>x[0]).join('').slice(0,2),start=color||themeColor('--avatar-surface-start'),end=themeColor('--avatar-surface-end'),face=themeColor('--avatar-face'),body=themeColor('--avatar-body'),hair=themeColor('--avatar-hair'),text=themeColor('--avatar-text');return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${htmlAttr(start)}"/><stop offset="1" stop-color="${htmlAttr(end)}"/></linearGradient></defs><rect width="100" height="100" rx="50" fill="url(#g)"/><circle cx="50" cy="39" r="20" fill="${htmlAttr(face)}"/><path d="M18 93c4-24 19-37 32-37s28 13 32 37" fill="${htmlAttr(body)}"/><path d="M31 35c3-16 13-24 26-20 10 3 15 10 16 20-7-6-14-9-22-9-7 0-13 3-20 9" fill="${htmlAttr(hair)}"/><text x="50" y="91" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="${htmlAttr(text)}">${htmlText(initials)}</text></svg>`)}
function emptyContact(){return {id:'',name:'尚未选择会话',online:false,last:'',time:'',snippet:'',tags:[],unread:0,vip:false,archived:false,color:'',age:'',birthday:'',address:'',city:'',country:'',job:'',languages:'',family:'',stage:'',interests:'',note:'',accountId:'',chatJid:'',platform:''}}
function activeContacts(){return contacts.filter(c=>c&&!c.archived)}
function activeContactById(id){return contacts.find(c=>c.id===id&&!c.archived)||null}
function firstActiveContact(){return activeContacts()[0]||null}
function publishActiveContact(id,{source='r32-ui-runtime',reason='selection',view=currentView,allowArchived=false,force=false}={}){if(!activeContactStore)return null;activeContactStore.setAvailableContacts(contacts);return activeContactStore.setActiveContact(id,{source,reason,view,allowArchived,force,contact:contacts.find(row=>row.id===id)||null})}
function hydrateActiveContactStore(source='r32-ui-runtime:bootstrap'){if(!activeContactStore)return null;return activeContactStore.hydrate({contacts,activeContactId:activeId,view:currentView},{source,reason:'hydrate',allowArchived:allowArchivedContactInCurrentView()})}
function allowArchivedContactInCurrentView(){return currentView==='conversation'&&filter==='archived'||currentView==='contacts'&&typeof identityFilter!=='undefined'&&identityFilter==='archived'}
function getC(){const selected=contacts.find(c=>c.id===activeId);if(selected&&(!selected.archived||allowArchivedContactInCurrentView()))return selected;return firstActiveContact()||emptyContact()}
function normalizeCrossModuleSelections(preferredId=''){const fallback=activeContactById(preferredId)||activeContactById(activeId)||firstActiveContact();const id=fallback?.id||'';if(!activeContactById(selectedIdentity))selectedIdentity=id;if(!activeContactById(selectedProfile))selectedProfile=id;if(!activeContactById(selectedTimeline))selectedTimeline=id;if(!activeContactById(composerOwnerId))composerOwnerId=id;if(currentView!=='conversation'&&currentView!=='contacts'&&!activeContactById(activeId))activeId=id;return id}
function avatar(c){c=c||emptyContact();return window.YanceAvatarRuntime?.resolveAvatarUrl?.(c)||svgAvatar(c.name||'?',c.color||themeColor('--avatar-surface-start'))}
function mountRuntimeAvatar(host,contact,withStatus=false){if(!host)return;const c=contact||emptyContact();if(window.YanceAvatarRuntime?.mountAvatar)window.YanceAvatarRuntime.mountAvatar(host,c);else host.innerHTML=`<img src="${urlAttr(avatar(c),{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(c.name||'联系人')}头像">`;if(withStatus){let dot=host.querySelector('[data-avatar-decoration="true"]');if(!dot){dot=document.createElement('i');dot.className='status-dot';dot.dataset.avatarDecoration='true';host.appendChild(dot)}}}
function avatarHostMarkup(contact,{className='avatar',withStatus=false}={}){const c=contact||emptyContact();return `<div class="${htmlAttr(className)}" data-avatar-contact-id="${htmlAttr(c.id||'')}" data-avatar-status="${withStatus?'true':'false'}" aria-label="${htmlAttr(c.name||'联系人')}头像"></div>`}
function hydrateRuntimeAvatars(root=document,rows=contacts){const list=(Array.isArray(rows)?rows:contacts).filter(Boolean);root?.querySelectorAll?.('[data-avatar-contact-id]').forEach(node=>{const id=node.dataset.avatarContactId;const contact=list.find(row=>row.id===id)||contacts.find(row=>row.id===id)||emptyContact();mountRuntimeAvatar(node,contact,node.dataset.avatarStatus==='true')})}
function hint(msg,type='info',options={}){const text=safeUiText(msg,'操作已完成');return window.YanceNotificationLayoutAuthority.show({message:text,tone:String(type||'info'),timeoutMs:Math.max(900,Number(options?.duration||1600)),actionLabel:options?.actionLabel,action:options?.action})}
function setTitlebarStatus(state,text){const host=$('titlebarStatus');if(!host)return;host.dataset.state=state||'connecting';const label=host.querySelector('span');if(label)label.textContent=safeUiText(text,'本地工作台')}
function unreadCountOf(contact){return messageInteraction.unreadCount?.(contact)||Math.max(0,Number(contact?.unreadCount??contact?.unread_count??contact?.unread??0)||0)}
function unreadBadgeLabel(contact){const value=messageInteraction.badgeLabel?.(contact);if(value!==undefined)return value;const count=unreadCountOf(contact);return count>99?'99+':count?String(count):''}
function clearUnreadState(contact){if(!contact)return;if(messageInteraction.clearUnread)messageInteraction.clearUnread(contact);else{contact.unread=0;contact.unreadCount=0;contact.unread_count=0}}
function totalUnread(){return contacts.filter(contact=>!contact.archived).reduce((sum,contact)=>sum+unreadCountOf(contact),0)}
function messageMetrics(host){return {scrollHeight:host?.scrollHeight||0,scrollTop:host?.scrollTop||0,clientHeight:host?.clientHeight||0}}
function isNearMessageBottom(host,threshold=100){return messageInteraction.isNearBottom?.(messageMetrics(host),threshold)??((host.scrollHeight-host.scrollTop-host.clientHeight)<threshold)}
function normalizedMessageScrollState(value){const state=messageInteraction.normalizeScrollState?.(value)||(value==null?null:{version:3,mode:'offset',scrollTop:Math.max(0,Number(value?.scrollTop??value)||0)});if(!state)return null;return {...state,version:3}}
function messageNodeIdentity(node){return {messageId:String(node?.dataset?.messageId||''),externalMessageId:String(node?.dataset?.externalMessageId||'')}}
function findMessageNode(host,state){if(!host||!state)return null;const messageId=String(state.messageId||''),externalMessageId=String(state.externalMessageId||'');return [...host.querySelectorAll('.msg[data-message-id],.msg[data-external-message-id]')].find(node=>{const id=messageNodeIdentity(node);return Boolean(messageId&&id.messageId===messageId||externalMessageId&&id.externalMessageId===externalMessageId)})||null}
function captureMessageScrollState(host){if(!host)return null;const scrollTop=Math.max(0,Number(host.scrollTop||0));if(isNearMessageBottom(host,100))return {version:3,mode:'bottom',scrollTop};const hostRect=host.getBoundingClientRect?.()||{top:0,bottom:host.clientHeight||0};const nodes=[...host.querySelectorAll('.msg[data-message-id],.msg[data-external-message-id]')];const anchor=nodes.find(node=>{const rect=node.getBoundingClientRect?.();return rect&&rect.bottom>hostRect.top+1&&rect.top<hostRect.bottom-1})||nodes[0]||null;if(!anchor)return {version:3,mode:'offset',scrollTop};const identity=messageNodeIdentity(anchor),rect=anchor.getBoundingClientRect();return {version:3,mode:'anchor',...identity,offsetPx:Number(rect.top-hostRect.top)||0,scrollTop}}
function markMessageScrollUserIntent(duration=1400){messageScrollUserIntentUntil=Math.max(messageScrollUserIntentUntil,performance.now()+Math.max(250,Number(duration)||1400))}
function messageScrollHasUserIntent(){return performance.now()<messageScrollUserIntentUntil}
function saveMessageScrollState(id,host,options={}){if(!id||!host)return null;if(options.force!==true&&!messageScrollHasUserIntent())return normalizedMessageScrollState(messageScroll[id]);const state=captureMessageScrollState(host);if(state){messageScroll[id]=state;messageBottomLock[id]=state.mode==='bottom';if(options.persist!==false)persistState()}return state}
function restoreMessageScrollState(host,value,{defaultBottom=false}={}){if(!host)return {mode:'none',restored:false};const state=normalizedMessageScrollState(value);if(!state){host.scrollTop=defaultBottom?host.scrollHeight:0;return {mode:defaultBottom?'bottom':'offset',restored:true}}if(state.mode==='bottom'){host.scrollTop=host.scrollHeight;return {mode:'bottom',restored:true}}if(state.mode==='anchor'){const anchor=findMessageNode(host,state);if(anchor){const hostRect=host.getBoundingClientRect?.()||{top:0};const rect=anchor.getBoundingClientRect();host.scrollTop=Math.max(0,host.scrollTop+(rect.top-hostRect.top)-Number(state.offsetPx||0));return {mode:'anchor',restored:true}}}host.scrollTop=Math.min(Math.max(0,Number(state.scrollTop||0)),Math.max(0,host.scrollHeight-host.clientHeight));return {mode:'offset',restored:true}}
function ensureNewMessageIndicator(host){if(!host?.parentElement)return null;let button=document.getElementById('chatNewMessageIndicator');if(button)return button;const parent=host.parentElement;if(getComputedStyle(parent).position==='static')parent.style.position='relative';button=document.createElement('button');button.type='button';button.id='chatNewMessageIndicator';button.className='message-new-indicator';button.hidden=true;button.setAttribute('aria-live','polite');button.onclick=()=>{beginMessageScrollRestore(host);host.scrollTop=host.scrollHeight;messageScroll[activeId]={version:3,mode:'bottom',scrollTop:host.scrollTop};messageBottomLock[activeId]=true;finishMessageScrollRestore(host);button.hidden=true};parent.appendChild(button);return button}
function hideNewMessageIndicator(){const button=document.getElementById('chatNewMessageIndicator');if(button)button.hidden=true}
function showNewMessageIndicator(count=1){const host=$('messages'),button=ensureNewMessageIndicator(host);if(!button)return;button.textContent=count>1?`有 ${count} 条新消息`:'有新消息';button.hidden=false}
function beginMessageScrollRestore(host){if(!host)return;messageScrollRestoreUntil=performance.now()+360;host.dataset.scrollRestoring='true'}
function finishMessageScrollRestore(host){requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!host?.isConnected)return;delete host.dataset.scrollRestoring;messageScrollRestoreUntil=Math.max(messageScrollRestoreUntil,performance.now()+40)}))}
function messageScrollRestoreActive(host){return Boolean(host?.dataset?.scrollRestoring==='true'||performance.now()<messageScrollRestoreUntil)}
function restoreMessagePositionAfterMediaLayout(host){if(!host||host.dataset.conversationId!==String(activeId))return;const state=normalizedMessageScrollState(messageScroll[activeId]);if(!state)return;beginMessageScrollRestore(host);requestAnimationFrame(()=>{if(host.isConnected&&host.dataset.conversationId===String(activeId)){restoreMessageScrollState(host,state,{defaultBottom:state.mode==='bottom'})}finishMessageScrollRestore(host)})}
function buildReadKeys(contact){return (histories[contact?.id]||[]).filter(message=>message.side!=='me'&&message.externalMessageId).slice(-100).map(message=>({remoteJid:contact.chatJid,id:message.externalMessageId,fromMe:false,participant:message.raw?.participant||undefined}))}
async function markConversationRead(contact){if(!contact?.id)return null;if(readInFlight.has(contact.id))return readInFlight.get(contact.id);const task=apiJson(`/api/r32/messages/conversations/${encodeURIComponent(contact.id)}/read`,{method:'POST',body:JSON.stringify({platform:contact.platform||'whatsapp',accountId:contact.accountId||'',chatJid:contact.chatJid||'',messageKeys:buildReadKeys(contact)})}).then(result=>{clearUnreadState(contact);renderContacts();return result}).finally(()=>readInFlight.delete(contact.id));readInFlight.set(contact.id,task);return task}
function applyCrossModuleContext(id,payload={}){
 if(!id||!payload)return payload;
 const contact=contacts.find(row=>row.id===id),remote=payload.contact||{},rawProfile=chineseFirstContent(payload.profile||{}),insight=chineseFirstContent(payload.insights||{}),rawTrajectory=payload.trajectory||{};
 const profile=cleanProfileObject(rawProfile),facts=rawProfile.facts&&typeof rawProfile.facts==='object'?rawProfile.facts:{};
 if(contact){
  const assignText=(key,...values)=>{const value=values.map(v=>profileText(v)).find(Boolean);if(value)contact[key]=value};
  assignText('contactId',remote.id,remote.contactId,contact.contactId);
  assignText('name',remote.displayName,remote.name,contact.name);
  const avatarUrl=profileText(remote.avatarUrl||remote.avatar_url);
  if(avatarUrl)Object.assign(contact,{avatarUrl,avatar_url:avatarUrl,avatar:avatarUrl,photo_url:avatarUrl});
  assignText('age',facts.age,contact.age);assignText('birthday',facts.birthday,contact.birthday);assignText('address',facts.address,contact.address);assignText('city',facts.city,contact.city);assignText('country',facts.country,contact.country);assignText('job',facts.job,facts.occupation,contact.job);assignText('languages',facts.languages,contact.languages);assignText('family',facts.family,contact.family);assignText('stage',profile.lifecycleStage,profile.stage,contact.stage);assignText('interests',facts.interests,contact.interests);assignText('note',profile.note,profile.notes,contact.note);
  if(Array.isArray(profile.tags)&&profile.tags.length)contact.tags=profile.tags.map(x=>profileText(x)).filter(Boolean);
  Object.assign(contact,{archived:Boolean(remote.archived??contact.archived),archivedAt:profileText(remote.archivedAt,contact.archivedAt||''),archiveReason:profileText(remote.archiveReason,contact.archiveReason||''),profileExists:payload.profile?.exists===true,identityStatus:profileText(payload.identitySummary?.status,remote.identityStatus,contact.identityStatus),identityConfidence:Number(payload.identitySummary?.confidence??remote.identityConfidence??contact.identityConfidence??0),identityConfirmed:payload.identitySummary?.verified===true||remote.identityConfirmed===true,platformIdentity:profileText(payload.identitySummary?.externalId,remote.platformIdentity,remote.externalId,contact.platformIdentity,contact.externalId)});
 }
 const authorityIdentity=payload.identitySummary&&typeof payload.identitySummary==='object'?payload.identitySummary:null;
 if(identityState[id]&&authorityIdentity){const observed=['observed','verified','confirmed'].includes(profileText(authorityIdentity.status).toLowerCase());Object.assign(identityState[id],{phone:profileText(remote.phone,identityState[id].phone),stableId:profileText(authorityIdentity.externalId,remote.platformIdentity,identityState[id].stableId),confidence:Number(authorityIdentity.confidence||0),pending:!observed,bound:payload.profile?.exists===true,maintained:payload.profile?.exists===true||identityState[id].maintained===true,identityStatus:profileText(authorityIdentity.status,'pending'),identityConfirmed:authorityIdentity.verified===true})}
 profileState[id]=cleanProfileObject({...defaultProfile(),...(profileState[id]||{}),...profile});
 trajectoryState[id]=cleanTrajectoryObject({...defaultTrajectory(),...(trajectoryState[id]||{}),...rawTrajectory,stage:rawTrajectory.stage||insight.relationshipStage||insight.stage||trajectoryState[id]?.stage||'待分析',initiative:Number(rawTrajectory.initiative??insight.initiativeScore??insight.initiative??0),opportunity:Number(rawTrajectory.opportunity??insight.opportunityScore??insight.opportunity??0),risk:Number(rawTrajectory.risk??insight.riskScore??insight.risk??0),next:rawTrajectory.next||insight.nextAction||insight.next||'等待真实分析。',evidence:Array.isArray(rawTrajectory.evidence)?rawTrajectory.evidence:Array.isArray(insight.evidence)?insight.evidence.map(x=>[x.quote||x.text||'',x.label||x.claim||'',x.source||'真实消息',Number(x.confidence||0)]):[],updated:rawTrajectory.updated||insight.updatedAt||insight.updated||''});
 if(id===activeId&&!contact?.archived){const run=payload.latestRun||null,analysis=payload.analysis&&typeof payload.analysis==='object'?payload.analysis:{};if(run?.status==='running'){renderUnderstanding({});syncUnderstandingState('running')}else if(run?.status==='failed'){renderUnderstanding({});syncUnderstandingState('error',profileText(run.errorText||run.result?.errorCode,'真实模型未完成分析'))}else if(run?.status==='completed'&&run.current===true&&Object.keys(analysis).length){const presented={...chineseFirstContent(analysis),_model:payload.model||analysis?._model||null,_sourceLastMessageId:profileText(payload.source?.lastMessageId,run?.sourceLastMessageId,run?.source_last_message_id,analysis.sourceLastMessageId,analysis.executionReceipt?.sourceLastMessageId)};renderUnderstanding(presented);const receiptState=analysisReceiptState(payload,presented);syncUnderstandingState(receiptState.complete?'complete':'incomplete',receiptState.complete?'':receiptState.committed?`缺少${receiptState.missing.join('、')||'完整分析字段'}`:'分析事务尚未确认提交')}else{renderUnderstanding({});syncUnderstandingState('idle')}}
 if(contact?.archived)normalizeCrossModuleSelections();
 if(id===activeId&&!contact?.archived){renderHeader();renderNotes();renderUtilityTimeline();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();if(app.classList.contains('contact-page-open'))renderIdentityPage()}
 return payload
}
async function loadCrossModuleContext(id,{render=true,requestToken=0}={}){if(!id)return null;const payload=await apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(id)}/context`);if(requestToken&&requestToken!==conversationContextRequestToken)return null;applyCrossModuleContext(id,payload);if(render){renderContacts();persistState()}window.dispatchEvent(new CustomEvent('yance:r32-cross-module-context',{detail:{id,payload}}));return payload}
const socialSignalLabels={emotion_declining:'情绪下降',emotion_recovering:'情绪恢复',defensiveness_increasing:'防御感增强',fatigue_expressed:'表达疲惫',warmth_increasing:'温暖度提升',tension_increasing:'压力上升',openness_increasing:'开放度提升',energy_decreasing:'互动活力下降',initiative_declining:'主动性下降',initiative_recovering:'主动性恢复',topic_depth_increasing:'话题深度增加',private_sharing:'主动分享私人信息',trust_expressed:'表达信任',boundary_expressed:'表达边界',distance_increasing:'关系距离增加',relationship_rewarming:'关系重新升温',reply_speed_increasing:'回复速度变快',reply_speed_decreasing:'回复速度变慢',reply_length_shortening:'回复变得简短',reply_length_increasing:'回复内容变长',consecutive_no_reply:'连续未回复',topic_avoidance:'进入避谈话题',question_tolerance_low:'连续提问耐受下降',preferred_time_detected:'偏好互动时段'};
function socialEventTime(value){const date=new Date(value||0);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'近期'}
function applyStoreSocialContext(id,context={}){
 if(!id||!context?.found)return context;
 const p=context.relationshipPotential||{},emotion=context.emotion||{},interaction=context.interaction||{},policy=context.interactionPolicy||{},strategy=context.replyStrategy||{};
 const events=(context.timeline||[]).slice().reverse().map(event=>[socialEventTime(event.confirmedAt||event.observedAt||event.startedAt),socialSignalLabels[event.eventType]||event.interpretation||'关系状态变化',event.interpretation||event.evidence?.summary||'由真实互动轨迹生成',String(event.eventType||'signal').includes('declin')||String(event.eventType||'').includes('defens')?'risk':'fact',`StoreManager · 置信度 ${Math.round(Number(event.confidence||0)*100)}%`]);
 const signals=(context.recentSignals||[]).slice().reverse().map(signal=>[socialEventTime(signal.observedAt),socialSignalLabels[signal.signalType]||signal.signalType,signal.evidence?.summary||'社交解析器信号',signal.direction==='negative'?'risk':'signal',`Social Parser · 置信度 ${Math.round(Number(signal.confidence||0)*100)}%`]);
 const potentialScore=Math.round(((Number(p.warmth||0)+Number(p.openness||0)+Number(p.trust||0))/3)*100),riskScore=Math.round(Number(p.tension||0)*100);
 const currentTrajectory=cleanTrajectoryObject({...defaultTrajectory(),...(trajectoryState[id]||{})});
 trajectoryState[id]=cleanTrajectoryObject({...currentTrajectory,events:[...events,...signals].slice(0,36),socialContextVersion:Number(context.contextVersion||0),socialMetrics:{initiative:Math.round(Number(p.initiative||0)*100),depth:Math.round(Number(p.openness||0)*100),opportunity:potentialScore,risk:riskScore,reply:interaction.averageReplyDelayMinutes?`约 ${Math.round(interaction.averageReplyDelayMinutes)} 分钟`:'尚未形成稳定节奏'}});
 const profile=cleanProfileObject(profileState[id]||defaultProfile());profile.socialPreferences={...(context.preferences||{})};profile.interactionPolicy={...policy};profileState[id]=profile;
 if(id===activeId){renderUtilityTimeline();if(app.classList.contains('timeline-page-open'))renderTimelinePage();if(app.classList.contains('profile-page-open'))renderProfilePage()}
 window.dispatchEvent(new CustomEvent('yance:r32-social-context',{detail:{id,context}}));return context
}
async function loadStoreSocialContext(id,{requestToken=0}={}){
 const c=contacts.find(row=>row.id===id);if(!c||!window.YanceStoreClient?.getCustomerSocialContext)return null;
 try{await window.YanceStoreClient.start?.();const context=await window.YanceStoreClient.getCustomerSocialContext(c.contactId||c.id,{timelineLimit:48,recentMessageLimit:60});if(requestToken&&requestToken!==conversationContextRequestToken)return null;return applyStoreSocialContext(id,context)}catch(error){console.warn('[言策 Store social context]',error.message||error);return null}
}
function scheduleStoreSocialContextRefresh(id,delayMs=500){
 const target=String(id||'');if(!target)return;
 storeSocialContextRefreshId=target;
 if(storeSocialContextRefreshTimer)return;
 storeSocialContextRefreshTimer=setTimeout(()=>{const next=storeSocialContextRefreshId;storeSocialContextRefreshId='';storeSocialContextRefreshTimer=0;if(next===activeId)Promise.allSettled([loadStoreSocialContext(next),loadCrossModuleContext(next,{render:true})])},Math.max(100,Number(delayMs)||500));
}
function activateConversationFilter(nextFilter='all'){
 filter=['all','unread','online','vip','archived'].includes(nextFilter)?nextFilter:'all';
 document.querySelectorAll('#filters button').forEach(button=>button.classList.toggle('active',button.dataset.filter===filter));
 if(filter==='archived'){const archived=contacts.find(contact=>contact.archived);if(archived)activeId=archived.id}
 renderContacts();renderHeader();renderMessages();syncComposerState();persistState();
}
function ensureContactContextMenu(){
 let menu=$('r32ContactContextMenu');if(menu)return menu;
 menu=document.createElement('div');menu.id='r32ContactContextMenu';menu.className='r32-contact-context-menu';menu.hidden=true;document.body.appendChild(menu);
 document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target))menu.hidden=true});
 window.addEventListener('blur',()=>{menu.hidden=true});
 return menu
}
function showContactContextMenu(contact,event){
 event.preventDefault();event.stopPropagation();const menu=ensureContactContextMenu(),archived=Boolean(contact.archived);
 menu.setAttribute('role','menu');menu.innerHTML=`<button data-contact-action="open">打开会话</button><button data-contact-action="pin">${htmlText(contact.pinned?'取消置顶':'置顶会话')}</button><div class="r32-menu-separator"></div><button data-contact-action="archive">${htmlText(archived?'恢复到活跃会话':'归档会话')}</button>`;
 menu.hidden=false;const placed=window.YanceFloatingMenuPosition?.placeMenu?.(menu,event,{margin:8});if(!placed){const width=220,height=Math.min(menu.scrollHeight||180,innerHeight-16);menu.style.left=`${Math.max(8,Math.min(innerWidth-width-8,event.clientX))}px`;menu.style.top=`${Math.max(8,Math.min(innerHeight-height-8,event.clientY))}px`;}
 menu.querySelectorAll('[data-contact-action]').forEach(button=>button.onclick=async()=>{const action=button.dataset.contactAction;menu.hidden=true;try{
  if(action==='open')await selectContact(contact.id);
  else if(action==='pin')await setConversationPinned(contact.id,!contact.pinned);
  else if(action==='archive'){const approved=archived||await window.YanceDialogs.confirm({title:'归档会话',message:`归档 ${contact.name||'该会话'}？聊天记录和客户档案会保留。`,danger:true,submitLabel:'归档'});if(!approved)return;await setConversationArchived(contact.id,!archived,archived?'':'用户右键归档');if(!archived)activateConversationFilter('archived')}
 }catch(error){hint(error.message||'会话操作失败','error')}});
}

function contactCapability(contact={},name,fallback=false){
 const runtime=window.YancePlatformCapabilityRuntime;
 if(runtime?.resolveCapability)return runtime.resolveCapability(contact,name,fallback);
 const value=contact?.capabilities?.[name];
 const supported=value===true||['supported','partial','policy','permission'].includes(String(value||'').toLowerCase());
 return {name,state:supported?'supported':'unsupported',supported,fullySupported:supported,note:'',constraints:[],source:'legacy-fallback'}
}
function contactCapabilitySupported(contact={},name,fallback=false){return contactCapability(contact,name,fallback).supported===true}
function contactPresenceSupported(contact={}){
 const fallback=profileText(contact.presenceSupport,'')!=='unsupported'&&(contact.online!==undefined||Boolean(profileText(contact.lastSeenAt,contact.last_seen_at,contact.presenceState,contact.presence,'')));
 return contactCapabilitySupported(contact,'terminalPresence',fallback)
}
function contactTypingSupported(contact={}){return contactCapabilitySupported(contact,'incomingTyping',false)}
function updateOnlineFilterAvailability(activeContacts=[]){
 const button=document.querySelector('#filters [data-filter="online"]');if(!button)return;
 const eligible=activeContacts.filter(contactPresenceSupported);
 const supported=eligible.length>0;
 button.hidden=!supported;button.disabled=!supported;button.classList.toggle('unsupported',!supported);button.setAttribute('aria-disabled',supported?'false':'true');button.title=supported?'仅统计平台实际提供且当前可见的在线状态':'';
 const textNode=[...button.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);if(textNode)textNode.nodeValue='在线 ';
 if(!supported&&filter==='online'){filter='all';document.querySelectorAll('#filters button').forEach(item=>item.classList.toggle('active',item.dataset.filter==='all'))}
}
function contactSnippetText(contact,mode=conversationLayoutState.translationMode){
 const original=profileText(contact?.snippetOriginal,contact?.snippet,'');
 const translated=profileText(contact?.snippetZh,contact?.snippetTranslation,'');
 if(mode==='original')return original||translated||'暂无消息';
 return translated||original||'暂无消息';
}
function contactSearchText(contact){return [contact?.name,contact?.snippetOriginal,contact?.snippetZh,contact?.snippet,...(contact?.tags||[])].map(value=>profileText(value)).filter(Boolean).join(' ').toLowerCase()}
function updateContactSnippetFromMessage(conversationId,message={}){
 const contact=contacts.find(row=>String(row.id)===String(conversationId));if(!contact)return false;
 const messageId=profileText(message.id,message.externalMessageId,message.messageId,'');
 if(contact.snippetMessageId&&messageId&&String(contact.snippetMessageId)!==String(messageId))return false;
 const original=profileText(message.text,message.caption,message.body,message.sourceText,contact.snippetOriginal,contact.snippet,'');
 const translated=profileText(message.translatedZh,message.translationZh,message.translationZH,message.chineseTranslation,message.translation,message.chinese,contact.snippetZh,'');
 Object.assign(contact,{snippet:original||translated,snippetOriginal:original,snippetZh:translated,snippetTranslationStatus:profileText(message.translationStatus,translated?'success':''),snippetMessageId:messageId||contact.snippetMessageId||''});
 return true
}
function accountCanAttemptSend(account={}){return account?.canAttemptSend===true||(account?.canAttemptSend==null&&account?.canSend===true)}
function renderContacts(){
 const input=$('contactSearch'),q=(input?.value||'').trim().toLowerCase();
 const active=contacts.filter(c=>!c.archived),archived=contacts.filter(c=>c.archived);
 updateOnlineFilterAvailability(active);
 const accountConnected=c=>runtimeAccounts.some(a=>(a.id===c.accountId||a.adapterAccountId===c.accountId)&&(a.canReceive===true||accountCanAttemptSend(a)||/online|connected|ready/i.test(String(a.state||a.status||''))));
 const isOnline=c=>Boolean(contactPresenceSupported(c)&&c.online&&accountConnected(c));
 const list=contacts.filter(c=>(!q||contactSearchText(c).includes(q))&&(filter==='archived'?c.archived:!c.archived&&(filter==='all'||filter==='unread'&&unreadCountOf(c)>0||filter==='online'&&isOnline(c)||filter==='vip'&&c.vip))).sort((a,b)=>{const pin=Number(Boolean(b.pinned))-Number(Boolean(a.pinned));if(pin)return pin;const pinTime=String(b.pinnedAt||'').localeCompare(String(a.pinnedAt||''));if(pinTime)return pinTime;return String(b.lastMessageAt||b.updatedAt||'').localeCompare(String(a.lastMessageAt||a.updatedAt||''))});
 const counts={all:active.length,unread:active.reduce((sum,c)=>sum+unreadCountOf(c),0),online:active.filter(isOnline).length,vip:active.filter(c=>c.vip).length,archived:archived.length};
 for(const [id,value] of [['allCount',counts.all],['unreadCount',counts.unread],['onlineCount',counts.online],['vipCount',counts.vip],['archivedCount',counts.archived]])if($(id))$(id).textContent=String(value);
 const connected=runtimeAccounts.filter(a=>a.canReceive===true||accountCanAttemptSend(a)||/online|connected|ready/i.test(String(a.state||a.status||''))).length;
 if($('contactSyncState'))$('contactSyncState').textContent=connected?`在线账号 ${connected} · 活跃会话 ${counts.all}`:`无在线账号 · SQLite 历史 ${counts.all}`;
 const host=$('contactList');
 const previousScrollTop=Number(host?.scrollTop||0);
 const markup=!list.length?(()=>{const archivedView=filter==='archived';return `<div class="ui-empty-state"><div><div class="ui-empty-orb"></div><b>${htmlText(archivedView?'暂无归档客户':'暂无活跃会话')}</b><p>${htmlText(archivedView?'从会话更多菜单或联系人详情中归档后会显示在这里。':'历史联系人会保留在SQLite中；不需要继续跟进的客户可以归档。')}</p></div></div>`})():list.map(c=>{const badge=unreadBadgeLabel(c),pinBadge=c.pinned?'<span class="contact-pin" title="已置顶" aria-label="已置顶">⌃</span>':'',platformKey=String(c.platform||'').toLowerCase(),platformLabel={whatsapp:'WhatsApp',telegram:'Telegram',facebook:'Facebook'}[platformKey]||profileText(c.platform,'未知平台'),tags=[...(c.tags||[]),...(c.archived?['已归档']:[])],status=c.archived?'已归档':contactPresenceLabel(c),tooltip=contactInfoTooltip(c,{platformLabel,status}),accountLabel=profileText(runtimeAccounts.find(row=>accountIdMatches(row,c.accountId||''))?.displayName,c.accountName,'未识别账号'),platformBadge=`<em class="contact-platform" data-platform="${htmlAttr(platformKey)}" title="${htmlAttr(`${platformLabel} · ${accountLabel}`)}">${htmlText(platformLabel)}</em>`,presenceSupported=contactPresenceSupported(c),statusMarkup=!presenceSupported&&!c.archived?`<div class="contact-status platform-only">${platformBadge}</div>`:`<div class="contact-status"><i></i><span>${htmlText(status)}</span>${platformBadge}</div>`;return `<button class="contact-card ${htmlAttr(c.id===activeId?'active':'')} ${htmlAttr(isOnline(c)?'online':'')} ${htmlAttr(c.archived?'archived':'')} ${htmlAttr(c.pinned?'pinned':'')}" data-id="${htmlAttr(c.id)}" title="${htmlAttr(tooltip)}" aria-label="${htmlAttr(tooltip.replace(/\n/g,'，'))}">${avatarHostMarkup(c,{withStatus:presenceSupported})}<div class="contact-main"><div class="contact-top"><b class="contact-name" title="${htmlAttr(c.name||'联系人')}">${htmlText(c.name)}</b><div class="contact-side">${pinBadge}<span class="contact-time">${htmlText(c.time||'')}</span><span class="unread ${htmlAttr(badge?'':'hidden')}" aria-label="${htmlAttr(badge?`${badge} 条未读消息`:'无未读消息')}">${htmlText(badge)}</span></div></div>${statusMarkup}<div class="snippet" data-translation-state="${htmlAttr(c.snippetZh?'translated':c.snippetTranslationStatus||'original')}">${htmlText(contactSnippetText(c))}</div><div class="tags">${tags.map(t=>`<i>${htmlText(t)}</i>`).join('')}</div></div></button>`}).join('');
 if(host.__yanceContactMarkup===markup)return;
 host.__yanceContactMarkup=markup;host.innerHTML=markup;
 if(!list.length)return;
 hydrateRuntimeAvatars(host,list);
 host.querySelectorAll('.contact-card').forEach(button=>{const contact=contacts.find(row=>row.id===button.dataset.id);button.onclick=()=>selectContact(button.dataset.id);button.oncontextmenu=event=>contact&&showContactContextMenu(contact,event)});
 if(previousScrollTop)requestAnimationFrame(()=>{if(host.isConnected)host.scrollTop=previousScrollTop});
}
async function setConversationPinned(id,pinned){
 const c=contacts.find(row=>row.id===id);if(!c)return null;
 const result=await apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(id)}/pin`,{method:'PUT',body:JSON.stringify({pinned,by:'user'})});
 Object.assign(c,{pinned:Boolean(result.pinned),pinnedAt:result.pinnedAt||'',pinnedBy:result.pinnedBy||''});
 renderContacts();persistState();
 window.dispatchEvent(new CustomEvent('yance:r32-conversation-pin-changed',{detail:{id,pinned:Boolean(result.pinned),accountId:c.accountId||''}}));
 hint(result.pinned?'会话已置顶':'已取消会话置顶');
 return result
}
async function setConversationArchived(id,archived,reason=''){
 const c=contacts.find(row=>row.id===id);if(!c)return null;
 const result=await apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(id)}/archive`,{method:'PUT',body:JSON.stringify({archived,reason})});
 Object.assign(c,{archived:Boolean(result.archived),archivedAt:result.archivedAt||'',archiveReason:result.archiveReason||'',archivedBy:result.archivedBy||''});
 filter='all';document.querySelectorAll('#filters button').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'));
 if(c.archived){const next=firstActiveContact();activeId=next?.id||'';selectedIdentity=activeId;selectedProfile=activeId;selectedTimeline=activeId;composerOwnerId=activeId}else{activeId=c.id;selectedIdentity=c.id;selectedProfile=c.id;selectedTimeline=c.id;composerOwnerId=c.id}
 normalizeCrossModuleSelections(activeId);
 renderContacts();renderHeader();renderMessages();renderNotes();updateSharedUI?.();
 if(app.classList.contains('contact-page-open'))renderIdentityPage();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();
 persistState();
 window.dispatchEvent(new CustomEvent('yance:r32-conversation-archive-changed',{detail:{id,archived:Boolean(result.archived),activeId}}));
 hint(result.archived?'已归档该客户，会话和资料仍保留':'已恢复到活跃会话');
 return result
}
function currentTypingState(contact=getC()){
 const key=contact?.contactId||contact?.id||'';
 const row=activeTypingSnapshot?.byContactId?.[key]||window.YanceStoreClient?.select?.(state=>state.typingState?.byContactId?.[key]||null)||null;
 const incoming=row?.contact||row||{},self=row?.self||{};
 const incomingExpires=Date.parse(incoming.expiresAt||0);
 const incomingActive=incoming.isTyping===true&&(!Number.isFinite(incomingExpires)||incomingExpires>Date.now());
 return {contact:{...incoming,isTyping:incomingActive},self:{...self,isTyping:self.isTyping===true}}
}
function contactTypingStatusLabel(typing){if(!typing?.isTyping)return'';if(typing.activity==='recording')return'对方正在录音…';if(typing.activity==='uploading')return'对方正在发送附件…';return'对方正在输入…'}
function selfTypingStatusLabel(typing){if(!typing?.isTyping)return'';if(typing.phase==='ai_generation')return'AI正在生成回复…';if(typing.phase==='approved_send_silent')return'正在静默阅读并准备回复…';if(typing.phase==='approved_send_delay'||typing.phase==='approved_send_burst')return'正在按自然节奏发送…';return'我方正在输入…'}
function contactPresenceLabel(c={}){
 if(!contactPresenceSupported(c))return'';
 if(c.online)return'在线';
 const lastSeen=profileText(c.lastSeenAt,c.last_seen_at,''),precision=profileText(c.lastSeenPrecision,c.last_seen_precision,'');
 if(lastSeen)return`离线 · 最后上线 ${socialEventTime(lastSeen)}`;
 if(precision==='recently')return'离线 · 最近上线（具体时间受隐私限制）';
 if(precision==='last_week')return'离线 · 一周内上线（具体时间受隐私限制）';
 if(precision==='last_month')return'离线 · 一月内上线（具体时间受隐私限制）';
 if(precision==='hidden')return'离线 · 上线时间已隐藏';
 if(profileText(c.presenceState,'')==='offline'||profileText(c.presence,'')==='unavailable')return'离线';
 return profileText(c.last,'上线状态未获取')
}
function contactInfoTooltip(c={},options={}){
 const platformLabel=profileText(options.platformLabel,{whatsapp:'WhatsApp',telegram:'Telegram',facebook:'Facebook'}[String(c.platform||'').toLowerCase()],c.platform,'未知平台');
 const account=runtimeAccounts.find(row=>accountIdMatches(row,c.accountId||''));
 const status=profileText(options.status,contactPresenceLabel(c));
 const avatarStatus=profileText(c.avatarStatus,c.avatar_status,c.avatarUrl||c.avatar_url?'头像已缓存':'头像未获取');
 const avatarError=profileText(c.avatarLastError,c.avatar_last_error,'');
 const identitySource=profileText(c.identitySource,c.identity_source,c.pageScopedUserId?'Page Scoped User ID':c.chatJid?'平台会话身份':'');
 const language=profileText(c.contactLanguage,c.languageCode,c.language,'');
 const rows=[profileText(c.name,'联系人'),`平台：${platformLabel}`,`账号：${profileText(account?.displayName,account?.name,c.accountName,'未识别账号')}`,`账号状态：${profileText(account?.stateLabel,account?.status,account?.state,'未知')}`];
 if(contactPresenceSupported(c)){if(status)rows.push(`状态：${status}`);rows.push(`上线能力：${profileText(c.presenceSupport,'按能力矩阵与隐私设置')}`)}
 rows.push(`头像：${avatarStatus}`);
 if(avatarError)rows.push(`头像错误：${avatarError}`);
 if(profileText(c.avatarUpdatedAt,c.avatar_updated_at,''))rows.push(`头像同步：${socialEventTime(profileText(c.avatarUpdatedAt,c.avatar_updated_at,''))}`);
 if(identitySource)rows.push(`身份来源：${identitySource}`);
 if(language)rows.push(`客户语言：${language}`);
 if(Number(c.learningVersion||c.learning_version||0)>0)rows.push(`AI学习版本：${Number(c.learningVersion||c.learning_version)}`);
 if(Number(c.unread||c.unreadCount||0)>0)rows.push(`未读：${Number(c.unread||c.unreadCount||0)}`);
 if(Array.isArray(c.tags)&&c.tags.length)rows.push(`标签：${c.tags.join('、')}`);
 return rows.join('\n')
}
function contactHeaderMetadata(c){
 const presence=contactPresenceLabel(c);
 const age=profileText(c.age,'');
 const ageLabel=age?(age.includes('岁')?age:`${age}岁`):'';
 const location=[profileText(c.city,''),profileText(c.country,'')].filter(Boolean).filter((value,index,rows)=>rows.indexOf(value)===index).join(' · ');
 return [presence,ageLabel,location].filter(Boolean).join(' · ')
}
function renderHeaderPresence(c){
 const host=$('chatOnline'),label=host?.querySelector('span'),dot=host?.querySelector('i'),typing=currentTypingState(c),incomingLabel=contactTypingSupported(c)?contactTypingStatusLabel(typing.contact):'',selfLabel=selfTypingStatusLabel(typing.self),typingLabel=incomingLabel||selfLabel,metadata=contactHeaderMetadata(c),platformPresenceUnsupported=!contactPresenceSupported(c),text=typingLabel||metadata;
 if(label)label.textContent=text;
 if(host)host.hidden=!text;
 host?.classList.toggle('typing',Boolean(typingLabel));
 host?.classList.toggle('self-typing',Boolean(selfLabel&&!incomingLabel));
 host?.classList.toggle('no-presence',platformPresenceUnsupported&&!typingLabel);
 if(host){host.dataset.presence=typingLabel?'typing':platformPresenceUnsupported?'unsupported':c.online?'online':'offline';host.style.removeProperty('color')}
 if(dot){dot.hidden=platformPresenceUnsupported&&!typingLabel;dot.style.removeProperty('background');dot.style.removeProperty('box-shadow')}
}
function updateViewingIndicator(){
 // The active-conversation quiet policy is enforced by the notification backend.
 // Do not keep a persistent banner in the chat header; status changes use the shared toast.
 const stale=$('viewingMuteIndicator');
 stale?.remove()
}

function readMutedListSync() {
  if (window.YanceNotificationView && Array.isArray(window.YanceNotificationView.mutedConversations)) {
    return Array.from(window.YanceNotificationView.mutedConversations).map(String);
  }
  return [];
}
async function getMutedList() {
  const sync = readMutedListSync();
  if (sync.length || (window.YanceNotificationView && Array.isArray(window.YanceNotificationView.mutedConversations))) return sync;
  try {
    const data = await apiJson('/api/r32/system/notifications', { method: 'GET' });
    const s = (data && (data.settings || data)) || {};
    window.YanceNotificationView = Object.assign(window.YanceNotificationView || {}, { enabled: s.enabled, soundEnabled: s.soundEnabled, paused: s.paused, dnd: s.dnd, mutedConversations: s.mutedConversations || [] });
    return (s.mutedConversations || []).map(String);
  } catch (_) { return []; }
}
function updateMuteButton() {
  try {
    const mb = $('chatMuteBtn'); if (!mb) return;
    const id = activeId;
    const muted = Boolean(id) && readMutedListSync().includes(String(id));
    mb.classList.toggle('active', muted);
    mb.title = muted ? '取消静音此会话' : '静音此会话';
    mb.setAttribute('aria-label', mb.title);
    mb.disabled = !id;
  } catch (_) {}
}
async function toggleMuteConversation() {
  const id = activeId; if (!id) return;
  const list = await getMutedList();
  const i = list.indexOf(String(id));
  if (i >= 0) list.splice(i, 1); else list.push(String(id));
  try {
    if (typeof window.yanceUpdateNotifications === 'function') {
      await window.yanceUpdateNotifications({ mutedConversations: list });
    } else {
      await apiJson('/api/r32/system/notifications', { method: 'POST', body: JSON.stringify({ mutedConversations: list }) });
      if (window.YanceNotificationView) window.YanceNotificationView.mutedConversations = list;
      window.dispatchEvent(new CustomEvent('yance:notification-view-changed', { detail: window.YanceNotificationView }));
    }
    updateMuteButton(); updateViewingIndicator();
    hint(list.includes(String(id)) ? '已静音此会话，新消息不再响铃' : '已取消静音此会话', 'info');
  } catch (e) { hint(e && e.message ? e.message : '会话静音切换失败', 'error'); }
}

function getActiveAccountId(){
  const c=getC();return String((c&&c.accountId)||'').trim();
}
function readMutedAccountsSync(){
  if(window.YanceNotificationView&&Array.isArray(window.YanceNotificationView.mutedAccounts))return Array.from(window.YanceNotificationView.mutedAccounts).map(String);
  return [];
}
async function getMutedAccounts(){
  const sync=readMutedAccountsSync();
  if(sync.length||(window.YanceNotificationView&&Array.isArray(window.YanceNotificationView.mutedAccounts)))return sync;
  try{const data=await apiJson('/api/r32/system/notifications',{method:'GET'});const s=(data&&(data.settings||data))||{};window.YanceNotificationView=Object.assign(window.YanceNotificationView||{},{enabled:s.enabled,soundEnabled:s.soundEnabled,paused:s.paused,dnd:s.dnd,mutedConversations:s.mutedConversations||[],mutedAccounts:s.mutedAccounts||[]});return (s.mutedAccounts||[]).map(String);}catch(_){return [];}
}
function updateMuteAccountButton(){
  try{const mb=$('chatMuteAccountBtn');if(!mb)return;const id=getActiveAccountId();const muted=Boolean(id)&&readMutedAccountsSync().includes(id);mb.classList.toggle('active',muted);mb.title=muted?'取消静音此账号':'静音此账号';mb.setAttribute('aria-label',mb.title);mb.disabled=!id;}catch(_){}
}
async function toggleMuteAccount(){
  const id=getActiveAccountId();if(!id)return;const list=await getMutedAccounts();const i=list.indexOf(id);if(i>=0)list.splice(i,1);else list.push(id);
  try{if(typeof window.yanceUpdateNotifications==='function'){await window.yanceUpdateNotifications({mutedAccounts:list});}else{await apiJson('/api/r32/system/notifications',{method:'POST',body:JSON.stringify({mutedAccounts:list})});if(window.YanceNotificationView)window.YanceNotificationView.mutedAccounts=list;window.dispatchEvent(new CustomEvent('yance:notification-view-changed',{detail:window.YanceNotificationView}));}
  updateMuteAccountButton();updateViewingIndicator();hint(list.includes(id)?'已静音此账号，该账号所有会话新消息不再响铃':'已取消静音此账号','info');}catch(e){hint(e&&e.message?e.message:'账号静音切换失败','error');}
}

function getActivePlatform(){ const c=getC(); return String((c&&c.platform)||'').trim().toLowerCase(); }
function readMutedPlatformsSync(){
  if(window.YanceNotificationView&&Array.isArray(window.YanceNotificationView.mutedPlatforms))return Array.from(window.YanceNotificationView.mutedPlatforms).map(String);
  return [];
}
async function getMutedPlatforms(){
  const sync=readMutedPlatformsSync();
  if(sync.length||(window.YanceNotificationView&&Array.isArray(window.YanceNotificationView.mutedPlatforms)))return sync;
  try{const data=await apiJson('/api/r32/system/notifications',{method:'GET'});const s=(data&&(data.settings||data))||{};window.YanceNotificationView=Object.assign(window.YanceNotificationView||{},{enabled:s.enabled,soundEnabled:s.soundEnabled,paused:s.paused,dnd:s.dnd,mutedConversations:s.mutedConversations||[],mutedAccounts:s.mutedAccounts||[],mutedPlatforms:s.mutedPlatforms||[]});return (s.mutedPlatforms||[]).map(String);}catch(_){return [];}
}
function updateMutePlatformButton(){
  try{const mb=$('chatMutePlatformBtn');if(!mb)return;const p=getActivePlatform();const muted=Boolean(p)&&readMutedPlatformsSync().includes(p);mb.classList.toggle('active',muted);mb.title=muted?('取消静音平台 '+p):('静音平台 '+p);mb.setAttribute('aria-label',mb.title);mb.disabled=!p;}catch(_){}
}
async function toggleMutePlatform(){
  const p=getActivePlatform();if(!p)return;const list=await getMutedPlatforms();const i=list.indexOf(p);if(i>=0)list.splice(i,1);else list.push(p);
  try{if(typeof window.yanceUpdateNotifications==='function'){await window.yanceUpdateNotifications({mutedPlatforms:list});}else{await apiJson('/api/r32/system/notifications',{method:'POST',body:JSON.stringify({mutedPlatforms:list})});if(window.YanceNotificationView)window.YanceNotificationView.mutedPlatforms=list;window.dispatchEvent(new CustomEvent('yance:notification-view-changed',{detail:window.YanceNotificationView}));}
  updateMutePlatformButton();updateViewingIndicator();hint(list.includes(p)?('已静音平台 '+p+'，该平台所有会话新消息不再响铃'):('已取消静音平台 '+p),'info');}catch(e){hint(e&&e.message?e.message:'平台静音切换失败','error');}
}

function renderHeader(){
 const c=getC(),hasConversation=Boolean(activeId&&c.id);
 if(hasConversation)mountRuntimeAvatar($('chatAvatar'),c,true);else $('chatAvatar').replaceChildren();
 $('chatAvatar').classList.toggle('online',Boolean(hasConversation&&c.online));$('chatName').textContent=hasConversation?(c.name||'未命名会话'):'会话中心';
 const platformLabel={whatsapp:'WhatsApp',telegram:'Telegram',facebook:'Facebook'}[String(c.platform||'').toLowerCase()]||profileText(c.platform,'未选择平台');
 const route=resolveConversationAccount(c),platformBadge=$('chatPlatformBadge'),accountSelect=$('chatAccountSelect');
 if(platformBadge){platformBadge.hidden=!hasConversation;platformBadge.textContent=platformLabel;platformBadge.dataset.platform=String(c.platform||'').toLowerCase();platformBadge.dataset.state=!hasConversation?'empty':route.blocked?'blocked':c.online?'online':'history';platformBadge.title=route.identityConflict?`${route.reason||'当前发送来源身份不一致'}，已阻止发送`:route.capabilityBlock?route.reason||'账号已绑定，但真实发送能力尚未通过平台确认':c.online?`${platformLabel} 已连接`:`${platformLabel} 历史会话`}
 if(accountSelect)accountSelect.hidden=!hasConversation;
 renderHeaderPresence(hasConversation?c:emptyContact());renderAccountSelector(hasConversation?c:emptyContact());updateViewingIndicator();updateMuteButton();updateMuteAccountButton();updateMutePlatformButton();syncComposerState();syncUnderstandingState();
 window.dispatchEvent(new CustomEvent('yance:r32-active-conversation-changed',{detail:{contact:cloneData(hasConversation?c:emptyContact())}}))
}
function strongConversationLinkKeys(contact={}){
 const values=[contact.customerId,contact.canonicalCustomerId,contact.canonical_customer_id,contact.canonicalContactId,contact.canonical_contact_id,contact.customer?.id,contact.profile?.customerId,contact.identity?.canonicalContactId];
 return new Set(values.map(value=>profileText(value,'')).filter(Boolean))
}
function explicitlyLinkedConversations(contact=getC()){
 const keys=strongConversationLinkKeys(contact);if(!keys.size)return [];
 return contacts.filter(row=>row.id!==contact.id&&!row.archived&&[...strongConversationLinkKeys(row)].some(key=>keys.has(key)))
}
function accountIdentityAliases(account={}){
 if(conversationRouteAuthority?.accountIdentityAliases)return conversationRouteAuthority.accountIdentityAliases(account);
 const values=new Set(),add=value=>{if(Array.isArray(value)){value.forEach(add);return}const text=profileText(value,'');if(text)values.add(text)};
 [account.id,account.canonicalAccountId,account.canonical_account_id,account.adapterAccountId,account.adapter_account_id,account.authAccountKey,account.auth_account_key,account.externalId,account.external_id,account.pageId,account.page_id,account.page?.id,account.user?.id,
  account.metadata?.pageId,account.metadata?.page_id,account.metadata?.authAccountKey,account.metadata?.auth_account_key,account.metadata?.accountKey,account.metadata?.account_key,account.metadata?.openClawAccountId,account.metadata?.open_claw_account_id,account.metadata?.whatsappAccountId,account.metadata?.whatsapp_account_id,
  account.metadata?.resolvedAuthAccountKey,account.metadata?.resolved_auth_account_key,account.metadata?.livePage?.id,account.metadata?.page?.id,account.metadata?.liveUser?.id,account.metadata?.user?.id,
  account.metadata?.sourceAccountId,account.metadata?.source_account_id,account.metadata?.sourceAccountIds,account.metadata?.source_account_ids,account.metadata?.aliases,account.routeAliases,account.route_aliases,account.aliases].forEach(add);
 return [...values]
}
function resolveConversationAccount(contact=getC()){
 const boundId=String(contact?.accountId||contact?.account_id||contact?.sourceAccountId||contact?.source_account_id||'').trim(),conversationId=String(contact?.id||'');
 let resolution=conversationRouteAuthority?.resolve?conversationRouteAuthority.resolve(runtimeAccounts,contact):null;
 if(!resolution){const account=runtimeAccounts.find(a=>accountIdentityAliases(a).includes(boundId))||null;resolution={account,identityConflict:!boundId?'missing-binding':!account?'unresolved-binding':String(account.platform||'').toLowerCase()!==String(contact?.platform||'').toLowerCase()?'platform-mismatch':'',capabilityBlock:accountCanAttemptSend(account)?'':'not-sendable',sendable:accountCanAttemptSend(account),reconciledAlias:Boolean(account&&account.id!==boundId),reason:''}}
 if(resolution.identityConflict==='unresolved-binding'){
  const cached=lastGoodConversationRoutes.get(conversationId);
  if(cached&&cached.boundId===boundId&&Date.now()-cached.at<15000){const cachedResolution=conversationRouteAuthority?.resolve?conversationRouteAuthority.resolve([cached.account],contact):{account:cached.account,identityConflict:'',capabilityBlock:accountCanAttemptSend(cached.account)?'':'not-sendable',sendable:accountCanAttemptSend(cached.account),reconciledAlias:cached.account.id!==boundId,reason:''};resolution={...cachedResolution,transient:true}}
 }
 const result={...resolution,conflict:resolution.identityConflict||'',blocked:resolution.identityConflict||resolution.capabilityBlock||'',transient:resolution.transient===true,reconciledAlias:resolution.reconciledAlias===true};
 if(result.account&&!result.identityConflict&&conversationId)lastGoodConversationRoutes.set(conversationId,{boundId,account:{...result.account},at:Date.now()});
 return result
}
function accountConnectedNow(account={}){const lifecycle=String(account.lifecycleState||account.state||'').toLowerCase();return !['merged','tombstoned','migrating','deleted','paused'].includes(lifecycle)&&(accountCanAttemptSend(account)||account.canReceive===true||/online|connected|ready|limited/i.test(String(account.state||account.status||'')))}
function accountIdMatches(account={},value=''){const id=profileText(value,'');return Boolean(id)&&accountIdentityAliases(account).includes(id)}
function accountPlatformLabel(account={}){const platform=String(account.platform||'').toLowerCase();return {whatsapp:'WhatsApp',telegram:'Telegram',facebook:'Facebook'}[platform]||profileText(account.platform,'未知平台')}
function looksLikeInternalAccountIdentity(value=''){const text=profileText(value,'');return /^(?:fa|wa|tg|account|auth|adapter)[-_][a-z0-9][a-z0-9_-]{7,}$/i.test(text)||/^[a-f0-9]{8,}-[a-f0-9-]{8,}$/i.test(text)}
function looksLikeGenericAccountIdentity(value='',platform=''){const text=profileText(value,'').replace(/\s+/g,' ').trim(),label=accountPlatformLabel({platform});return !text||new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\s*账号)?$`,'i').test(text)||/^(?:平台账号|当前账号|默认账号|未命名账号)$/i.test(text)}
function accountRouteIdentity(account={}){
 const platform=String(account.platform||'').toLowerCase();
 const direct=platform==='facebook'
  ?[account.page?.name,account.pageName,account.metadata?.livePage?.name,account.metadata?.page?.name,account.metadata?.pageName,account.user?.name,account.metadata?.liveUser?.name,account.identityLabel,account.displayName,account.page?.username,account.user?.username,account.username]
  :[account.user?.name,account.metadata?.liveUser?.name,account.identityLabel,account.displayName,account.user?.username,account.username,account.phone,account.phoneNumber];
 const candidates=[...direct,account.phone,account.phoneNumber,account.authAccountKey,account.adapterAccountId,account.id].map(value=>profileText(value,'')).filter(Boolean);
 return candidates.find(value=>!looksLikeInternalAccountIdentity(value)&&!looksLikeGenericAccountIdentity(value,platform))||candidates.find(value=>!looksLikeInternalAccountIdentity(value))||'账号名称待同步'
}
function accountRouteDiagnosticIdentity(account={}){return [account.id,account.canonicalAccountId,account.adapterAccountId,account.authAccountKey].map(value=>profileText(value,'')).filter(Boolean).filter((value,index,rows)=>rows.indexOf(value)===index).join(' · ')}
function conversationRouteContext(contact=getC()){
 const resolution=resolveConversationAccount(contact),account=resolution.account||{},platform=String(contact?.platform||account.platform||'').toLowerCase(),target=profileText(contact?.phone||contact?.chatJid||contact?.externalId,'');
 return {conversationId:String(contact?.id||''),canonicalContactId:profileText(contact?.canonicalContactId||contact?.canonical_contact_id,''),customerId:profileText(contact?.customerId||contact?.canonicalCustomerId||contact?.canonical_customer_id,''),platform,platformLabel:accountPlatformLabel({platform}),sourceAccountId:profileText(contact?.accountId||account.id,''),resolvedAccountId:profileText(account.id||account.canonicalAccountId,''),sourceAccountIdentity:accountRouteIdentity(account),targetIdentity:target,accountConnected:Boolean(resolution.account&&accountConnectedNow(account)),accountCanSend:accountCanAttemptSend(resolution.account),accountSendVerified:resolution.account?.sendVerified===true,conflict:resolution.identityConflict||'',capabilityBlock:resolution.capabilityBlock||'',blocked:resolution.blocked||'',routeReason:resolution.reason||'',transient:resolution.transient===true,reconciledAlias:resolution.reconciledAlias===true,routeKey:[platform,profileText(contact?.accountId||account.id,''),target,String(contact?.id||'')].join('|')}
}
function routeOptionLabel(contact){const resolution=resolveConversationAccount(contact),account=resolution.account||{},platform=accountPlatformLabel({platform:contact.platform}),source=accountRouteIdentity(account);return `${platform} • ${source}`}
function renderAccountSelector(contact=getC()){
 const select=$('chatAccountSelect');if(!select)return;
 const resolution=resolveConversationAccount(contact);
 if(!contact.id){select.innerHTML='<option value="">请选择会话</option>';select.disabled=true;select.dataset.routeConflict='no-conversation';return}
 const linked=explicitlyLinkedConversations(contact),rows=[contact,...linked];
 select.innerHTML=rows.map(row=>`<option value="conversation:${htmlAttr(row.id)}" ${row.id===contact.id?'selected':''}>${htmlText(routeOptionLabel(row))}</option>`).join('');
 select.dataset.routeConflict=resolution.identityConflict||'';select.dataset.capabilityBlock=resolution.capabilityBlock||'';
 select.disabled=Boolean(resolution.identityConflict)||rows.length<2;
 const diagnosticIdentity=accountRouteDiagnosticIdentity(resolution.account||{});
 const baseTitle=resolution.identityConflict?(resolution.reason||'当前会话发送账号身份未解析'):resolution.capabilityBlock?(resolution.reason||'账号已绑定，但当前发送能力不可用'):rows.length<2?'当前没有经过明确客户身份绑定的其他在线账号；不会按同名或同头像猜测切换':resolution.transient?'其他在线账号状态刷新中，保留上一次已验证路由':'切换到该账号的会话（仅限同一客户明确绑定的其他在线账号）';
 select.title=diagnosticIdentity?`${baseTitle}。内部账号标识：${diagnosticIdentity}`:baseTitle;
}
async function switchConversationAccount(value){
 const current=getC(),text=String(value||'');if(!current.id||!text.startsWith('conversation:')){renderAccountSelector(current);return}
 const conversationId=text.slice('conversation:'.length);if(!conversationId||conversationId===current.id)return;
 const allowed=explicitlyLinkedConversations(current).find(row=>row.id===conversationId);
 if(!allowed){renderAccountSelector(current);hint('没有明确身份绑定，已阻止按同名或同头像切换会话','error',{duration:5000});return}
 await selectContact(allowed.id);hint(`已切换到 ${routeOptionLabel(allowed)}`)
}

function messageTimeValue(message){const value=new Date(message?.raw?.timestamp||message?.raw?.sentAt||message?.timestamp||message?.sentAt||0).getTime();return Number.isFinite(value)?value:0}
function messageGroupingKey(message){const raw=message?.raw||{},sender=message?.side==='me'?(raw.accountId||raw.senderAccountId||message?.accountId||'unknown-self'):(raw.senderId||raw.authorId||raw.participant||'contact');return [message?.side||'',sender].join(':')}
function messagesShareGroup(previous,current){if(!previous||!current||previous.type==='day'||previous.type==='unread'||current.type==='day'||current.type==='unread')return false;if(messageGroupingKey(previous)!==messageGroupingKey(current))return false;const a=messageTimeValue(previous),b=messageTimeValue(current);return !a||!b||Math.abs(b-a)<=180000}
function accountAvatarUrl(account={}){return profileText(account.avatarUrl||account.avatar_url||account.avatar||account.profilePicture||account.picture||account.photoUrl||account.photo_url||account.user?.avatarUrl||account.user?.avatar_url||account.user?.photoUrl||account.user?.photo_url||account.user?.photo||account.metadata?.liveUser?.avatarUrl||account.metadata?.liveUser?.avatar_url||account.metadata?.liveUser?.photoUrl||account.metadata?.liveUser?.photo_url||account.page?.picture||account.metadata?.picture||account.metadata?.pagePicture||account.metadata?.liveUser?.photo,'')}
function senderIdentityForMessage(message={}){const raw=message.raw||{},accountId=profileText(raw.accountId||raw.senderAccountId||message.accountId||'','');let account=runtimeAccounts.find(row=>accountIdMatches(row,accountId))||null;if(!account&&message.side==='me'){const current=getC(),route=resolveConversationAccount(current);if(!route.conflict)account=route.account;if(!account){const platform=String(raw.platform||current.platform||'').toLowerCase(),matches=runtimeAccounts.filter(row=>String(row.platform||'').toLowerCase()===platform&&accountConnectedNow(row));if(matches.length===1)account=matches[0]}}const resolved=Boolean(account);const name=profileText(account?.displayName||account?.identityLabel||account?.user?.name||account?.metadata?.liveUser?.name,resolved?'我方身份':'历史我方身份');const image=accountAvatarUrl(account||{});return {name,image,color:account?.color||themeColor('--avatar-surface-start'),resolved,account}}
function accountAvatarRecord(account={},fallbackName='我方身份'){return {id:profileText(account.id||account.canonicalAccountId||account.adapterAccountId,'self'),contactId:profileText(account.id||account.canonicalAccountId||account.adapterAccountId,'self'),name:profileText(account.displayName||account.identityLabel||account.user?.name||account.metadata?.liveUser?.name,fallbackName),avatarUrl:accountAvatarUrl(account),avatar:accountAvatarUrl(account),platform:profileText(account.platform,''),color:account.color||themeColor('--avatar-surface-start')}}
function messageAvatarMarkup(message={}){if(message.side!=='me'){const c=getC();return `<div class="message-avatar"><img src="${urlAttr(avatar(c),{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(c.name||'联系人')}头像"></div>`}const sender=senderIdentityForMessage(message),accountId=profileText(sender.account?.id||sender.account?.canonicalAccountId||sender.account?.adapterAccountId,'');const src=sender.image||svgAvatar(sender.name,sender.color);return `<div class="message-avatar placeholder ${htmlAttr(sender.resolved?'':'neutral')}" data-message-account-avatar="${htmlAttr(accountId)}" title="${htmlAttr(sender.resolved?sender.name:'历史消息未能还原当时发送账号，使用中性我方身份占位')}"><img src="${urlAttr(src,{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(sender.name)}头像"></div>`}
function hydrateMessageAccountAvatars(root){root?.querySelectorAll?.('[data-message-account-avatar]').forEach(host=>{const id=profileText(host.dataset.messageAccountAvatar,''),account=runtimeAccounts.find(row=>accountIdMatches(row,id));if(!account)return;const record=accountAvatarRecord(account);if(window.YanceAvatarRuntime?.mountAvatar)window.YanceAvatarRuntime.mountAvatar(host,record);else host.innerHTML=`<img src="${urlAttr(record.avatarUrl||svgAvatar(record.name,record.color),{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(record.name)}头像">`})}
function messageRouteLabel(message={}){const raw=message.raw||{},platform=String(raw.platform||getC().platform||'').toLowerCase(),accountId=profileText(raw.accountId||message.accountId||getC().accountId,''),account=runtimeAccounts.find(row=>accountIdMatches(row,accountId))||{},samePlatformAccounts=runtimeAccounts.filter(row=>String(row.platform||'').toLowerCase()===platform&&!['merged','tombstoned','deleted'].includes(String(row.lifecycleState||row.state||'').toLowerCase()));if(samePlatformAccounts.length<2&&!explicitlyLinkedConversations(getC()).length)return'';return `${accountPlatformLabel({platform})} · ${accountRouteIdentity(account)}`}
function messageRowHtml(side,bubble,avatarMarkup){return side==='me'?bubble+avatarMarkup:avatarMarkup+bubble}
function messageMediaSource(message={}){const value=String(message.mediaUrl||'').trim();return /^(?:https?:|\/|blob:|data:(?:image|audio|video)\/)/i.test(value)?value:''}
function messageMediaThumbnail(message={}){const value=String(message.thumbnailDataUrl||'').trim();return /^data:image\//i.test(value)?value:''}
function friendlyMediaRecoveryError(value=''){const text=String(value||'').trim();if(/MEDIA_ENVELOPE_MISSING|缺少.*(?:信封|凭证)|missing envelope/i.test(text))return'这条旧媒体缺少恢复凭证，无法继续使用过期地址；可尝试重新同步 WhatsApp 历史。';if(/mmg\.whatsapp\.net|failed to fetch stream|403|forbidden|expired/i.test(text))return'WhatsApp 原下载凭证已失效，正在等待平台重新同步媒体。';if(/not.?authorized|unauthorized/i.test(text))return'当前账号没有此媒体的下载授权，请重新连接后同步。';if(/item.?not.?found|404/i.test(text))return'WhatsApp 已无法提供这条旧媒体。';return text?'媒体恢复失败，请重新同步或稍后重试。':'媒体暂时无法恢复，可从媒体菜单重试'}
function mediaRecoveryLabel(message={}){const state=String(message.mediaStatus||message.supportState||'').toLowerCase();if(/failed|error|forbidden|missing|expired|unavailable|unsupported/.test(state))return friendlyMediaRecoveryError(message.mediaError);if(/queued|pending/.test(state))return '媒体已进入恢复队列，轮到后自动开始';if(/downloading|recovering|syncing|remote/.test(state))return '媒体正在后台恢复，请稍候';return message.mediaPath?'本地媒体索引存在，但可播放地址尚未建立':'媒体尚未缓存到本机'}
function messageVoiceMarkup(message={}){if(!message.voice)return'';const source=messageMediaSource(message),durationMarkup=message.duration?`<time>${htmlText(message.duration)}</time>`:'',waveform=String(message.waveformBase64||'');return `<div class="voice message-audio" data-media-kind="${htmlAttr(message.mediaKind||'voice')}" data-media-status="${htmlAttr(message.mediaStatus||'')}" data-waveform="${htmlAttr(waveform)}">${source?`<audio controls preload="metadata" src="${urlAttr(source,{allowBlob:true,allowRelative:true,allowHttp:true,allowHttps:true})}"></audio>`:`<span>${htmlText(mediaRecoveryLabel(message))}</span>`}${durationMarkup}${source?'<button type="button" class="media-analyze-btn">语音转写</button>':message.mediaRetryable===false?'':'<button type="button" class="media-retry-btn">重试恢复语音</button>'}</div>`}
function messageCompactExpressionHint(message={}){
 const kind=String(message.mediaKind||message.type||'').toLowerCase(),presentation=String(message.mediaPresentation||'').toLowerCase(),raw=message.raw||{},attachment=Array.isArray(raw.attachments)?raw.attachments[0]||{}:{};
 return kind==='sticker'||presentation==='compact-expression'||Boolean(message.platformExpressionId||attachment.platformExpressionId||attachment.stickerId||attachment.sticker_id||attachment.payload?.sticker_id||attachment.payload?.stickerId)
}
function messageMediaMarkup(message={}){
 if(!message.media||message.voice)return'';
 const kind=String(message.mediaKind||message.type||'image').toLowerCase(),mime=String(message.mimeType||'').toLowerCase(),source=messageMediaSource(message),thumbnail=messageMediaThumbnail(message),compact=messageCompactExpressionHint(message),platform=String(message.raw?.platform||getC().platform||'').toLowerCase(),attributes=`data-media-kind="${htmlAttr(kind)}" data-platform="${htmlAttr(platform)}" data-compact-expression="${htmlAttr(compact?'1':'0')}" data-has-visible-text="${htmlAttr(messageVisibleText(message).trim()?'1':'0')}" data-animated-media="${htmlAttr(message.isAnimatedSticker?'1':'0')}" data-sticker-format="${htmlAttr(message.stickerFormat||'')}"`;
 if(message.mediaRenderable===false){const fallbackMarkup=thumbnail?`<img src="${urlAttr(thumbnail,{allowDataImage:true})}" alt="动态贴纸缩略图">`:'';return `<div class="media-card media-unsupported ${compact?'media-compact-expression':''}" ${attributes}>${fallbackMarkup}<div><b>${htmlText(message.stickerFormat==='lottie'?'动态贴纸已识别，当前使用缩略图':'该媒体格式暂不支持直接播放')}</b><span>${htmlText(message.text||'媒体已安全保存。')}</span></div></div>`}
 if(!source){const fallbackMarkup=thumbnail?`<img class="media-pending-thumbnail" src="${urlAttr(thumbnail,{allowDataImage:true})}" alt="媒体缩略图">`:'';return `<div class="media-card media-unavailable ${compact?'media-compact-expression':''}" data-media-status="${htmlAttr(message.mediaStatus||'')}" ${attributes}>${fallbackMarkup}<span>${htmlText(mediaRecoveryLabel(message))}</span>${message.mediaRetryable===false?'':'<button type="button" class="media-retry-btn">重试恢复媒体</button>'}</div>`}
 let preview='';
 if(kind==='video'||((kind==='gif'||kind==='sticker')&&/^video\//.test(mime)))preview=`<video controls preload="metadata" playsinline ${kind==='gif'?'autoplay loop muted':''} src="${urlAttr(source,{allowBlob:true,allowRelative:true,allowHttp:true,allowHttps:true})}"></video>`;
 else if(['document','file'].includes(kind))preview=`<a class="message-file-link" href="${urlAttr(source,{allowBlob:true,allowRelative:true,allowHttp:true,allowHttps:true})}" target="_blank" rel="noopener noreferrer">打开文件${message.fileName?`：${htmlText(message.fileName)}`:''}</a>`;
 else preview=`<img src="${urlAttr(source,{allowDataImage:true,allowBlob:true,allowRelative:true,allowHttp:true,allowHttps:true})}" alt="${htmlAttr(message.isAnimatedSticker?'动态贴纸':kind==='gif'?'GIF':'媒体预览')}">`;
 const analyze=!compact&&['image','gif','video'].includes(kind)?'<button type="button" class="media-analyze-btn">内容识别</button>':'';
 return `<div class="media-card ${compact?'media-compact-expression':''}" ${attributes}>${preview}${analyze}</div>`
}
function enhanceCompactMessageMedia(root){
 root?.querySelectorAll?.('.media-card').forEach(card=>{
  const apply=()=>{
   const image=card.querySelector('img'),explicit=card.dataset.compactExpression==='1'||card.dataset.mediaKind==='sticker';
   const legacyFacebookExpression=card.dataset.platform==='facebook'&&card.dataset.hasVisibleText!=='1'&&image&&image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth<=160&&image.naturalHeight<=160;
   if(!explicit&&!legacyFacebookExpression)return;
   card.classList.add('media-compact-expression');
   card.querySelector('.media-analyze-btn')?.remove();
  };
  const image=card.querySelector('img');
  if(image&&!image.complete)image.addEventListener('load',apply,{once:true});else apply();
 })
}
function messageHasMediaPlaceholderText(message={}){return Boolean((message.media||message.voice)&&/^\[(?:image|photo|video|audio|voice|file|document|attachment|sticker|gif|media|图片|照片|视频|音频|语音|文件|文档|附件|贴纸|动图)\]$/i.test(String(message.text||'').trim()))}
function messageVisibleText(message={}){return messageHasMediaPlaceholderText(message)?'':String(message.text||'')}
function messageTextIsChineseDominant(text=''){const value=String(text||'').replace(/https?:\/\/\S+|www\.\S+/gi,' ').replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,' '),han=(value.match(/[\u3400-\u9fff]/g)||[]).length,latin=(value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)||[]).length;return han>0&&(!latin||(han>=2&&han*2>=latin))}
function messageNeedsChineseTranslation(message={}){const text=messageVisibleText(message).trim(),language=String(message.sourceLanguage||message.language||'').trim().toLowerCase(),knownChinese=language==='zh'||language.startsWith('zh-')||(!language&&messageTextIsChineseDominant(text));return Boolean(message.id)&&Boolean(text)&&!knownChinese&&!String(message.cn||message.lastSuccessfulCn||'').trim()}
function messageTranslationMarkup(message={}){
 const status=String(message.translationStatus||'').toLowerCase(),current=String(message.cn||''),preserved=String(message.lastSuccessfulCn||''),visible=current||preserved;
 if(status==='pending')return visible?`<div class="translation translation-pending translation-preserved"><span>${htmlText(visible)}</span><small>正在更新中文翻译，暂时保留上次成功结果</small></div>`:'<div class="translation translation-pending">正在翻译为中文…</div>';
 if(status==='failed')return visible?`<div class="translation translation-failed translation-preserved"><span>${htmlText(visible)}</span><small>${htmlText(message.translationError||'本次更新失败，已保留上次成功结果')}</small></div>`:`<div class="translation translation-failed">${htmlText(message.translationError||'中文翻译失败')} · 可重试</div>`;
 if(status==='cancelled')return visible?`<div class="translation translation-cancelled translation-preserved"><span>${htmlText(visible)}</span><small>本次翻译已取消，保留上次成功结果</small></div>`:'<div class="translation translation-cancelled">中文翻译已取消</div>';
 if(visible)return `<div class="translation">${htmlText(visible)}</div>`;
 if(messageNeedsChineseTranslation(message))return '<div class="translation translation-pending translation-auto-needed" data-auto-translation-needed="1">等待中文翻译…</div>';
 return ''
}
function renderMessages(){
 const arr=histories[activeId]||[],host=$('messages');
 const previousConversationId=host.dataset.conversationId||'';
 const sameConversation=previousConversationId===activeId;
 const previousCount=Number(host.dataset.messageCount||0);
 const previousScrollTop=host.scrollTop;
 const previousScrollHeight=host.scrollHeight;
 const savedScrollState=normalizedMessageScrollState(messageScroll[activeId]);
 const previousScrollState=savedScrollState;
 const wasNearBottom=savedScrollState?savedScrollState.mode==='bottom':!sameConversation;
 messageBottomLock[activeId]=Boolean(wasNearBottom);
 beginMessageScrollRestore(host);
 const indicator=ensureNewMessageIndicator(host);
 if(!activeId){const hasActive=activeContacts().length>0;host.innerHTML=`<div class="ui-empty-state chat-empty-guidance"><div><div class="ui-empty-orb"></div><b>${hasActive?'请选择左侧会话':'连接平台账号'}</b><p>${hasActive?'选中会话后，这里显示历史消息、翻译和AI辅助。':'连接 WhatsApp、Telegram 或 Facebook 后，会话会自动出现在左侧。'}</p>${hasActive?'':'<button type="button" data-open-account-center>打开统一账号中心</button>'}</div></div>`;host.querySelector('[data-open-account-center]')?.addEventListener('click',()=>window.__Y27?.openAccountsPage?.(''));host.dataset.conversationId='';host.dataset.messageCount='0';if(indicator)indicator.hidden=true;finishMessageScrollRestore(host);return}
 if(!arr.length){host.innerHTML='<div class="ui-empty-state"><div><div class="ui-empty-orb"></div><b>暂无历史消息</b><p>发送或收到消息后会自动显示。</p></div></div>';host.dataset.conversationId=activeId;host.dataset.messageCount='0';if(indicator)indicator.hidden=true;finishMessageScrollRestore(host);return}
 host.innerHTML=arr.map((m,i)=>{if(m.type==='day')return `<div class="day">${htmlText(m.text)}</div>`;if(m.type==='unread')return `<div class="unread-divider">${htmlText(m.text)}</div>`;const previous=arr[i-1],next=arr[i+1],groupStart=!messagesShareGroup(previous,m),groupEnd=!messagesShareGroup(m,next);const q=m.quote?`<div class="quote"><b>${htmlText(m.quote.split('|')[0]||'引用')}</b>${htmlText(m.quote.split('|').slice(1).join('|'))}</div>`:'';const media=messageMediaMarkup(m),voice=messageVoiceMarkup(m),translation=messageTranslationMarkup(m),visibleText=messageVisibleText(m),hasTranslation=Boolean(String(m.cn||m.lastSuccessfulCn||'').trim());const reactions=(m.reactions||[]).length?`<div class="message-reactions">${m.reactions.map(r=>`<span>${htmlText(r.emoji||'')}</span>`).join('')}</div>`:'';const bubble=`<article class="msg ${htmlAttr(m.side==='me'?'me':'')} ${htmlAttr(hasTranslation?'has-translation':'translation-missing')}" data-msg="${htmlAttr(i)}" data-message-id="${htmlAttr(m.id||'')}" data-external-message-id="${htmlAttr(m.externalMessageId||m.id||'')}" data-queue-id="${htmlAttr(m.queueId||'')}" data-from-me="${htmlAttr(m.side==='me'?'1':'0')}" data-auto-translation-needed="${htmlAttr(messageNeedsChineseTranslation(m)?'1':'0')}">${q}${media}${voice}${visibleText?`<p class="message-original" data-emoji-motion="${htmlAttr(m.animatedEmojiMotion||'')}" style="margin-top:${sanitizeCssNumber(m.media||m.voice?8:0,{min:0,max:64,unit:'px'})}">${htmlText(visibleText)}</p>`:''}${translation}${reactions}<footer>${translation?'<button class="translate-toggle">隐藏翻译</button>':''}${messageRouteLabel(m)?`<small class="message-route-label">${htmlText(messageRouteLabel(m))}</small>`:''}<span>${htmlText(m.time||'')}</span><em>${htmlText(m.statusLabel||'')}</em></footer></article>`;const avatarMarkup=groupEnd?messageAvatarMarkup(m):'<div class="message-avatar hidden-anchor" aria-hidden="true"></div>';return `<div class="message-row ${htmlAttr(m.side==='me'?'me':'')} ${htmlAttr(groupStart?'group-start':'')}">${messageRowHtml(m.side,bubble,avatarMarkup)}</div>`}).join('');
 host.dataset.conversationId=activeId;
 host.dataset.messageCount=String(arr.length);
 hydrateMessageAccountAvatars(host);
 enhanceCompactMessageMedia(host);
 window.YanceMediaPlayback?.enhance?.(host);
 window.dispatchEvent(new CustomEvent('yance:r32-messages-rendered',{detail:{conversationId:activeId,messageCount:arr.length}}));
 host.querySelectorAll('.translate-toggle').forEach(b=>b.onclick=()=>{const t=b.closest('.msg').querySelector('.translation');t.classList.toggle('collapsed');b.textContent=t.classList.contains('collapsed')?'显示翻译':'隐藏翻译'});
 requestAnimationFrame(()=>{
   const meta=historyMeta[activeId]||{};
   const newMessageCount=sameConversation?Math.max(0,arr.length-previousCount):0;
   let restoredMode='bottom';
   if(meta.prependAnchor){host.scrollTop=Math.max(0,previousScrollTop+(host.scrollHeight-previousScrollHeight));restoredMode='anchor'}
   else{const targetState=savedScrollState;const restored=restoreMessageScrollState(host,targetState,{defaultBottom:!targetState});restoredMode=restored.mode}
   meta.prependAnchor=false;historyMeta[activeId]=meta;
   if(!messageScroll[activeId])messageScroll[activeId]={version:3,mode:restoredMode==='bottom'?'bottom':'offset',scrollTop:host.scrollTop};
   if(sameConversation&&restoredMode!=='bottom'&&newMessageCount>0&&!meta.loadingOlder)showNewMessageIndicator(newMessageCount);else if(restoredMode==='bottom'||!sameConversation||meta.loadingOlder)hideNewMessageIndicator();
   finishMessageScrollRestore(host);
 });
 window.dispatchEvent(new CustomEvent('yance:r32-messages-rendered',{detail:{activeId,previousCount,nextCount:arr.length,wasNearBottom}}))
}
function renderNotes(){
 const c=getC(),profile=cleanProfileObject(profileState[c.id]||{});if(c.id)mountRuntimeAvatar($('noteAvatar'),c,false);else $('noteAvatar').replaceChildren();$('noteName').textContent=c.name||'未选择联系人';$('noteMeta').textContent=[c.country,c.languages,c.stage].filter(Boolean).join(' · ');
 const presenceUnsupported=!contactPresenceSupported(c),activityFact=presenceUnsupported?['最近互动',profileText(c.time,c.last,'')]:['当前状态',contactPresenceLabel(c)];
 const values=[['年龄',c.age],['地址',c.address],['家庭情况',c.family],['职业',c.job],['语言与沟通',c.languages],['关系阶段',businessLabel('relationshipStage',c.stage,'待确认')],['兴趣',c.interests],activityFact];$('factGrid').innerHTML=values.map(x=>`<article class="fact"><span>${htmlText(x[0])}</span><b>${htmlText(profileText(x[1],'未确认'))}</b></article>`).join('');$('noteText').textContent=profileText(c.note,'暂无已确认备注');
 const factHost=$('confirmedFactList'),inferHost=$('inferenceList');
 const toRow=(item,fallback)=>{const text=typeof item==='string'?item:(item?.text||item?.value||item?.fact||item?.title||fallback);const meta=typeof item==='object'?(item.source||item.status||item.confidence||'已记录'):'已确认';return `<div class="source-row"><span>${htmlText(text||fallback)}</span><i>${htmlText(String(meta))}</i></div>`};
 if(factHost)factHost.innerHTML=(profile.confirmed||[]).length?(profile.confirmed||[]).map(x=>toRow(x,'已确认事实')).join(''):'<div class="source-row"><span>暂无已确认事实</span><i>等待录入</i></div>';
 if(inferHost)inferHost.innerHTML=(profile.inferences||[]).length?(profile.inferences||[]).map(x=>toRow(x,'AI推断')).join(''):'<div class="source-row"><span>暂无经过审核的AI推断</span><i>未分析</i></div>';
 renderUtilityTimeline();
}
function stashConversationState(){if(!composerOwnerId)return;drafts[composerOwnerId]=$('composerText').value;saveMessageScrollState(composerOwnerId,$('messages'),{force:true})}
function cancelTypingForContact(contact, cause = 'conversation_changed') {
  if (!contact?.id || !contact?.accountId || !contact?.chatJid) return;
  const payload = {
    contactId: contact.id,
    conversationId: contact.id,
    accountId: contact.accountId,
    platform: contact.platform || 'whatsapp',
    chatJid: contact.chatJid,
    cause,
    reason: String(cause || 'conversation_changed').toUpperCase()
  };
  window.YanceCore?.messages?.cancelTyping?.(payload)?.catch?.(() => {});
  window.YanceCore?.messages?.presence?.({
    platform: payload.platform,
    accountId: payload.accountId,
    chatJid: payload.chatJid,
    state: 'paused'
  })?.catch?.(() => {});
}
function syncBackendActiveConversation(contactId, options = {}) {
  try {
    const focused = options.focused === undefined
      ? (typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true)
      : !!options.focused;
    const body = JSON.stringify({ activeConversationId: String(contactId || ''), focused });
    apiJson('/api/r32/system/notifications', { method: 'POST', body, timeoutMs: 8000 }).catch(() => {});
  } catch (_) {}
}
if (typeof window !== 'undefined' && !window.__y27ActiveConvFocusBound) {
  window.__y27ActiveConvFocusBound = true;
  const rePushFocus = () => { try { syncBackendActiveConversation(activeId, { focused: document.hasFocus() }); } catch (_) {} try { updateViewingIndicator(); } catch (_) {} };
  window.addEventListener('focus', rePushFocus);
  window.addEventListener('blur', rePushFocus);
  window.addEventListener('yance:notification-view-changed', () => { try { updateViewingIndicator(); } catch (_) {} try { updateMuteButton(); } catch (_) {} try { updateMuteAccountButton(); } catch (_) {} try { updateMutePlatformButton(); } catch (_) {} });
}
function replyAbortReason(code='AI_REPLY_GENERATION_SUPERSEDED'){const error=new Error(code);error.name='AbortError';error.code=code;return error}
function abortReplyCandidateRequest(conversationId,code='AI_REPLY_GENERATION_SUPERSEDED'){const key=String(conversationId||'');const controller=replyCandidateRequestControllers.get(key);if(!controller)return false;replyCandidateRequestControllers.delete(key);if(!controller.signal.aborted)controller.abort(replyAbortReason(code));return true}
function beginReplyCandidateRequest(conversationId){const key=String(conversationId||'');abortReplyCandidateRequest(key);const controller=new AbortController();replyCandidateRequestControllers.set(key,controller);return controller}
function finishReplyCandidateRequest(conversationId,controller){const key=String(conversationId||'');if(replyCandidateRequestControllers.get(key)===controller)replyCandidateRequestControllers.delete(key)}
function isReplyAbortError(error){return error?.name==='AbortError'||error?.name==='ReplyGenerationSupersededError'||/AI_REPLY_GENERATION_SUPERSEDED|NEW_INCOMING_MESSAGE/.test(String(error?.code||''))}
async function selectContact(id,options={}){
 const selected=contacts.find(c=>c.id===id);if(!selected)return;if(selected.archived&&filter!=='archived')return;
 const previous=contacts.find(c=>c.id===activeId);if(previous&&previous.id!==id){cancelTypingForContact(previous,'conversation_changed');abortReplyCandidateRequest(previous.id)}
 const requestToken=++conversationContextRequestToken;stashConversationState();activeId=id;selectedIdentity=id;if(!selected.archived){selectedProfile=id;selectedTimeline=id}composerOwnerId=id;if(options.fromStore!==true)publishActiveContact(id,{source:options.source||'r32-ui-runtime:conversation',reason:options.reason||'conversation-selected',view:'conversation',allowArchived:selected.archived});
 syncBackendActiveConversation(id);
 const c=getC(),previousUnread=unreadCountOf(c);clearUnreadState(c);$('composerText').value=drafts[id]||'';$('composerText').dataset.replySource='manual';delete $('composerText').dataset.aiConversationRevision;renderContacts();renderHeader();renderNotes();renderMessages();persistState();enforceHistoryMemoryBudget(id);
 const tasks=[loadConversationMessages(id,true,{requestToken}),loadCrossModuleContext(id,{render:true,requestToken}),loadStoreSocialContext(id,{requestToken}),markConversationRead(c),loadOutboundLanguage(id)];
 const results=await Promise.allSettled(tasks);if(requestToken!==conversationContextRequestToken)return;const contextFailure=results.slice(0,3).find(result=>result.status==='rejected'),readResult=results[3],readFailure=readResult?.status==='rejected'?readResult:null;if(readFailure&&previousUnread>0){c.unread=previousUnread;c.unreadCount=previousUnread;renderContacts()}if(readFailure)hint(readFailure.reason?.message||'会话已读状态同步失败','error');else if(contextFailure)hint(contextFailure.reason?.message||'会话辅助信息加载失败，已读状态不受影响','error');
 const readSynced=readResult?.status==='fulfilled';if(activeContactStore)activeContactStore.announceLegacy({contact:getC(),readSynced});else window.dispatchEvent(new CustomEvent('yance:r32-contact-selected',{detail:{contact:getC(),readSynced}}))
}
function openPanel(name){
 document.querySelectorAll('.ai-view').forEach(s=>s.classList.toggle('active',s.dataset.panel===name));
 document.querySelectorAll('#mainTabs button,#utilityTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
 $('aiTitle').textContent={understanding:'AI 回复大脑',director:'策略导演',candidates:'候选回复',notes:'关系备注',media:'媒体',timeline:'关系轨迹',learning:'回复学习'}[name]||'AI 回复大脑';if(name==='learning')loadReplyLearning(activeId,{render:true}).catch(error=>hint(error.message||'回复学习读取失败','error'));
 // AC-038: refresh candidate states from store before showing panel
 if(name==='candidates'&&candidateBase.length){
  fetch('/api/v2/store/snapshot?domains=aiBrain')
   .then(r=>r.ok?r.json():null)
   .then(data=>{if(!data?.snapshot?.aiBrain?.candidatesById)return;const states={};for(const[id,c]of Object.entries(data.snapshot.aiBrain.candidatesById))states[id]=c.state||'generated';let stale=0;candidateBase.forEach(c=>{if(states[c.candidateId]==='reverify_required'){c._stale=true;stale++}else c._stale=false});if(stale)hint(`⚠ 有 ${stale} 条候选的 Persona 版本已更新，请重新生成后再使用`,'warning');renderCandidates()})
   .catch(()=>{})
 }
}
function updateDirector(){
 const strategy=document.querySelector('input[name=strategy]:checked')?.value||'自然承接';const selected=[...document.querySelectorAll('#palette button.active')].map(b=>b.textContent).join(' + ')||'未选择';const analysis=lastAnalysis||{};
 $('directorSummary').innerHTML=`<b>本轮目标：</b>${htmlText($('goal').value)}<br><b>当前策略：</b>${htmlText(strategy)}<br><b>人物状态：</b>${htmlText($('persona').value)}；关系节奏：${htmlText($('pace').value)}<br><b>语气与调色：</b>${htmlText($('tone').value)}，${htmlText(selected)}，总体强度 ${htmlText($('strength').value)}%<br><b>真实分析摘要：</b>${htmlText(aiSummaryText(analysis.summary||analysis.intent,'尚未执行真实分析'))}<br><b>避免：</b>${htmlText($('avoid').value)}<br><b>临时指令：</b>${htmlText($('directorInstruction').value||'无')}`
}
function setCandidateProcessState(state,text,action=null){const host=$('candidateProcessStatus');if(!host)return;host.dataset.state=state||'idle';const label=host.querySelector('span'),button=$('candidateProcessAction');if(label)label.textContent=text||'等待生成候选';if(button){button.hidden=!action;button.textContent=action?.label||'处理';button.onclick=typeof action?.run==='function'?action.run:null}}
function candidateFailureDetailsHtml(failure){
 if(!failure)return '';
 const stages=[...(failure.priorStages||[]),{stage:failure.stage,label:failure.stageLabel,status:'failed'}];
 const stageRows=stages.map(row=>`<li data-state="${htmlAttr(row.status||'pending')}"><b>${htmlText(row.label||row.stage||'AI 阶段')}</b><span>${htmlText(row.status==='completed'?'已完成':row.status==='failed'?'失败':'等待')}${row.model?` · ${htmlText(row.model)}`:''}</span></li>`).join('');
 const attemptRows=(failure.attempts||[]).map(row=>`<li><b>${htmlText(row.model||'模型待确认')}</b><span>${htmlText(row.statusLabel||'失败')} · ${htmlText(row.messageZh||'模型调用失败')}</span>${row.code?`<small>${htmlText(row.code)}</small>`:''}</li>`).join('');
 return `<section class="candidate-stage-failure"><header><div><b>${htmlText(failure.stageLabel||'候选生成')}失败</b><p>${htmlText(failure.text||'候选生成失败')}</p></div><span>${htmlText(failure.fallbackAttempted?'已尝试备用模型':'未完成备用接管')}</span></header><ol class="candidate-stage-flow">${stageRows}</ol>${attemptRows?`<details open><summary>本次模型尝试（${htmlText(failure.attempts.length)}）</summary><ol class="candidate-attempt-list">${attemptRows}</ol></details>`:''}<footer><span>${htmlText(failure.nextAction||'请检查模型配置后重试')}</span></footer></section>`
}
function candidateFailurePresentation(error){
 const analysisModel=profileText(lastAnalysis?._model?.name||lastAnalysis?._model?.id,'');const priorStages=[{stage:'understanding',label:'消息理解',status:currentAnalysisReady()?'completed':'pending',model:analysisModel},{stage:'director',label:'策略导演',status:currentAnalysisReady()?'completed':'pending',model:analysisModel}];
 const projected=aiBusinessPresentation.failureProjection?.(error,{priorStages})||{code:String(error?.code||''),text:safeUiText(error?.message||error,'候选生成失败'),attempts:[],priorStages,stage:'candidate_generation',stageLabel:'候选生成',nextAction:'打开 AI 工作台查看模型配置'};
 const signature=`${projected.code||''} ${projected.text||''}`;
 if(/CUSTOMER_NOT_FOUND|SOCIAL_CONTACT_RESOLUTION_FAILED|Customer social context was not found/i.test(signature))return {...projected,state:'error',text:'当前会话的客户上下文未完成同步',action:{label:'重新同步并重试',run:async()=>{await refreshAllData?.().catch(()=>{});generateAiCandidates()}}};
 if(/NO[_ -]?MODEL|MODEL.*(?:UNCONFIGURED|UNAVAILABLE|INELIGIBLE)|UNKNOWN_TASK|没有可用于真实回复的合格模型|模型.*(?:未配置|不可用|不合格)/i.test(signature))return {...projected,state:'unconfigured',text:'当前没有可用于真实回复的合格主模型与备用模型',action:{label:'前往 AI 工作台配置',run:()=>$('navAiWorkbench')?.click()}};
 if(/QUALITY|质量|QUESTION_COUNT|FACT|REPETITION|SIMILAR|LANGUAGE_MISMATCH/i.test(signature))return {...projected,state:'error',text:'本次候选未通过语言、Persona 或 WhatsApp 质量门禁',action:{label:'重新生成',run:()=>generateAiCandidates()}};
 return {...projected,state:'error',action:{label:projected.retryable?'重新生成':'打开 AI 工作台',run:projected.retryable?()=>generateAiCandidates():()=>$('navAiWorkbench')?.click()}}
}
function renderCandidates(){
 const host=$('candidateList'),failureHtml=candidateFailureDetailsHtml(candidateFailureState);
 if(!candidateBase.length){host.innerHTML=failureHtml+'<div class="ui-empty-state"><div><div class="ui-empty-orb"></div><b>暂无真实候选</b><p>平衡模式默认生成 3 条可筛选候选；深度模式生成 4 条；极速模式仅生成 1 条。</p></div></div>';if($('mergeSelected'))$('mergeSelected').disabled=true;if(!candidateFailureState)setCandidateProcessState('idle','等待生成候选');return}
 const selectedStrategy=document.querySelector('input[name=strategy]:checked')?.value||'自然承接';
 host.innerHTML=failureHtml+candidateBase.map((s,i)=>{const task=s.replyTask==='deep_reply'?'深度回复':'快速回复',language=candidateLanguageLabel(s.language),stale=Boolean(s._stale);return `<article class="candidate ${htmlAttr(stale?'stale':'')}" data-i="${htmlAttr(i)}" data-candidate-id="${htmlAttr(s.candidateId||'')}"><div class="candidate-head"><h4>${htmlText(s.name||`候选 ${i+1}`)}</h4><span>${htmlText(i===0?'AI推荐 · ':'')}${htmlText(selectedStrategy)}</span></div><div class="candidate-route-line"><i>${htmlText(task)}</i><i>${htmlText(language)}</i><i>${htmlText(s.model||s.modelId||'模型待确认')}</i><i>${htmlText(s.effectivePersonaLabel||'当前 Persona')}</i><i>${htmlText(businessLabel('interactionStyle',s.generationMetadata?.styleVariant,s.name||'自然承接'))}</i><i>人工确认后发送</i></div>${(s.modelAttempts||s.generationMetadata?.modelAttempts||[]).length?`<details class="candidate-model-attempts"><summary>实际模型与回退链</summary>${(s.modelAttempts||s.generationMetadata?.modelAttempts||[]).map(row=>`<p><b>${htmlText(row.model||row.modelId||'模型')}</b> · ${htmlText(row.status==='success'?'成功':row.status==='circuit_open'?'熔断跳过':'失败')}</p>`).join('')}</details>`:''}${stale?'<div class="candidate-stale-warning">人物规则已经更新，这条候选已失效。请重新生成后再使用。</div>':''}<div class="reply foreign-original" lang="${htmlAttr(s.language||'de')}">${htmlText(s.de||s.text||'')}</div>${s.cn?`<p class="candidate-cn success">中文回译：${htmlText(s.cn)}</p>`:s.translationStatus==='failed'?'<p class="candidate-cn failed">中文回译失败，请重新生成或在发送前核对外语原文。</p>':'<p class="candidate-cn pending">中文回译正在生成，完成前请勿盲目发送。</p>'}${s.generationMetadata?.styleChange?.verified?`<div class="candidate-style-proof">风格微调已验证 · ${htmlText(s.generationMetadata.styleChange.requested||'')} · 与原候选相似度 ${htmlText(Math.round(Number(s.generationMetadata.styleChange.similarity||0)*100))}% · ${htmlText(s.generationMetadata.styleChange.attempts||1)} 次生成</div>`:''}${s.translationQuality&&s.translationQuality.status&&s.translationQuality.status!=='pass'?`<div class="candidate-translation-warning ${htmlAttr(s.translationQuality.status)}"><b>${htmlText(s.translationQuality.status==='blocking'?'中文回译需要核对':'中文回译存在提示')}</b><p>${htmlText((s.translationQuality.issues||[]).map(issue=>issue.message).join('；')||'请核对姓名、数字、链接和术语后再发送。')}</p></div>`:''}<p class="candidate-strategy">策略说明：${htmlText(s.strategy||'基于客户档案、关系轨迹与真实上下文生成')}</p>${Array.isArray(s.learningApplication?.applied)&&s.learningApplication.applied.length?`<details class="candidate-learning-proof"><summary>本次命中的已审核学习（${htmlText(s.learningApplication.applied.length)}）</summary>${s.learningApplication.applied.map(row=>`<p><b>${htmlText(businessLabel('interactionStyle',row.key,row.key||'学习偏好'))}</b>：${htmlText(businessLabel('interactionStyle',row.value,row.value||''))} · ${htmlText(businessLabel('learningScope',row.scope,'未知范围'))} · 置信度 ${htmlText(Math.round(Number(row.confidence||0)*100))}%</p>`).join('')}</details>`:''}<div class="score-grid"><article><span>温暖度</span><b class="${htmlAttr(s.relationshipPotential?.warmth==null?'':'good')}">${htmlText(ratioScoreDisplay(s.relationshipPotential?.warmth))}</b></article><article><span>开放度</span><b class="${htmlAttr(s.relationshipPotential?.openness==null?'':'good')}">${htmlText(ratioScoreDisplay(s.relationshipPotential?.openness))}</b></article><article><span>主动权重</span><b>${htmlText(ratioScoreDisplay(s.replyStrategy?.toneWeights?.initiative))}</b></article><article><span>问题上限</span><b class="${htmlAttr(s.replyStrategy?.maxQuestions==null?'':Number(s.replyStrategy.maxQuestions)>1?'warn':'good')}">${htmlText(s.replyStrategy?.maxQuestions==null?'—':Number(s.replyStrategy.maxQuestions))}</b></article></div><div class="micro-tune"><button data-tune="更温柔">更温柔</button><button data-tune="更有女人味">更有女人味</button><button data-tune="更像小女人">更像小女人</button><button data-tune="更有女王感">更有女王感</button><button data-tune="更暧昧">更暧昧</button><button data-tune="更风骚">更风骚</button><button data-tune="更有情趣">更有情趣</button><button data-tune="更会调情">更会调情</button><button data-tune="更有个性">更有个性</button><button data-tune="更主动">更主动</button><button data-tune="更短">更短</button><button data-tune="更直接">更直接</button><button data-tune="更自然">更自然</button><button data-tune="更妩媚">更妩媚</button><button data-tune="更强势">更强势</button><button data-tune="更害羞">更害羞</button><button data-tune="不提问">不提问</button><button data-tune="换话题">换话题</button><button data-tune="降低热度">降低热度</button></div><div class="candidate-trust"><span><strong>真实生成元数据</strong> · ${s.contextVersion!=null?`轨迹版本 ${htmlText(Number(s.contextVersion))}`:'上下文版本待确认'} · ${htmlText(s.targetLanguage||language)} · ${htmlText(s.translationModel?`中文翻译 ${s.translationModel}`:'中文翻译待确认')}</span>${s.quality?.repaired?'<span class="repaired">已自动修正一次</span>':'<span>最终发送仍需人工确认</span>'}</div><div class="candidate-actions"><button class="primary" data-act="input" ${stale?'disabled':''} aria-disabled="${htmlAttr(stale?'true':'false')}">放入输入框</button><button data-act="select" aria-pressed="false">选择合并</button><button data-act="edit">编辑</button><button data-act="reject">拒绝候选</button><button data-act="regen">重新生成</button></div></article>`}).join('');
 document.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>candidateAction(b));document.querySelectorAll('[data-tune]').forEach(b=>b.onclick=()=>tuneCandidate(b));if($('mergeSelected')){$('mergeSelected').disabled=candidateBase.length<2;$('mergeSelected').title=candidateBase.length<2?'至少需要两条候选才能进行 AI 综合':'选择两条或更多候选后生成新的综合候选'}const staleCount=candidateBase.filter(row=>row._stale).length,repairedCount=candidateBase.filter(row=>row.quality?.repaired).length;if(staleCount)setCandidateProcessState('stale',`${staleCount} 条候选因人物规则更新而失效`,{label:'全部重新生成',run:()=>generateAiCandidates()});else setCandidateProcessState('success',repairedCount?`已生成 ${candidateBase.length} 条候选，其中 ${repairedCount} 条已自动修正并通过质量检查`:`已生成 ${candidateBase.length} 条候选，复杂学习与关系更新将在后台执行`)
}

function recordCandidateInteraction(candidate,signalType,details={}){
 const candidateId=String(candidate?.candidateId||'').trim(),store=window.YanceStoreClient;if(!candidateId||!store?.recordCandidateInteraction)return;
 store.recordCandidateInteraction(candidateId,{signalType,interactionMode:details.interactionMode||'',finalText:details.finalText||candidate?.de||'',adjustments:Array.isArray(details.adjustments)?details.adjustments:[],interactionId:globalThis.crypto?.randomUUID?.()||`candidate-interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`}).catch(error=>console.warn('[R13 candidate learning]',error?.message||error))
}
async function candidateAction(b){
 const card=b.closest('.candidate'),act=b.dataset.act,index=Number(card?.dataset.i),reply=card?.querySelector('.reply'),candidate=candidateBase[index];
 if(!card||!reply||!candidate)return;
 if(act==='select'){const selected=card.classList.toggle('selected');b.setAttribute('aria-pressed',String(selected));b.textContent=selected?'取消合并':'选择合并';const count=document.querySelectorAll('.candidate.selected').length;if($('mergeSelected'))$('mergeSelected').textContent=count?`AI 综合已选（${count}）`:'AI 综合已选候选';return}
 if(act==='input'){
  if(candidate._stale){hint('人物规则已更新，此候选必须重新生成后才能使用','warning');return;}
  $('composerText').value=reply.value||reply.textContent;
  $('composerText').dataset.aiCandidateId=candidate.candidateId||'';
  $('composerText').dataset.aiContextVersion=String(candidate.contextVersion||'');
  $('composerText').dataset.aiConversationRevision=String(candidate.conversationRevision||'');
  $('composerText').dataset.replySource='ai_routed_model';
  $('composerText').dispatchEvent(new Event('input',{bubbles:true}));
  recordCandidateInteraction(candidate,'candidate_used',{interactionMode:'candidate-card-use',finalText:$('composerText').value});
  hint('候选已放入输入框。你可继续修改，点击发送时仍需最终确认')
 }else if(act==='edit'){
  if(reply.tagName==='DIV'){const ta=document.createElement('textarea');ta.className='reply foreign-original';ta.lang=reply.lang||'de';ta.value=reply.textContent;reply.replaceWith(ta);b.textContent='完成编辑'}else{candidate.de=reply.value;const d=document.createElement('div');d.className='reply foreign-original';d.lang=reply.lang||'de';d.textContent=reply.value;reply.replaceWith(d);b.textContent='编辑';recordCandidateInteraction(candidate,'candidate_revised',{interactionMode:'candidate-card-edit',finalText:candidate.de})}
 }else if(act==='reject'){
  if(!candidate.candidateId){candidateBase.splice(index,1);renderCandidates();return}
  const reason=await window.YanceDialogs.prompt({title:'拒绝 AI 候选',message:'拒绝原因会作为负样本证据；请具体说明太长、问题太多、语气不合适或事实有误等。',label:'拒绝原因（必填）',value:'',multiline:true,placeholder:'例如：问题太多，语气过于正式'});
  if(reason===null)return;
  if(!String(reason||'').trim()){hint('请填写拒绝原因','warning');return}
  window.YanceStoreClient?.rejectReplyCandidate(candidate.candidateId,String(reason).trim()).then(()=>{candidateBase.splice(index,1);renderCandidates();hint('候选已拒绝，原因已记录为负样本证据')}).catch(error=>hint(error.message||'拒绝候选失败','error'))
 }else if(act==='regen'){generateAiCandidates(index,b)}
}

function recentConversationContext(limit=40){return (histories[activeId]||[]).filter(m=>!['day','unread'].includes(m.type)).slice(-limit).map(m=>({role:m.side==='me'?'user':'contact',text:m.text||'',translation:m.cn||'',time:m.time||'',type:m.mediaKind||m.type||'text'}))}
function parseAiJson(value){if(aiTaskRuntime.parseStructuredModelResult)return aiTaskRuntime.parseStructuredModelResult(value);const raw=String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(raw)}catch(_){const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(raw.slice(a,b+1));throw new Error('模型返回的JSON格式无效')}}
async function executeAiTask(task,instruction,maxTokens=1600,options={}){const contactId=options.contactId||activeId;const c=activeContactById(contactId);if(!c)throw new Error('已归档客户不会进入AI任务链，请先恢复客户');const profile=options.profile||profileState[contactId]||defaultProfile(),trajectory=options.trajectory||trajectoryState[contactId]||defaultTrajectory(),conversation=options.conversation||recentConversationContext();const requestBody={task,dedupeKey:options.dedupeKey||`${task}:${contactId}`,fingerprint:options.fingerprint||'',messages:[{role:'system',content:instruction},{role:'user',content:JSON.stringify({contact:{id:c.id,name:c.name,platform:c.platform,note:c.note,confirmed:profile.confirmed||[],inferences:profile.inferences||[]},trajectory,conversation})}],options:{json:true,maxTokens,temperature:.25,timeoutMs:Math.max(180000,Number(options.timeoutMs||180000))}};const payload=await apiJson('/api/r32/models/execute',{method:'POST',signal:options.signal,body:JSON.stringify(requestBody)});return parseAiJson(payload.structured??payload.result?.structured??payload.result??payload)}
function clampScore(v){return Math.max(0,Math.min(100,Number(v)||0))}
function scoreDisplay(v,suffix=''){return v==null||v===''?'—':`${clampScore(v)}${suffix}`}
function ratioScoreDisplay(v){return v==null||v===''?'—':String(Math.round(Math.max(0,Math.min(1,Number(v)||0))*100))}
function candidateLanguageLabel(code){return ({de:'德语',zh:'中文',en:'英语',fr:'法语',es:'西班牙语',it:'意大利语',pt:'葡萄牙语',ru:'俄语',ar:'阿拉伯语',tr:'土耳其语'})[profileText(code).toLowerCase()]||profileText(code,'目标语言待确认')}
async function focusEvidenceMessage(messageId){
 const id=profileText(messageId,'');if(!id)return;
 const locate=()=>document.querySelector(`.msg[data-message-id="${CSS.escape(id)}"],.msg[data-external-message-id="${CSS.escape(id)}"]`);
 let target=locate();
 if(!target&&activeId){await loadConversationMessages(activeId,true).catch(()=>{});target=locate()}
 if(!target){hint('这条证据消息当前不在已加载历史中','warning');return}
 target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target.classList.add('evidence-focus');setTimeout(()=>target.classList.remove('evidence-focus'),1800)
}
function analysisCompleteness(value={}){
 const analysis=value&&typeof value==='object'?chineseFirstContent(value):{};
 const evidence=Array.isArray(analysis.evidence)?analysis.evidence.filter(row=>profileText(row?.messageId,row?.message_id,row?.externalMessageId,row?.quote,row?.text)):[];
 const intent=profileText(analysis.intentLabel,analysis.intent,analysis.summary,'');
 const hiddenNeed=profileText(analysis.hiddenNeed,'');
 const strategy=analysis.strategy&&typeof analysis.strategy==='object'?profileText(analysis.strategy.title,analysis.strategy.name,analysis.strategy.reason,analysis.strategy.text,''):profileText(analysis.strategy,'');
 const missing=[];if(!intent)missing.push('核心意图');if(!hiddenNeed)missing.push('隐含需求');if(!evidence.length)missing.push('可追溯证据');if(!strategy)missing.push('策略判断');
 return {complete:missing.length===0,missing,evidenceCount:evidence.length,intent,hiddenNeed,strategy}
}
function analysisReceiptState(payload={},analysis={}){const run=payload?.latestRun||{},receipt=payload?.analysisReceipt||run?.receipt||run?.result?.analysisReceipt||{},frontend=analysisCompleteness(analysis),backend=receipt?.completeness&&typeof receipt.completeness==='object'?receipt.completeness:{},labels={summary:'关系摘要',intent:'核心意图',hiddenNeed:'隐含需求',dimensions:'五维理解',risk:'风险判断',opportunity:'机会判断',strategy:'策略判断',evidence:'可追溯证据'},backendMissing=Array.isArray(backend.missing)?backend.missing.map(key=>labels[key]||String(key)).filter(Boolean):[],missing=[...new Set([...backendMissing,...frontend.missing])],committed=receipt.transactionCommitted===true,complete=committed&&backend.complete===true&&frontend.complete;return {receipt,committed,complete,missing,frontend,backend}}
function latestConversationContentMessage(id=activeId){return [...(histories[id]||[])].reverse().find(message=>message&&!['day','unread','receipt','read','delivery','presence','typing','system'].includes(String(message.type||'').toLowerCase()))||null}
function latestConversationMessageId(id=activeId){const message=latestConversationContentMessage(id);return String(message?.id||message?.externalMessageId||message?.platformMessageId||'').trim()}
function currentAnalysisReady(){const sourceId=String(lastAnalysis?._sourceLastMessageId||lastAnalysis?.sourceLastMessageId||'').trim(),latestId=latestConversationMessageId(activeId);return Boolean(activeContactById(activeId)&&lastAnalysisContactId===activeId&&analysisCompleteness(lastAnalysis).complete&&sourceId&&latestId&&sourceId===latestId)}
function setUnderstandingStatus(label,state){const status=$('analysisStatus');if(!status)return;const dot=document.createElement('i');status.replaceChildren(dot,document.createTextNode(label));status.dataset.state=state||'idle';status.style.removeProperty('color')}
function syncUnderstandingState(nextPhase=analysisPhase,detail=''){
 const contact=activeContactById(activeId),flow=document.querySelector('[data-panel="understanding"] .flow-state span'),button=$('goDirector');analysisPhase=nextPhase;
 if(!contact){analysisPhase='idle';setUnderstandingStatus('请选择会话','idle');if(flow)flow.innerHTML='<b>尚未选择会话</b> · 选择左侧真实会话后才能执行分析';if(button){button.disabled=true;button.textContent='请选择会话'}return}
 if(nextPhase==='running'){if(flow)flow.innerHTML='<b>正在理解当前会话</b> · 读取真实消息、记忆与证据';if(button){button.disabled=true;button.textContent='正在理解…'}return}
 if(nextPhase==='error'){setUnderstandingStatus(detail?'分析失败 · '+detail:'分析失败','error');if(flow)flow.innerHTML='<b>理解失败</b> · 未生成可用结论，可重新执行';if(button){button.disabled=false;button.textContent='重新分析'}return}
 if(nextPhase==='incomplete'){setUnderstandingStatus(detail?'结果不完整 · '+detail:'结果不完整','warning');if(flow)flow.innerHTML='<b>理解尚未完成</b> · 模型结果缺少必要字段，不能进入导演';if(button){button.disabled=false;button.textContent='重新分析'}return}
 if(nextPhase==='complete'&&currentAnalysisReady()){setUnderstandingStatus('真实分析已完成','complete');if(flow)flow.innerHTML='<b>理解已完成</b> · 已从SQLite消息表分析并写回档案与洞察';if(button){button.disabled=false;button.textContent='理解完成，进入导演'}return}
 analysisPhase='idle';setUnderstandingStatus('等待真实分析','idle');if(flow)flow.innerHTML='<b>尚未执行理解</b> · 当前没有使用任何演示结论';if(button){button.disabled=false;button.textContent='开始真实分析'}
}
function renderUnderstanding(analysis={}){analysis=chineseFirstContent(analysis);lastAnalysis=analysis;lastAnalysisContactId=activeId;const set=(id,v,fallback='—')=>{const n=$(id);if(n)n.textContent=aiSummaryText(v,fallback)};set('analysisConfidence',scoreDisplay(analysis.confidence,'%'));set('analysisIntent',analysis.intentLabel||analysis.intent||'待分析');set('analysisOpportunity',scoreDisplay(analysis.opportunity?.score??analysis.opportunity));set('analysisRisk',scoreDisplay(analysis.risk?.score??analysis.risk));set('analysisPersona',scoreDisplay(analysis.personaConsistency));const completeness=analysisCompleteness(analysis);set('analysisChainStatus',completeness.complete?'真实分析已完成':Object.keys(analysis).length?`结果不完整 · 缺少${completeness.missing.join('、')}`:'等待真实模型');set('analysisIntentConfidence',analysis.intentConfidence!=null?`置信度 ${clampScore(analysis.intentConfidence)}%`:'未计算');if($('analysisIntentText'))$('analysisIntentText').innerHTML=aiSummaryHtml(analysis.intent||analysis.summary,'尚无真实推断');set('analysisNeedConfidence',analysis.needConfidence!=null?`置信度 ${clampScore(analysis.needConfidence)}%`:'未计算');if($('analysisNeedText'))$('analysisNeedText').innerHTML=aiSummaryHtml(analysis.hiddenNeed,'尚无真实推断');const dims=analysis.dimensions||{};const dimHost=$('analysisDimensions');if(dimHost)dimHost.innerHTML=Object.entries({情绪温度:dims.emotion,主动程度:dims.initiative,关系开放:dims.openness,回应压力:dims.pressure,暧昧信号:dims.flirtation}).map(([k,v])=>`<div class="mini-bar"><span>${htmlText(k)}</span><div class="track"><i style="width:${sanitizeCssNumber(v==null?0:clampScore(v),{min:0,max:100,unit:'%'})}"></i></div><b>${htmlText(scoreDisplay(v))}</b></div>`).join('')||'<p>暂无维度数据</p>';const memories=Array.isArray(analysis.memories)?analysis.memories:[];set('analysisMemoryCount',`${memories.length} 条`);if($('analysisMemories'))$('analysisMemories').innerHTML=memories.length?memories.map(x=>{const text=typeof x==='string'?x:x.text||x.fact||'',source=typeof x==='object'?x.source||x.provenance||x.truthStatus||'已确认记忆':'已确认记忆';return `<b>${htmlText(text)}<small>${htmlText(businessLabel('source',source,source))}</small></b>`}).join(''):'<b>暂无已确认记忆</b>';const evidence=Array.isArray(analysis.evidence)?analysis.evidence:[],evidenceHost=$('analysisEvidence');if(evidenceHost){evidenceHost.innerHTML=evidence.length?evidence.map(x=>{const messageId=profileText(x.messageId||x.message_id||x.externalMessageId||x.external_message_id,'');return `<div class="evidence-row"><b>${htmlText(x.label||x.claim||'证据')}</b><p>${htmlText(x.translatedZh||x.textZh||x.quote||x.text||'')}${x.translatedZh&&x.quote?`<small class="evidence-original">原文：${htmlText(x.quote)}</small>`:''}</p><footer><span>${htmlText([businessLabel('source',x.source,x.source||'真实会话'),x.time||x.sentAt||''].filter(Boolean).join(' · '))}</span><span>置信度 ${htmlText(scoreDisplay(x.confidence,'%'))}</span>${messageId?`<button type="button" data-evidence-message="${htmlAttr(messageId)}">跳到消息</button>`:''}</footer></div>`}).join(''):'<div class="ui-empty-state"><div><b>没有足够证据</b><p>模型未返回可追溯证据。</p></div></div>';evidenceHost.querySelectorAll('[data-evidence-message]').forEach(button=>button.onclick=()=>focusEvidenceMessage(button.dataset.evidenceMessage))}const must=Array.isArray(analysis.mustRespond)?analysis.mustRespond:[];if($('analysisMustRespond'))$('analysisMustRespond').innerHTML=must.length?must.map((x,i)=>`<div class="signal"><i>${htmlText(i+1)}</i><div><b>${htmlText(typeof x==='string'?x:x.text||x.title||'')}</b><small>${htmlText(typeof x==='object'?x.reason||'':'')}</small></div><em>${htmlText(i===0?'优先':'建议')}</em></div>`).join(''):'<div class="ui-empty-state"><div><b>暂无必须回应项</b></div></div>';if($('analysisIgnore'))$('analysisIgnore').innerHTML=aiSummaryHtml(analysis.ignore,'暂无可忽略内容');const risk=analysis.risk||{},opp=analysis.opportunity||{};set('analysisRiskTitle',`风险 ${scoreDisplay(risk.score??risk)} · ${risk.level||'待判断'}`);set('analysisRiskText',risk.text||analysis.riskText||risk,'尚无风险判断');set('analysisOpportunityTitle',`机会 ${scoreDisplay(opp.score??opp)} · ${opp.level||'待判断'}`);set('analysisOpportunityText',opp.text||analysis.opportunityText||opp,'尚无机会判断');const checks=Array.isArray(analysis.constraints)?analysis.constraints:[];set('analysisConflictStatus',checks.length?'检查完成':'无检查结果');if($('analysisConstraints'))$('analysisConstraints').innerHTML=checks.length?checks.map(x=>`<div class="constraint"><i>${htmlText(x.pass===false?'×':'✓')}</i>${htmlText(aiSummaryText(x,'约束检查'))}</div>`).join(''):'<div class="constraint"><i>·</i>模型未返回冲突检查</div>';const reason=$('analysisReasoning');if(reason)reason.innerHTML=[['读取会话',recentConversationContext().length+'条消息'],['调用记忆',memories.length+'条有效'],['证据检查',evidence.length+'条证据'],['策略判断',completeness.strategy||'未计算']].map(x=>`<div class="reason-step"><i></i><b>${htmlText(x[0])}</b><span>${htmlText(x[1])}</span></div>`).join('');const strategy=analysis.strategy||{};set('strategyRecommendationTitle',strategy.title||strategy.name||strategy,'等待人工导演');set('strategyRecommendationText',strategy.reason||strategy.text||strategy||analysis.summary,'尚无策略建议');set('strategyMatch',`匹配度 ${strategy.match!=null?clampScore(strategy.match)+'%':'--'}`);set('strategyProgress',`关系推进 ${strategy.progress!=null?clampScore(strategy.progress)+'%':'--'}`);set('strategyRisk',`风险 ${strategy.risk!=null?clampScore(strategy.risk)+'%':'--'}`);set('strategyReplyChance',`继续回复 ${strategy.replyChance!=null?clampScore(strategy.replyChance)+'%':'--'}`);const sim=analysis.simulation||{};for(const [key,prefix] of [['likely','Likely'],['positive','Positive'],['negative','Negative']]){set(`simulation${prefix}`,sim[key]?.text||sim[key],'等待真实分析');set(`simulation${prefix}Prob`,`概率 ${sim[key]?.probability!=null?clampScore(sim[key].probability)+'%':'--'}`)};updateDirector()}
function latestIncomingForSocialBrain(contactId=activeId){
 const row=[...(histories[contactId]||[])].reverse().find(message=>message&&!['day','unread'].includes(message.type)&&message.side!=='me');
 if(!row)return {id:'',text:'',type:'text',sentAt:''};
 return {id:row.id||row.externalMessageId||'',text:row.text||'',type:row.mediaKind||row.type||'text',sentAt:row.raw?.sentAt||row.raw?.timestamp||''}
}
function currentDirectorPayload(variant='',avoidCandidates=[],quickAdjustment='',extra={}){
 const styleWeights={};document.querySelectorAll('#palette button.active[data-style-key]').forEach(button=>{styleWeights[button.dataset.styleKey]=Number(button.dataset.weight||$('strength')?.value||0)});
 const mergeCandidates=(Array.isArray(extra?.mergeCandidates)?extra.mergeCandidates:[]).map(value=>String(value||'').trim()).filter(Boolean).slice(0,5);
 return {goal:$('goal')?.value||'',persona:$('persona')?.value||'',pace:$('pace')?.value||'',tone:$('tone')?.value||'',strategy:document.querySelector('input[name=strategy]:checked')?.value||'',instruction:[$('directorInstruction')?.value||'',extra?.instruction||''].filter(Boolean).join('\n'),avoid:$('avoid')?.value||'',variant,quickAdjustment,styleWeights,styleIntensity:$('styleIntensity')?.value||'natural',avoidCandidates:(Array.isArray(avoidCandidates)?avoidCandidates:[]).filter(Boolean).slice(-5),mergeMode:mergeCandidates.length>=2,mergeCandidates}
}
function readReplyPreferences(){try{const saved=JSON.parse(localStorage.getItem(REPLY_PREFERENCES_KEY)||'{}');return {speed:['rapid','balanced','deep'].includes(saved.speed)?saved.speed:'balanced',learning:['send_and_learn','send_only','exception'].includes(saved.learning)?saved.learning:'send_and_learn'}}catch(_){return {speed:'balanced',learning:'send_and_learn'}}}
function applyReplyPreferences(){const saved=readReplyPreferences();if($('replySpeedMode'))$('replySpeedMode').value=saved.speed;if($('replyLearningMode'))$('replyLearningMode').value=saved.learning}
function persistReplyPreferences(){try{localStorage.setItem(REPLY_PREFERENCES_KEY,JSON.stringify({speed:currentReplySpeedMode(),learning:currentReplyLearningMode()}))}catch(_){}}
function currentReplySpeedMode(){return $('replySpeedMode')?.value||'balanced'}
function currentReplyLearningMode(){return $('replyLearningMode')?.value||'send_and_learn'}
function currentComposerReplySource(){return $('composerText')?.dataset.replySource||($('composerText')?.dataset.aiCandidateId?'ai_routed_model':'manual')}
async function generateSocialBrainCandidate(variant='自然成熟',avoidCandidates=[],quickAdjustment='',extra={}){
 const contactId=String(extra?.contactId||activeId||''),c=activeContactById(contactId),store=window.YanceStoreClient,generationToken=extra?.generationToken||null,fingerprint=extra?.fingerprint||'';
 if(!c)throw new Error('当前会话已切换或归档，停止生成旧候选');
 if(generationToken)replyGenerationAuthority?.assertCurrent?.(generationToken,{contactId,fingerprint});
 if(!store?.generateReplyCandidate)throw new Error('StoreManager回复大脑尚未就绪');
 const director=currentDirectorPayload(variant,avoidCandidates,quickAdjustment,extra);
 const result=await store.generateReplyCandidate({contactId:c.contactId||'',conversationId:c.id,incomingMessage:latestIncomingForSocialBrain(contactId),director,temperature:variant==='更会调情'?0.64:variant==='更有女人味'?0.58:0.52,performanceMode:currentReplySpeedMode(),aggregateIncoming:true,source:extra?.mergeCandidates?.length?'ai_merge':'ai_routed_model',signal:extra?.signal});
 if(generationToken)replyGenerationAuthority?.assertCurrent?.(generationToken,{contactId,fingerprint});
 if(!result?.text)throw new Error('回复大脑没有返回可审阅候选');
 const candidateCount=Math.max(1,Number(result.performancePolicy?.candidateCount||1));
 return {candidateId:result.candidateId,taskId:result.taskId,name:variant,de:result.text,cn:result.translatedZh||'',translationStatus:result.translationStatus||'',translationModel:result.translationModel||'',translationQuality:result.translationQuality||result.generationMetadata?.translationQuality||{},protectedTerms:result.protectedTerms||result.generationMetadata?.protectedTerms||[],strategy:`${result.replyStrategy?.recommendedTone||'自然'} · ${result.replyStrategy?.recommendedLength||'自适应'} · ${result.performanceMode==='rapid'?`极速 ${candidateCount} 条候选`:`${result.performanceMode==='deep'?'深度':'平衡'} ${candidateCount} 条候选`}。最终回复由你确认。`,language:({German:'de',Chinese:'zh',English:'en',French:'fr',Spanish:'es',Italian:'it',Portuguese:'pt',Russian:'ru',Arabic:'ar',Turkish:'tr'}[result.targetLanguage]||''),targetLanguage:result.targetLanguage||'',targetLanguageCode:result.targetLanguageCode||result.languageAuthority?.code||'',languageAuthority:result.languageAuthority||{},languageValidation:result.languageValidation||{},contactLanguage:result.contactLanguage||{},contextVersion:result.contextVersion,conversationRevision:result.conversationRevision,performanceMode:result.performanceMode||currentReplySpeedMode(),performancePolicy:result.performancePolicy||{},source:extra?.mergeCandidates?.length?'ai_merge':'ai_routed_model',modelId:result.modelId||'',model:result.model||'',modelAttempts:result.modelAttempts||result.generationMetadata?.modelAttempts||[],fallbackUsed:result.fallbackUsed===true||result.generationMetadata?.fallbackUsed===true,generationMetadata:result.generationMetadata||{},director:result.director||director,replyStrategy:result.replyStrategy||{},relationshipPotential:result.relationshipPotential||{},replyTask:result.replyTask||'quick_reply',quality:result.quality||{},requiresUserApproval:true,effectivePersonaLabel:result.effectivePersonaLabel||'',appliedPersonaScopes:result.appliedPersonaScopes||[],learningApplication:result.learningApplication||result.generationMetadata?.learningApplication||{}}
}
function candidateVariantsFor(count=1){const variants=['自然成熟','温暖有女人味','简短直接','边界清晰','不提问留余味'];return variants.slice(0,Math.max(1,Math.min(variants.length,Number(count)||1)))}
async function generateAiCandidates(singleIndex=null,button=null,options={}){
 const automatic=options?.automatic===true,contactId=String(options?.contactId||activeId||''),latestId=latestConversationMessageId(contactId),fingerprint=options?.fingerprint||`${contactId}:${latestId}`,generationToken=options?.generationToken||replyGenerationAuthority?.begin?.(contactId,fingerprint)||null;
 const ensureCurrent=()=>{if(contactId!==String(activeId)||latestConversationMessageId(contactId)!==latestId){const error=new Error('候选生成已被更新的会话上下文取代');error.code='AI_REPLY_GENERATION_SUPERSEDED';throw error}replyGenerationAuthority?.assertCurrent?.(generationToken,{contactId,fingerprint})};
 if(!activeContactById(contactId)){hint('已归档客户不参与AI候选生成，请先恢复客户','warning');return}
 const requestController=beginReplyCandidateRequest(contactId);
 const target=button||$('generateCandidates');setBusy?.(target,true,'读取关系轨迹…');setCandidateProcessState('running','正在读取会话、关系阶段与人物规则');
 try{
  ensureCurrent();candidateFailureState=null;
  const generationOptions={contactId,generationToken,fingerprint,signal:requestController.signal};
  if(singleIndex!=null){const current=candidateBase[singleIndex],next=await generateSocialBrainCandidate(current?.name||'重新生成',candidateBase.filter((_,i)=>i!==singleIndex).map(row=>row.de),'',generationOptions);ensureCurrent();candidateBase.splice(singleIndex,1,next);renderCandidates();hint('候选已重新生成并通过质量门禁');return [next]}
  const rows=[];
  setCandidateProcessState('running','正在生成第 1 条候选并读取后端候选数量策略');
  const first=await generateSocialBrainCandidate('自然成熟',[],'',generationOptions);ensureCurrent();rows.push(first);
  const desired=Math.max(1,Number(first.performancePolicy?.candidateCount||1)),variants=candidateVariantsFor(desired);
  for(let index=1;index<variants.length;index++){setCandidateProcessState('running',`正在生成第 ${index+1}/${variants.length} 条差异化候选`);const next=await generateSocialBrainCandidate(variants[index],rows.map(row=>row.de),variants[index],generationOptions);ensureCurrent();rows.push(next)}
  ensureCurrent();candidateBase.splice(0,candidateBase.length,...rows);if(!automatic)openPanel('candidates');renderCandidates();if(!automatic)hint(`已生成 ${rows.length} 条方向不同的可筛选候选，每条均通过语言、Persona 与平台私聊风格门禁`);return rows
 }catch(error){if(isReplyAbortError(error)){setCandidateProcessState('stale','检测到更新的会话上下文，旧候选生成结果已丢弃');throw error}const failure=candidateFailurePresentation(error);candidateFailureState=failure;renderCandidates();setCandidateProcessState(failure.state,failure.text,failure.action);if(!automatic)hint(failure.text,'error',{duration:5000});throw error}finally{finishReplyCandidateRequest(contactId,requestController);setBusy?.(target,false)}
}
async function mergeSelectedCandidates(){
 const selected=[...document.querySelectorAll('.candidate.selected')].map(card=>candidateBase[Number(card.dataset.i)]).filter(Boolean);
 if(selected.length<2){hint('请至少选择两条候选再进行 AI 综合','warning');return}
 const button=$('mergeSelected'),contactId=String(activeId||''),requestController=beginReplyCandidateRequest(contactId);setBusy?.(button,true,'AI 正在综合…');setCandidateProcessState('running',`正在综合 ${selected.length} 条候选，去重并重新执行全部门禁`);
 try{candidateFailureState=null;const merged=await generateSocialBrainCandidate('AI 综合候选',candidateBase.filter(row=>!selected.includes(row)).map(row=>row.de),'',{mergeCandidates:selected.map(row=>row.de),instruction:'综合用户选中的候选，只保留最自然、最符合当前关系与 Persona 的表达；禁止简单拼接。',signal:requestController.signal});candidateBase.push(merged);renderCandidates();openPanel('candidates');hint('已生成新的 AI 综合候选，请审阅后再放入输入框')}
 catch(error){if(isReplyAbortError(error)){setCandidateProcessState('stale','检测到更新的会话上下文，旧综合结果已丢弃');return}const failure=candidateFailurePresentation(error);candidateFailureState=failure;renderCandidates();setCandidateProcessState(failure.state,failure.text,failure.action);hint(failure.text,'error',{duration:5000})}
 finally{finishReplyCandidateRequest(contactId,requestController);setBusy?.(button,false)}
}

async function tuneCandidate(button){
 const card=button.closest('.candidate'),index=Number(card.dataset.i),current=candidateBase[index];if(!current)return;
 const tune=button.dataset.tune||button.textContent,old=button.textContent,director=$('directorInstruction'),originalInstruction=director?.value||'',runtime=window.YanceBilingualPresentationRuntime,contactId=String(activeId||''),requestController=beginReplyCandidateRequest(contactId);
 button.disabled=true;button.textContent='微调中…';
 try{
  const otherCandidates=candidateBase.filter((_,rowIndex)=>rowIndex!==index).map(row=>row.de);
  let attempts=1;
  if(director)director.value=[originalInstruction,`微调要求：${tune}。基于原候选：${current.de}`].filter(Boolean).join('\n');
  let next=await generateSocialBrainCandidate(`${current.name} · ${tune}`,otherCandidates,tune,{signal:requestController.signal});
  let similarity=runtime?.textSimilarity?runtime.textSimilarity(current.de,next.de):(String(current.de||'').trim()===String(next.de||'').trim()?1:0);
  let changed=runtime?.isMeaningfullyDifferent?runtime.isMeaningfullyDifferent(current.de,next.de):similarity<0.9;
  if(!changed){
   attempts=2;
   const strictInstruction=`严格重写要求：${tune}。必须明显改变句式、长度、措辞或语气标记，禁止复用原候选原句。原候选仅供理解，不得原样返回：${current.de}`;
   if(director)director.value=[originalInstruction,strictInstruction].filter(Boolean).join('\n');
   next=await generateSocialBrainCandidate(`${current.name} · ${tune} · 严格重写`,[...otherCandidates,current.de],strictInstruction,{signal:requestController.signal});
   similarity=runtime?.textSimilarity?runtime.textSimilarity(current.de,next.de):(String(current.de||'').trim()===String(next.de||'').trim()?1:0);
   changed=runtime?.isMeaningfullyDifferent?runtime.isMeaningfullyDifferent(current.de,next.de):similarity<0.9;
  }
  if(!changed){const error=new Error(`模型没有真正应用“${tune}”风格，请更换模型或稍后重试`);error.code='STYLE_VARIATION_NOT_APPLIED';throw error}
  next.generationMetadata={...(next.generationMetadata||{}),styleChange:{requested:tune,attempts,similarity,verified:true,verifiedAt:new Date().toISOString()}};
  recordCandidateInteraction(current,'candidate_micro_adjusted',{interactionMode:'candidate-micro-tune',finalText:next.de,adjustments:[tune]});
  candidateBase[index]=next;renderCandidates();hint(`已验证风格变化：${tune}`)
 }catch(error){if(!isReplyAbortError(error))hint(error.message||'微调失败','error')}finally{finishReplyCandidateRequest(contactId,requestController);if(director)director.value=originalInstruction;button.disabled=false;button.textContent=old}
}
let runAnalysis=async function(){hint('AI分析管道正在初始化','warning')};
function openNote(){const c=getC();pendingAvatar='';$('editAvatar').innerHTML=`<img src="${urlAttr(avatar(c),{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(c.name)}头像">`;$('fAge').value=c.age;$('fBirthday').value=c.birthday;$('fAddress').value=c.address;$('fCity').value=c.city;$('fCountry').value=c.country;$('fJob').value=c.job;$('fLanguages').value=c.languages;$('fFamily').value=c.family;$('fStage').value=c.stage;$('fInterests').value=c.interests;$('fNote').value=c.note;$('noteDialog').showModal()}
async function saveNote(){
 const c=getC();if(!c.id)return;Object.assign(c,{age:$('fAge').value.trim(),birthday:$('fBirthday').value.trim(),address:$('fAddress').value.trim(),city:$('fCity').value.trim(),country:$('fCountry').value.trim(),job:$('fJob').value.trim(),languages:$('fLanguages').value.trim(),family:$('fFamily').value.trim(),stage:$('fStage').value.trim(),interests:$('fInterests').value.trim(),note:$('fNote').value.trim()});if(pendingAvatar)c.customAvatar=pendingAvatar;
 const payload={facts:{age:c.age,birthday:c.birthday,address:c.address,city:c.city,country:c.country,job:c.job,languages:c.languages,family:c.family,stage:c.stage,interests:c.interests},note:c.note,profile:profileState[c.id]||defaultProfile()};
 try{await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(c.id)}/profile`,{method:'PUT',body:JSON.stringify(payload)});logAction(c.id,'客户备注已更新','资料已写入SQLite并同步到当前工作台');renderContacts();renderHeader();renderNotes();if(app.classList.contains('contact-page-open'))renderIdentityPage();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();persistState();$('noteDialog').close();hint('客户备注已保存')}catch(error){hint(error.message||'客户备注保存失败','error')}
}
async function send(){
 const composer=$('composerText'),btn=$('sendBtn'),c=getC();if(btn?.dataset.typingCancel==='1'){cancelTypingForContact(c,'user_cancel');hint('已取消当前自然输入与发送');syncComposerState();return}const t=composer.value.trim();if(!t){hint('请输入消息');return}if(!activeContactById(activeId)){hint('已归档联系人为只读状态，请先恢复后再发送','warning');return}if(!c.id||!c.accountId||!c.chatJid){hint('当前会话缺少真实发送账号或目标地址','error');return}const route=resolveConversationAccount(c);if(route.blocked){const message=route.identityConflict?`${route.reason||'当前会话的发送来源身份不一致'}，已阻止发送。请在账号中心核对绑定。`:route.reason||'账号已绑定，但平台尚未确认真实发送能力';hint(message,'error',{duration:6000});renderHeader();return}
 setBusy?.(btn,true,'发送中…');
 try{
  const quoted=window.YanceR32ConversationCapabilities?.currentQuote?.();
  let aiCandidateId=composer.dataset.aiCandidateId||'',outboxId=composer.dataset.aiOutboxId||'';const learningMode=currentReplyLearningMode(),replySource=currentComposerReplySource();
  const shouldUseLearningOutbox=Boolean(aiCandidateId||outboxId||learningMode==='send_and_learn');
  if(shouldUseLearningOutbox){
   if(!window.YanceStoreClient)throw new Error('StoreManager发送与学习链路尚未就绪');
   if(!aiCandidateId&&!outboxId){
    const manualRequestController=beginReplyCandidateRequest(c.id);
    try{
     const manualCandidate=await window.YanceStoreClient.generateReplyCandidate({contactId:c.contactId||'',conversationId:c.id,incomingMessage:latestIncomingForSocialBrain(),manualText:t,source:replySource,performanceMode:'rapid',aggregateIncoming:false,signal:manualRequestController.signal});
     aiCandidateId=manualCandidate?.candidateId||'';composer.dataset.aiCandidateId=aiCandidateId;composer.dataset.aiContextVersion=String(manualCandidate?.contextVersion||'');composer.dataset.aiConversationRevision=String(manualCandidate?.conversationRevision||'');
    }finally{finishReplyCandidateRequest(c.id,manualRequestController)}
   }
   if(!outboxId){
    if(!await window.YanceDialogs.confirm({title:'确认发送',message:learningMode==='send_and_learn'?'发送成功后会在后台学习本次最终文字。':'本次不会写入学习库。',submitLabel:'发送'}))return;
    const approved=await window.YanceStoreClient.approveReplyCandidate(aiCandidateId,{text:t,userApproved:true,approvedBy:'user',learningMode,source:replySource});
    if(!approved?.outboxId)throw new Error('回复未能进入人工确认发送箱');
    outboxId=approved.outboxId;composer.dataset.aiOutboxId=outboxId;composer.dataset.aiApprovedText=t;delete composer.dataset.aiCandidateId;
   }else if((composer.dataset.aiApprovedText||'')!==t){
    await window.YanceStoreClient.reviseOutboxText(outboxId,t);composer.dataset.aiApprovedText=t;
   }
   await window.YanceStoreClient.confirmOutboxSend(outboxId,true,{quoted});
   composer.value='';delete composer.dataset.pendingSendKey;delete composer.dataset.pendingSendText;delete composer.dataset.aiCandidateId;delete composer.dataset.aiContextVersion;delete composer.dataset.aiConversationRevision;delete composer.dataset.aiOutboxId;delete composer.dataset.aiApprovedText;delete composer.dataset.contextStale;composer.dataset.replySource='manual';drafts[activeId]='';window.YanceR32ConversationCapabilities?.clearQuote?.();hint(learningMode==='send_and_learn'?'消息正在发送；成功后学习会在后台完成':'消息正在发送，本次不学习');return
  }
  const pendingText=String(composer.dataset.pendingSendText||''),existingKey=String(composer.dataset.pendingSendKey||'');const idempotencyKey=existingKey&&pendingText===t?existingKey:(globalThis.crypto?.randomUUID?.()||`text-${Date.now()}-${Math.random().toString(16).slice(2)}`);composer.dataset.pendingSendKey=idempotencyKey;composer.dataset.pendingSendText=t;const payload=await window.YanceCore.messages.sendText({platform:c.platform||'whatsapp',accountId:route.account.id||route.account.canonicalAccountId||c.accountId,sessionKey:c.id,chatJid:c.chatJid,text:t,idempotencyKey,...(quoted||{})});composer.value='';delete composer.dataset.pendingSendKey;delete composer.dataset.pendingSendText;delete composer.dataset.aiCandidateId;delete composer.dataset.aiContextVersion;delete composer.dataset.aiConversationRevision;delete composer.dataset.aiOutboxId;delete composer.dataset.aiApprovedText;delete composer.dataset.contextStale;composer.dataset.replySource='manual';drafts[activeId]='';window.YanceR32ConversationCapabilities?.clearQuote?.();await loadConversationMessages(activeId,true);hint(payload.reconciledAfterUncertainResponse?'消息发送结果已自动核对，未重复发送':payload.state==='sent'?'消息已发送':payload.state==='retry'?'网络暂不可用，消息会自动重试':'消息已加入发送队列')
 }catch(error){const code=String(error?.code||error?.reasonCode||''),uncertain=error?.name==='TimeoutError'||error?.name==='AbortError'||/CORE_NETWORK_UNAVAILABLE|CORE_INVALID_RESPONSE|R32_INVALID_RESPONSE|ABORT_ERR/i.test(code);if(!uncertain){delete composer.dataset.pendingSendKey;delete composer.dataset.pendingSendText}if(/STALE_CONVERSATION|REVERIFY|NEW_INCOMING/i.test(code)){hint('对方刚发来新消息，旧回复已暂停，请结合最新上下文重新生成或修改','warning',{duration:6000})}else if(uncertain)hint('发送结果暂未确认；再次点击会沿用同一发送标识核对结果，避免重复消息','warning',{duration:7000});else hint(error.message||'消息发送失败','error',{duration:5000})}finally{setBusy?.(btn,false);syncComposerState()}
}
function enterImmersive(){immersiveScrollTop=$('messages').scrollTop;app.classList.add('immersive');requestAnimationFrame(()=>$('messages').scrollTop=immersiveScrollTop)}function exitImmersive(){if(!app.classList.contains('immersive'))return;immersiveScrollTop=$('messages').scrollTop;app.classList.remove('immersive');requestAnimationFrame(()=>$('messages').scrollTop=immersiveScrollTop)}
function effectiveNavMode(){return innerWidth<1640&&conversationLayoutState.navMode==='expanded'?'compact':conversationLayoutState.navMode}
function updateLayoutTooltips(){const navMode=effectiveNavMode(),contactMode=conversationLayoutState.contactMode;const navButton=$('navModeToggle'),contactButton=$('contactPanelMode');if(navButton){const next=navMode==='expanded'?'图标栏':navMode==='compact'?'隐藏导航':'展开导航';navButton.title=`切换为${next}`;navButton.setAttribute('aria-label',navButton.title)}if(contactButton){const next=contactMode==='normal'?'头像栏':contactMode==='compact'?'隐藏联系人栏':'完整联系人栏';contactButton.title=`切换为${next}`;contactButton.setAttribute('aria-label',contactButton.title)}}
function applyConversationLayout(){const navMode=effectiveNavMode(),route=window.YanceWorkspaceRouteAuthority?.activeView?.(app)||app.dataset.activeWorkspaceView||'conversation',layout=window.YanceWorkspaceLayoutAuthority?.apply?.(app,{...conversationLayoutState,navMode,route,aiOverlayOpen,density:document.documentElement.dataset.spacing==='compact'?'compact':'comfortable'},innerWidth);app.dataset.translationMode=conversationLayoutState.translationMode;updateLayoutTooltips();window.dispatchEvent(new CustomEvent('yance:conversation-layout-changed',{detail:{preferred:{...conversationLayoutState},effective:layout||{navMode,contactMode:conversationLayoutState.contactMode,aiVisible:conversationLayoutState.aiVisible}}}))}
function persistConversationLayout(){writeConversationLayoutState();if(typeof r32RuntimeState!=='undefined'){r32RuntimeState.contactMode=conversationLayoutState.contactMode;r32RuntimeState.aiHidden=!conversationLayoutState.aiVisible;r32RuntimeState.navMode=conversationLayoutState.navMode;r32RuntimeWrite?.()}}
function cycleNavMode(){const mode=effectiveNavMode();conversationLayoutState.navMode=mode==='expanded'?'compact':mode==='compact'?'hidden':(innerWidth>=1640?'expanded':'compact');persistConversationLayout();applyConversationLayout()}
function cycleContactMode(){conversationLayoutState.contactMode=conversationLayoutState.contactMode==='normal'?'compact':conversationLayoutState.contactMode==='compact'?'hidden':'normal';persistConversationLayout();applyConversationLayout()}
function openContactSearchWorkspace(){
  let dialog=$('contactSearchDialog');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='contactSearchDialog';dialog.className='contact-search-dialog';
    const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
    title.textContent='搜索联系人';close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();header.append(title,close);
    const body=document.createElement('section');body.className='contact-search-body';
    const input=document.createElement('input');input.type='search';input.id='contactSearchWorkspaceInput';input.placeholder='按姓名、号码、平台或标签搜索';input.autocomplete='off';
    const results=document.createElement('div');results.id='contactSearchWorkspaceResults';results.className='contact-search-results';
    body.append(input,results);dialog.append(header,body);document.body.appendChild(dialog);
    const render=()=>{
      const query=String(input.value||'').trim().toLowerCase();
      const rows=(Array.isArray(contacts)?contacts:[]).filter(contact=>{
        if(!query)return true;
        return [contact.name,contact.phone,contact.externalId,contact.chatJid,contact.platform,...(Array.isArray(contact.tags)?contact.tags:[])].some(value=>String(value||'').toLowerCase().includes(query));
      }).slice(0,100);
      results.replaceChildren();
      if(!rows.length){const empty=document.createElement('div');empty.className='contact-search-empty';empty.textContent='没有找到匹配的联系人';results.appendChild(empty);return;}
      rows.forEach(contact=>{
        const button=document.createElement('button');button.type='button';button.className='contact-search-result';
        const avatar=document.createElement('i');const label=String(contact.name||contact.phone||'?').trim();avatar.textContent=(label.match(/[\p{L}\p{N}]/u)||['?'])[0].toUpperCase();
        const copy=document.createElement('span'),name=document.createElement('b'),meta=document.createElement('small'),action=document.createElement('em');
        name.textContent=contact.name||contact.phone||'未命名联系人';meta.textContent=[contact.platform,contact.phone||contact.externalId||''].filter(Boolean).join(' · ');action.textContent='打开';
        copy.append(name,meta);button.append(avatar,copy,action);button.onclick=()=>{dialog.close();openContactsPage(contact.id);};results.appendChild(button);
      });
    };
    input.addEventListener('input',render);dialog.addEventListener('close',()=>{input.value='';});dialog._renderResults=render;
  }
  dialog._renderResults?.();dialog.showModal();requestAnimationFrame(()=>$('contactSearchWorkspaceInput')?.focus());
}

$('navModeToggle').onclick=cycleNavMode;$('restoreNav').onclick=()=>{conversationLayoutState.navMode=innerWidth>=1640?'expanded':'compact';persistConversationLayout();applyConversationLayout()};$('contactPanelMode').onclick=cycleContactMode;$('restoreContacts').onclick=()=>{conversationLayoutState.contactMode='normal';persistConversationLayout();applyConversationLayout()};$('toggleAi').onclick=()=>{if(innerWidth<1360)aiOverlayOpen=!aiOverlayOpen;else{conversationLayoutState.aiVisible=!conversationLayoutState.aiVisible;persistConversationLayout()}applyConversationLayout()};$('closeAi').onclick=()=>{if(innerWidth<1360)aiOverlayOpen=false;else{conversationLayoutState.aiVisible=false;persistConversationLayout()}applyConversationLayout()};$('aiOverlayBackdrop').onclick=()=>{aiOverlayOpen=false;applyConversationLayout()};window.addEventListener('resize',()=>{const overlayMode=innerWidth<1360;if(overlayMode!==lastOverlayMode)aiOverlayOpen=false;lastOverlayMode=overlayMode;applyConversationLayout()});$('immersiveBtn').onclick=enterImmersive;$('immersiveExit').onclick=exitImmersive;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&app.classList.contains('immersive')){e.preventDefault();exitImmersive()}});$('navSearch').onclick=()=>{openContactSearchWorkspace();hint('已打开独立联系人搜索')};$('contactSearch').oninput=renderContacts;document.querySelectorAll('#filters button').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();activateConversationFilter(button.dataset.filter)});document.querySelectorAll('#mainTabs button,#utilityTabs button').forEach(b=>b.onclick=()=>openPanel(b.dataset.tab));applyReplyPreferences();if($('replySpeedMode'))$('replySpeedMode').onchange=persistReplyPreferences;if($('replyLearningMode'))$('replyLearningMode').onchange=persistReplyPreferences;if($('refreshReplyLearning'))$('refreshReplyLearning').onclick=()=>loadReplyLearning(activeId).catch(error=>hint(error.message||'刷新学习失败','error'));if($('undoReplyLearning'))$('undoReplyLearning').onclick=()=>undoLatestReplyLearning().catch(error=>hint(error.message||'恢复学习失败','error'));if($('clearReplyLearning'))$('clearReplyLearning').onclick=()=>clearCurrentReplyLearning().catch(error=>hint(error.message||'清空学习失败','error'));if($('forgetReplyLearning'))$('forgetReplyLearning').onclick=()=>forgetCurrentReplyLearning().catch(error=>hint(error.message||'永久忘记学习失败','error'));if($('exportReplyLearning'))$('exportReplyLearning').onclick=exportCurrentReplyLearning;$('goDirector').onclick=()=>currentAnalysisReady()?openPanel('director'):runAnalysis();$('backUnderstanding').onclick=()=>openPanel('understanding');$('backDirector').onclick=()=>openPanel('director');$('generateCandidates').onclick=()=>generateAiCandidates();$('regenAll').onclick=()=>generateAiCandidates();$('mergeSelected').onclick=mergeSelectedCandidates;document.querySelectorAll('#palette button').forEach(b=>b.onclick=()=>{b.classList.toggle('active');updateDirector()});document.querySelectorAll('input[name=strategy]').forEach(r=>r.onchange=()=>{document.querySelectorAll('.strategy-option').forEach(x=>x.classList.toggle('active',x.contains(r)&&r.checked));updateDirector()});['goal','persona','pace','tone','strength','styleIntensity','avoid'].forEach(id=>$(id).oninput=()=>{if(id==='strength')$('strengthValue').textContent=$('strength').value+'%';updateDirector()});$('sendBtn').onclick=send;$('composerText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};window.dispatchEvent(new CustomEvent('yance:r32-composer-controls-ready'));$('uploadAvatarBtn').onclick=openNote;$('editNoteBtn').onclick=openNote;$('closeNote').onclick=()=>$('noteDialog').close();$('cancelNote').onclick=()=>$('noteDialog').close();$('chooseAvatar').onclick=()=>$('avatarInput').click();$('restoreAvatar').onclick=()=>{delete getC().customAvatar;pendingAvatar='';$('editAvatar').innerHTML=`<img src="${urlAttr(avatar(getC()),{allowDataImage:true,allowBlob:true})}">`;hint('已恢复默认头像')};$('avatarInput').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{pendingAvatar=String(r.result||'');$('editAvatar').innerHTML=`<img src="${urlAttr(pendingAvatar,{allowDataImage:true,allowBlob:true})}">`};r.readAsDataURL(f)};$('saveNote').onclick=saveNote;



// R32 · 会话中心与联系人身份统一工作台：共享真实联系人、头像、未读、备注和历史状态
const identityState={};

const profileState={};


const trajectoryState={};

const STORAGE_KEY='yance27:r32:workspace-state';
function cloneData(v){return JSON.parse(JSON.stringify(v))}
function setExternalView(view){const authority=window.YanceWorkspaceRouteAuthority,normalized=authority?.normalizeView?.(view,'')||String(view||'');if(!authority?.ROUTES?.[normalized]||normalized==='conversation')return false;currentView=normalized;persistState();return true}
function persistState(){
 try{
  const canonicalId=activeContactStore?.getSnapshot?.()?.contactId||activeId;
  localStorage.setItem(STORAGE_KEY,JSON.stringify({uiVersion:4,activeId:canonicalId,canonicalContactId:canonicalId,selectedIdentity,identityFilter,selectedProfile,profileFilter,selectedTimeline,timelineRange,timelineFilter,messageScroll,currentView}))
 }catch(e){}
 scheduleWorkspacePersist()
}

function scheduleWorkspacePersist(){
 if(!workspaceBootstrapped)return;
 clearTimeout(workspacePersistTimer);
 workspacePersistTimer=setTimeout(async()=>{
  const ids=[...new Set([activeId,selectedIdentity,selectedProfile,selectedTimeline].filter(Boolean))];
  const jobs=[];
  for(const id of ids){
   const c=contacts.find(row=>row.id===id);if(!c)continue;
   const facts={age:c.age||'',birthday:c.birthday||'',address:c.address||'',city:c.city||'',country:c.country||'',job:c.job||'',languages:c.languages||'',family:c.family||'',stage:c.stage||'',interests:c.interests||''};
   jobs.push(apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/identity`,{method:'PUT',body:JSON.stringify(identityState[id]||defaultIdentity(c))}));
   jobs.push(apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/profile`,{method:'PUT',body:JSON.stringify({facts,note:c.note||'',profile:profileState[id]||defaultProfile()})}));
   jobs.push(apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/trajectory`,{method:'PUT',body:JSON.stringify(trajectoryState[id]||defaultTrajectory())}));
  }
  const results=await Promise.allSettled(jobs);if(results.some(x=>x.status==='rejected'))console.warn('[R32 workspace] 部分状态保存失败',results.filter(x=>x.status==='rejected').map(x=>x.reason?.message||String(x.reason)));
 },650)
}
function restoreState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return;const s=JSON.parse(raw);if(s.activeId&&contacts.some(c=>c.id===s.activeId))activeId=s.activeId;composerOwnerId=activeId;if(s.selectedIdentity&&contacts.some(c=>c.id===s.selectedIdentity))selectedIdentity=s.selectedIdentity;if(s.identityFilter)identityFilter=s.identityFilter;if(s.selectedProfile&&contacts.some(c=>c.id===s.selectedProfile))selectedProfile=s.selectedProfile;if(s.profileFilter)profileFilter=s.profileFilter;if(s.selectedTimeline&&contacts.some(c=>c.id===s.selectedTimeline))selectedTimeline=s.selectedTimeline;if(s.timelineRange)timelineRange=s.timelineRange;if(s.timelineFilter)timelineFilter=s.timelineFilter;messageScroll=Number(s.uiVersion||0)>=4&&s.messageScroll&&typeof s.messageScroll==='object'?s.messageScroll:{};currentView=window.YanceWorkspaceRouteAuthority?.normalizeView?.(s.currentView,'conversation')||(['conversation','contacts','profiles','timeline','insights','ai-workbench','accounts','system','settings','theme'].includes(s.currentView)?s.currentView:'conversation');if(activeContactStore&&activeId&&contacts.some(c=>c.id===activeId))activeContactStore.setActiveContact(activeId,{source:'r32-ui-runtime:persistence',reason:'restore',view:currentView,force:true,contact:contacts.find(row=>row.id===activeId)||null})}catch(e){}}
function logAction(contactId,title,detail){auditLog.unshift({contactId,title,detail,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});auditLog=auditLog.slice(0,30)}
function syncConversationTags(id){const c=contacts.find(x=>x.id===id),s=identityState[id];if(!c||!s)return;c.tags=c.tags.filter(t=>!['待确认','已绑定'].includes(t));if(s.pending)c.tags.push('待确认');if(s.bound)c.tags.push('已绑定')}
/* AC-005 暂存建议（设备本地，使用稳定契约服务；不再随手塞进 localStorage 全局对象） */
const savedSuggestionStore=(function(){const KEY='r32:savedSuggestions';function readAll(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){return[]}}function writeAll(rows){try{localStorage.setItem(KEY,JSON.stringify(rows))}catch(e){}}return{get(id){return readAll().find(r=>r.suggestionId===id)||null},upsert(rec){const rows=readAll();const i=rows.findIndex(r=>r.suggestionId===rec.suggestionId);if(i>=0)rows[i]=rec;else rows.push(rec);writeAll(rows)},remove(id){const rows=readAll();const i=rows.findIndex(r=>r.suggestionId===id);if(i<0)return false;rows.splice(i,1);writeAll(rows);return true},list(contactId){return readAll().filter(r=>!contactId||r.contactId===contactId)}}}());
const savedSuggestionService=(typeof createSavedSuggestionService==='function')?createSavedSuggestionService({store:savedSuggestionStore,now:()=>Date.now()}):null;
function currentSavedContactId(){return activeId||selectedProfile||null}
function syncComposerState(){const c=activeContactById(activeId),input=$('composerText'),send=$('sendBtn'),save=$('saveSuggestionBtn'),saved=$('savedSuggestionsBtn'),state=$('composerSuggestionState'),route=c?resolveConversationAccount(c):{conflict:'no-conversation'},hasText=Boolean(input?.value.trim()),hasAttachment=Boolean(window.YanceR32ConversationCapabilities?.hasPendingAttachment?.()),hasSendableContent=hasText||hasAttachment,selfTyping=c?currentTypingState(c).self:{},simulating=selfTyping.isTyping===true&&String(selfTyping.phase||'').startsWith('approved_send_');if(input){input.disabled=!c;input.placeholder=c?(simulating?'可直接输入新内容以取消当前自动发送':'输入消息，Enter发送，Shift+Enter换行'):''}if(send){send.disabled=!c||Boolean(route.conflict)||!hasSendableContent||Boolean(route.blocked);if(simulating)send.disabled=false;send.textContent=simulating?'取消发送':'发送';if(simulating)send.dataset.typingCancel='1';else delete send.dataset.typingCancel}if(save)save.disabled=!c||!hasText;if(saved)saved.disabled=!c;document.querySelectorAll('.composer .tools button').forEach(button=>button.disabled=!c);if(state)state.textContent=c?(simulating?'正在按自然节奏准备发送 · 可随时取消':hasAttachment&&!hasText?'附件已就绪 · 可直接发送，无需输入文字':hasText?'可暂存当前输入 · 仅保存在本机':''):'选择会话后可输入、暂存与发送';updateComposerTranslationIndicator()}
function updateSavedCount(){const btn=$('savedSuggestionsBtn');if(!btn)return;const n=savedSuggestionService?savedSuggestionService.listSaved(currentSavedContactId()).length:0;btn.textContent=n?`暂存箱 · ${n}`:'暂存箱';btn.classList.toggle('active',!!n);syncComposerState()}
function saveCurrentSuggestion(){if(!savedSuggestionService){hint('暂存建议服务不可用','error');return}const cid=currentSavedContactId();if(!cid){hint('请先选择一位客户','warning');return}const text=($('composerText').value||'').trim();if(!text){hint('请先输入要暂存的内容','warning');return}const label=text.length>20?text.slice(0,20)+'…':text;try{savedSuggestionService.saveSuggestion({contactId:cid,label:label,note:text});hint('已暂存建议（仅本设备）');updateSavedCount()}catch(e){hint(e.message||'暂存失败','error')}}
function renderSavedSuggestions(){const cid=currentSavedContactId();const list=$('savedSuggestionsList');const empty=$('savedSuggestionsEmpty');if(!list)return;const rows=savedSuggestionService?savedSuggestionService.listSaved(cid):[];list.innerHTML='';if(!rows.length){if(empty)empty.classList.remove('hidden');return}if(empty)empty.classList.add('hidden');rows.forEach(r=>{const li=document.createElement('li');li.className='saved-item';const meta=document.createElement('div');meta.className='saved-meta';const b=document.createElement('b');b.textContent=r.label||'保存建议';const s=document.createElement('span');s.textContent=(r.savedAt||'').slice(0,16).replace('T',' ');meta.appendChild(b);meta.appendChild(s);const note=document.createElement('p');note.className='saved-note';note.textContent=r.note||'';const rm=document.createElement('button');rm.className='saved-remove';rm.textContent='移除';rm.onclick=function(){removeSavedSuggestion(r.suggestionId)};li.appendChild(meta);li.appendChild(note);li.appendChild(rm);list.appendChild(li)})}
function removeSavedSuggestion(id){if(!savedSuggestionService)return;try{savedSuggestionService.unsaveSuggestion({suggestionId:id})}catch(e){}renderSavedSuggestions();updateSavedCount()}
function openSavedSuggestions(){if(!savedSuggestionService){hint('暂存建议服务不可用','error');return}renderSavedSuggestions();updateSavedCount();const d=$('savedSuggestionsDialog');if(d&&d.showModal)d.showModal()}
window.addEventListener('yance:r32-composer-content-changed',syncComposerState);
$('saveSuggestionBtn').onclick=saveCurrentSuggestion;
$('savedSuggestionsBtn').onclick=openSavedSuggestions;
if($('closeSavedSuggestions'))$('closeSavedSuggestions').onclick=function(){const d=$('savedSuggestionsDialog');if(d&&d.close)d.close()};
if($('closeSavedSuggestionsBtn'))$('closeSavedSuggestionsBtn').onclick=function(){const d=$('savedSuggestionsDialog');if(d&&d.close)d.close()};

function updateSharedUI(){const c=contacts.find(x=>x.id===activeId);if($('sharedSync')&&c)$('sharedSync').textContent=`当前 ${c.name} · 头像、未读、备注、在线共用同一数据`;if($('undoMerge'))$('undoMerge').classList.toggle('hidden',!lastMerge);updateSavedCount()}
function openMergeDialog(sourceId){
 const source=identityRows().find(x=>x.id===sourceId);if(!source)return;
 const candidates=identityRows().filter(x=>x.id!==sourceId),renderers=window.YanceContactSafeRenderers;
 if(!renderers){hint('安全渲染模块未加载，合并窗口已阻止打开','error');return}
 const dialog=$('mergeDialog'),select=$('mergeTarget');dialog.dataset.source=sourceId;
 renderers.renderMergeOptions(document,select,candidates,candidates[0]?.id||'');
 const paint=()=>{const target=identityRows().find(x=>x.id===select.value)||candidates[0];if(!target)return;renderers.renderMergeCard(document,$('mergeSourceCard'),source);renderers.renderMergeCard(document,$('mergeTargetCard'),target);renderers.renderMergeChecklist(document,$('mergeChecklist'),target.name)};
 select.onchange=paint;paint();dialog.showModal()
}
function mergeContacts(sourceId,targetId){const source=contacts.find(x=>x.id===sourceId),target=contacts.find(x=>x.id===targetId);if(!source||!target||sourceId===targetId)return;lastMerge={sourceId,targetId,source:cloneData(source),target:cloneData(target),sourceIdentity:cloneData(identityState[sourceId]),targetIdentity:cloneData(identityState[targetId]),sourceHistory:cloneData(histories[sourceId]||[]),targetHistory:cloneData(histories[targetId]||[]),sourceDraft:drafts[sourceId]||'',targetDraft:drafts[targetId]||'',sourceProfile:cloneData(profileState[sourceId]),targetProfile:cloneData(profileState[targetId])};target.unread=(target.unread||0)+(source.unread||0);target.tags=[...new Set([...target.tags,...source.tags.filter(t=>t!=='待确认')])];target.note=[target.note,`合并自 ${source.name}：${source.note}`].filter(Boolean).join('\n');if(!target.customAvatar&&source.customAvatar)target.customAvatar=source.customAvatar;histories[targetId]=[...(histories[targetId]||[]),{type:'day',text:`已合并 ${source.name} 的历史会话`},...(histories[sourceId]||[]).filter(x=>x.type!=='day')];drafts[targetId]=[drafts[targetId],drafts[sourceId]].filter(Boolean).join('\n');Object.assign(identityState[targetId],{confidence:Math.max(identityState[targetId].confidence||0,identityState[sourceId].confidence||0),maintained:true,bound:identityState[targetId].bound||identityState[sourceId].bound,duplicate:false,note:`已合并 ${source.name} 的身份、历史与备注。`});if(profileState[sourceId]&&profileState[targetId]){profileState[targetId].confirmed=[...profileState[targetId].confirmed,...profileState[sourceId].confirmed];profileState[targetId].inferences=[...profileState[targetId].inferences,...profileState[sourceId].inferences];profileState[targetId].commitments=[...profileState[targetId].commitments,...profileState[sourceId].commitments];profileState[targetId].boundaries=[...profileState[targetId].boundaries,...profileState[sourceId].boundaries];profileState[targetId].milestones=[['刚刚','身份档案已合并',`已合并 ${source.name} 的关系记忆与开放事项。`],...profileState[targetId].milestones,...profileState[sourceId].milestones];profileState[targetId].health=Math.max(profileState[targetId].health,profileState[sourceId].health)}Object.assign(identityState[sourceId],{ignored:true,mergedInto:targetId,pending:false,duplicate:false});selectedProfile=targetId;syncConversationTags(targetId);activeId=targetId;selectedIdentity=targetId;selectedTimeline=targetId;publishActiveContact(activeId,{source:'r32-ui-runtime:contacts',reason:'local-merge-selection',view:'contacts'});identityFilter='all';logAction(targetId,'已合并重复身份',`${source.name} 的聊天、未读、头像来源和客户备注已合并到 ${target.name}`);$('mergeDialog').close();renderContacts();renderHeader();renderMessages();renderNotes();renderIdentityPage();updateSharedUI();persistState();hint('重复身份已安全合并，可撤销')}
async function undoLastMerge(){if(!lastMerge)return;const m=lastMerge;try{if(m.backendJournalId&&m.targetId){await apiJson('/api/r32/workspace/contacts/'+encodeURIComponent(m.targetId)+'/merge/undo',{method:'POST',body:JSON.stringify({journalId:m.backendJournalId,by:'user'})})}}catch(error){hint(error.message||'撤销保存失败','error');return}Object.assign(contacts.find(x=>x.id===m.sourceId),m.source);Object.assign(contacts.find(x=>x.id===m.targetId),m.target);identityState[m.sourceId]=m.sourceIdentity;identityState[m.targetId]=m.targetIdentity;histories[m.sourceId]=m.sourceHistory;histories[m.targetId]=m.targetHistory;drafts[m.sourceId]=m.sourceDraft;drafts[m.targetId]=m.targetDraft;if(m.sourceProfile)profileState[m.sourceId]=m.sourceProfile;if(m.targetProfile)profileState[m.targetId]=m.targetProfile;selectedProfile=m.sourceId;activeId=m.sourceId;selectedIdentity=m.sourceId;selectedTimeline=m.sourceId;publishActiveContact(activeId,{source:'r32-ui-runtime:contacts',reason:'local-merge-undo-selection',view:'contacts'});identityFilter='all';logAction(m.sourceId,'已撤销身份合并',`恢复 ${m.source.name} 与 ${m.target.name} 为两个独立联系人`);lastMerge=null;renderContacts();renderHeader();renderMessages();renderNotes();renderIdentityPage();updateSharedUI();persistState();hint('已撤销上次身份合并')}
let identityFilter='pending', selectedIdentity='';
const filterLabel={pending:'新联系人',maintained:'资料已维护',bound:'已绑定客户',system:'系统服务',archived:'已归档',all:'全部联系人'};
function identityRows(){return contacts.map(c=>({...c,...identityState[c.id]})).filter(r=>!r.ignored)}
function rowMatches(r,filter){return filter==='archived'?r.archived:!r.archived&&(filter==='all'||filter==='pending'&&r.pending||filter==='maintained'&&r.maintained||filter==='bound'&&r.bound||filter==='system'&&r.system)}
function primaryState(r){if(r.archived)return '已归档';if(r.system)return '系统服务';if(r.pending)return '待确认';if(r.bound)return '已绑定';if(r.maintained)return '已维护';return '待整理'}
function nextAction(r){if(r.archived)return '已归档，必要时恢复到活跃会话';if(r.duplicate)return '先核对重复身份并合并';if(r.pending)return '先确认身份并绑定客户';if(!r.maintained)return '完善联系人资料';if(!r.bound)return '绑定长期客户档案';return '保持头像与资料同步'}
function openContactsPage(id=activeId){stashConversationState();if(id&&contacts.some(c=>c.id===id)){activeId=id;selectedIdentity=id}identityFilter='all';document.querySelectorAll('#identityFilters button').forEach(x=>x.classList.toggle('active',x.dataset.identityFilter==='all'));applyWorkspaceRoute('contacts','r32-ui-runtime:contacts');$('navConversation').classList.remove('active');$('navProfiles').classList.remove('active');$('navTimeline').classList.remove('active');$('navContacts').classList.add('active');currentView='contacts';publishActiveContact(activeId,{source:'r32-ui-runtime:contacts',reason:'contacts-opened',view:'contacts',allowArchived:allowArchivedContactInCurrentView()});renderIdentityPage();updateSharedUI();persistState()}
function openConversationPage(id=selectedIdentity||activeId){applyWorkspaceRoute('conversation','r32-ui-runtime:conversation');applyConversationLayout();$('navContacts').classList.remove('active');$('navProfiles').classList.remove('active');$('navTimeline').classList.remove('active');$('navConversation').classList.add('active');currentView='conversation';if(id)selectContact(id,{source:'r32-ui-runtime:conversation',reason:'conversation-opened'});else{publishActiveContact(activeId,{source:'r32-ui-runtime:conversation',reason:'conversation-opened',view:'conversation',allowArchived:allowArchivedContactInCurrentView()});renderContacts();renderHeader();renderMessages();renderNotes()}updateSharedUI();persistState()}
function renderIdentityStats(){const rows=identityRows(),activeRows=rows.filter(r=>!r.archived);const stats=[
 ['全部联系人',activeRows.length,'当前需要处理的活跃对象','all'],
 ['新联系人',activeRows.filter(r=>r.pending).length,'尚未确认长期资料','pending'],
 ['资料已维护',activeRows.filter(r=>r.maintained).length,'已经录入联系人线索','maintained'],
 ['已绑定客户',activeRows.filter(r=>r.bound).length,'已进入客户档案','bound'],
 ['系统服务',activeRows.filter(r=>r.system).length,'不参与客户关系','system'],
 ['已归档',rows.filter(r=>r.archived).length,'不再进入活跃工作队列','archived'],
 ['稳定身份',activeRows.filter(r=>r.stableId).length,'已具备 JID、LID 或号码','stable']
];
 $('contactStats').innerHTML=stats.map(s=>`<article class="contact26-stat ${htmlAttr(s[3]===identityFilter||s[3]==='stable'&&rows.every(r=>r.stableId)?'active':'')}" data-stat-filter="${htmlAttr(s[3])}"><span>${htmlText(s[0])}</span><b>${htmlText(s[1])}</b><small>${htmlText(s[2])}</small></article>`).join('');
 document.querySelectorAll('[data-stat-filter]').forEach(card=>card.onclick=()=>{const f=card.dataset.statFilter;if(f==='stable'){hint(`当前 ${activeRows.length} 个活跃联系人均已建立稳定身份标识`);return}setIdentityFilter(f)});
 $('heroLoaded').textContent=`联系人中心已载入 ${activeRows.length} 个活跃对象 · ${rows.filter(r=>r.archived).length} 个归档`;$('workbenchCount').textContent=`${activeRows.length} 个活跃联系人`;updateSharedUI();$('summaryPending').textContent=`${activeRows.filter(r=>r.pending).length} 人`;$('summaryBound').textContent=`${activeRows.filter(r=>r.bound).length} 人`;
}
function renderWorkbench(){
 const allRows=identityRows(),rows=allRows.filter(r=>rowMatches(r,identityFilter)),r=rows.find(x=>x.id===selectedIdentity)||rows[0]||allRows.find(x=>!x.archived)||allRows[0];if(!r)return;
 const queue=allRows.filter(x=>!x.archived&&x.pending).slice(0,3),renderers=window.YanceContactSafeRenderers;
 if(!renderers){hint('安全渲染模块未加载，联系人工作台已停止渲染','error');return}
 renderers.renderWorkbenchQueue(document,$('workbenchQueue'),queue,selectedIdentity).forEach(b=>b.onclick=()=>{stashConversationState();selectedIdentity=b.dataset.queueId;activeId=selectedIdentity;selectedProfile=activeId;selectedTimeline=activeId;publishActiveContact(activeId,{source:'r32-ui-runtime:contacts',reason:'identity-queue-selected',view:'contacts'});renderIdentityPage();renderHeader();renderNotes();updateSharedUI();persistState()});
 $('summaryCurrent').textContent=r.name;$('summaryNext').textContent=nextAction(r);$('workbenchTitle').textContent=`${r.name} · ${r.pending?'等待确认身份':r.bound?'客户身份已绑定':'联系人资料处理中'}`;$('workbenchPhone').textContent=businessIdentity(r.phone||r.stableId,{platform:r.platform,kind:r.phone?'phone':'platform',fallback:'平台身份待确认'});$('workbenchFilter').textContent=filterLabel[identityFilter];$('workbenchSelected').textContent=r.name;$('heroFilter').textContent=filterLabel[identityFilter]
}
function setIdentityFilter(filter){identityFilter=filter;document.querySelectorAll('#identityFilters button').forEach(x=>x.classList.toggle('active',x.dataset.identityFilter===filter));const rows=identityRows().filter(r=>rowMatches(r,filter));if(rows.length&&!rows.some(r=>r.id===selectedIdentity))selectedIdentity=rows[0].id;renderIdentityPage()}
function renderIdentityList(){
 const q=$('identitySearch').value.trim().toLowerCase();
 const rows=identityRows().filter(r=>rowMatches(r,identityFilter)&&(!q||[r.name,r.phone,r.platform,r.source,r.stableId,r.snippet,...r.tags].join(' ').toLowerCase().includes(q)));
 $('directoryMeta').textContent=`${filterLabel[identityFilter]} · 当前查看 ${rows.length} 项`;
 const renderers=window.YanceContactSafeRenderers;if(!renderers){hint('安全渲染模块未加载，联系人列表已停止渲染','error');return}
 renderers.renderIdentityList(document,$('identityList'),rows,selectedIdentity,avatar,primaryState).forEach(b=>b.onclick=()=>{stashConversationState();selectedIdentity=b.dataset.identityId;activeId=selectedIdentity;selectedProfile=activeId;selectedTimeline=activeId;publishActiveContact(activeId,{source:'r32-ui-runtime:contacts',reason:'identity-selected',view:'contacts',allowArchived:allowArchivedContactInCurrentView()});renderIdentityPage();renderHeader();renderNotes();updateSharedUI();persistState()})
}
function renderIdentityDetail(){
 const hero=$('contactDetailHero'),grid=$('contactDetailGrid'),r=identityRows().find(x=>x.id===selectedIdentity)||identityRows()[0];
 if(!r){
  if(hero)hero.innerHTML='';
  if(grid)grid.innerHTML='<div class="ui-empty-state ui-empty-state-fill"><div><div class="ui-empty-orb"></div><b>请选择一个联系人</b><p>选择左侧联系人后，这里会显示身份来源、客户档案、关系证据和下一步操作。</p></div></div>';
  return
 }
 const latest=(histories[r.id]||[]).filter(x=>x.side).slice(-1)[0],renderers=window.YanceContactSafeRenderers;
 if(!renderers){hint('安全渲染模块未加载，联系人详情已停止渲染','error');return}
 const rows=auditLog.filter(x=>x.contactId===r.id).slice(0,5),auditRows=rows.length?rows:[{time:'当前',title:'统一数据源已连接',detail:'联系人、头像、在线、未读、客户备注由同一联系人对象驱动'}];
 renderers.renderIdentityDetail(document,$('contactDetailHero'),$('contactDetailGrid'),r,latest,auditRows,avatar,primaryState,nextAction).forEach(b=>b.onclick=()=>handleContactAction(b.dataset.contactAction,r))
}
async function manageCustomerProfileAssociation(r){
 const physicalId=profileText(r.contactId,r.id),anchor=profileText(r.customerProfileId||r.canonicalContactId,physicalId),linked=explicitlyLinkedConversations(r);
 if(anchor&&physicalId&&anchor!==physicalId){
  const approved=await window.YanceDialogs.confirm({title:'解除客户档案关联',message:`仅解除 ${profileText(r.name,'当前联系人')} 这个平台身份的客户档案关联。聊天、消息、媒体、草稿和发送路由不会删除或迁移；系统会复制当前共享档案，避免资料突然消失。`,submitLabel:'解除关联'});if(!approved)return;
  await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(r.id)}/customer-association`,{method:'DELETE',body:JSON.stringify({by:'user',copyProfile:true})});await bootstrapR32(true);logAction(r.id,'已解除跨平台客户档案关联','底层会话与发送路由始终保持独立，当前平台身份已拥有独立档案副本');hint('客户档案关联已解除，聊天与发送路由未改变');return
 }
 const candidates=activeContacts().filter(row=>row.id!==r.id&&!explicitlyLinkedConversations(r).some(link=>link.id===row.id));
 if(!candidates.length){hint(linked.length?'当前明确关联身份需从对应非主身份解除':'没有可关联的其他平台身份','warning');return}
 const choices=candidates.map((row,index)=>`${index+1}. ${profileText(row.name,'未命名联系人')} · ${profileText(row.platform,'未知平台')} · 账号 ${profileText(row.accountId,'未识别')} · 目标 ${profileText(row.phone||row.chatJid||row.externalId,'未识别')}`).join('\n');
 const entered=await window.YanceDialogs.prompt({title:'关联跨平台客户档案',message:`请选择经过你人工确认属于同一客户的平台身份。\n\n${choices}\n\n姓名和头像相同不能作为关联依据；关联只共享客户档案与联系人级 Persona，不会合并聊天或发送路由。`,label:'输入序号',value:'1',placeholder:'例如：1'});if(entered===null)return;
 const index=Number(String(entered).trim())-1,target=candidates[index];if(!target){hint('选择的客户身份不存在','warning');return}
 if(!await window.YanceDialogs.confirm({title:'确认客户档案关联',message:`确认将 ${profileText(r.platform,'当前平台')} 的 ${profileText(r.name,'联系人')} 与 ${profileText(target.platform,'目标平台')} 的 ${profileText(target.name,'联系人')} 关联为同一客户？\n\n消息、媒体、AI Context、学习、草稿和发送路由仍按平台、账号和会话隔离。`,submitLabel:'确认关联'}))return;
 await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(r.id)}/customer-association`,{method:'POST',body:JSON.stringify({targetContactId:target.id,by:'user',note:'用户在联系人中心明确确认跨平台客户关联'})});await bootstrapR32(true);logAction(r.id,'已关联跨平台客户档案',`${profileText(r.platform,'当前平台')} 与 ${profileText(target.platform,'目标平台')} 共享客户档案；底层会话和发送路由保持独立`);hint('客户档案已关联，平台会话与发送路由仍然隔离')
}

async function handleContactAction(action,r){if(action==='confirm'){activeId=r.id;if(r.pending){try{const res=await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(r.id)}/confirm-identity`,{method:'POST',body:JSON.stringify({accountId:'local',confirmedBy:'user',note:''})});const c=(res&&res.contact)||{};Object.assign(identityState[r.id],{pending:false,maintained:true,bound:true,duplicate:false,confidence:Math.max(96,r.confidence),identityConfirmed:c.identityConfirmed!==false,identityVersion:c.version||0,confirmedAt:c.confirmedAt||null,confirmedBy:c.confirmedBy||'user'});syncConversationTags(r.id);logAction(r.id,'身份已确认并绑定客户','已持久化到 R32 权威联系人表');renderContacts();renderHeader();renderNotes();persistState();hint('身份已确认');setIdentityFilter('bound')}catch(err){hint((err&&err.message)||'身份确认保存失败','error')}}else{openProfilesPage(r.id);hint('已打开 '+r.name+' 的客户档案')}return}if(action==='notes'){activeId=r.id;openNote();return}if(action==='avatar'){activeId=r.id;openNote();hint('可上传自定义头像，保存后生效');return}if(action==='associate'){try{await manageCustomerProfileAssociation(r)}catch(error){hint(error.message||'客户档案关联失败','error')}return}if(action==='merge'){openMergeDialog(r.id);return}if(action==='history'){openConversationPage(r.id);hint('已进入 '+r.name+' 的对应会话');return}if(action==='archive'){const approved=r.archived||await window.YanceDialogs.confirm({title:'归档联系人',message:`归档 ${r.name}？聊天记录、档案和关系洞察会保留，但不会继续出现在活跃会话中。`,danger:true,submitLabel:'归档'});if(!approved)return;const wasArchived=r.archived;setConversationArchived(r.id,!wasArchived,wasArchived?'':'不符合当前客户标准').then(()=>{identityFilter=wasArchived?'all':'archived';renderIdentityPage()}).catch(error=>hint(error.message||'归档操作失败','error'));return}if(action==='ignore'){identityState[r.id].ignored=true;logAction(r.id,'已从工作队列忽略','联系人未删除，历史会话和客户资料仍然保留');const rows=identityRows().filter(x=>rowMatches(x,identityFilter));selectedIdentity=(rows[0]||identityRows()[0]||{}).id||'';if(selectedIdentity)activeId=selectedIdentity;renderIdentityPage();renderContacts();persistState();hint('该联系人已从当前工作队列忽略');return}}
function renderIdentityPage(){renderIdentityStats();renderWorkbench();renderIdentityList();renderIdentityDetail()}

const profileFilterLabel={all:'全部档案',active:'重点关系',bound:'已绑定客户',pending:'待确认推断',risk:'需关注'};
function profileRows(){return activeContacts().map(c=>({...c,...(identityState[c.id]||defaultIdentity(c)),profile:cleanProfileObject(profileState[c.id]||{})})).filter(r=>r.profile)}
function profileMatches(r,f){const p=r.profile,stage=String(r.stage||''),hasPendingProfile=Boolean(pendingProfileReviewSummary(p));return f==='all'||f==='active'&&(p.temperature>=60||stage.includes('认真')||stage.includes('客户'))||f==='bound'&&r.bound||f==='pending'&&(hasPendingProfile||p.inferences.some(x=>x.status==='pending'))||f==='risk'&&p.risk>=30}
function openProfilesPage(id=activeId){stashConversationState();const target=activeContactById(id)||activeContactById(activeId)||firstActiveContact();activeId=target?.id||'';selectedProfile=activeId;selectedIdentity=activeId;applyWorkspaceRoute('profiles','r32-ui-runtime:profiles');$('navConversation').classList.remove('active');$('navContacts').classList.remove('active');$('navTimeline').classList.remove('active');$('navProfiles').classList.add('active');currentView='profiles';publishActiveContact(activeId,{source:'r32-ui-runtime:profiles',reason:'profiles-opened',view:'profiles'});renderProfilePage();renderHeader();renderNotes();persistState()}
function setProfileFilter(f){profileFilter=f;document.querySelectorAll('#profileFilters button').forEach(b=>b.classList.toggle('active',b.dataset.profileFilter===f));const rows=profileRows().filter(r=>profileMatches(r,f));if(!rows.some(r=>r.id===selectedProfile))selectedProfile=rows[0]?.id||'';renderProfilePage();persistState()}
function renderProfileStats(){const rows=profileRows(),pending=rows.reduce((n,r)=>n+r.profile.inferences.filter(x=>x.status==='pending').length+(pendingProfileReviewSummary(r.profile)?1:0),0),open=rows.reduce((n,r)=>n+r.profile.commitments.filter(x=>!x.done).length,0),risk=rows.filter(r=>r.profile.risk>=30).length,avg=rows.length?Math.round(rows.reduce((n,r)=>n+Number(r.profile.health||0),0)/rows.length):0;const stats=[['全部档案',rows.length,'活跃联系人与长期关系记忆','all'],['重点关系',rows.filter(r=>profileMatches(r,'active')).length,'当前值得持续经营','active'],['已绑定客户',rows.filter(r=>r.bound).length,'身份与档案已经连接','bound'],['待确认推断',pending,'AI推断不能直接当事实','pending'],['开放事项',open,'承诺与下一步待处理','all'],['资料健康度',avg+'%','平均完整度与可信度','all']];$('profileStats').innerHTML=stats.map(s=>`<button class="profile27-stat ${htmlAttr(profileFilter===s[3]?'active':'')}" data-profile-stat="${htmlAttr(s[3])}"><span>${htmlText(s[0])}</span><b>${htmlText(s[1])}</b><small>${htmlText(s[2])}</small></button>`).join('');document.querySelectorAll('[data-profile-stat]').forEach(b=>b.onclick=()=>setProfileFilter(b.dataset.profileStat));$('profileMemoryStatus').textContent=rows.length?`${pending} 条AI推断待确认 · ${open} 个开放事项 · ${risk} 个需关注档案`:'当前没有活跃客户档案'}
function renderProfileList(){const q=$('profileSearch').value.trim().toLowerCase();const rows=profileRows().filter(r=>profileMatches(r,profileFilter)&&(!q||[r.name,r.job,r.city,r.country,r.stage,r.note,...(r.tags||[])].map(x=>profileText(x)).join(' ').toLowerCase().includes(q)));if(!rows.some(r=>r.id===selectedProfile))selectedProfile=rows[0]?.id||'';$('profileDirectoryMeta').textContent=`${profileFilterLabel[profileFilter]} · 当前查看 ${rows.length} 份活跃档案`;$('profileList').innerHTML=rows.length?rows.map(r=>{const p=cleanProfileObject(r.profile),pending=p.inferences.filter(x=>x.status==='pending').length,hasPendingProfile=Boolean(pendingProfileReviewSummary(p));return `<button class="profile27-card ${htmlAttr(r.id===selectedProfile?'active':'')}" data-profile-id="${htmlAttr(r.id)}">${avatarHostMarkup(r)}<div class="profile27-copy"><b>${htmlText(profileText(r.name,'未命名联系人'))}</b><p>${htmlText(profileText(r.job,'职业未填写'))} · ${htmlText(profileText(r.city,'地区未填写'))}</p><div class="profile27-tags"><i>${htmlText(businessLabel('relationshipStage',r.stage,'待确认'))}</i>${r.bound?'<i>已绑定</i>':'<i>候选档案</i>'}${hasPendingProfile?'<i>AI画像待审核</i>':''}${pending?`<i>${htmlText(pending)}条推断待确认</i>`:''}${p.risk>=30?'<i>需关注</i>':''}</div></div><div class="health-ring" style="--v:${sanitizeCssNumber(Number(p.health)||0,{min:0,max:100})}"><b>${htmlText(Number(p.health)||0)}</b></div></button>`}).join(''):'<div class="ui-empty-state ui-empty-state-fill"><div><div class="ui-empty-orb"></div><b>当前没有活跃客户档案</b><p>已归档客户不会出现在此处，可在联系人中心的“已归档”筛选中恢复。</p></div></div>';hydrateRuntimeAvatars($('profileList'),rows);document.querySelectorAll('[data-profile-id]').forEach(b=>b.onclick=()=>{selectedProfile=b.dataset.profileId;selectedIdentity=selectedProfile;activeId=selectedProfile;selectedTimeline=activeId;publishActiveContact(activeId,{source:'r32-ui-runtime:profiles',reason:'profile-selected',view:'profiles'});renderProfilePage();renderHeader();renderNotes();updateSharedUI();persistState();loadStoreSocialContext(activeId).catch(()=>{})})}
function renderProfileDetail(){const rows=profileRows(),r=rows.find(x=>x.id===selectedProfile)||rows[0];if(!r){selectedProfile='';$('profileSharedStatus').textContent='当前没有活跃客户档案';$('profileDetailHero').innerHTML='';hydrateRuntimeAvatars($('profileDetailHero'),[r]);$('profileDetailGrid').innerHTML='<div class="ui-empty-state ui-empty-state-fill"><div><div class="ui-empty-orb"></div><b>没有可显示的活跃客户</b><p>归档客户已从客户档案工作区隐藏，可在联系人中心恢复。</p></div></div>';return}selectedProfile=r.id;const p=cleanProfileObject(r.profile);profileState[r.id]=p;const pending=p.inferences.filter(x=>x.status==='pending'),pendingProfileReview=pendingProfileReviewSummary(p),feedbackRows=feedbackPreferenceRows(p);$('profileSharedStatus').textContent=`当前 ${profileText(r.name,'联系人')} · 头像、身份、备注、未读、聊天实时共用`;$('profileDetailHero').innerHTML=`<div class="profile27-person">${avatarHostMarkup(r)}<div><h2>${htmlText(profileText(r.name,'未命名联系人'))}</h2><p>${htmlText(profileText(r.job,'职业未填写'))} · ${htmlText(profileText(r.city,'地区未填写'))}${profileText(r.country)?`, ${htmlText(profileText(r.country))}`:''}</p><div class="profile27-meta"><span>${htmlText(businessLabel('relationshipStage',r.stage,'待确认'))}</span><span>${htmlText(r.bound?'客户档案已绑定':'候选档案')}</span><span>健康度 ${htmlText(Number(p.health)||0)}%</span>${r.online?'<span class="live">● 在线</span>':''}${p.risk>=30?'<span class="warn">需关注</span>':''}</div></div></div><div class="profile27-detail-actions"><button class="primary" data-profile-action="conversation">进入会话</button><button data-profile-action="identity">查看身份</button><button data-profile-action="timeline">关系轨迹</button><button data-profile-action="edit">编辑档案</button><button data-profile-action="memory">刷新档案状态</button></div>`;hydrateRuntimeAvatars($('profileDetailHero'),[r]);
const factCandidates=[['年龄与生日',[profileText(r.age),profileText(r.birthday)].filter(Boolean).join(' · '),'客户备注'],['地址',[profileText(r.address),profileText(r.country)].filter(Boolean).join(', '),'联系人资料'],['语言',profileText(r.languages),'联系人资料'],['家庭情况',profileText(r.family),'客户备注'],['兴趣',profileText(r.interests),'用户备注'],['稳定身份',profileText(identityState[r.id]?.stableId),'平台同步']];
const baseFacts=factCandidates.filter(f=>profileText(f[1])).map(f=>[f[0],profileText(f[1]),f[2]]);
const presentation=p.analysisPresentation&&typeof p.analysisPresentation==='object'?p.analysisPresentation:{};
const bilingualMemoryHtml=[bilingualMemorySectionHtml('客户事实：中文理解与原始资料','已确认事实中文优先展示，外语原文仍是权威来源',presentation.facts||[],{title:'已确认事实',badge:'已确认'}),bilingualMemorySectionHtml('推断、承诺与沟通边界','推断不会冒充事实；承诺和边界继续参与回复前检查',[...(presentation.inferences||[]),...(presentation.commitments||[]),...(presentation.boundaries||[])],{title:'关系记忆'}),bilingualMemorySectionHtml('里程碑、风险与下一步建议','缺少中文理解时明确显示待生成，不用机器猜测填充',[...(presentation.milestones||[]),...(presentation.risks||[]),...(presentation.recommendations||[])],{title:'关系决策'})].join('');
$('profileDetailGrid').innerHTML=`
<section class="profile27-section wide"><header><h3>关系状态与决策核心</h3><span>由聊天事实、客户备注和身份可信度共同计算</span></header><div class="profile27-body"><div class="relation-core"><div class="relation-orb"><strong>${htmlText(p.health)}%</strong><span>档案健康度</span></div><div class="relation-metrics"><article><span>关系温度</span><b>${htmlText(p.temperature)}</b><p>${htmlText(p.temperature>=65?'稳定上升，可轻微推进':'保持当前节奏，避免过度解读')}</p></article><article><span>开放程度</span><b>${htmlText(p.openness)}</b><p>对方愿意分享真实生活的程度</p></article><article><span>互动活跃</span><b>${htmlText(p.activity)}</b><p>结合主动比例、回复速度与话题深度</p></article><article><span>关系风险</span><b class="${htmlAttr(p.risk>=30?'warn':'good')}">${htmlText(p.risk)}</b><p>${htmlText(p.risk>=30?'存在身份或关系信号需要人工确认':'目前没有明显高风险信号')}</p></article></div></div></div></section>
<section class="profile27-section wide"><header><h3>已确认事实</h3><span>AI回复大脑只把这些内容视为事实</span></header><div class="profile27-body"><div class="profile-fact-grid">${baseFacts.map(f=>`<article class="profile-fact"><small><span>${htmlText(f[0])}</span><i>${htmlText(f[2])}</i></small><b>${htmlText(f[1])}</b></article>`).join('')}${p.confirmed.map(f=>`<article class="profile-fact"><small><span>${htmlText(f.title)}</span><i>${htmlText(f.source)}</i></small><b>${htmlText(f.text)}</b></article>`).join('')}</div></div></section>
${bilingualMemoryHtml}
${pendingProfileReview?`<section class="profile27-section wide pending-profile-review"><header><h3>AI画像待人工审核</h3><span>未批准前不会进入事实层或回复上下文</span></header><div class="profile27-body"><div class="pending-profile-review-head"><div><b>${htmlText(pendingProfileReview.modelName)} 生成的画像建议</b><p>基于 ${htmlText(pendingProfileReview.sourceMessageCount)} 条消息${pendingProfileReview.createdAt?` · ${htmlText(pendingProfileReview.createdAt)}`:''}。请核对后再决定是否生效。</p></div><span>隔离中</span></div><div class="profile-fact-grid pending-profile-facts">${pendingProfileReview.rows.length?pendingProfileReview.rows.map(row=>`<article class="profile-fact"><small><span>${htmlText(row.title)}</span><i>AI建议</i></small><b>${htmlText(row.text)}</b></article>`).join(''):'<article class="profile-fact"><small><span>画像建议</span><i>AI建议</i></small><b>本次分析未产生可展示的事实字段，请结合关系阶段和下一步建议审核。</b></article>'}</div>${profileText(pendingProfileReview.proposal.lifecycleStage)?`<div class="pending-profile-note"><small>建议关系阶段</small><b>${htmlText(profileText(pendingProfileReview.proposal.lifecycleStage))}</b></div>`:''}${profileText(pendingProfileReview.proposal.nextAction)?`<div class="pending-profile-note"><small>建议下一步</small><b>${htmlText(profileText(pendingProfileReview.proposal.nextAction))}</b></div>`:''}<div class="inline-actions pending-profile-actions"><button class="ok" data-profile-review="approved">批准并应用画像</button><button data-profile-review="rejected">拒绝本次画像</button></div></div></section>`:''}
<section class="profile27-section"><header><h3>AI推断待确认</h3><span>${htmlText(pending.length)} 条不能自动覆盖事实</span></header><div class="profile27-body"><div class="inference-list">${pending.length?pending.map(x=>`<article class="inference-card"><header><b>${htmlText(x.text)}</b><em>置信度 ${htmlText(x.confidence)}%</em></header><p>确认后才会进入已确认事实，并参与回复前冲突检查。</p><div class="inline-actions"><button class="ok" data-inference-action="confirm" data-inference-id="${htmlAttr(x.id)}">确认事实</button><button data-inference-action="reject" data-inference-id="${htmlAttr(x.id)}">删除推断</button></div></article>`).join(''):'<article class="inference-card"><b>当前没有待确认推断</b><p>AI不会把未确认推断写入事实层。</p></article>'}</div></div></section>
<section class="profile27-section"><header><h3>从你的批改中学习</h3><span>${htmlText(feedbackRows.length)} 项稳定偏好</span></header><div class="profile27-body"><div class="feedback-learning-list">${feedbackRows.length?feedbackRows.map(row=>`<article class="feedback-learning-card"><div><small>${htmlText(row.label)}</small><b>${htmlText(row.value)}</b></div><span>${htmlText(row.evidenceCount)} 次证据 · 置信度 ${htmlText(row.confidence)}%</span></article>`).join(''):'<article class="feedback-learning-card empty"><div><small>尚未形成稳定偏好</small><b>实际发送后的改写，或带原因的明确拒绝，累计至少3次同方向证据后才会生效。</b></div></article>'}</div><div class="inline-actions feedback-learning-actions">${feedbackRows.length?'<button data-feedback-action="clear">清空该联系人的回复学习</button>':''}<button data-feedback-action="restore">恢复历史学习版本</button></div></div></section>
<section class="profile27-section"><header><h3>承诺与开放事项</h3><span>防止忘记、重复询问或失约</span></header><div class="profile27-body"><div class="commitment-list">${p.commitments.length?p.commitments.map(x=>`<article class="commitment-card ${htmlAttr(x.done?'done':'')}"><header><b>${htmlText(x.text)}</b><span class="commitment-state ${htmlAttr(x.done?'':'open')}">${htmlText(x.done?'已完成':x.due)}</span></header><p>${htmlText(x.done?'已归档，不再作为待办提醒。':'发送回复前会提醒是否需要承接。')}</p><div class="inline-actions"><button data-commitment-id="${htmlAttr(x.id)}">${htmlText(x.done?'恢复待办':'标记完成')}</button></div></article>`).join(''):'<article class="commitment-card"><b>暂无开放事项</b><p>当前没有需要跟进的承诺或任务。</p></article>'}</div></div></section>
<section class="profile27-section"><header><h3>边界、禁忌与风险</h3><span>回复前强制检查</span></header><div class="profile27-body"><div class="boundary-list">${p.boundaries.map(x=>`<article class="boundary-card ${htmlAttr(x.level)}"><b>${htmlText(x.title)}</b><p>${htmlText(x.text)}</p></article>`).join('')}</div></div></section>
<section class="profile27-section"><header><h3>长期备注</h3><span>用户可编辑 · 不由AI自动覆盖</span></header><div class="profile27-body"><div class="profile-note">${htmlText(r.note||'尚未填写长期备注。')}</div><div class="source-legend" style="margin-top:9px"><span class="confirmed">本人/平台确认</span><span class="manual">用户手动备注</span><span class="ai">AI推断待确认</span></div></div></section>
<section class="profile27-section wide"><header><h3>关系时间线与下一步</h3><span>更新于 ${htmlText(p.updated)}</span></header><div class="profile27-body"><div style="display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px"><div class="profile-timeline">${p.milestones.map(x=>`<div class="profile-timeline-row"><time>${htmlText(x[0])}</time><i></i><div><b>${htmlText(x[1])}</b><span>${htmlText(x[2])}</span></div></div>`).join('')}</div><div class="next-step-card"><small>AI建议下一步</small><h4>${htmlText(p.next)}</h4><p>建议会在进入会话后同步到AI回复大脑的理解与导演阶段，并继续受客户备注和边界约束。</p><button data-profile-action="conversation">进入会话并继续</button></div></div></div></section>`;
document.querySelectorAll('[data-profile-action]').forEach(b=>b.onclick=()=>handleProfileAction(b.dataset.profileAction,r));document.querySelectorAll('[data-profile-review]').forEach(b=>b.onclick=()=>handlePendingProfileReview(r.id,b.dataset.profileReview));document.querySelectorAll('[data-feedback-action]').forEach(b=>b.onclick=()=>handleReplyFeedbackAction(r.id,b.dataset.feedbackAction));document.querySelectorAll('[data-inference-action]').forEach(b=>b.onclick=()=>handleInferenceAction(r.id,b.dataset.inferenceId,b.dataset.inferenceAction));document.querySelectorAll('[data-commitment-id]').forEach(b=>b.onclick=()=>toggleCommitment(r.id,b.dataset.commitmentId))}
function handleProfileAction(action,r){if(action==='conversation'){openConversationPage(r.id);hint('已进入 '+r.name+' 的对应会话');return}if(action==='identity'){openContactsPage(r.id);hint('已打开 '+r.name+' 的身份详情');return}if(action==='timeline'){openTimelinePage(r.id);hint('已打开 '+r.name+' 的关系轨迹');return}if(action==='edit'){activeId=r.id;openNote();return}if(action==='memory'){profileState[r.id].updated='刚刚';logAction(r.id,'联系人档案已更新','已确认事实、边界、开放事项与客户备注已重新送入回复前检查');renderProfilePage();persistState();hint('联系人档案已更新')}}
async function handleReplyFeedbackAction(contactId,action){try{if(action==='clear'){if(!await window.YanceDialogs.confirm({title:'清空回复学习',message:'清空后，该联系人的回复长度、提问、表情和语气偏好将重新学习。历史聊天和已发送消息不会删除。确认清空吗？',danger:true,submitLabel:'清空学习'}))return;await apiJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback`,{method:'DELETE',body:JSON.stringify({resetBy:'user'})});const profile=cleanProfileObject(profileState[contactId]||{});profile.socialPreferences={...(profile.socialPreferences||{}),userFeedback:{}};profileState[contactId]=profile;await loadStoreSocialContext(contactId).catch(()=>null);renderProfilePage();persistState();logAction(contactId,'回复学习已清空','该联系人的反馈偏好已重置，将从后续真实批改和成功发送重新学习。');hint('该联系人的回复学习已清空');return}if(action==='restore'){const history=await apiJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback?versionLimit=12`);const versions=(history.versions||[]).filter(row=>Number(row.version)>0);if(!versions.length){hint('当前没有可恢复的回复学习版本','warning');return}const choices=versions.map(row=>`v${row.version} · ${profileText(row.reason,'学习快照')} · ${profileText(row.createdAt,'')}`).join('\n');const entered=await window.YanceDialogs.prompt({title:'恢复回复学习版本',message:choices,label:'输入版本号',value:String(versions[0].version),placeholder:'例如：3'});if(entered===null)return;const sourceVersion=Number(String(entered).replace(/^v/i,''));if(!versions.some(row=>Number(row.version)===sourceVersion)){hint('回复学习版本不存在','warning');return}await apiJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback/restore`,{method:'POST',body:JSON.stringify({version:sourceVersion,restoredBy:'user'})});await loadStoreSocialContext(contactId).catch(()=>null);renderProfilePage();persistState();logAction(contactId,'回复学习版本已恢复',`已从版本 v${sourceVersion} 创建新的生效版本。`);hint(`回复学习已恢复到 v${sourceVersion} 的内容`);return}}catch(error){hint(error.message||'回复学习操作失败','error')}}
async function handlePendingProfileReview(contactId,decision){const normalized=decision==='approved'?'approved':'rejected';if(normalized==='approved'&&!await window.YanceDialogs.confirm({title:'批准 AI 画像',message:'批准后，AI画像建议会进入正式客户档案并参与后续回复。',submitLabel:'批准'}))return;let reason='';if(normalized==='rejected'){const entered=await window.YanceDialogs.prompt({title:'拒绝 AI 画像',label:'拒绝原因（可留空）',value:'',multiline:true,placeholder:'说明本次建议不应进入客户档案的原因'});if(entered===null)return;reason=profileText(entered,'')}try{const result=await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(contactId)}/profile-review`,{method:'POST',body:JSON.stringify({decision:normalized,reason,decidedBy:'user'})});profileState[contactId]=cleanProfileObject(result.profile||{});await loadCrossModuleContext(contactId,{render:false}).catch(()=>null);logAction(contactId,normalized==='approved'?'AI画像已批准':'AI画像已拒绝',normalized==='approved'?'画像建议已进入正式档案和回复前检查。':'本次画像建议已从待审核区移除，不会进入回复上下文。');renderProfilePage();renderHeader();renderNotes();persistState();hint(normalized==='approved'?'AI画像已批准并生效':'AI画像已拒绝')}catch(error){hint(error.message||'AI画像审核保存失败','error')}}
function handleInferenceAction(contactId,inferenceId,action){const p=profileState[contactId],x=p.inferences.find(i=>i.id===inferenceId);if(!x)return;if(action==='confirm'){x.status='confirmed';p.confirmed.push({title:'AI推断已人工确认',text:x.text,source:'用户确认'});logAction(contactId,'AI推断已确认','该推断已进入事实层，并可参与AI回复前检查');hint('推断已确认并写入事实层')}else{x.status='rejected';logAction(contactId,'AI推断已删除','该推断不会进入长期事实或AI回复策略');hint('推断已删除')}p.updated='刚刚';renderProfilePage();persistState()}
function toggleCommitment(contactId,id){const x=profileState[contactId].commitments.find(i=>i.id===id);if(!x)return;x.done=!x.done;logAction(contactId,x.done?'开放事项已完成':'开放事项已恢复',x.text);renderProfilePage();persistState();hint(x.done?'已标记完成':'已恢复为待办')}
function renderProfilePage(){renderProfileStats();renderProfileList();renderProfileDetail()}


function timelineRows(){return activeContacts().map(c=>Object.assign({},c,{trajectory:cleanTrajectoryObject(trajectoryState[c.id]||{}),profile:cleanProfileObject(profileState[c.id]||{})}))}
function timelineMatches(r,f){const t=r.trajectory,p=r.profile;if(f==='all')return true;if(f==='warming')return Number(String(t.momentum||0).replace('+',''))>=5;if(f==='active')return Number(t.initiative||0)>=52||Number(p.activity||0)>=70;if(f==='risk')return Number(t.risk||0)>=30;return true}
function trajectorySlice(t){const points=Array.isArray(t?.points)?t.points.filter(Array.isArray):[],n=timelineRange==='7d'?4:timelineRange==='30d'?7:points.length;return points.slice(-n)}
function sparklinePoints(values,w=70,h=24,p=2){const rows=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite);if(!rows.length)return'';const min=Math.min(...rows)-3,max=Math.max(...rows)+3,den=Math.max(1,max-min);return rows.map((v,i)=>`${p+(w-2*p)*(i/Math.max(1,rows.length-1))},${h-p-(h-2*p)*((v-min)/den)}`).join(' ')}
function chartPoints(values,w=860,h=250,padX=36,padY=24){const rows=(Array.isArray(values)?values:[]).map(Number).map(v=>Number.isFinite(v)?v:0);return rows.map((v,i)=>`${padX+(w-padX*2)*(i/Math.max(1,rows.length-1))},${h-padY-(h-padY*2)*(v/100)}`).join(' ')}
function chartDots(values,cls,w=860,h=250,padX=36,padY=24){const rows=(Array.isArray(values)?values:[]).map(Number).map(v=>Number.isFinite(v)?v:0);return rows.map((v,i)=>`<circle class="chart-dot ${htmlAttr(cls)}" cx="${htmlAttr(padX+(w-padX*2)*(i/Math.max(1,rows.length-1)))}" cy="${htmlAttr(h-padY-(h-padY*2)*(v/100))}" r="3.2"/>`).join('')}
function trajectoryChart(t){const rows=trajectorySlice(t);if(!rows.length)return '<div class="ui-empty-state"><div><div class="ui-empty-orb"></div><b>暂无关系轨迹</b><p>真实互动发生并完成分析后会自动形成趋势。</p></div></div>';const labels=rows.map(x=>profileText(x[0],'')),temp=rows.map(x=>Number(x[1])||0),init=rows.map(x=>Number(x[2])||0),depth=rows.map(x=>Number(x[3])||0),w=860,h=250,px=36,py=24;const tempPts=chartPoints(temp,w,h,px,py),initPts=chartPoints(init,w,h,px,py),depthPts=chartPoints(depth,w,h,px,py),area=`${px},${h-py} ${tempPts} ${w-px},${h-py}`;const yLines=[20,40,60,80].map(v=>{const y=h-py-(h-py*2)*(v/100);return `<line x1="${htmlAttr(px)}" y1="${htmlAttr(y)}" x2="${htmlAttr(w-px)}" y2="${htmlAttr(y)}"/><text x="7" y="${htmlAttr(y+3)}">${htmlText(v)}</text>`}).join(''),xText=labels.map((l,i)=>`<text x="${htmlAttr(px+(w-px*2)*(i/Math.max(1,labels.length-1)))}" y="${htmlAttr(h-6)}" text-anchor="middle">${htmlText(l)}</text>`).join('');return `<div class="trajectory-chart"><svg viewBox="0 0 ${htmlAttr(w)} ${htmlAttr(h)}" preserveAspectRatio="none"><defs><linearGradient id="trajectoryArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--chart-series-primary)" stop-opacity=".65"/><stop offset="1" stop-color="var(--chart-series-primary)" stop-opacity="0"/></linearGradient></defs><g class="chart-grid chart-axis">${yLines}${xText}</g><polygon class="chart-area" points="${htmlAttr(area)}"/><polyline class="chart-line-temp" points="${htmlAttr(tempPts)}"/><polyline class="chart-line-init" points="${htmlAttr(initPts)}"/><polyline class="chart-line-depth" points="${htmlAttr(depthPts)}"/>${chartDots(temp,'temp',w,h,px,py)}${chartDots(init,'init',w,h,px,py)}${chartDots(depth,'depth',w,h,px,py)}</svg></div><div class="chart-legend"><span><i></i>关系温度</span><span><i></i>对方主动度</span><span><i></i>对话深度</span></div>`}
function renderTimelineList(){const q=$('timelineSearch').value.trim().toLowerCase(),all=timelineRows(),rows=all.filter(r=>timelineMatches(r,timelineFilter)&&(!q||[r.name,r.stage,r.note,...(r.tags||[]),...r.trajectory.topics.map(x=>x[0]),r.trajectory.risk>=30?'需关注':''].map(x=>profileText(x)).join(' ').toLowerCase().includes(q)));if(!rows.some(r=>r.id===selectedTimeline))selectedTimeline=rows[0]?.id||'';$('timelineDirectoryMeta').textContent=`${rows.length} 个活跃关系对象 · 当前范围 ${timelineRange==='7d'?'最近7天':timelineRange==='30d'?'最近30天':'全部时间'}`;$('timelineList').innerHTML=rows.length?rows.map(r=>{const t=r.trajectory,vals=t.points.slice(-6).map(x=>Number(x[1])||0);return `<button class="timeline27-card ${htmlAttr(r.id===selectedTimeline?'active':'')}" data-timeline-id="${htmlAttr(r.id)}">${avatarHostMarkup(r)}<div class="timeline27-copy"><b>${htmlText(profileText(r.name,'未命名联系人'))}</b><p>${htmlText(businessLabel('relationshipStage',t.stage,'待分析'))} · ${htmlText(businessLabel('relationshipStage',r.stage,'待确认'))}</p><div class="timeline27-tags"><i>温度 ${htmlText(Number(r.profile.temperature)||0)}</i><i>${htmlText(t.risk>=30?'需关注':'风险低')}</i></div></div><div class="timeline27-side"><strong>${htmlText(businessLabel('momentum',t.momentum,profileText(t.momentum,'0')))}</strong><svg class="mini-spark" viewBox="0 0 70 24"><polyline points="${htmlAttr(sparklinePoints(vals))}"/></svg><small>${htmlText(profileText(t.updated,'尚未分析'))}</small></div></button>`}).join(''):'<div class="ui-empty-state ui-empty-state-fill"><div><div class="ui-empty-orb"></div><b>当前没有活跃关系对象</b><p>已归档客户已隐藏；真实互动与分析完成后会在此生成关系轨迹。</p></div></div>';hydrateRuntimeAvatars($('timelineList'),rows);document.querySelectorAll('[data-timeline-id]').forEach(b=>b.onclick=()=>{selectedTimeline=b.dataset.timelineId;activeId=selectedTimeline;selectedProfile=selectedTimeline;selectedIdentity=selectedTimeline;publishActiveContact(activeId,{source:'r32-ui-runtime:timeline',reason:'timeline-selected',view:'timeline'});renderTimelinePage();renderHeader();renderNotes();updateSharedUI();persistState()})}
function renderTimelineDetail(){const rowsAll=timelineRows(),r=rowsAll.find(x=>x.id===selectedTimeline)||rowsAll[0];if(!r){selectedTimeline='';$('timelineConversationStatus').textContent='当前没有活跃关系对象';$('timelineDetailHero').innerHTML='';hydrateRuntimeAvatars($('timelineDetailHero'),[r]);$('timelineContent').innerHTML='<div class="ui-empty-state ui-empty-state-fill"><div><div class="ui-empty-orb"></div><b>暂无可显示的关系轨迹</b><p>归档客户不会进入关系轨迹、决策和AI自动处理链。</p></div></div>';return}selectedTimeline=r.id;const t=cleanTrajectoryObject(r.trajectory),p=cleanProfileObject(r.profile),rows=trajectorySlice(t),current=rows.at(-1)||['',Number(p.temperature)||0,Number(t.initiative)||0,Number(t.depth)||0],topics=t.topics,events=t.events,evidence=t.evidence,topTopic=topics[0]||['暂无升温话题',0,'等待真实互动'],relationship=t.bilingualPresentation||p.analysisPresentation?.relationship||{},effectiveNodeCount=Number(t.relationshipProjection?.socialNodeCount||events.length||rows.length||0);$('timelineConversationStatus').textContent=`当前 ${profileText(r.name,'联系人')} · 聊天、未读、头像、备注实时共用`;$('timelineDetailHero').innerHTML=`<div class="timeline27-person">${avatarHostMarkup(r)}<div><h2>${htmlText(profileText(r.name,'未命名联系人'))}</h2><p>${htmlText(profileText(r.job,'职业未填写'))} · ${htmlText(profileText(r.city,'地区未填写'))}${profileText(r.country)?`, ${htmlText(profileText(r.country))}`:''}</p><div class="timeline27-meta"><span>${htmlText(businessLabel('relationshipStage',t.stage,'待分析'))}</span><span>${htmlText(businessLabel('relationshipStage',r.stage,'待确认'))}</span><span>轨迹更新 ${htmlText(profileText(t.updated,'尚未分析'))}</span>${r.online?'<span class="live">● 在线</span>':''}${t.risk>=30?'<span class="warn">需关注</span>':''}</div></div></div><div class="timeline27-detail-actions"><button class="primary" data-timeline-action="conversation">进入会话</button><button data-timeline-action="profile">客户档案</button><button data-timeline-action="identity">身份详情</button><button data-timeline-action="director">生成回复策略</button></div>`;hydrateRuntimeAvatars($('timelineDetailHero'),[r]);$('timelineContent').innerHTML=`
<div class="timeline27-rangebar"><div><b>关系轨迹分析范围</b><span>更新时间 ${htmlText(profileText(t.updated,'尚未分析'))} · ${htmlText(effectiveNodeCount)} 个有效节点 · ${htmlText(profileText(t.analysisStatusLabel,'关系投影状态未知'))}</span></div><div class="timeline27-ranges"><button data-range="7d" class="${htmlAttr(timelineRange==='7d'?'active':'')}">最近7天</button><button data-range="30d" class="${htmlAttr(timelineRange==='30d'?'active':'')}">最近30天</button><button data-range="all" class="${htmlAttr(timelineRange==='all'?'active':'')}">全部</button></div></div>
${relationshipPresentationHtml(relationship)}
<div class="timeline27-metrics"><article class="timeline27-metric"><span>关系温度</span><b class="good">${htmlText(Number(current[1])||0)}</b><small>${htmlText(businessLabel('momentum',t.momentum,profileText(t.momentum,'0')))} · ${htmlText(businessLabel('relationshipStage',t.stage,'待分析'))}</small></article><article class="timeline27-metric"><span>对方主动度</span><b>${htmlText(Number(t.initiative)||0)}%</b><small>你方 ${htmlText(Math.max(0,100-(Number(t.initiative)||0)))}%</small></article><article class="timeline27-metric"><span>平均回复速度</span><b>${htmlText(t.reply)}</b><small>按当前时间范围计算</small></article><article class="timeline27-metric"><span>对话深度</span><b>${htmlText(Number(t.depth)||0)}</b><small>事实、情绪与行动综合</small></article><article class="timeline27-metric"><span>关系机会</span><b class="good">${htmlText(Number(t.opportunity)||0)}</b><small>可推进窗口</small></article><article class="timeline27-metric"><span>关系风险</span><b class="${htmlAttr(t.risk>=30?'warn':'good')}">${htmlText(Number(t.risk)||0)}</b><small>${htmlText(t.risk>=30?'需要人工确认':'当前风险较低')}</small></article></div>
<div class="timeline27-grid">
<section class="timeline27-section wide"><header><h3>关系温度与互动轨迹</h3><span>温度、主动度与对话深度不是单一情绪分数</span></header><div class="timeline27-body">${trajectoryChart(t)}</div></section>
<section class="timeline27-section"><header><h3>互动节奏诊断</h3><span>谁更主动、速度与投入变化</span></header><div class="timeline27-body"><div class="rhythm-grid"><article class="rhythm-card"><span>主动比例</span><b>对方 ${htmlText(Number(t.initiative)||0)}% · 你 ${htmlText(Math.max(0,100-(Number(t.initiative)||0)))}%</b><div class="balance"><i style="width:${sanitizeCssNumber(Number(t.initiative)||0,{min:0,max:100,unit:'%'})}"></i></div><p>${htmlText(Number(t.initiative)>=55?'对方近期主动性更高，可以自然承接。':'主动比例接近平衡，不需要刻意拉动。')}</p></article><article class="rhythm-card"><span>回复节奏</span><b>${htmlText(t.reply)}</b><p>${htmlText(String(t.reply).includes('小时')?'节奏偏慢，避免连续追问。':'回复速度尚未形成稳定结论。')}</p></article><article class="rhythm-card"><span>最强升温话题</span><b>${htmlText(profileText(topTopic[0],'暂无升温话题'))}</b><p>${htmlText(profileText(topTopic[2],'等待真实互动'))} · 影响分 ${htmlText(Number(topTopic[1])||0)}</p></article><article class="rhythm-card"><span>当前关系姿态</span><b>${htmlText(businessLabel('relationshipStage',t.stage,'待分析'))}</b><p>${htmlText(profileText(t.next,'继续观察真实互动。'))}</p></article></div></div></section>
<section class="timeline27-section"><header><h3>关键话题影响</h3><span>哪些话题推动或压低关系温度</span></header><div class="timeline27-body"><div class="topic-list">${topics.length?topics.map(x=>`<article class="topic27"><div><b>${htmlText(profileText(x[0],'话题'))}</b><span>${htmlText(profileText(x[2],'暂无说明'))}</span></div><div class="topic27-meter"><i style="width:${sanitizeCssNumber(Math.max(0,Math.min(100,Number(x[1])||0)),{min:0,max:100,unit:'%'})}"></i></div><strong>${htmlText(Number(x[1])||0)}</strong></article>`).join(''):'<div class="ui-empty-state"><div><b>暂无关键话题</b><p>真实互动分析后显示。</p></div></div>'}</div></div></section>
<section class="timeline27-section wide"><header><h3>关键转折点</h3><span>来自会话、身份、客户档案与用户标记</span></header><div class="timeline27-body"><div class="turning-list">${events.length?events.map(x=>`<article class="turning-event ${htmlAttr(profileText(x[3],''))}"><time>${htmlText(profileText(x[0],''))}</time><i></i><div><b>${htmlText(businessLabel('eventType',x[1],profileText(x[1],'关系事件')))}</b><span>${htmlText(profileText(x[2],''))}</span><em>${htmlText(businessLabel('source',x[4],profileText(x[4],'真实数据')))}</em></div></article>`).join(''):'<div class="ui-empty-state"><div><b>暂无关键转折点</b><p>等待真实互动形成证据。</p></div></div>'}</div></div></section>
<section class="timeline27-section"><header><h3>机会与风险</h3><span>同时观察推进窗口和保护边界</span></header><div class="timeline27-body"><div class="signal27-grid"><article class="signal27 opportunity"><small>关系机会 ${htmlText(Number(t.opportunity)||0)}</small><h4>当前值得推进的信号</h4><p>${htmlText(t.opportunityText)}</p></article><article class="signal27 risk"><small>关系风险 ${htmlText(Number(t.risk)||0)}</small><h4>需要继续保护的边界</h4><p>${htmlText(t.riskText)}</p></article></div></div></section>
<section class="timeline27-section"><header><h3>原句证据链</h3><span>判断可回到原句，不把推断当事实</span></header><div class="timeline27-body"><div class="evidence27-list">${evidence.length?evidence.map(x=>`<article class="evidence27"><blockquote>${htmlText(profileText(x[0],''))}</blockquote><p>${htmlText(profileText(x[1],''))}</p><footer><span>${htmlText(profileText(x[2],'真实消息'))}</span><b>置信度 ${htmlText(Number(x[3])||0)}%</b></footer></article>`).join(''):'<div class="ui-empty-state"><div><b>暂无原句证据</b><p>关系判断不会在没有证据时强行生成。</p></div></div>'}</div></div></section>
<section class="timeline27-section wide"><header><h3>${htmlText(t.projectionSource==='ai_analysis'?'AI 下一步关系决策':'规则关系建议')}</h3><span>${htmlText(profileText(t.analysisStatusLabel,'关系建议来自当前权威投影'))}</span></header><div class="timeline27-body"><div class="next27"><div class="next27-orb"><div><b>${htmlText(Number(t.opportunity)||0)}%</b><span>推荐置信</span></div></div><div><small>当前最佳动作</small><h4>${htmlText(t.next)}</h4><p>执行前继续检查客户备注、已确认事实、边界、开放事项与最近原句证据，避免过度升温、重复询问或串用其他联系人资料。</p><div class="next27-actions"><button class="primary" data-timeline-action="director">进入导演生成策略</button><button data-timeline-action="conversation">返回对应会话</button><button data-timeline-action="profile">查看客户档案</button></div></div></div></div></section>
</div>`;document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{timelineRange=b.dataset.range;renderTimelinePage();persistState()});document.querySelectorAll('[data-timeline-action]').forEach(b=>b.onclick=()=>handleTimelineAction(b.dataset.timelineAction,r))}
function handleTimelineAction(action,r){if(action==='conversation'){openConversationPage(r.id);hint('已进入 '+r.name+' 的对应会话');return}if(action==='profile'){openProfilesPage(r.id);hint('已打开 '+r.name+' 的客户档案');return}if(action==='identity'){openContactsPage(r.id);hint('已打开 '+r.name+' 的身份详情');return}if(action==='director'){openConversationPage(r.id);openPanel('director');hint('关系轨迹已送入AI导演策略');return}}
function renderTimelinePage(){renderTimelineList();renderTimelineDetail()}
function setTimelineFilter(f){timelineFilter=f;document.querySelectorAll('#timelineQuickFilters button').forEach(b=>b.classList.toggle('active',b.dataset.timelineFilter===f));const rows=timelineRows().filter(r=>timelineMatches(r,f));if(!rows.some(r=>r.id===selectedTimeline))selectedTimeline=rows[0]?.id||'';renderTimelinePage();persistState()}
function openTimelinePage(id=activeId){stashConversationState();const target=activeContactById(id)||activeContactById(activeId)||firstActiveContact();activeId=target?.id||'';selectedTimeline=activeId;selectedProfile=activeId;selectedIdentity=activeId;applyWorkspaceRoute('timeline','r32-ui-runtime:timeline');$('navConversation').classList.remove('active');$('navContacts').classList.remove('active');$('navProfiles').classList.remove('active');$('navTimeline').classList.add('active');currentView='timeline';publishActiveContact(activeId,{source:'r32-ui-runtime:timeline',reason:'timeline-opened',view:'timeline'});renderTimelinePage();renderHeader();renderNotes();persistState()}


/* R32 · 稳定性、状态保持与完整工作流。 */
const R32_RUNTIME_STATE_KEY='yance27:r32:ui-safety';
let r32RuntimeState={version:1,aiPanel:'understanding',searches:{contact:'',identity:'',profile:'',timeline:''},scrolls:{},profileChanges:[],moduleErrors:[],contactMode:'normal',navMode:innerWidth>=1640?'expanded':'compact',aiHidden:false,lastSavedAt:0};
let analysisRunToken=0,analysisTimer=0,statusTimer=0,retryAction=null,editingContactId=null;
function r32RuntimeRead(){try{const raw=localStorage.getItem(R32_RUNTIME_STATE_KEY);if(raw){const saved=JSON.parse(raw);r32RuntimeState={...r32RuntimeState,...saved,searches:{...r32RuntimeState.searches,...(saved.searches||{})},scrolls:{...r32RuntimeState.scrolls,...(saved.scrolls||{})},profileChanges:Array.isArray(saved.profileChanges)?saved.profileChanges:[],moduleErrors:Array.isArray(saved.moduleErrors)?saved.moduleErrors:[]}}}catch(e){showSystemStatus('warning','显示与安全状态读取失败，已使用安全默认值')}}
function r32RuntimeWrite(){try{r32RuntimeState.lastSavedAt=Date.now();localStorage.setItem(R32_RUNTIME_STATE_KEY,JSON.stringify(r32RuntimeState));return true}catch(e){showSystemStatus('error','本地保存失败，当前修改仍保留在页面中','重试',()=>{persistState();r32RuntimeWrite()});return false}}
function showSystemStatus(type,text,actionLabel='',action=null,autoHide){retryAction=action;const explicitDuration=arguments.length>=5;return window.YanceSystemStatus?.show?.(type,text,{actionLabel,action,duration:explicitDuration&&autoHide>0?autoHide:undefined,persistent:explicitDuration&&autoHide===0,source:'r32-ui-runtime'})||null}
function clearSystemStatus(reason='manual'){retryAction=null;return window.YanceSystemStatus?.clear?.(reason)}
const baseHint=hint;
hint=function(msg,type='success',options={}){return window.YanceNotificationLayoutAuthority.show({message:safeUiText(msg,'操作已完成'),tone:String(type||'success'),timeoutMs:Math.max(900,Number(options?.duration||1900)),actionLabel:options?.actionLabel,action:options?.action})};
function setBusy(btn,busy,label){if(!btn)return;if(busy){btn.dataset.oldText=btn.textContent;btn.textContent=label||'处理中…';btn.disabled=true;btn.classList.add('button-busy')}else{btn.textContent=btn.dataset.oldText||btn.textContent;btn.disabled=false;btn.classList.remove('button-busy')}}
async function runBusy(btn,label,task,success){setBusy(btn,true,label);try{const result=await task();if(success)hint(typeof success==='function'?success(result):success,'success');return result}catch(e){hint(e?.message||'操作失败','error',{actionLabel:'重试',action:()=>runBusy(btn,label,task,success),duration:5000});showSystemStatus('error','操作未完成，数据没有被破坏','重试',()=>runBusy(btn,label,task,success))}finally{setBusy(btn,false)}}
function validateSharedData(){const ids=new Set(),issues=[];contacts.forEach(c=>{if(!c||!c.id){issues.push('发现缺少ID的联系人');return}if(ids.has(c.id))issues.push('联系人ID重复：'+c.id);ids.add(c.id);if(!histories[c.id])histories[c.id]=[{type:'day',text:'暂无聊天记录'}];if(!identityState[c.id])identityState[c.id]=defaultIdentity(c);if(!profileState[c.id])profileState[c.id]=defaultProfile();else profileState[c.id]=cleanProfileObject(profileState[c.id]);if(!trajectoryState[c.id])trajectoryState[c.id]=defaultTrajectory();else trajectoryState[c.id]=cleanTrajectoryObject(trajectoryState[c.id])});if(!contacts.some(c=>c.id===activeId))activeId=firstActiveContact()?.id||contacts[0]?.id||'';normalizeCrossModuleSelections(activeId);if(issues.length){r32RuntimeState.moduleErrors.push({time:Date.now(),module:'数据校验',detail:issues.join('；')});r32RuntimeState.moduleErrors=r32RuntimeState.moduleErrors.slice(-20);showSystemStatus('warning','检测到部分资料缺失，系统已隔离问题并保留其他模块','查看',()=>runDiagnostics())}return issues}
const basePersistState=persistState;
persistState=function(){let ok=true;try{basePersistState()}catch(e){ok=false}if(!r32RuntimeWrite())ok=false;if(!ok)showSystemStatus('error','保存失败，页面状态仍在内存中','重试',()=>persistState());return ok};
const baseRestoreState=restoreState;
restoreState=function(){baseRestoreState();r32RuntimeRead();validateSharedData();const s=r32RuntimeState.searches||{};$('contactSearch').value=s.contact||'';$('identitySearch').value=s.identity||'';$('profileSearch').value=s.profile||'';$('timelineSearch').value=s.timeline||'';filter=r32RuntimeState.contactFilter||filter;if(!localStorage.getItem(CONVERSATION_LAYOUT_KEY)){conversationLayoutState.contactMode=r32RuntimeState.contactMode||conversationLayoutState.contactMode;conversationLayoutState.navMode=r32RuntimeState.navMode||conversationLayoutState.navMode;conversationLayoutState.aiVisible=!r32RuntimeState.aiHidden}applyConversationLayout()};
function lazyEnhance(root=document){root.querySelectorAll('img:not([data-r32-lazy])').forEach(img=>{img.loading='lazy';img.decoding='async';img.dataset.r32Lazy='1'});window.YanceAvatarRuntime?.enhanceAvatarImages?.(root)}
function renderModuleError(targetId,module,error,retry){const target=$(targetId);if(!target)return;const old=target.querySelector('.ui-module-error');if(old)old.remove();const box=document.createElement('div');box.className='ui-module-error';box.innerHTML=`<b>${htmlText(module)}暂时无法显示</b><p>${htmlText(String(error?.message||error||'未知错误'))}</p><button>重新加载此模块</button>`;box.querySelector('button').onclick=retry;target.appendChild(box);r32RuntimeState.moduleErrors.push({time:Date.now(),module,detail:String(error?.message||error)});r32RuntimeState.moduleErrors=r32RuntimeState.moduleErrors.slice(-20);r32RuntimeWrite();showSystemStatus('error',module+'发生异常，其他模块仍可继续使用','重试',retry)}
function safeModule(module,targetId,fn){try{const result=fn();lazyEnhance($(targetId)||document);return result}catch(e){renderModuleError(targetId,module,e,()=>safeModule(module,targetId,fn));return null}}
const baseRenderIdentityPage=renderIdentityPage,baseRenderProfilePage=renderProfilePage,baseRenderTimelinePage=renderTimelinePage;
renderIdentityPage=function(){return safeModule('联系人与身份','contactsWorkspace',baseRenderIdentityPage)};
renderProfilePage=function(){return safeModule('客户档案','profilesWorkspace',baseRenderProfilePage)};
renderTimelinePage=function(){return safeModule('关系轨迹','timelineWorkspace',baseRenderTimelinePage)};
const baseRenderContacts=renderContacts,baseRenderMessages=renderMessages;
renderContacts=function(){const result=baseRenderContacts();lazyEnhance($('contactList'));return result};
renderMessages=function(){const arr=histories[activeId]||[];if(arr.length<=100){const r=baseRenderMessages();lazyEnhance($('messages'));return r}const keep=80,start=Math.max(0,arr.length-keep);const original=histories[activeId];histories[activeId]=arr.slice(start);baseRenderMessages();histories[activeId]=original;const btn=document.createElement('button');btn.className='load-earlier';btn.textContent=`加载更早的 ${start} 条消息`;btn.onclick=()=>{histories[activeId]=original;const old=baseRenderMessages;baseRenderMessages();lazyEnhance($('messages'));hint('已加载完整历史消息')};$('messages').prepend(btn);lazyEnhance($('messages'))};
const baseOpenPanel=openPanel;
openPanel=function(name){r32RuntimeState.aiPanel=name;baseOpenPanel(name);r32RuntimeWrite();requestAnimationFrame(()=>{const sc=document.querySelector(`.ai-view[data-panel="${name}"] .ai-scroll`);if(sc&&r32RuntimeState.scrolls['ai:'+name]!=null)sc.scrollTop=r32RuntimeState.scrolls['ai:'+name]})};
const ANALYSIS_INSTRUCTION='你是言策R32会话理解引擎。只使用输入中的真实消息、已确认客户资料和关系轨迹，不得编造。输出严格JSON，字段：summary,confidence,intent,intentLabel,intentConfidence,hiddenNeed,needConfidence,dimensions{emotion,initiative,openness,pressure,flirtation},memories[],evidence[{label,quote,source,confidence}],mustRespond[],ignore[],risk{score,level,text},opportunity{score,level,text},personaConsistency,constraints[{text,pass}],strategy{title,reason,match,progress,risk,replyChance},simulation{likely:{text,probability},positive:{text,probability},negative:{text,probability}}。';
function setAnalysisProgress(percent,label,detail=''){const s=$('analysisStatus');if(!s)return;const value=Math.max(0,Math.min(100,Math.round(Number(percent)||0))),safeLabel=safeUiText(label,'AI正在分析'),safeDetail=safeUiText(detail,''),failed=/失败|错误/.test(safeLabel+safeDetail),incomplete=!failed&&/不完整|缺少|未进入/.test(safeLabel+safeDetail),running=!failed&&!incomplete&&value>0&&value<100,dot=document.createElement('i'),text=document.createTextNode(`${safeLabel}${safeDetail?` · ${safeDetail}`:''}${running?` ${value}%`:''}`);s.replaceChildren(dot,text);s.dataset.state=failed?'error':incomplete?'incomplete':running?'running':value>=100?'complete':'idle';s.style.removeProperty('color');document.querySelector('.ai')?.classList.toggle('analysis-running',running);syncUnderstandingState(failed?'error':incomplete?'incomplete':running?'running':value>=100?'complete':'idle',safeDetail||safeLabel)}
runAnalysis=async function(options={}){const automatic=options?.automatic===true;clearTimeout(analysisTimer);const contactId=activeId;if(!activeContactById(contactId)){hint('已归档客户不参与AI分析，请先恢复客户','warning');return}const internetOffline=!navigator.onLine;if(internetOffline)showSystemStatus('warning','互联网不可用，正在尝试本地AI；本地历史数据仍可使用','',null,2200);const messageIds=(histories[contactId]||[]).map(x=>x.id||x.externalMessageId).filter(Boolean);const fingerprint=aiTaskRuntime.stableFingerprint?.({contactId,messageIds})||`${contactId}:${messageIds.at(-1)||messageIds.length}`;const key=`understanding:${contactId}`;showSystemStatus('success','AI分析防冲刷锁已启用；将直接读取SQLite历史消息并写回客户档案与关系洞察','',null,1800);try{const result=await (aiTaskCoordinator?aiTaskCoordinator.run(key,{fingerprint,onReuse:()=>setAnalysisProgress(8,'分析本轮连续消息','等待当前任务完成'),onProgress:step=>setAnalysisProgress(step.percent,step.label,step.detail),work:async({signal,progress,isCurrent})=>{progress(8,'读取真实历史消息','查询SQLite messages表');progress(24,'建立联系人关联','解析contacts与会话映射');const payload=await apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(contactId)}/analyze`,{method:'POST',signal,body:JSON.stringify({maxMessages:240,dedupeKey:key,fingerprint,timeoutMs:240000}),timeoutMs:300000});progress(82,'写入结构化结果','更新customer_profiles与relationship_insights');if(!isCurrent())throw new aiTaskRuntime.TaskSupersededError();const receiptState=analysisReceiptState(payload,payload.analysis||{});if(!receiptState.committed){const error=new Error('分析结果没有形成已提交的执行回执');error.code='AI_ANALYSIS_TRANSACTION_UNCONFIRMED';throw error}applyCrossModuleContext(contactId,payload);progress(96,'联动刷新','刷新客户档案与关系洞察');if(activeId===contactId)await loadCrossModuleContext(contactId,{render:true});progress(100,receiptState.complete?'真实分析已完成':'分析已写入但结果不完整',receiptState.complete?'':`缺少${receiptState.missing.join('、')||'完整分析字段'}`);return {...payload,contactId}}}):apiJson(`/api/r32/workspace/conversations/${encodeURIComponent(contactId)}/analyze`,{method:'POST',body:JSON.stringify({maxMessages:240,dedupeKey:key,fingerprint,timeoutMs:240000}),timeoutMs:300000}));if(result?.contactId&&activeId===result.contactId){applyCrossModuleContext(contactId,result);const receiptState=analysisReceiptState(result,result.analysis||{});if(!receiptState.committed){const error=new Error('分析结果没有形成已提交的执行回执');error.code='AI_ANALYSIS_TRANSACTION_UNCONFIRMED';throw error}if(receiptState.complete){setAnalysisProgress(100,'真实分析已完成');if(!automatic)hint('客户档案与关系洞察已同步更新','success')}else{const detail=`缺少${receiptState.missing.join('、')||'完整分析字段'}；未进入导演与候选阶段`;setAnalysisProgress(100,'分析已写入但结果不完整',detail);if(!automatic)hint(detail,'warning')}}clearSystemStatus();return result}catch(error){if(error?.code==='AI_TASK_SUPERSEDED'||error?.name==='AbortError')return null;const message=safeUiText(error,'真实AI分析失败');setAnalysisProgress(0,'分析失败',message);showSystemStatus('error',message,'重试',runAnalysis);if(automatic)console.warn('[Yance auto reply analysis]',message);return null}};
const aiAutoPipelineState=new Map();let aiAutoPipelineTimer=0;
function scheduleAutomaticReplyPipeline(contactId,reason='messages-rendered'){
 const targetId=String(contactId||'').trim();if(!targetId||targetId!==String(activeId)||!activeContactById(targetId))return;
 const latest=latestConversationContentMessage(targetId),latestId=latestConversationMessageId(targetId);if(!latest||!latestId||latest.side==='me')return;
 const fingerprint=`${targetId}:${latestId}`,prior=aiAutoPipelineState.get(targetId);if(prior?.fingerprint===fingerprint&&['scheduled','running','completed'].includes(prior.state))return;
 clearTimeout(aiAutoPipelineTimer);aiAutoPipelineState.set(targetId,{fingerprint,state:'scheduled',reason,scheduledAt:Date.now()});setAnalysisProgress(8,'检测到新消息','等待连续消息稳定后自动生成候选');
 aiAutoPipelineTimer=setTimeout(async()=>{
  if(targetId!==String(activeId)||latestConversationMessageId(targetId)!==latestId)return;
  const generationToken=replyGenerationAuthority?.begin?.(targetId,fingerprint)||null;
  aiAutoPipelineState.set(targetId,{fingerprint,state:'running',reason,startedAt:Date.now(),generationRevision:generationToken?.revision||0});
  try{
   const payload=await runAnalysis({automatic:true,reason});
   replyGenerationAuthority?.assertCurrent?.(generationToken,{contactId:targetId,fingerprint});
   if(!payload||targetId!==String(activeId)||latestConversationMessageId(targetId)!==latestId||!currentAnalysisReady())throw new Error('最新消息分析尚未形成完整且当前的执行回执');
   setCandidateProcessState('running','理解已完成，正在自动生成 3–5 条高质量候选');
   const rows=await generateAiCandidates(null,null,{automatic:true,reason,contactId:targetId,fingerprint,generationToken});
   replyGenerationAuthority?.assertCurrent?.(generationToken,{contactId:targetId,fingerprint});
   aiAutoPipelineState.set(targetId,{fingerprint,state:'completed',candidateCount:Array.isArray(rows)?rows.length:0,completedAt:Date.now(),generationRevision:generationToken?.revision||0});
   setCandidateProcessState('success',`已根据最新消息生成 ${Array.isArray(rows)?rows.length:0} 条候选，等待你选择`);
  }catch(error){const superseded=/AI_REPLY_GENERATION_SUPERSEDED/.test(String(error?.code||''))||error?.name==='ReplyGenerationSupersededError'||error?.code==='AI_TASK_SUPERSEDED'||error?.name==='AbortError';aiAutoPipelineState.set(targetId,{fingerprint,state:superseded?'superseded':'failed',error:String(error?.message||error),completedAt:Date.now()});if(superseded){setCandidateProcessState('stale','旧回复任务已被更新的连续消息取代，等待新链路完成');return}setCandidateProcessState('error',String(error?.message||'自动回复链路未完成'),{label:'重试完整链路',run:()=>scheduleAutomaticReplyPipeline(targetId,'manual-retry')})}
 },900)
}
window.addEventListener('yance:r32-messages-rendered',event=>{const contactId=String(event?.detail?.activeId||event?.detail?.conversationId||activeId||'');if(!contactId)return;const latestId=latestConversationMessageId(contactId),fingerprint=latestId?`${contactId}:${latestId}`:'',prior=aiAutoPipelineState.get(contactId),key=`understanding:${contactId}`;if(prior?.fingerprint&&fingerprint&&prior.fingerprint!==fingerprint&&aiTaskCoordinator?.status().some(task=>task.key===key))aiTaskCoordinator.cancel(key,new aiTaskRuntime.TaskSupersededError('检测到更新的连续消息，旧分析已取消'));clearTimeout(analysisTimer);scheduleAutomaticReplyPipeline(contactId,'messages-rendered')});
function snapshotContact(c){return cloneData({age:c.age,birthday:c.birthday,address:c.address,city:c.city,country:c.country,job:c.job,languages:c.languages,family:c.family,stage:c.stage,interests:c.interests,note:c.note,customAvatar:c.customAvatar||''})}
const baseOpenNote=openNote;
openNote=function(){editingContactId=activeId;baseOpenNote();$('noteDialog').dataset.contactId=editingContactId;$('undoProfileChange').classList.toggle('hidden',!r32RuntimeState.profileChanges.some(x=>x.contactId===editingContactId))};
const baseSaveNote=saveNote;
saveNote=async function(){const id=$('noteDialog').dataset.contactId||editingContactId;if(!id||!contacts.some(c=>c.id===id)){hint('当前联系人已变化，未保存任何资料','error');return}const c=contacts.find(x=>x.id===id);const fields={age:$('fAge').value.trim(),birthday:$('fBirthday').value.trim(),address:$('fAddress').value.trim(),city:$('fCity').value.trim(),country:$('fCountry').value.trim(),job:$('fJob').value.trim(),languages:$('fLanguages').value.trim(),family:$('fFamily').value.trim(),stage:$('fStage').value.trim(),interests:$('fInterests').value.trim(),note:$('fNote').value.trim()};if(fields.note.length>5000){hint('长期备注过长，请控制在5000字以内','warning');return}const before=snapshotContact(c),after={...fields,customAvatar:pendingAvatar||c.customAvatar||''};if(JSON.stringify(before)===JSON.stringify(after)){hint('没有检测到资料变化','warning');return}try{await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/profile`,{method:'PUT',body:JSON.stringify({facts:fields,note:fields.note,profile:{...(profileState[id]||defaultProfile()),stage:fields.stage}})});r32RuntimeState.profileChanges.unshift({contactId:id,time:Date.now(),before,after});r32RuntimeState.profileChanges=r32RuntimeState.profileChanges.slice(0,20);Object.assign(c,fields);if(pendingAvatar)c.customAvatar=pendingAvatar;await loadCrossModuleContext(id,{render:false});logAction(id,'客户备注已更新','资料已写入customer_profiles并联动刷新');renderContacts();renderHeader();renderNotes();if(app.classList.contains('contact-page-open'))renderIdentityPage();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();persistState();$('noteDialog').close();hint('客户备注已保存到SQLite')}catch(error){hint(error.message||'客户备注保存失败','error')}};
function undoProfileChange(){const id=$('noteDialog').dataset.contactId||editingContactId;const idx=r32RuntimeState.profileChanges.findIndex(x=>x.contactId===id);if(idx<0){hint('没有可撤销的资料修改','warning');return}const item=r32RuntimeState.profileChanges.splice(idx,1)[0],c=contacts.find(x=>x.id===id);if(!c)return;Object.assign(c,item.before);if(!item.before.customAvatar)delete c.customAvatar;logAction(id,'已撤销资料修改','姓名归属未改变，资料与头像恢复到上一个版本');renderContacts();renderHeader();renderNotes();if(app.classList.contains('contact-page-open'))renderIdentityPage();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();persistState();$('undoProfileChange').classList.toggle('hidden',!r32RuntimeState.profileChanges.some(x=>x.contactId===id));hint('已撤销上次资料修改')}
const baseHandleInference=handleInferenceAction;
handleInferenceAction=async function(contactId,inferenceId,action){const p=profileState[contactId],x=p?.inferences?.find(i=>i.id===inferenceId);if(!x)return;const wording=action==='confirm'?'确认后，该推断会进入事实层并参与AI回复检查。':'删除后，该推断不会进入事实层。';if(!await window.YanceDialogs.confirm({title:action==='confirm'?'确认推断':'删除推断',message:wording+'\n\n'+x.text,danger:action!=='confirm',submitLabel:action==='confirm'?'确认':'删除'}))return;baseHandleInference(contactId,inferenceId,action)};
const baseMergeContacts=mergeContacts;
mergeContacts=function(sourceId,targetId){const snapshot={contacts:cloneData(contacts),accounts:cloneData(runtimeAccounts),identityState:cloneData(identityState),profileState:cloneData(profileState),trajectoryState:cloneData(trajectoryState),histories:cloneData(histories),drafts:cloneData(drafts),activeId,selectedIdentity,selectedProfile,selectedTimeline};try{if(sourceId===targetId)throw new Error('不能把联系人合并到自己');const source=contacts.find(x=>x.id===sourceId),target=contacts.find(x=>x.id===targetId);if(!source||!target)throw new Error('合并对象不存在');baseMergeContacts(sourceId,targetId);const issues=validateSharedData();if(issues.some(x=>x.includes('重复')))throw new Error('合并后数据校验未通过');hint('重复身份已完成事务合并，可随时撤销','success',{actionLabel:'撤销',action:undoLastMerge,duration:5000})}catch(e){contacts.splice(0,contacts.length,...snapshot.contacts);Object.keys(identityState).forEach(k=>delete identityState[k]);Object.assign(identityState,snapshot.identityState);Object.keys(profileState).forEach(k=>delete profileState[k]);Object.assign(profileState,snapshot.profileState);Object.keys(trajectoryState).forEach(k=>delete trajectoryState[k]);Object.assign(trajectoryState,snapshot.trajectoryState);Object.keys(histories).forEach(k=>delete histories[k]);Object.assign(histories,snapshot.histories);drafts=snapshot.drafts;activeId=snapshot.activeId;selectedIdentity=snapshot.selectedIdentity;selectedProfile=snapshot.selectedProfile;selectedTimeline=snapshot.selectedTimeline;renderContacts();renderHeader();renderMessages();renderNotes();renderIdentityPage();persistState();hint('合并已中止，所有资料已自动回滚','error',{actionLabel:'重试',action:()=>openMergeDialog(sourceId),duration:5000})}};
function rememberScroll(key,el){if(!el)return;el.addEventListener('scroll',()=>{r32RuntimeState.scrolls[key]=el.scrollTop;r32RuntimeWrite()},{passive:true})}
function restoreScroll(key,el){if(el&&r32RuntimeState.scrolls[key]!=null)requestAnimationFrame(()=>el.scrollTop=r32RuntimeState.scrolls[key])}
const baseOpenContactsPage=openContactsPage,baseOpenProfilesPage=openProfilesPage,baseOpenTimelinePage=openTimelinePage,baseOpenConversationPage=openConversationPage;
openContactsPage=function(id=activeId){baseOpenContactsPage(id);restoreScroll('identity:list',$('identityList'));restoreScroll('identity:detail',document.querySelector('.detail26-scroll'))};
openProfilesPage=function(id=activeId){baseOpenProfilesPage(id);restoreScroll('profile:list',$('profileList'));restoreScroll('profile:detail',document.querySelector('.profile27-scroll'))};
openTimelinePage=function(id=activeId){baseOpenTimelinePage(id);restoreScroll('timeline:list',$('timelineList'));restoreScroll('timeline:detail',document.querySelector('.timeline27-scroll'))};
openConversationPage=function(id=selectedIdentity||activeId){const target=contacts.find(c=>c.id===id);if(target?.archived){filter='archived';document.querySelectorAll('#filters button').forEach(x=>x.classList.toggle('active',x.dataset.filter==='archived'))}else if(target){filter='all';document.querySelectorAll('#filters button').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'))}baseOpenConversationPage(id);openPanel(r32RuntimeState.aiPanel||'understanding')};
async function refreshTimelineFromRealData(){
 const id=selectedTimeline||activeId;if(!activeContactById(id))throw new Error('已归档客户不参与关系轨迹计算，请先恢复客户');
 const payload=await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/insights`);
 const next=cleanTrajectoryObject({...defaultTrajectory(),...(payload.trajectory||{}),updated:'刚刚'});
 trajectoryState[id]=next;
 await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/trajectory`,{method:'PUT',body:JSON.stringify(next)});
 logAction(id,'关系轨迹已重新计算',`基于 ${Number(payload.messageCount||0)} 条真实消息和客户档案重新生成`);
 renderTimelinePage();renderUtilityTimeline();persistState();
 return payload;
}
function summarizeAccountSyncResult(payload={}){
  const totals={contactsScanned:0,avatarsRequested:0,avatarsDownloaded:0,avatarsUnchanged:0,avatarsUnavailable:0,avatarsFailed:0,cacheRepaired:0};
  const rows=Array.isArray(payload.results)?payload.results:[];
  for(const row of rows){
    const stats=row&&row.result&&typeof row.result==='object'?row.result:{};
    for(const key of Object.keys(totals))totals[key]+=Math.max(0,Number(stats[key]||0));
  }
  return {okAccounts:rows.filter(row=>row&&row.ok).length,...totals};
}
function formatAccountSyncSummary(payload={}){
  const stats=summarizeAccountSyncResult(payload);
  return `已同步 ${stats.okAccounts} 个账号：扫描 ${stats.contactsScanned}，请求 ${stats.avatarsRequested}，下载 ${stats.avatarsDownloaded}，未变 ${stats.avatarsUnchanged}，不可用 ${stats.avatarsUnavailable}，失败 ${stats.avatarsFailed}，修复缓存 ${stats.cacheRepaired}`;
}
function installR32Handlers(){
  $('saveNote').onclick=saveNote;$('undoProfileChange').onclick=undoProfileChange;$('editNoteBtn').onclick=openNote;$('uploadAvatarBtn').onclick=openNote;
  $('restoreAvatar').onclick=async()=>{if(!await window.YanceDialogs.confirm({title:'恢复平台头像',message:'自定义头像会被移除，但可通过资料修改历史撤销。',submitLabel:'恢复'}))return;const c=contacts.find(x=>x.id===($('noteDialog').dataset.contactId||activeId));if(!c)return;pendingAvatar='';delete c.customAvatar;$('editAvatar').innerHTML=`<img src="${urlAttr(avatar(c),{allowDataImage:true,allowBlob:true})}" alt="${htmlAttr(c.name)}头像">`;hint('已恢复平台/默认头像，保存后生效')};
  $('avatarInput').onchange=e=>{const f=e.target.files?.[0];if(!f)return;if(!/^image\/(png|jpeg|webp)$/.test(f.type)){hint('仅支持 JPG、PNG 或 WebP 头像','error');return}if(f.size>5*1024*1024){hint('头像文件不能超过5MB','warning');return}const r=new FileReader();r.onerror=()=>hint('头像读取失败，请重新选择','error');r.onload=()=>{pendingAvatar=String(r.result||'');$('editAvatar').innerHTML=`<img src="${urlAttr(pendingAvatar,{allowDataImage:true,allowBlob:true})}" alt="头像预览">`};r.readAsDataURL(f)};
  ['contactSearch','identitySearch','profileSearch','timelineSearch'].forEach(id=>{const key=id.replace('Search','').replace('contact','contact').replace('identity','identity').replace('profile','profile').replace('timeline','timeline');$(id).addEventListener('input',()=>{r32RuntimeState.searches[key]=$(id).value;r32RuntimeWrite()})});
  rememberScroll('identity:list',$('identityList'));rememberScroll('identity:detail',document.querySelector('.detail26-scroll'));rememberScroll('profile:list',$('profileList'));rememberScroll('profile:detail',document.querySelector('.profile27-scroll'));rememberScroll('timeline:list',$('timelineList'));rememberScroll('timeline:detail',document.querySelector('.timeline27-scroll'));
  document.querySelector('.ai-views')?.addEventListener('scroll',e=>{const sc=e.target.closest?.('.ai-scroll');if(!sc)return;const panel=sc.closest('.ai-view')?.dataset.panel;if(panel){r32RuntimeState.scrolls['ai:'+panel]=sc.scrollTop;r32RuntimeWrite()}},true);
  const persistLayoutState=()=>{r32RuntimeState.contactMode=conversationLayoutState.contactMode;r32RuntimeState.navMode=conversationLayoutState.navMode;r32RuntimeState.aiHidden=!conversationLayoutState.aiVisible;r32RuntimeWrite()};
  ['contactPanelMode','restoreContacts','navModeToggle','restoreNav','toggleAi','closeAi','navSearch'].forEach(id=>$(id)?.addEventListener('click',()=>requestAnimationFrame(persistLayoutState)));
  $('syncContacts').onclick=()=>runBusy($('syncContacts'),'正在同步…',async()=>{if(!navigator.onLine)throw new Error('平台离线，无法刷新联系人');const result=await apiJson('/api/r32/accounts/actions/sync-all',{method:'POST',body:'{}'});await bootstrapR32(true);return result},formatAccountSyncSummary);
  $('syncProfiles').onclick=()=>runBusy($('syncProfiles'),'正在校验…',async()=>{const id=selectedProfile;if(!id)throw new Error('请先选择客户档案');await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/profile`,{method:'PUT',body:JSON.stringify({profile:profileState[id]||{},updatedAt:new Date().toISOString()})});await bootstrapR32(true);logAction(id,'客户档案已同步','客户档案与真实聊天事实已重新校验')},'客户档案已写入SQLite并重新校验');
  $('refreshTimeline').onclick=()=>runBusy($('refreshTimeline'),'正在计算…',refreshTimelineFromRealData,'关系轨迹与证据链已根据真实数据重新计算');
  $('runDiagnostics').onclick=()=>runDiagnostics();$('closeDiagnostic').onclick=()=>$('diagnosticDialog').close();$('finishDiagnostic').onclick=()=>$('diagnosticDialog').close();$('rerunDiagnostic').onclick=()=>runDiagnostics(true);$('exportDiagnostic').onclick=()=>exportCurrentDiagnostics();
  window.YanceSystemStatus?.install?.();
  window.addEventListener('online',()=>showSystemStatus('success','连接已恢复，联系人和AI服务可以继续同步','',null,2200));window.addEventListener('offline',()=>showSystemStatus('warning','当前处于离线状态，浏览和编辑可继续，联网操作已暂停','重试',()=>navigator.onLine?clearSystemStatus():showSystemStatus('warning','仍未连接网络')));
  window.addEventListener('error',e=>{r32RuntimeState.moduleErrors.push({time:Date.now(),module:'运行时',detail:e.message});r32RuntimeState.moduleErrors=r32RuntimeState.moduleErrors.slice(-20);r32RuntimeWrite();showSystemStatus('error','检测到运行异常，已隔离并保留当前页面','诊断',()=>runDiagnostics())});
  window.addEventListener('unhandledrejection',e=>{const detail=userFacingRuntimeError(e.reason,'异步任务失败');r32RuntimeState.moduleErrors.push({time:Date.now(),module:'异步任务',detail,reasonCode:runtimeErrorCode(e.reason)});r32RuntimeState.moduleErrors=r32RuntimeState.moduleErrors.slice(-20);r32RuntimeWrite();showSystemStatus('error',detail,'诊断',()=>runDiagnostics())});
  const io=new IntersectionObserver(entries=>entries.forEach(x=>x.target.classList.toggle('paused-motion',!x.isIntersecting)),{threshold:.01});['contactsWorkspace','profilesWorkspace','timelineWorkspace'].forEach(id=>io.observe($(id)));
}
async function regressionChecks(){const tests=[];const add=(name,pass,detail,warn=false)=>tests.push({name,pass,detail,status:pass?'pass':warn?'warn':'fail'});const ids=contacts.map(c=>c.id);add('统一联系人数据源',new Set(ids).size===ids.length&&ids.every(id=>identityState[id]&&profileState[id]&&trajectoryState[id]),'联系人、身份、档案和轨迹使用同一ID链');add('页面双向联动',typeof openConversationPage==='function'&&typeof openContactsPage==='function'&&typeof openProfilesPage==='function'&&typeof openTimelinePage==='function','四个工作页面共用当前联系人');add('资料安全与撤销',Array.isArray(r32RuntimeState.profileChanges)&&typeof undoLastMerge==='function','客户资料和身份合并均具备撤销链');add('异常隔离',typeof safeModule==='function'&&!!$('systemStatus'),'单个模块失败不会导致整页空白');add('状态保持',!!(r32RuntimeState.aiPanel&&r32RuntimeState.searches&&r32RuntimeState.scrolls),'AI阶段、搜索、草稿、滚动与筛选可恢复');add('性能保护',typeof IntersectionObserver!=='undefined'&&typeof renderMessages==='function','离屏动画暂停，大历史消息启用分段加载');add('统一反馈',!!$('globalNotificationRegion')&&!!$('systemStatus'),'成功、处理中、离线、失败和重试反馈统一');const layoutResults=await window.YanceLayoutDiagnostics?.probeWorkspaceLayouts?.({app,document,window});if(Array.isArray(layoutResults)&&layoutResults.length){const failed=layoutResults.filter(row=>!row.pass);add('路由自适应布局',failed.length===0,failed.length?failed.map(row=>`${row.label}：${row.failures.join('、')}`).join('；'):`已实测 ${layoutResults.length} 个工作区，当前 ${innerWidth}×${innerHeight} 无窄列、逐字竖排或横向溢出`)}else add('路由自适应布局',false,'布局诊断组件未加载');add('数据完整性',validateSharedData().length===0,'联系人、聊天、档案和轨迹关联校验完成');return tests}
function diagnosticSafeText(value='',limit=1200){return String(value||'').replace(/data:[^,;]+(?:;base64)?,[A-Za-z0-9+/=_-]+/giu,'[REDACTED_DATA]').replace(/Bearer\s+[^\s,;]+/giu,'Bearer [REDACTED]').replace(/(?:api[_ -]?key|token|secret|password|session)\s*[:=]\s*[^\s,;]+/giu,'$1=[REDACTED]').replace(/[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/gu,'[REDACTED_PATH]').replace(/\/(?:home|Users|mnt|tmp|var|private)\/[^\s,;]+/gu,'[REDACTED_PATH]').replace(/\+?\d[\d ()-]{7,}\d/gu,'[REDACTED_PHONE]').slice(0,Math.max(80,Number(limit)||1200))}
function diagnosticSnapshot(tests=[],error=null){const rows=Array.isArray(tests)?tests.map(row=>({name:diagnosticSafeText(row.name,160),status:['pass','warn','fail'].includes(row.status)?row.status:'fail',detail:diagnosticSafeText(row.detail,1200)})):[],summary={pass:rows.filter(row=>row.status==='pass').length,warn:rows.filter(row=>row.status==='warn').length,fail:rows.filter(row=>row.status==='fail').length};return {schemaVersion:1,generatedAt:new Date().toISOString(),privacyMode:true,status:error?'failed':summary.fail?'attention':'pass',summary,workspace:{view:currentView,renderer:rendererEnvironmentSnapshot()},tests:rows,...(error?{error:{reasonCode:diagnosticSafeText(runtimeErrorCode(error)||'WORKSPACE_DIAGNOSTICS_FAILED',120),message:diagnosticSafeText(userFacingRuntimeError(error,'系统诊断执行失败'),600)}}:{})}}
function browserDownloadDiagnostics(bundle){const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),link=document.createElement('a'),url=URL.createObjectURL(blob);setUrlAttribute(link,'href',url,{allowBlob:true,allowRelative:false});link.download=`Yance-Diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function exportCurrentDiagnostics(){const button=$('exportDiagnostic');try{setBusy?.(button,true,'导出中…');if(!lastDiagnosticSnapshot)await runDiagnostics(true);const payload=await apiJson('/api/r32/system/diagnostics/export'),bundle={...(payload.bundle||{}),workspaceDiagnostics:lastDiagnosticSnapshot||diagnosticSnapshot([],new Error('当前尚无工作区诊断结果'))};if(window.yanceDesktop?.exportDiagnostics){const raw=await window.yanceDesktop.exportDiagnostics(bundle),normalized=window.YanceDesktopResultContracts?.normalizeSaveDialogResult?window.YanceDesktopResultContracts.normalizeSaveDialogResult(raw):{ok:raw?.ok===true||raw?.saved===true||raw?.cancelled===true||raw?.canceled===true,saved:raw?.saved===true,cancelled:raw?.cancelled===true||raw?.canceled===true,path:String(raw?.path||raw?.filePath||'')};if(normalized.cancelled){hint('已取消保存诊断报告','warning');return normalized}if(!normalized.ok||!normalized.saved)throw new Error('诊断报告保存失败');hint(normalized.path?`脱敏诊断已保存：${normalized.path}`:'脱敏诊断已保存');return normalized}browserDownloadDiagnostics(bundle);hint('脱敏诊断已导出');return {ok:true,saved:true,browserDownload:true}}catch(error){const message=userFacingRuntimeError(error,'诊断报告导出失败');hint(message,'error',{duration:5000});showSystemStatus('error',message,'重试',()=>exportCurrentDiagnostics());return {ok:false,error:message}}finally{setBusy?.(button,false)}}
function runDiagnostics(rerun=false){const dlg=$('diagnosticDialog'),exportButton=$('exportDiagnostic');if(!dlg.open)dlg.showModal();if(exportButton)exportButton.disabled=true;$('diagnosticSummary').innerHTML='<article><b>…</b><span>正在检测</span></article><article><b>10</b><span>系统项目</span></article><article><b>R32</b><span>当前基线</span></article>';$('diagnosticList').innerHTML='<div class="diagnostic-row warn"><i>⟳</i><div><b>正在执行完整回归</b><p>逐页检查统一数据、状态保持、异常隔离、窄列、竖排和横向溢出。</p></div><em>请稍候</em></div>';return new Promise(resolve=>setTimeout(async()=>{try{const tests=await regressionChecks(),pass=tests.filter(x=>x.status==='pass').length,warn=tests.filter(x=>x.status==='warn').length,fail=tests.filter(x=>x.status==='fail').length;lastDiagnosticSnapshot=diagnosticSnapshot(tests);$('diagnosticSummary').innerHTML=`<article><b>${htmlText(pass)}</b><span>通过</span></article><article><b>${htmlText(warn)}</b><span>需关注</span></article><article><b>${htmlText(fail)}</b><span>失败</span></article>`;$('diagnosticList').innerHTML=tests.map(x=>`<div class="diagnostic-row ${htmlAttr(x.status)}"><i>${htmlText(x.status==='pass'?'✓':x.status==='warn'?'!':'×')}</i><div><b>${htmlText(x.name)}</b><p>${htmlText(x.detail)}</p></div><em>${htmlText(x.status==='pass'?'通过':x.status==='warn'?'关注':'失败')}</em></div>`).join('');if(!fail)showSystemStatus('success','系统诊断完成：核心链路与全部工作区布局正常','',null,2200);else showSystemStatus('error','系统诊断发现失败项','查看',()=>dlg.showModal());resolve(lastDiagnosticSnapshot)}catch(error){const message=userFacingRuntimeError(error,'系统诊断执行失败');lastDiagnosticSnapshot=diagnosticSnapshot([],error);$('diagnosticList').innerHTML=`<div class="diagnostic-row fail"><i>×</i><div><b>系统诊断执行失败</b><p>${htmlText(message)}</p></div><em>失败</em></div>`;showSystemStatus('error',message,'重试',()=>runDiagnostics(true));resolve(lastDiagnosticSnapshot)}finally{if(exportButton)exportButton.disabled=false}},260))}

if($('chatAccountSelect'))$('chatAccountSelect').onchange=e=>switchConversationAccount(e.target.value);
function focusGlobalConversationSearch(){conversationLayoutState.contactMode='normal';persistConversationLayout();applyConversationLayout();const input=$('contactSearch');input?.focus();input?.select()}
$('titleGlobalSearch').onclick=focusGlobalConversationSearch;document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='k'){event.preventDefault();focusGlobalConversationSearch()}});
function setTranslationMode(mode){if(!['both','original','translation'].includes(mode))return;conversationLayoutState.translationMode=mode;persistConversationLayout();applyConversationLayout();renderContacts();hint({both:'已显示原文与中文翻译',original:'已切换为仅显示原文',translation:'已切换为仅显示中文翻译'}[mode])}
function registerNavEntry(button,{group='system',order=100}={}){if(!(button instanceof HTMLElement))return null;const host=group==='quick'?document.querySelector('.nav-bottom'):($('navSystemEntries')||$('navMenu'));if(!host)return null;button.dataset.navOrder=String(Number(order)||100);host.appendChild(button);const entries=[...host.children].filter(node=>node.matches?.('button[data-nav-order]')).sort((a,b)=>(Number(a.dataset.navOrder)||100)-(Number(b.dataset.navOrder)||100));const reference=group==='quick'?$('displaySettingsBtn'):null;entries.forEach(node=>{if(reference&&reference.parentElement===host)host.insertBefore(node,reference);else host.appendChild(node)});return button}
window.YanceConversationCenterV2={setTranslationMode,getTranslationMode:()=>conversationLayoutState.translationMode,applyLayout:applyConversationLayout,registerNavEntry};
function resizeComposer(){const input=$('composerText');if(!input)return;input.style.height='52px';input.style.height=Math.min(132,Math.max(52,input.scrollHeight))+'px'}
$('composerText')?.addEventListener('input',resizeComposer);requestAnimationFrame(()=>{applyConversationLayout();resizeComposer()});$('navContacts').onclick=()=>openContactsPage(activeId);$('navProfiles').onclick=()=>openProfilesPage(activeId);$('navTimeline').onclick=()=>openTimelinePage(activeId);$('navConversation').onclick=()=>openConversationPage(activeId);$('chatIdentityLink').onclick=()=>openContactsPage(activeId);$('identitySearch').oninput=renderIdentityList;$('profileSearch').oninput=renderProfileList;$('timelineSearch').oninput=renderTimelineList;document.querySelectorAll('#timelineQuickFilters button').forEach(b=>b.onclick=()=>setTimelineFilter(b.dataset.timelineFilter));$('refreshTimeline').onclick=()=>runBusy($('refreshTimeline'),'正在计算…',refreshTimelineFromRealData,'关系轨迹与证据链已根据真实数据重新计算');$('markTimelineEvent').onclick=async()=>{const id=selectedTimeline||activeId;if(!activeContactById(id)){hint('已归档客户为只读状态，请先恢复客户','warning');return}const ev=['刚刚','用户标记关键节点','该节点已写入关系轨迹，并同步到客户档案。','fact','用户手动标记'];const t=cleanTrajectoryObject(trajectoryState[id]||defaultTrajectory());t.events.unshift(ev);t.updated='刚刚';trajectoryState[id]=t;renderTimelinePage();persistState();try{await apiJson('/api/r32/workspace/contacts/'+encodeURIComponent(id)+'/key-nodes',{method:'POST',body:JSON.stringify({eventId:'k'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),nodeKind:'fact',markedBy:'user'})});logAction(id,'关键关系节点已标记','手动节点已进入关系轨迹并持久化到 R32');hint('关键节点已标记并保存');}catch(error){const cur=cleanTrajectoryObject(trajectoryState[id]||defaultTrajectory());cur.events=cur.events.filter(e=>e!==ev);trajectoryState[id]=cur;renderTimelinePage();persistState();hint(error.message||'关键节点保存失败','error');}};$('openTimelineConversation').onclick=()=>openConversationPage(selectedTimeline);document.querySelectorAll('#profileFilters button').forEach(b=>b.onclick=()=>setProfileFilter(b.dataset.profileFilter));$('syncProfiles').onclick=async()=>{const btn=$('syncProfiles');try{setBusy?.(btn,true,'同步中…');const id=selectedProfile;if(!id)throw new Error('请先选择客户档案');await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/profile`,{method:'PUT',body:JSON.stringify({profile:profileState[id]||{},updatedAt:new Date().toISOString()})});await bootstrapR32(true);hint('客户档案已写入SQLite并重新校验')}catch(error){hint(error.message||'档案同步失败','error')}finally{setBusy?.(btn,false)}};$('reviewInferences').onclick=()=>setProfileFilter('pending');$('openProfileConversation').onclick=()=>openConversationPage(selectedProfile);document.querySelectorAll('#identityFilters button').forEach(b=>b.onclick=()=>setIdentityFilter(b.dataset.identityFilter));$('syncContacts').onclick=async()=>{const btn=$('syncContacts');try{setBusy?.(btn,true,'正在同步…');if(!navigator.onLine)throw new Error('平台离线，无法刷新联系人');const result=await apiJson('/api/r32/accounts/actions/sync-all',{method:'POST',body:'{}'});await bootstrapR32(true);hint(formatAccountSyncSummary(result))}catch(error){hint(error.message||'联系人同步失败','error')}finally{setBusy?.(btn,false)}};$('recoverContacts').onclick=async()=>{try{await bootstrapR32(true);hint('旧联系人与历史会话已重新扫描')}catch(error){hint(error.message||'恢复扫描失败','error')}};$('closeMerge').onclick=()=>$('mergeDialog').close();$('cancelMerge').onclick=()=>$('mergeDialog').close();$('confirmMerge').onclick=async()=>{const absorbedId=$('mergeDialog').dataset.source;const survivorId=$('mergeTarget').value;if(!survivorId||absorbedId===survivorId){hint('请先选择要保留的客户','warning');return}try{const res=await apiJson('/api/r32/workspace/contacts/'+encodeURIComponent(survivorId)+'/merge',{method:'POST',body:JSON.stringify({mergedId:absorbedId,by:'user'})});mergeContacts(absorbedId,survivorId);if(res&&res.journalId)lastMerge.backendJournalId=res.journalId;hint('重复身份已合并并保存')}catch(error){hint(error.message||'合并保存失败','error')}};$('undoMerge').onclick=undoLastMerge;$('composerText').addEventListener('paste',event=>{const pasted=String(event.clipboardData?.getData('text')||'').trim();if(pasted.length>=8){const composer=$('composerText');composer.dataset.replySource=composer.dataset.aiCandidateId?'chatgpt_web_edited':'external_paste';composer.dataset.externalPasteAt=String(Date.now());document.querySelector('.composer')?.setAttribute('data-reply-source','external_paste');setTimeout(()=>hint('检测到外部粘贴内容；选择“发送并学习”后，只会学习你最终实际发送的文字'),0)}});$('composerText').addEventListener('input',()=>{const composer=$('composerText'),recentPaste=Date.now()-Number(composer.dataset.externalPasteAt||0)<1200;drafts[composerOwnerId]=composer.value;syncComposerState();if(!recentPaste&&!composer.dataset.aiCandidateId&&!composer.dataset.aiOutboxId)composer.dataset.replySource='manual';if(!composer.value.trim()){delete composer.dataset.aiCandidateId;delete composer.dataset.aiContextVersion;delete composer.dataset.aiConversationRevision;delete composer.dataset.aiOutboxId;delete composer.dataset.aiApprovedText;delete composer.dataset.externalPasteAt;delete composer.dataset.contextStale;composer.dataset.replySource='manual';document.querySelector('.composer')?.removeAttribute('data-reply-source')}persistState()});const contactList=$('contactList');contactList?.addEventListener('scroll',()=>{if(conversationPagingState.loading||conversationPagingState.hasMore===false)return;if(contactList.scrollHeight-contactList.scrollTop-contactList.clientHeight<=240)loadMoreConversationSummaries().catch(error=>console.warn('[R32 contact pagination]',error.message||error))},{passive:true});const messageHost=$('messages');['wheel','touchstart','pointerdown'].forEach(type=>messageHost.addEventListener(type,()=>markMessageScrollUserIntent(type==='wheel'?1800:1200),{passive:true}));messageHost.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))markMessageScrollUserIntent(1800)});messageHost.addEventListener('scroll',()=>{const host=$('messages');if(messageScrollRestoreActive(host)||!messageScrollHasUserIntent())return;const state=saveMessageScrollState(composerOwnerId,host,{persist:false});const nearBottom=state?.mode==='bottom';if(nearBottom)hideNewMessageIndicator();if(messageInteraction.shouldLoadOlder?.({scrollTop:host.scrollTop,threshold:140,restoring:messageScrollRestoreActive(host)})??(host.scrollTop<140))loadOlderMessages(activeId).catch(error=>console.warn('[R32 history stream]',error.message||error));clearTimeout(window.__yanceScrollPersistTimer);window.__yanceScrollPersistTimer=setTimeout(persistState,250)},{passive:true});$('messages').addEventListener('load',event=>{if(event.target?.matches?.('img,video'))restoreMessagePositionAfterMediaLayout($('messages'))},true);$('messages').addEventListener('loadedmetadata',event=>{if(event.target?.matches?.('audio,video'))restoreMessagePositionAfterMediaLayout($('messages'))},true);installR32Handlers();restoreState();if(!auditLog.length)logAction(activeId,'统一数据源已启用','会话中心与联系人身份页面已连接到同一联系人、头像、未读、备注和聊天状态');contacts.forEach(c=>syncConversationTags(c.id));composerOwnerId=activeId;$('composerText').value=drafts[activeId]||'';requestAnimationFrame(()=>{const requestedView=window.YanceWorkspaceRouteAuthority?.normalizeView?.(currentView,'conversation')||currentView;if(requestedView==='conversation')openConversationPage(activeId);else if(requestedView==='contacts')openContactsPage(activeId);else if(requestedView==='profiles')openProfilesPage(activeId);else if(requestedView==='timeline')openTimelinePage(activeId);else{openConversationPage(activeId);currentView=requestedView;window.__YancePendingWorkspaceView=requestedView;persistState();window.dispatchEvent(new CustomEvent('yance:workspace-route-restore-requested',{detail:{view:requestedView,source:'startup'}}))}openPanel(r32RuntimeState.aiPanel||'understanding');lazyEnhance(document);if(!navigator.onLine)showSystemStatus('warning','当前处于离线状态，浏览和编辑可继续','重试',()=>location.reload())});




async function apiJson(url,options={}){const externalSignal=options.signal,controller=new AbortController(),timeoutMs=Math.max(500,Number(options.timeoutMs||45000));let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs),abortExternal=()=>controller.abort();if(externalSignal){if(externalSignal.aborted)abortExternal();else externalSignal.addEventListener('abort',abortExternal,{once:true})}try{const requestOptions={...options,signal:controller.signal};delete requestOptions.timeoutMs;const response=await fetch(url,{headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})},...requestOptions});let payload;try{payload=await response.json()}catch(cause){const invalid=new Error('服务返回了无法解析的响应');invalid.code='R32_INVALID_RESPONSE';invalid.status=response.status;invalid.cause=cause;throw invalid}if(!payload||typeof payload!=='object'){const invalid=new Error('服务返回了无效响应');invalid.code='R32_INVALID_RESPONSE';invalid.status=response.status;throw invalid}if(!response.ok||payload.ok===false){if(runtimeErrors.createError)throw runtimeErrors.createError(payload,{status:response.status,rootObject:window,fallback:`请求失败（HTTP ${response.status}）`});const error=new Error(typeof payload.error==='string'?payload.error:(payload.message||`请求失败（HTTP ${response.status}）`));error.code=payload.code||payload.error?.reasonCode;throw error}return payload}catch(error){if(timedOut){const timeoutError=runtimeErrors.createError?runtimeErrors.createError({reasonCode:'REQUEST_TIMEOUT',message:'请求超时，系统已停止等待'},{rootObject:window}):Object.assign(new Error('请求超时，系统已停止等待'),{code:'REQUEST_TIMEOUT'});throw timeoutError}if(!navigator.onLine&&error?.name==='TypeError')error.code=error.code||'INTERNET_OFFLINE';throw error}finally{clearTimeout(timer);externalSignal?.removeEventListener?.('abort',abortExternal)}}
function defaultIdentity(contact={}){const stableId=contact.platformIdentity||contact.externalId||contact.chatJid||contact.id||'',status=profileText(contact.identityStatus,stableId?'observed':'pending').toLowerCase(),observed=['observed','verified','confirmed'].includes(status);return {platform:contact.platform||'unknown',phone:contact.phone||'',stableId,source:'真实会话',confidence:Number(contact.identityConfidence??(status==='verified'||status==='confirmed'?100:observed?85:0)),pending:!observed,maintained:Boolean(contact.profileExists),bound:Boolean(contact.profileExists),identityStatus:status,identityConfirmed:status==='verified'||status==='confirmed',system:false,duplicate:false,ignored:false,note:''}}
function defaultProfile(){return {health:0,temperature:0,openness:0,risk:0,activity:0,next:'等待真实互动与人工确认后生成建议。',updated:'',confirmed:[],inferences:[],commitments:[],boundaries:[],milestones:[]}}
function defaultTrajectory(){return {stage:'待分析',momentum:'0',initiative:0,reply:'未计算',depth:0,opportunity:0,risk:0,updated:'',points:[],events:[],topics:[],evidence:[],summary:'',next:'等待真实互动与人工确认后生成建议。',opportunityText:'暂无可确认的推进信号。',riskText:'目前没有可确认的高风险信号。'}}
function animatedEmojiMotion(text,type,hasMedia){
 if(hasMedia||String(type||'').toLowerCase()!=='text')return'';
 const value=String(text||'').trim();
 const motions={'🔥':'fire','🎉':'celebrate','💯':'impact','🥳':'celebrate','✨':'celebrate','🚀':'impact','❤️':'impact','❤':'impact','😍':'pop','😂':'pop','👏':'celebrate'};
 return motions[value]||''
}
function runtimeMessage(row){
 const type=String(row.type||row.messageType||'text').toLowerCase(),fromMe=row.fromMe===true||/outgoing|outbound/.test(String(row.direction||''));
 const attachment=Array.isArray(row.attachments)?row.attachments[0]:null;
 const mediaKind=String(attachment?.kind||type).toLowerCase(),mimeType=String(attachment?.mimeType||attachment?.mimetype||row.mimeType||'').toLowerCase();
 const media=Boolean(attachment)||['image','video','gif','sticker','document','file','voice','audio'].includes(type);
 const text=row.revoked?'一条消息已被撤回':String(row.text||'');
 return {
  id:row.id||row.dedupeKey||'',externalMessageId:row.externalMessageId||row.id||'',queueId:row.queueId||'',side:fromMe?'me':'in',text,
  cn:String(row.translatedZh||row.translationZh||row.translationZH||row.chineseTranslation||row.translation||row.chinese||''),lastSuccessfulCn:String(row.lastSuccessfulTranslatedZh||''),translationStatus:String(row.translationStatus||''),translationModel:String(row.translationModel||''),translationError:String(row.translationError||''),sourceLanguage:String(row.sourceLanguage||row.language||''),time:formatRuntimeTime(row.timestamp||row.sentAt),statusLabel:fromMe?receiptLabel(row.status||row.deliveryStatus):'',
  media,voice:['voice','audio'].includes(type)||['voice','audio'].includes(mediaKind)||mimeType.startsWith('audio/'),mediaKind,mimeType,fileName:String(attachment?.filename||attachment?.name||''),mediaUrl:attachment?.mediaUrl||attachment?.url||row.mediaUrl||'',mediaPath:attachment?.localFile||row.mediaPath||'',platformExpressionId:String(attachment?.platformExpressionId||attachment?.stickerId||attachment?.sticker_id||''),mediaPresentation:String(attachment?.presentation||attachment?.mediaPresentation||''),thumbnailDataUrl:String(attachment?.thumbnailDataUrl||''),waveformBase64:String(attachment?.waveformBase64||''),mediaStatus:String(attachment?.downloadStatus||attachment?.status||row.mediaStatus||row.downloadStatus||''),mediaError:String(attachment?.downloadError||attachment?.errorMessage||attachment?.error||row.mediaError||''),mediaRetryCount:Number(attachment?.retryCount||row.mediaRetryCount||0),mediaRetryable:attachment?.retryable!==false&&attachment?.mediaRetryable!==false&&row.mediaRetryable!==false&&!/MEDIA_ENVELOPE_MISSING/i.test(String(attachment?.downloadError||attachment?.errorMessage||attachment?.error||row.mediaError||'')),mediaHasEnvelope:Boolean(attachment?.mediaKey||attachment?.directPath||row.mediaEnvelope||row.baileysMediaEnvelope),
  mediaRenderable:attachment?.renderable!==false&&attachment?.supportState!=='unsupported',isAnimatedSticker:Boolean(attachment?.isAnimatedSticker||attachment?.isAnimated),
  stickerFormat:String(attachment?.stickerFormat||''),supportState:String(attachment?.supportState||''),animatedEmojiMotion:animatedEmojiMotion(text,type,media),
  duration:attachment?.duration?`${Math.round(attachment.duration)}秒`:'',quote:row.quotedText?`${row.quotedSender||'引用'}|${row.quotedText}`:'',quotedMessageId:row.quotedMessageId||'',
  reactions:Array.isArray(row.reactions)?row.reactions:[],raw:row
 }
}

function formatRuntimeTime(value){const date=new Date(value||0);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(date):''}
function receiptLabel(value){const s=String(value??'').toLowerCase();if(['4','read','played'].includes(s))return'✓✓ 已读';if(['3','delivered'].includes(s))return'✓✓ 已送达';if(['2','server_ack','sent'].includes(s))return'✓ 已发送';if(s==='queued'||s==='pending')return'等待发送';if(s==='sending')return'正在发送';if(s==='retry')return'等待重试';if(s==='failed')return'发送失败';if(s==='cancelled')return'已取消';if(s==='platform_accepted_local_pending')return'✓ 已发送，本地记录修复中';if(s==='send_outcome_unknown')return'⚠ 发送结果不确定，已禁止自动重发';return s||'已发送'}

function learningSourceLabel(value){return ({manual:'手写',external_paste:'外部粘贴',chatgpt_web_edited:'ChatGPT 网页修改稿',local_model:'言策本地模型',ai_routed_model:'言策云端优先智能路由'}[String(value||'').toLowerCase()]||'已确认回复')}
function learningPreferenceLabel(key,value){const labels={replyLength:'回复长度',questionFrequency:'提问频率',emojiLevel:'表情使用',formality:'正式程度',tone:'语气风格'};const values={short:'偏短',medium:'适中',long:'偏长',low:'较少',high:'较多',casual:'自然口语',formal:'较正式',flirty:'更暧昧',neutral:'自然中性'};return {label:labels[key]||key,value:values[value]||value||'—'}}
async function loadReplyLearning(id=activeId,options={}){const contact=activeContactById(id),contactId=contact?.contactId||contact?.id||id;if(!contactId||!window.YanceStoreClient?.getReplyFeedback)return null;const payload=await window.YanceStoreClient.getReplyFeedback(contactId,{limit:60,versionLimit:20});replyLearningCache[id]=payload;if(options.render!==false&&id===activeId)renderReplyLearning();return payload}
function renderReplyLearning(){const data=replyLearningCache[activeId]||null,version=$('replyLearningVersion'),facts=$('replyLearningFacts'),rules=$('replyLearningRules'),events=$('replyLearningEvents');if(!version||!facts||!rules||!events)return;if(!data){version.textContent='等待读取';facts.innerHTML='';rules.innerHTML='<div class="ui-empty-state"><div><b>暂无已生效规则</b></div></div>';events.innerHTML='<div class="ui-empty-state"><div><b>暂无学习记录</b></div></div>';return}const profile=data.feedbackLearning||{},effective=profile.effective||profile.profile?.effective||{},rows=Object.entries(effective).map(([key,row])=>{const item=learningPreferenceLabel(key,row?.value);return {...item,confidence:Math.round(Number(row?.confidence||0)*100),evidence:Number(row?.evidenceCount||0)}});version.textContent=`版本 ${Number(profile.version||data.versions?.[0]?.version||0)} · ${Number(data.events?.length||0)} 条记录`;facts.innerHTML=`<article class="fact"><span>已生效规则</span><b>${htmlText(rows.length)}</b></article><article class="fact"><span>最近记录</span><b>${htmlText(Number(data.events?.length||0))}</b></article><article class="fact"><span>可恢复版本</span><b>${htmlText(Number(data.versions?.length||0))}</b></article>`;rules.innerHTML=rows.length?rows.map(row=>`<div class="reply-learning-rule"><span>${htmlText(row.label)}</span><b>${htmlText(row.value)} · ${htmlText(row.confidence)}% · ${htmlText(row.evidence)}次</b></div>`).join(''):'<div class="ui-empty-state"><div><b>暂无已生效规则</b><p>明确发送并学习的内容会在后台积累，达到稳定证据后生效。</p></div></div>';const latest=(data.events||[]).slice(0,30);events.innerHTML=latest.length?latest.map(row=>`<article class="reply-learning-event" data-source="${htmlAttr(row.source||'')}"><header><span>${htmlText(learningSourceLabel(row.source))} · ${htmlText(row.performanceMode||'')}</span><time>${htmlText(formatRuntimeTime(row.createdAt||''))}</time></header><b>${htmlText(row.eventType==='rejected'?'未采用的表达':'最终实际发送')}</b><p>${htmlText(row.finalText||row.rejectionReason||row.originalText||'')}</p>${row.originalText&&row.finalText&&row.originalText!==row.finalText?`<p>原稿：${htmlText(row.originalText)}</p>`:''}</article>`).join(''):'<div class="ui-empty-state"><div><b>暂无学习记录</b><p>发送失败、取消或上下文过期的回复不会进入这里。</p></div></div>'}
async function undoLatestReplyLearning(){const data=replyLearningCache[activeId]||await loadReplyLearning(activeId,{render:false}),versions=data?.versions||[],contact=activeContactById(activeId),contactId=contact?.contactId||contact?.id;if(!contactId||versions.length<2){hint('没有更早的学习版本可恢复','warning');return}const target=versions[1];if(!await window.YanceDialogs.confirm({title:'恢复回复学习',message:`恢复到回复学习版本 ${target.version}？`,submitLabel:'恢复'}))return;await window.YanceStoreClient.restoreReplyFeedback(contactId,target.version);await loadReplyLearning(activeId);hint(`已恢复到学习版本 ${target.version}`)}
async function clearCurrentReplyLearning(){const contact=activeContactById(activeId),contactId=contact?.contactId||contact?.id;if(!contactId)return;if(!await window.YanceDialogs.confirm({title:'清空回复学习',message:'历史版本仍可用于恢复。',danger:true,submitLabel:'清空'}))return;await window.YanceStoreClient.resetReplyFeedback(contactId);await loadReplyLearning(activeId);hint('当前联系人回复学习已清空，可随时恢复旧版本')}
async function forgetCurrentReplyLearning(){const contact=activeContactById(activeId),contactId=contact?.contactId||contact?.id;if(!contactId)return;if(!await window.YanceDialogs.confirm({title:'永久忘记回复学习',message:'将删除联系人学习记录、历史版本，以及平台/全局学习中的该联系人证据。此操作不可恢复。',danger:true,submitLabel:'永久忘记'}))return;await window.YanceStoreClient.forgetReplyLearning(contactId,{confirmForget:true,actor:'user'});await loadReplyLearning(activeId);hint('该联系人的回复学习已永久忘记')}
function exportCurrentReplyLearning(){const data=replyLearningCache[activeId];if(!data){hint('请先刷新回复学习','warning');return}const contact=activeContactById(activeId)||{},blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),contact:{id:contact.contactId||contact.id,name:contact.name||contact.displayName||''},data},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');setUrlAttribute(a,'href',url,{allowBlob:true,allowHttp:false,allowHttps:false,allowRelative:false});a.download=`Yance-Reply-Learning-${String(contact.name||contact.id||'contact').replace(/[^a-z0-9一-鿿_-]+/gi,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function renderUtilityTimeline(){const host=$('utilityTimelineContent'),range=$('utilityTimelineRange');if(!host)return;if(!activeContactById(activeId)){if(range)range.textContent='只读归档';host.innerHTML='<div class="ui-empty-state"><div><b>归档客户不参与实时关系计算</b><p>历史数据仍保留，恢复客户后可继续分析。</p></div></div>';return}const t=cleanTrajectoryObject(trajectoryState[activeId]||defaultTrajectory()),rows=Array.isArray(t.events)?t.events:[];if(range)range.textContent=t.updated||'真实数据';host.innerHTML=`<div class="facts"><article class="fact"><span>对方主动度</span><b>${htmlText(clampScore(t.initiative))}%</b></article><article class="fact"><span>关系阶段</span><b>${htmlText(businessLabel('relationshipStage',t.stage,'待分析'))}</b></article><article class="fact"><span>关系机会</span><b class="good">${htmlText(clampScore(t.opportunity))}</b></article><article class="fact"><span>风险</span><b class="warn">${htmlText(clampScore(t.risk))}</b></article></div><div class="timeline-list">${rows.length?rows.slice(0,12).map(x=>`<div class="timeline-event"><time>${htmlText(x[0]||'')}</time><i></i><div><b>${htmlText(businessLabel('eventType',x[1],x[1]||'真实互动'))}</b><span>${htmlText(x[2]||'')}</span></div></div>`).join(''):'<div class="ui-empty-state"><div><b>暂无关系事件</b><p>真实消息同步后自动生成。</p></div></div>'}</div>`}
function addMediaAnalysisToPanel(analysis={}){const grid=$('mediaAnalysisGrid'),count=$('mediaAnalysisCount');if(!grid)return;const localized=chineseFirstContent(analysis),original=profileText(analysis.summary||analysis.transcript||analysis.translation,''),display=profileText(localized.summary||localized.transcript||localized.translation,original||'识别完成');const existing=[...grid.querySelectorAll('.media-item')];if(!existing.length)grid.innerHTML='';const article=document.createElement('article');article.className='media-item';article.innerHTML=`<b>${htmlText(localized.kind||analysis.kind||'媒体')} · 真实识别</b><p>${htmlText(display)}</p>${original&&original!==display?`<small class="bilingual-original">原文：${htmlText(original)}</small>`:''}<span>${htmlText(analysis.model||localized.scene||analysis.scene||'本地模型')}</span>`;grid.prepend(article);while(grid.children.length>20)grid.lastElementChild.remove();if(count)count.textContent=`${grid.querySelectorAll('.media-item').length}项已分析`}
/* STAGE6_1_CONTEXT_PIPELINE + STAGE6_1_LARGE_HISTORY: SQLite is the only business-data source. */
function messageOrderValue(message){const value=new Date(message?.raw?.timestamp||message?.raw?.sentAt||message?.timestamp||message?.sentAt||0).getTime();return Number.isFinite(value)?value:0}
function messageIdentity(message){return String(message?.id||message?.externalMessageId||message?.raw?.dedupeKey||'')}
function mergeMessageChunk(id,rows,mode='latest'){
 const incoming=(rows||[]).map(runtimeMessage),existing=histories[id]||[],combined=mode==='replace'?incoming:mode==='older'?[...incoming,...existing]:[...existing,...incoming],seen=new Set(),deduped=[];
 for(const row of combined){const key=messageIdentity(row)||`${messageOrderValue(row)}:${row.side}:${row.text}`;if(seen.has(key))continue;seen.add(key);deduped.push(row)}
 deduped.sort((a,b)=>messageOrderValue(a)-messageOrderValue(b)||messageIdentity(a).localeCompare(messageIdentity(b)));
 const max=Math.max(240,Number(historyPerformance.maxMessagesPerConversation||800));
 histories[id]=deduped.length>max?deduped.slice(-max):deduped;
 if(deduped.length>max){const meta=historyMeta[id]||{};meta.memoryCapped=true;meta.hasMoreOlder=false;historyMeta[id]=meta}
 return histories[id]
}
function enforceHistoryMemoryBudget(keepId=activeId){
 const retain=Math.max(0,Number(historyPerformance.inactiveConversationRetain||80)),maxCached=Math.max(2,Number(historyPerformance.maxCachedConversations||8));
 const ids=Object.keys(histories).filter(id=>id!==keepId).sort((a,b)=>(historyMeta[b]?.lastAccess||0)-(historyMeta[a]?.lastAccess||0));
 ids.forEach((id,index)=>{if(index>=maxCached){delete histories[id];delete historyMeta[id]}else if((histories[id]||[]).length>retain)histories[id]=histories[id].slice(-retain)});
}
async function streamMessagePage(id,query,onChunk,signal){
 const base=`/api/r32/messages/conversations/${encodeURIComponent(id)}/messages`,url=`${base}/stream?${new URLSearchParams(query)}`,response=await fetch(url,{headers:{accept:'application/x-ndjson'},signal});
 const contentType=String(response.headers.get('content-type')||'').toLowerCase();
 if(!response.ok||!contentType.includes('application/x-ndjson')){const body=await response.text().catch(()=>'');const preview=body.trim().slice(0,160);throw new Error(response.ok?`历史消息接口返回了非流式内容（${contentType||'unknown'}）${preview?`：${preview.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}`:''}`:`历史消息加载失败（HTTP ${response.status}）`)}
 if(!response.body?.getReader){const fallback=await apiJson(`${base}?${new URLSearchParams(query)}`);onChunk(fallback.messages||[]);return fallback.page||{}}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',page={};
 const consume=line=>{if(!line.trim())return;let item;try{item=JSON.parse(line)}catch(error){throw new Error(`历史消息流格式错误：${error.message}`)}if(item.type==='meta')page=item.page||{};else if(item.type==='messages')onChunk(item.messages||[])};
 try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);consume(line)}if(done)break}}finally{if(signal?.aborted)await reader.cancel(signal.reason).catch(()=>{})}
 if(buffer.trim())consume(buffer);return page
}
async function loadConversationMessages(id,force=false,options={}){
 if(!id)return[];const mode=options.mode||'latest',requestToken=Number(options.requestToken||0),meta=historyMeta[id]||{};
 if(!force&&mode==='latest'&&histories[id]?.length){meta.lastAccess=Date.now();historyMeta[id]=meta;return histories[id]}
 if(mode==='older'&&(meta.loadingOlder||meta.hasMoreOlder===false||meta.memoryCapped))return histories[id]||[];
 const messageToken=++messageRequestSequence;meta.requestToken=messageToken;meta.lastAccess=Date.now();if(mode==='older'){meta.loadingOlder=true;meta.prependAnchor=true}historyMeta[id]=meta;
 const previousController=historyRequestControllers.get(id);if(previousController&&!previousController.signal.aborted)previousController.abort(new DOMException('History generation superseded','AbortError'));const controller=new AbortController();historyRequestControllers.set(id,controller);
 const query={limit:String(historyPerformance.messagePageSize||120)};if(options.before)query.before=options.before;if(options.after)query.after=options.after;
 let firstChunk=true;
 try{
  const page=await streamMessagePage(id,query,rows=>{if(meta.requestToken!==messageToken||(requestToken&&requestToken!==conversationContextRequestToken))return;mergeMessageChunk(id,rows,force&&mode==='latest'&&firstChunk?'replace':mode);firstChunk=false;if(id===activeId)renderMessages()},controller.signal);
  if(meta.requestToken!==messageToken||(requestToken&&requestToken!==conversationContextRequestToken))return histories[id]||[];
  Object.assign(meta,page,{loadingOlder:false,lastAccess:Date.now()});historyMeta[id]=meta;enforceHistoryMemoryBudget(id);if(id===activeId)renderMessages();return histories[id]||[]
 }catch(error){meta.loadingOlder=false;meta.prependAnchor=false;historyMeta[id]=meta;throw error}finally{if(historyRequestControllers.get(id)===controller)historyRequestControllers.delete(id)}
}
async function loadOlderMessages(id=activeId){const meta=historyMeta[id]||{};if(!id||meta.loadingOlder||meta.hasMoreOlder===false||meta.memoryCapped)return histories[id]||[];return loadConversationMessages(id,true,{mode:'older',before:meta.oldestCursor,requestToken:conversationContextRequestToken})}
function mergeRuntimeContactRows(incoming=[],options={}){
 const next=syncStability?.mergeContactCollections?.(contacts,incoming,{retainMissing:options.retainMissing!==false})||(()=>{const previousById=new Map(contacts.map(contact=>[contact.id,contact]));const rows=(incoming||[]).map(contact=>({...previousById.get(contact.id),...contact}));if(options.retainMissing!==false){const seen=new Set(rows.map(row=>row.id));contacts.forEach(row=>{if(row?.id&&!seen.has(row.id))rows.push(row)})}return rows})();
 contacts.splice(0,contacts.length,...next);
 return next
}
function removeRuntimeConversations(ids=[]){
 const removed=new Set((ids||[]).map(value=>String(value||'')).filter(Boolean));if(!removed.size)return false;
 for(let index=contacts.length-1;index>=0;index-=1){if(removed.has(String(contacts[index]?.id||'')))contacts.splice(index,1)}
 removed.forEach(id=>{delete histories[id];delete historyMeta[id];delete drafts[id];delete identityState[id];delete profileState[id];delete trajectoryState[id];historyRequestControllers.get(id)?.abort?.();historyRequestControllers.delete(id);abortReplyCandidateRequest(id)});
 if(removed.has(String(activeId))){activeId=firstActiveContact()?.id||'';composerOwnerId=activeId;normalizeCrossModuleSelections(activeId)}
 return true
}
function mergeRuntimeAccountRows(incoming=[]){
 const previousById=new Map(runtimeAccounts.map(account=>[String(account?.id||account?.accountId||''),account]));
 const seen=new Set();const next=(incoming||[]).map(account=>{const id=String(account?.id||account?.accountId||'');if(id)seen.add(id);return {...(previousById.get(id)||{}),...account}});
 runtimeAccounts.forEach(account=>{const id=String(account?.id||account?.accountId||'');if(id&&!seen.has(id))next.push(account)});
 runtimeAccounts.splice(0,runtimeAccounts.length,...next);return next
}
function currentConversationUiFingerprint(){return syncStability?.conversationUiFingerprint?.({contacts,accounts:runtimeAccounts,activeId})||JSON.stringify({activeId,translationMode:conversationLayoutState.translationMode,contacts:contacts.map(row=>[row.id,row.name,row.avatarUrl,row.snippet,row.snippetOriginal,row.snippetZh,row.snippetTranslationStatus,row.unreadCount]),accounts:runtimeAccounts.map(row=>[row.id,row.state,row.canAttemptSend,row.sendVerified,row.canReceive])})}
function updateConversationPaging(payload={},options={}){
 const page=payload.pagination||{},reset=options.reset===true;
 conversationPagingState.limit=Math.min(2000,Math.max(1,Number(page.conversationLimit||conversationPagingState.limit||250)));
 if(reset)conversationPagingState.nextOffset=0;
 const fallbackOffset=Number(page.conversationOffset||0)+Number(page.returned??payload.contacts?.length??0);
 conversationPagingState.nextOffset=Math.max(conversationPagingState.nextOffset,Number(page.nextOffset??fallbackOffset)||0);
 conversationPagingState.hasMore=page.hasMore!==false;
 conversationPagingState.lastError='';
}
function applyConversationSummaryPayload(payload={},options={}){
 mergeRuntimeContactRows(payload.contacts||[],{retainMissing:options.retainMissing!==false});mergeRuntimeAccountRows(payload.accounts||[]);
 Object.assign(drafts,payload.drafts||{});Object.assign(identityState,payload.identityState||{});Object.assign(profileState,payload.profileState||{});Object.assign(trajectoryState,payload.trajectoryState||{});
 for(const c of contacts){identityState[c.id]={...defaultIdentity(c),...(identityState[c.id]||{})};profileState[c.id]=cleanProfileObject(profileState[c.id]||{});trajectoryState[c.id]=cleanTrajectoryObject(trajectoryState[c.id]||{})}
 updateConversationPaging(payload,{reset:options.resetPaging===true});
}
async function refreshConversationSummaries(options={}){
 conversationRefreshDiagnostics.summaryRequests+=1;
 const beforeFingerprint=currentConversationUiFingerprint(),beforeActiveId=activeId;
 const refreshLimit=Math.min(2000,Math.max(conversationPagingState.limit,contacts.length||conversationPagingState.limit));
 const payload=await apiJson(`/api/r32/workspace/bootstrap?conversationLimit=${refreshLimit}&conversationOffset=0&messageLimit=0`);
 const replacementRequested=options.retainMissing===false,completeSnapshot=syncStability?.isCompleteContactSnapshot?.(payload)===true;
 applyConversationSummaryPayload(payload,{retainMissing:!replacementRequested||!completeSnapshot,resetPaging:true});
 if(activeId&&!activeContactById(activeId))activeId=firstActiveContact()?.id||'';normalizeCrossModuleSelections(activeId);composerOwnerId=activeId;
 const afterFingerprint=currentConversationUiFingerprint(),changed=options.forceRender===true||beforeFingerprint!==afterFingerprint||beforeActiveId!==activeId;
 const uiRefresh={changed,beforeActiveId,activeId,eventTypes:Array.isArray(options.eventTypes)?options.eventTypes:[]};
 if(!changed){conversationRefreshDiagnostics.summaryNoops+=1;conversationRefreshDiagnostics.lastSummaryNoopAt=new Date().toISOString();return {...payload,uiRefresh}}
 conversationRefreshDiagnostics.summaryCommits+=1;conversationRefreshDiagnostics.lastSummaryChangedAt=new Date().toISOString();
 hydrateActiveContactStore('r32-ui-runtime:summary-refresh');renderContacts();if(activeId){renderHeader();renderNotes()}updateSharedUI?.();
 window.dispatchEvent(new CustomEvent('yance:r32-summary-updated',{detail:{payload,activeId:activeContactById(activeId)?.id||firstActiveContact()?.id||'',uiRefresh}}));
 return {...payload,uiRefresh}
}
async function loadMoreConversationSummaries(){
 if(conversationPagingState.loading||conversationPagingState.hasMore===false)return {ok:true,skipped:true};
 conversationPagingState.loading=true;conversationPagingState.lastError='';
 try{
  const offset=conversationPagingState.nextOffset,limit=conversationPagingState.limit;
  const payload=await apiJson(`/api/r32/workspace/bootstrap?conversationLimit=${limit}&conversationOffset=${offset}&messageLimit=0`);
  const beforeFingerprint=currentConversationUiFingerprint();
  applyConversationSummaryPayload(payload,{retainMissing:true});
  if(beforeFingerprint!==currentConversationUiFingerprint()){hydrateActiveContactStore('r32-ui-runtime:contact-page');renderContacts();if(activeId){renderHeader();renderNotes()}updateSharedUI?.()}
  return payload
 }catch(error){conversationPagingState.lastError=String(error?.message||error);throw error}
 finally{conversationPagingState.loading=false}
}
async function bootstrapR32(force=false){
 const initial=!workspaceBootstrapped;
 setTitlebarStatus('connecting',force?'正在重新同步本地服务':'正在连接本地服务');showSystemStatus?.('warning',force?'正在重新同步真实数据…':'正在加载真实会话、客户档案与关系数据…');
 const [payload,performanceResult]=await Promise.all([apiJson('/api/r32/workspace/bootstrap?conversationLimit=250&conversationOffset=0&messageLimit=0'),apiJson('/api/r32/system/performance').catch(()=>null)]);if(performanceResult?.settings)Object.assign(historyPerformance,performanceResult.settings);
 if(initial){contacts.splice(0,contacts.length,...(payload.contacts||[]));runtimeAccounts.splice(0,runtimeAccounts.length,...(payload.accounts||[]));Object.keys(histories).forEach(k=>delete histories[k]);Object.keys(historyMeta).forEach(k=>delete historyMeta[k]);Object.keys(drafts).forEach(k=>delete drafts[k]);for(const target of [identityState,profileState,trajectoryState])Object.keys(target).forEach(k=>delete target[k]);applyConversationSummaryPayload(payload,{retainMissing:false,resetPaging:true})}
 else applyConversationSummaryPayload(payload,{retainMissing:true,resetPaging:true});
 restoreState();if(!activeContactById(activeId))activeId=firstActiveContact()?.id||'';normalizeCrossModuleSelections(activeId);if(!selectedIdentity)selectedIdentity=activeId;composerOwnerId=activeId;hydrateActiveContactStore();
 renderContacts();renderHeader();renderMessages();renderNotes();updateSharedUI?.();
 if(activeId){const requestToken=++conversationContextRequestToken;await Promise.allSettled([loadConversationMessages(activeId,true,{requestToken}),loadCrossModuleContext(activeId,{render:false,requestToken}),loadStoreSocialContext(activeId,{requestToken}),loadOutboundLanguage(activeId)]);renderHeader();renderMessages();renderNotes();updateComposerTranslationIndicator()}
 workspaceBootstrapped=true;renderUtilityTimeline();setTitlebarStatus('online','本地服务已连接');clearSystemStatus?.();window.dispatchEvent(new CustomEvent('yance:r32-data-ready',{detail:{payload,activeId}}));return payload
}

function inboundContentEvent(event){const message=event?.payload?.message||event?.payload||{};const direction=String(message.direction||'').toLowerCase();const type=String(message.type||message.messageType||'text').toLowerCase();if(direction==='outbound'||direction==='outgoing'||message.fromMe===true)return null;if(/^(read|receipt|delivered|delivery|presence|typing|sync|metadata)$/i.test(type))return null;return message}
function invalidateVisibleReplyForIncoming(event){const message=inboundContentEvent(event);if(!message)return;const conversationId=String(message.conversationId||message.sessionKey||event?.payload?.conversation?.id||'');if(!conversationId||conversationId!==String(activeId))return;abortReplyCandidateRequest(conversationId,'NEW_INCOMING_MESSAGE');replyGenerationAuthority?.invalidate?.(conversationId);const prior=aiAutoPipelineState.get(conversationId);if(prior)aiAutoPipelineState.set(conversationId,{...prior,state:'superseded',supersededAt:Date.now()});let changed=0;candidateBase.forEach(row=>{if(!row._stale){row._stale=true;row._staleReason='new_incoming_message';changed++}});const composer=$('composerText');if(composer?.value?.trim()){composer.dataset.contextStale='1';$('composerSuggestionState').textContent=composer.dataset.aiCandidateId||/external_paste|chatgpt_web_edited/.test(composer.dataset.replySource||'')?'对方又发来了消息，当前草稿需要重新确认':'对方又发来了消息，已保留你的手写内容'}if(changed){renderCandidates();setCandidateProcessState('stale','检测到对方的新消息，旧候选已暂停',{label:'结合新消息重新生成',run:()=>generateAiCandidates()})}hint('对方又发来了消息；旧 AI 回复已停止，正在等待连续消息结束','warning')}
function mediaEventConversationId(event={}){const payload=event?.payload||event||{};return String(payload.conversationId||payload.sessionKey||payload.message?.conversationId||payload.message?.sessionKey||'')}
// Direct realtime history mutation was removed in Batch 22. SQLite is the only message authority.
const mediaPatchReloadCoordinator=syncStability?.createRefreshCoordinator?.({delayMs:1800,run:async()=>{
 if(!activeId)return;conversationRefreshDiagnostics.fullConversationReloads+=1;const requestToken=++conversationContextRequestToken;await loadConversationMessages(activeId,true,{requestToken});renderMessages();
}});
const platformRefreshCoordinator=syncStability?.createRefreshCoordinator?.({delayMs:1200,run:async({reloadConversation,eventTypes})=>{
 try{
  conversationRefreshDiagnostics.lastEventTypes=[...eventTypes];
  const retainMissing=syncStability?.shouldRetainMissingContacts?.(eventTypes)!==false;
  await refreshConversationSummaries({retainMissing,eventTypes});
  if(eventTypes.some(type=>syncStability?.isAccountCapabilityEvent?.(type)||['account:state','account:summary','accounts:summary','whatsapp:state','telegram:state','facebook:state'].includes(String(type)))){
   const current=getC();
   if(current&&window.YancePlatformCapabilityRuntime?.refreshContact){
    try{await window.YancePlatformCapabilityRuntime.refreshContact(current,{force:true});renderHeader();renderMessages();renderNotes()}catch(error){console.warn('[R32 capability refresh]',error.message||error)}
   }
  }
  if(reloadConversation&&activeId){conversationRefreshDiagnostics.fullConversationReloads+=1;const requestToken=++conversationContextRequestToken;await Promise.allSettled([loadConversationMessages(activeId,true,{requestToken}),loadCrossModuleContext(activeId,{render:false,requestToken}),loadStoreSocialContext(activeId,{requestToken})]);renderHeader();renderMessages();renderNotes()}
 }catch(error){console.warn('[R32 platform refresh]',eventTypes,error.message||error)}
}});
window.yanceDesktop?.onDesktopEvent?.(event=>{
  if(event?.type==='conversation:presence'){
    const applied=syncStability?.applyPresenceEvent?.(contacts,event);
    if(applied?.changed){
      contacts.splice(0,contacts.length,...applied.contacts);
      renderContacts();renderHeader();
      if(app.classList.contains('profile-page-open'))renderProfilePage();
      if(app.classList.contains('timeline-page-open'))renderTimelinePage();
    }
  }
  if(event?.type==='message:inserted')invalidateVisibleReplyForIncoming(event);
  if(syncStability?.isMessagePatchEvent?.(event?.type)){
    const eventConversationId=mediaEventConversationId(event);
    // Realtime events only invalidate the SQLite projection. They never mutate the visible history directly.
    if(eventConversationId&&eventConversationId===String(activeId))mediaPatchReloadCoordinator?.schedule?.(event.type);
    else platformRefreshCoordinator?.schedule?.(event.type);
    return;
  }
  if(event?.type==='message:translation-updated'){
    const payload=event.payload||{},conversationId=String(payload.conversationId||payload.message?.conversationId||payload.message?.sessionKey||'');
    platformRefreshCoordinator?.schedule?.('message:translation-updated');
    if(conversationId&&conversationId===String(activeId))mediaPatchReloadCoordinator?.schedule?.('message:translation-updated');
    window.dispatchEvent(new CustomEvent('message:translation-updated',{detail:{conversationId,messageId:String(payload.messageId||payload.message?.id||'')}}));
  }
  if(event?.type==='conversation:merged'){
    const payload=event.payload||{};
    const sources=Array.isArray(payload.sourceConversationIds)?payload.sourceConversationIds:[];
    const target=String(payload.conversationId||payload.targetConversationId||'');
    if(target&&sources.includes(String(activeId))){
      delete histories[activeId];delete historyMeta[activeId];activeId=target;composerOwnerId=target;
    }
  }
  const removedConversationIds=syncStability?.removedConversationIdsForEvent?.(event)||[];
  if(removedConversationIds.length)removeRuntimeConversations(removedConversationIds);
  if(syncStability?.shouldHandleEvent?.(event?.type))platformRefreshCoordinator?.schedule?.(event.type);
});

window.YanceStoreClient?.onEvent?.(event=>{
 if(event?.eventType==='ai.reply.progress'){const payload=event.payload||{};if(payload.conversationId===activeId){const preview=String(payload.text||'').replace(/\s+/g,' ').trim();setCandidateProcessState(payload.done?'success':'running',payload.done?'候选已生成':`正在流式生成${preview?`：${preview.slice(-72)}`:'…'}`)}return}const learningEventTypes=['ai.replyFeedback.learned','ai.replyFeedback.reset','ai.replyFeedback.restored','ai.replyFeedback.forgotten'];if(learningEventTypes.includes(event?.eventType)){const affectedKeys=syncStability?.learningCacheKeysForEvent?.(contacts,event)||[];affectedKeys.forEach(key=>delete replyLearningCache[key]);if(affectedKeys.includes(String(activeId))&&r32RuntimeState.aiPanel==='learning')loadReplyLearning(activeId).catch(()=>{})}
 const contactId=event?.payload?.contactId||event?.entityId||'';
 const current=contacts.find(row=>row.id===activeId);
 if(!current)return;
 const relevant=!contactId||contactId===current.contactId||contactId===current.id||['relationships','interactionPolicies','memories','customers'].includes(event?.domain);
 if(relevant&&['socialSignals.detected','relationshipTrail.updated','customer.socialState.updated','customer.facts.updated','interactionPolicy.changed','socialInference.corrected','ai.replyFeedback.learned','ai.replyFeedback.reset','ai.replyFeedback.restored'].includes(event?.eventType))scheduleStoreSocialContextRefresh(activeId,event?.eventType==='customer.facts.updated'?120:500);
 if(relevant&&['conversation.contactTyping.updated','conversation.selfTyping.updated'].includes(event?.eventType)){renderHeader();syncComposerState();}
});
window.YanceStoreClient?.subscribe?.(
 state=>state.typingState||{ready:false,byContactId:{}},
 next=>{activeTypingSnapshot=next||{};if(currentView==='conversation')renderHeader()},
 {fireImmediately:true,equality:(a,b)=>(syncStability?.typingStateFingerprint?.(a)||JSON.stringify(a))===(syncStability?.typingStateFingerprint?.(b)||JSON.stringify(b))}
);

activeContactStore?.subscribe((snapshot,detail)=>{const id=String(snapshot?.contactId||'');if(!id||applyingCanonicalContact||String(snapshot?.source||'').startsWith('r32-ui-runtime'))return;const contact=contacts.find(row=>row.id===id);if(!contact||contact.archived)return;applyingCanonicalContact=true;Promise.resolve().then(async()=>{try{if(currentView==='conversation')await selectContact(id,{fromStore:true,source:snapshot.source,reason:'canonical-store-sync'});else{activeId=id;selectedIdentity=id;selectedProfile=id;selectedTimeline=id;composerOwnerId=id;if(currentView==='contacts')renderIdentityPage();else if(currentView==='profiles')renderProfilePage();else if(currentView==='timeline')renderTimelinePage();renderContacts();renderHeader();renderNotes();persistState();syncBackendActiveConversation(id)}}finally{applyingCanonicalContact=false}}).catch(error=>{applyingCanonicalContact=false;console.warn('[言策 ActiveContactStore]',error)})},{fireImmediately:false});

window.YanceMemorySoak=Object.freeze({
 async switchChats(count=50,delayMs=75){const ids=activeContacts().map(row=>row.id).filter(Boolean);if(!ids.length)return {ok:true,switches:0,uniqueConversations:0,reason:'no-active-conversations'};const total=Math.max(1,Math.min(500,Number(count)||50)),delay=Math.max(0,Math.min(1000,Number(delayMs)||0)),startedAt=Date.now();for(let index=0;index<total;index+=1){await selectContact(ids[index%ids.length]);if(delay)await new Promise(resolve=>setTimeout(resolve,delay))}return {ok:true,switches:total,uniqueConversations:new Set(ids).size,durationMs:Date.now()-startedAt,historyCache:Object.keys(histories).length,historyMessages:Object.values(histories).reduce((sum,rows)=>sum+(rows?.length||0),0)}}
});

function messageActionPlainText(message={}){return profileText(message.text,message.cn,message.translatedZh,message.raw?.text,message.raw?.caption,'').trim()}
function messageEvidence(message={}){return {messageId:profileText(message.externalMessageId,message.id,''),conversationId:activeId,platform:profileText(getC()?.platform,''),sentAt:profileText(message.raw?.sentAt,message.raw?.timestamp,message.time,''),quote:messageActionPlainText(message).slice(0,1200),translatedZh:profileText(message.cn,message.translatedZh,'')}}
async function persistCurrentProfile(contact,profile,noteOverride){const note=noteOverride===undefined?profileText(contact.note,profile.note,profile.notes,''):noteOverride;const payload={facts:{age:contact.age||'',birthday:contact.birthday||'',address:contact.address||'',city:contact.city||'',country:contact.country||'',job:contact.job||'',languages:contact.languages||'',family:contact.family||'',stage:contact.stage||'',interests:contact.interests||''},note,profile};await apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(contact.id)}/profile`,{method:'PUT',body:JSON.stringify(payload)});contact.note=note;profileState[contact.id]=profile;renderContacts();renderHeader();renderNotes();if(app.classList.contains('profile-page-open'))renderProfilePage();if(app.classList.contains('timeline-page-open'))renderTimelinePage();return profile}
async function addMessageToNotes(message){const contact=getC();if(!contact?.id)throw new Error('请先选择联系人');const text=messageActionPlainText(message);if(!text)throw new Error('这条消息没有可加入备注的内容');const profile=cleanProfileObject(profileState[contact.id]||defaultProfile()),stamp=new Date().toLocaleString('zh-CN',{hour12:false}),entry=`[消息备注 ${stamp}] ${text}`,current=profileText(contact.note,profile.note,profile.notes,'');const note=[current,entry].filter(Boolean).join('\n');await persistCurrentProfile(contact,{...profile,note,notes:note},note);logAction(contact.id,'消息加入客户备注',text.slice(0,160));hint('已加入客户长期备注')}
async function addMessageConfirmedFact(message){const contact=getC();if(!contact?.id)throw new Error('请先选择联系人');const text=messageActionPlainText(message);if(!text)throw new Error('这条消息没有可标记内容');const profile=cleanProfileObject(profileState[contact.id]||defaultProfile()),evidence=messageEvidence(message),row={id:`fact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,field:'conversation_fact',text,translatedZh:evidence.translatedZh,source:'user_marked_message',confidence:1,evidence:[evidence],status:'confirmed',confirmedAt:new Date().toISOString()};profile.confirmed=[...(Array.isArray(profile.confirmed)?profile.confirmed:[]),row];await persistCurrentProfile(contact,profile);logAction(contact.id,'消息标记为已确认事实',text.slice(0,160));hint('已写入客户档案的确认事实')}
async function prepareReplyFromMessage(message){const contact=getC();if(!contact?.id)throw new Error('请先选择联系人');const text=messageActionPlainText(message);if(!text)throw new Error('这条消息没有可用于生成回复的内容');openPanel('director');const instruction=$('directorInstruction');if(instruction){instruction.value=`请重点回应这条客户消息，并保持当前客户语言：${text}`;instruction.dispatchEvent(new Event('input',{bubbles:true}))}const latest=(histories[contact.id]||[]).find(row=>messageIdentity(row)===messageIdentity(message));if(latest)latest.aiFocus=true;updateDirector();hint('已将这条消息送入 AI 导演，可继续调整风格后生成候选')}
window.YanceMessageActions=Object.freeze({addToNotes:addMessageToNotes,addConfirmedFact:addMessageConfirmedFact,prepareReplyFromMessage});

window.__Y27={getState:()=>({activeId,activeContactId:activeContactStore?.getSnapshot?.().contactId||activeContactById(activeId)?.id||firstActiveContact()?.id||'',selectedIdentity,identityFilter,selectedProfile,profileFilter,selectedTimeline,timelineRange,timelineFilter,currentView,aiPanel:r32RuntimeState.aiPanel,contacts:cloneData(contacts),activeContacts:cloneData(activeContacts()),accounts:cloneData(runtimeAccounts),identityState:cloneData(identityState),profileState:cloneData(profileState),trajectoryState:cloneData(trajectoryState),drafts:cloneData(drafts),auditLog:cloneData(auditLog),profileChanges:cloneData(r32RuntimeState.profileChanges),moduleErrors:cloneData(r32RuntimeState.moduleErrors),lastMerge:!!lastMerge}),setExternalView,openContactsPage,openConversationPage,openProfilesPage,openTimelinePage,renderIdentityPage,renderProfilePage,renderTimelinePage,mergeContacts,undoLastMerge,runSelfTest:()=>Promise.resolve(regressionChecks()),runDiagnostics,bootstrapR32,loadConversationMessages,loadOlderMessages,loadCrossModuleContext,refreshConversationSummaries,loadMoreConversationSummaries,getConversationPagingState:()=>cloneData(conversationPagingState),markConversationRead,setConversationArchived,setConversationPinned,getHistoryPerformance:()=>cloneData(historyPerformance),getConversationRefreshDiagnostics:refreshDiagnosticsSnapshot,getConversationRouteContext:()=>cloneData(conversationRouteContext(getC())),getLinkedConversations:()=>cloneData(explicitlyLinkedConversations(getC())),getActiveContacts:()=>cloneData(activeContacts()),isContactArchived:id=>Boolean(contacts.find(c=>c.id===id)?.archived),getActiveContact:()=>getC(),getActiveMessages:()=>cloneData(histories[activeId]||[]),getMessageById:id=>cloneData((histories[activeId]||[]).find(m=>m.id===id||m.externalMessageId===id)||null),apiJson,saveIdentity:async(id,value)=>apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/identity`,{method:'PUT',body:JSON.stringify(value)}),saveProfile:async(id,value)=>apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/profile`,{method:'PUT',body:JSON.stringify(value)}),saveTrajectory:async(id,value)=>apiJson(`/api/r32/workspace/contacts/${encodeURIComponent(id)}/trajectory`,{method:'PUT',body:JSON.stringify(value)})};

let desktopActivationRecoveryPromise=null;
let desktopActivationSessionGeneration='';
async function recoverDesktopActivation(probe={}){
 const id=String(probe?.id||'');if(!id)return;
 try{
  if(desktopActivationRecoveryPromise)await desktopActivationRecoveryPromise.catch(()=>{});
  desktopActivationRecoveryPromise=(async()=>{
   const desktopState=await window.yanceDesktop.getState();
   if(desktopState?.backend?.ready!==true)throw Object.assign(new Error('本地服务尚未恢复'),{code:'DESKTOP_BACKEND_NOT_READY'});
   await apiJson('/api/ready',{timeoutMs:8000});
   if(!workspaceBootstrapped){const started=Date.now();while(!workspaceBootstrapped&&Date.now()-started<6000)await new Promise(resolve=>setTimeout(resolve,100));}
   const nextSessionGeneration=String(probe?.sessionGeneration||'');
   const sessionChanged=Boolean(desktopActivationSessionGeneration&&nextSessionGeneration&&desktopActivationSessionGeneration!==nextSessionGeneration);
   let backgroundRefreshScheduled=false;
   if(!workspaceBootstrapped||sessionChanged)await bootstrapR32(true);
   else{
    backgroundRefreshScheduled=true;
    queueMicrotask(()=>{
     const targetId=activeId,requestToken=++conversationContextRequestToken;
     Promise.allSettled([refreshConversationSummaries(),targetId?loadConversationMessages(targetId,true,{requestToken}):null,targetId?loadCrossModuleContext(targetId,{render:false,requestToken}):null,targetId?loadStoreSocialContext(targetId,{requestToken}):null]).then(()=>{
      if(targetId&&targetId===activeId){renderHeader();renderMessages();renderNotes()}
     }).catch(error=>console.warn('[言策 桌面恢复后台刷新]',error?.message||error));
    });
   }
   desktopActivationSessionGeneration=nextSessionGeneration||desktopActivationSessionGeneration;
   const verifiedState=await window.yanceDesktop.getState();
   if(verifiedState?.backend?.ready!==true)throw Object.assign(new Error('本地服务在恢复期间失去就绪状态'),{code:'DESKTOP_BACKEND_NOT_READY'});
   return {activeId,contactCount:contacts.length,currentView,sessionChanged,backgroundRefreshScheduled,verifiedAt:new Date().toISOString()};
  })();
  const detail=await desktopActivationRecoveryPromise;
  window.yanceDesktop.completeActivationProbe({id,ok:true,backendReady:true,sessionReady:true,rendererReady:true,workspaceReady:true,detail});
 }catch(error){
  window.yanceDesktop.completeActivationProbe({id,ok:false,backendReady:false,sessionReady:false,rendererReady:true,workspaceReady:false,reasonCode:error?.code||error?.reasonCode||'DESKTOP_RENDERER_ACTIVATION_RECOVERY_FAILED',message:error?.message||'桌面恢复失败'});
 }finally{desktopActivationRecoveryPromise=null}
}
window.yanceDesktop?.onActivationProbe?.(probe=>{recoverDesktopActivation(probe).catch(()=>{})});

window.yanceDesktop?.onActivationRecovery?.(payload=>{
 const state=String(payload?.state||'');
 const recoveryMessages={
  'visible-recovering':'主窗口已显示，正在恢复本地会话…',
  'validating-runtime':'正在校验本地服务与工作区…',
  'recovering-reload':'会话状态已失效，正在安全重载工作区…',
  'recovering-recreate':'工作区重载未恢复，正在重建主窗口…'
 };
 if(recoveryMessages[state]){
  window.YanceSystemStatus?.show?.('info',recoveryMessages[state],{persistent:true,retainAcrossRoutes:true,source:'desktop-activation',reason:state});
  document.documentElement.dataset.desktopActivationState=state;
  return;
 }
 if(state==='ready'){
  window.YanceSystemStatus?.clear?.('desktop-activation-ready');
  document.documentElement.dataset.desktopActivationState='ready';
  const authority=window.YanceWorkspaceRouteAuthority,expected=authority?.normalizeView?.(window.__Y27?.getState?.().currentView,'conversation')||'conversation',integrity=authority?.routeIntegrity?.(app,expected);
  if(integrity&& !integrity.pass)window.YanceProductAreaNavigation?.restoreWorkspaceView?.(expected,'desktop-activation-ready');
  return;
 }
 if(state==='failed'){
  document.documentElement.dataset.desktopActivationState='failed';
  window.YanceSystemStatus?.show?.('error','主窗口恢复失败，请查看诊断后重试',{persistent:true,retainAcrossRoutes:true,source:'desktop-activation',reason:payload?.detail?.reasonCode||'DESKTOP_ACTIVATION_FAILED'});
 }
});



// R32 · 统一阅读字号与界面密度设置。事件只允许绑定在 Aa 面板内部，禁止污染 html 根节点。
const displayRoot=document.documentElement;
const displayPanel=$('displaySettingsPanel');
function displayStoreGet(key,fallback){try{return localStorage.getItem(key)||fallback}catch(_){return fallback}}
function displayStoreSet(key,value){try{localStorage.setItem(key,value)}catch(_){}}
const savedReading=displayStoreGet('y27-reading','comfortable');
const savedDensity=displayStoreGet('y27-density','comfortable');
const savedContrast=displayStoreGet('y27-contrast','high');
function normalizedDisplaySettings(reading,density,contrast){
  return {
    reading:['standard','comfortable','large'].includes(reading)?reading:'comfortable',
    density:['compact','comfortable'].includes(density)?density:'comfortable',
    contrast:['standard','high'].includes(contrast)?contrast:'high'
  };
}
function updateDisplayScaleStatus(){
  const target=$('displayScaleStatus');if(!target)return;
  const dpr=Math.max(.5,Number(window.devicePixelRatio||1));
  const viewportScale=Math.max(.5,Number(window.visualViewport?.scale||1));
  const effective=Math.round(dpr*viewportScale*100);
  target.textContent=`${effective}% · ${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)}`;
  target.title='来自当前 Electron/Windows 运行环境；用于真实可读性与裁切验收';
}
function applyDisplaySettings(reading=savedReading,density=savedDensity,contrast=savedContrast,notify=false,persistToStore=false){
  const next=normalizedDisplaySettings(reading,density,contrast);
  const previousReading=displayRoot.dataset.reading;
  const previousDensity=displayRoot.dataset.density;
  const previousContrast=displayRoot.dataset.contrast;
  displayRoot.dataset.reading=next.reading;
  displayRoot.dataset.density=next.density;
  displayRoot.dataset.contrast=next.contrast;
  displayRoot.dataset.displayAuthority='batch21-semantic-v1';
  displayRoot.style.setProperty('--yance-reading-mode',next.reading);
  displayRoot.style.setProperty('--yance-density-mode',next.density);
  displayRoot.style.setProperty('--yance-contrast-mode',next.contrast);
  displayStoreSet('y27-reading',next.reading);
  displayStoreSet('y27-density',next.density);
  displayStoreSet('y27-contrast',next.contrast);
  displayPanel?.querySelectorAll('button[data-reading]').forEach(b=>b.classList.toggle('active',b.dataset.reading===next.reading));
  displayPanel?.querySelectorAll('button[data-density]').forEach(b=>b.classList.toggle('active',b.dataset.density===next.density));
  displayPanel?.querySelectorAll('button[data-contrast]').forEach(b=>b.classList.toggle('active',b.dataset.contrast===next.contrast));
  if(persistToStore&&window.YanceStoreClient?.setReadingMode){
    window.YanceStoreClient.setReadingMode(next.reading,next.density,next.contrast).catch(error=>hint(error.message||'显示设置持久化失败','error'));
  }
  const changed=previousReading!==next.reading||previousDensity!==next.density||previousContrast!==next.contrast;
  if(notify&&changed)hint(`显示设置已更新：${next.reading==='large'?'大字':next.reading==='standard'?'标准':'舒适'} · ${next.density==='compact'?'紧凑':'舒适'} · ${next.contrast==='high'?'增强对比':'标准对比'}`);
  if(changed){
    window.dispatchEvent(new CustomEvent('yance:display-authority-changed',{detail:{...next,authority:'batch21-semantic-v1'}}));
  }
  if(changed&&window.yanceDesktop?.reportRuntimeEnvironment)setTimeout(()=>window.yanceDesktop.reportRuntimeEnvironment(rendererEnvironmentSnapshot()).catch(error=>console.warn('[言策 display environment report]',error)),0);
  updateDisplayScaleStatus();
}
applyDisplaySettings(savedReading,savedDensity,savedContrast,false);
$('displaySettingsBtn').onclick=e=>{e.preventDefault();e.stopPropagation();window.YanceR32BasicSettings?.close?.();displayPanel.hidden=!displayPanel.hidden;if(!displayPanel.hidden)updateDisplayScaleStatus()};
$('closeDisplaySettings').onclick=e=>{e.preventDefault();displayPanel.hidden=true};
displayPanel?.querySelectorAll('button[data-reading]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();applyDisplaySettings(b.dataset.reading,displayRoot.dataset.density||'comfortable',displayRoot.dataset.contrast||'standard',true,true)});
displayPanel?.querySelectorAll('button[data-density]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();applyDisplaySettings(displayRoot.dataset.reading||'comfortable',b.dataset.density,displayRoot.dataset.contrast||'standard',true,true)});
displayPanel?.querySelectorAll('button[data-contrast]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();applyDisplaySettings(displayRoot.dataset.reading||'comfortable',displayRoot.dataset.density||'comfortable',b.dataset.contrast,true,true)});
if($('resetDisplaySettings'))$('resetDisplaySettings').onclick=e=>{e.preventDefault();e.stopPropagation();applyDisplaySettings('comfortable','comfortable','high',true,true)};
displayPanel?.addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{displayPanel.hidden=true});
window.addEventListener('resize',()=>{if(!displayPanel?.hidden)updateDisplayScaleStatus()},{passive:true});
window.YanceR32DisplaySettings={open:()=>{displayPanel.hidden=false;updateDisplayScaleStatus()},close:()=>{displayPanel.hidden=true},apply:applyDisplaySettings,reset:()=>applyDisplaySettings('comfortable','comfortable','high',true,true)};
window.YanceStoreClient?.subscribe?.(
  state=>({readingMode:state.ui?.readingMode||'comfortable',density:state.ui?.density||'comfortable',contrastMode:state.ui?.contrastMode||'high',ready:state.ui?.ready===true}),
  next=>{if(next?.ready)applyDisplaySettings(next.readingMode,next.density,next.contrastMode,false,false)},
  {fireImmediately:true,equality:(a,b)=>a?.ready===b?.ready&&a?.readingMode===b?.readingMode&&a?.density===b?.density&&a?.contrastMode===b?.contrastMode}
);

// Double-click the analysis status to start a fresh real SQLite-backed analysis.
$('analysisStatus').ondblclick=runAnalysis;
window.addEventListener('yance:r32-media-analysis',e=>addMediaAnalysisToPanel(e.detail||{}));
hydrateRuntimeEnvironment();window.addEventListener('resize',()=>{clearTimeout(window.__yanceRuntimeEnvironmentTimer);window.__yanceRuntimeEnvironmentTimer=setTimeout(hydrateRuntimeEnvironment,250)},{passive:true});syncComposerState();syncUnderstandingState();bootstrapR32().then(()=>{renderCandidates();updateDirector();syncComposerState();syncUnderstandingState()}).catch(error=>{const message=error.userMessage||userFacingRuntimeError(error,'真实数据加载失败');setTitlebarStatus('error',runtimeErrorCode(error)==='API_SESSION_UNAUTHORIZED'&&!hasDesktopSessionBridge()?'请从桌面应用打开':'本地服务连接异常');console.error('[R32 bootstrap]',error);showSystemStatus?.('error',message,'重试',()=>bootstrapR32(true))});
})();
