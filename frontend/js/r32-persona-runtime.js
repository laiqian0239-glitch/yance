(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const security = window.YanceSecurity || {};
  const runtimeErrors = window.YanceRuntimeErrors || {};
  const htmlText = security.escapeHtmlText || (value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));
  const htmlAttr = security.escapeHtmlAttribute || htmlText;
  const PERSONA_PROFILE_KEY = 'yance:persona-profile-id';
  const LEGACY_PERSONA_PROFILE_KEY = 'yance29:persona-profile-id';
  const LEGACY_ACTION_LABELS = Object.freeze(['校验人物基线', '导出JSON', '导入JSON', '保存新版本']);
  const STYLE_OVERLAY_FIELDS = Object.freeze([
    ['ambiguity', '暧昧'], ['softWoman', '小女人'], ['coquettish', '风骚'], ['flirting', '调情'],
    ['individuality', '个性'], ['femininity', '温柔'], ['matureWarm', '成熟'], ['queen', '高冷'],
    ['initiative', '主动'], ['mystery', '神秘'], ['humor', '幽默'], ['sensualPlayfulness', '俏皮']
  ]);
  const NORMALIZED_CHARACTER_CARD_FIELDS = Object.freeze([
    'firstMessage', 'exampleDialogueText', 'alternateGreetings', 'tags', 'extensions', 'systemPrompt'
  ]);
  function readPersonaProfileId() {
    const current = localStorage.getItem(PERSONA_PROFILE_KEY);
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_PERSONA_PROFILE_KEY);
    if (legacy) {
      localStorage.setItem(PERSONA_PROFILE_KEY, legacy);
      return legacy;
    }
    return 'owner';
  }
  function writePersonaProfileId(value) {
    localStorage.setItem(PERSONA_PROFILE_KEY, value);
  }

  const state = {
    loaded: false,
    loading: false,
    current: null,
    versions: [],
    pendingChanges: [],
    validation: null,
    dirty: false,
    draftText: '',
    profileId: readPersonaProfileId(),
    profiles: [],
    presets: [],
    effective: null,
    bindings: [],
    versionDiff: null,
    v2: {
      hydrated: false,
      characterCardPreview: null,
      compositionPreview: null,
      inFlight: false,
      status: 'idle',
      personaDescription: '',
      characterCard: { name: '', description: '', personality: '', scenario: '', characterNote: { content: '', depth: 4, role: 'system' } },
      examples: [{ user: '', assistant: '' }],
      locale: 'de-DE',
      chatRegister: 'native_short_form',
      styleWeights: {}
    }
  };

  function profileId() { return String(state.profileId || 'owner').trim() || 'owner'; }
  function activeScope() {
    const snapshot = window.YanceActiveContactStore?.getSnapshot?.() || {};
    const contactId = String(snapshot.contactId || '').trim();
    const conversationId = String(window.__YanceActiveConversationId || contactId || '').trim();
    return { contactId, conversationId };
  }

  function notify(message, type = 'success') {
    return window.YanceNotificationLayoutAuthority.show({ message, tone: type, timeoutMs: type === 'error' ? 6200 : type === 'warning' ? 4400 : 2000 });
  }

  async function fetchPersona(url, options = {}) {
    const attempts = Math.max(1, Number(options.retryAttempts || 3));
    const timeoutMs = Math.max(3000, Number(options.timeoutMs || 12000));
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: options.signal || controller.signal });
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    const failure = new Error(lastError?.name === 'AbortError' ? '人物基线服务响应超时，请稍后重试' : '人物基线服务暂未连接，请检查本地服务状态');
    failure.code = lastError?.name === 'AbortError' ? 'PERSONA_REQUEST_TIMEOUT' : 'PERSONA_SERVICE_UNREACHABLE';
    failure.cause = lastError;
    throw failure;
  }

  async function request(url, options = {}) {
    const { headers = {}, retryAttempts, timeoutMs, ...requestOptions } = options;
    const response = await fetchPersona(url, {
      ...requestOptions,
      retryAttempts,
      timeoutMs,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (runtimeErrors.createError) throw runtimeErrors.createError(payload, { status: response.status, rootObject: window, fallback: `请求失败 ${response.status}` });
      const raw = payload?.error?.message || payload?.message || (typeof payload?.error === 'string' ? payload.error : '');
      const error = new Error(raw && raw !== '[object Object]' ? raw : `请求失败 ${response.status}`);
      error.code = payload.code || payload?.error?.reasonCode;
      error.details = payload.details;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function version() { return Number(state.current?.profile?.activeVersion || state.current?.version?.version || 0); }
  function authoritative() { return state.current?.version?.content?.authoritative || {}; }
  function prettyAuthoritative() { return JSON.stringify(authoritative(), null, 2); }

  const personaSectionLabels = {
    coreIdentity: '核心身份', familyAndUpbringing: '家庭与成长', educationAndCareer: '教育与事业', relationshipHistory: '关系经历', emotionalAndHealthBoundaries: '情绪与健康边界', investmentBackground: '投资背景', travelMemories: '旅行记忆', socialRelationships: '社交关系', languageCapabilities: '语言能力', financialAndAssets: '财务与资产', expressionMatrix: '表达矩阵', localizedChatStyles: '本地化聊天风格', disclosureRules: '披露规则', forbiddenFabrications: '禁止虚构', personaProfile: '可读人物画像', replyStylePolicy: '回复风格策略', core: '核心身份', languagePolicy: '语言策略', voice: '表达声音', personality: '性格与边界', career: '事业经历', family: '家庭情况', relationship: '关系状态', truthPolicy: '真实性策略'
  };
  const personaFieldLabels = {
    displayName:'显示姓名',name:'姓名',names:'多语言姓名',birthDate:'出生日期',age:'年龄',zodiac:'星座',nationality:'国籍',residence:'居住地',country:'国家',city:'城市',district:'区域',sinceYear:'自何年起',occupation:'职业',heightCm:'身高（厘米）',weightKg:'体重（公斤）',mode:'运行模式',status:'状态',summary:'摘要',traits:'性格特征',boundaries:'边界',interests:'兴趣',experiences:'经历',personality:'性格',relationshipViews:'关系观',lifeStatus:'生活状态',expressionHabits:'表达习惯',replyStylePreferences:'回复风格偏好',forbiddenExpressions:'禁用表达',specialRelationshipSettings:'特殊关系设置',directions:'导演参数',intensity:'强度',allowBoldInitiative:'允许主动推进',avoidMechanicalFlirting:'避免机械调情',level:'水平',use:'使用场景',rules:'规则',records:'记录',startDate:'开始日期',endDate:'结束日期',reason:'原因',title:'标题',description:'说明',truthStatus:'事实状态',source:'来源',verifiedAt:'核验时间',liveReplyMode:'真实回复策略',generatedTextNeverBecomesFactAutomatically:'生成文本不得自动成为事实',allowFictionalFactsInSimulation:'模拟中允许虚构事实',allowFictionalFactsInLiveReplies:'真实会话允许虚构事实'
  };
  function containsChinese(value){return /[\u3400-\u9fff]/u.test(String(value??''))}
  function personaLabel(key){const text=String(key??'').trim();if(!text)return '内容';return personaFieldLabels[text]||personaSectionLabels[text]||text.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,char=>char.toUpperCase())}
  function personaScalar(value){if(value==null)return '';if(typeof value==='boolean')return value?'是':'否';if(typeof value==='number')return String(value);if(typeof value==='string')return value.trim();if(Array.isArray(value)&&value.every(item=>item==null||['string','number','boolean'].includes(typeof item)))return value.map(personaScalar).filter(Boolean).join('、');return ''}
  function personaLocalizedValue(value){if(value&&typeof value==='object'&&!Array.isArray(value)){const zh=personaScalar(value.zh||value.zhCN||value.translatedZh||value.translationZh||value.chineseUnderstanding?.text||value.chineseUnderstanding?.value);const original=personaScalar(value.original||value.sourceText||value.en||value.de||value.ko||value.value||value.text);if(zh||original)return {primary:zh||(containsChinese(original)?original:'中文理解待生成'),original,pending:Boolean(original&&!zh&&!containsChinese(original))}}
    const original=personaScalar(value);return {primary:original,original,pending:Boolean(original&&!containsChinese(original))}}
  function personaReadableRows(value,path=[],depth=0,limit=80){const rows=[];const walk=(current,currentPath,level)=>{if(rows.length>=limit||level>5||current==null)return;const scalar=personaScalar(current);if(scalar){const localized=personaLocalizedValue(current);rows.push({path:currentPath,label:personaLabel(currentPath.at(-1)),...localized});return}if(Array.isArray(current)){current.forEach((item,index)=>walk(item,[...currentPath,`${index+1}`],level+1));return}if(typeof current==='object'){const localized=personaLocalizedValue(current);if(localized.primary||localized.original){rows.push({path:currentPath,label:personaLabel(currentPath.at(-1)),...localized});return}Object.entries(current).forEach(([key,item])=>{if(key==='chineseUnderstanding'||key==='translatedZh'||key==='translationZh')return;walk(item,[...currentPath,key],level+1)})}};walk(value,path,depth);return rows}
  function readablePersonaHtml(){const source=authoritative();const sections=Object.entries(source||{});return `<section class="persona-card persona-readable-card"><header><div><small>中文结构化视图</small><h3>可阅读人物基线</h3></div><span class="persona-pill ok">原始数据不变</span></header><div class="persona-readable-note"><b>中文优先展示，不覆盖权威原文</b><p>已有中文理解时直接显示；只有外语原文而缺少中文时标记“中文理解待生成”，不会猜测或伪造译文。高级 JSON 编辑仍保留在下方。</p></div><div class="persona-readable-grid">${sections.length?sections.map(([key,value])=>{const rows=personaReadableRows(value,[key]);return `<article class="persona-readable-section"><header><div><small>${htmlText(key)}</small><h4>${htmlText(personaLabel(key))}</h4></div><span>${htmlText(rows.length)} 项</span></header><div>${rows.length?rows.map(row=>`<div class="persona-readable-row ${htmlAttr(row.pending?'translation-pending':'')}"><span>${htmlText(row.path.slice(1).map(personaLabel).join(' · ')||personaLabel(key))}</span><b>${htmlText(row.primary||'暂无内容')}</b>${row.original&&row.original!==row.primary?`<p><em>原文</em>${htmlText(row.original)}</p>`:''}${row.pending?'<small>待生成中文理解 · 当前展示权威原文</small>':''}</div>`).join(''):'<div class="persona-readable-empty">当前部分没有可展示内容</div>'}</div></article>`}).join(''):'<div class="persona-readable-empty">当前 Persona 没有权威人物数据</div>'}</div></section>`}

  function cloneJson(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function preserveNormalizedCharacterCard(card = {}) {
    const preserved = cloneJson(card) || {};
    for (const field of NORMALIZED_CHARACTER_CARD_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(card, field)) preserved[field] = cloneJson(card[field]);
    }
    return preserved;
  }
  function v2RelationshipProjection() {
    const scope = activeScope();
    const snapshot = window.YanceActiveContactStore?.getSnapshot?.() || {};
    return {
      authority: 'read_only_communication_context_projection',
      relationshipStage: state.effective?.relationshipStage || snapshot.relationshipStage || '',
      contactId: scope.contactId || '',
      conversationId: scope.conversationId || '',
      effectivePersona: state.effective?.effectiveLabel || '',
      readOnly: true
    };
  }
  function hydrateV2Draft(payload = state.current) {
    const content = payload?.version?.content || {};
    const auth = content.authoritative || {};
    const profile = auth.personaProfile && typeof auth.personaProfile === 'object' ? auth.personaProfile : {};
    const card = profile.characterCard && typeof profile.characterCard === 'object' ? preserveNormalizedCharacterCard(profile.characterCard) : {};
    const examples = Array.isArray(profile.exampleDialogues) && profile.exampleDialogues.length ? cloneJson(profile.exampleDialogues) : [{ user: '', assistant: '' }];
    const directions = auth.replyStylePolicy?.directions && typeof auth.replyStylePolicy.directions === 'object' ? auth.replyStylePolicy.directions : {};
    state.v2 = {
      ...state.v2,
      hydrated: true,
      personaDescription: String(profile.description || ''),
      characterCard: {
        ...card,
        name: String(card.name || ''),
        description: String(card.description || ''),
        personality: String(card.personality || ''),
        scenario: String(card.scenario || ''),
        characterNote: {
          content: String(card.characterNote?.content || card.postHistoryInstructions || ''),
          depth: Number(card.characterNote?.depth ?? 4),
          role: String(card.characterNote?.role || 'system')
        },
        characterBook: card.characterBook && typeof card.characterBook === 'object' ? cloneJson(card.characterBook) : undefined
      },
      examples,
      locale: ['de-DE', 'de-AT'].includes(String(profile.localeProfile?.locale || content.metadata?.locale || '')) ? String(profile.localeProfile?.locale || content.metadata?.locale) : 'de-DE',
      chatRegister: String(profile.chatRegister?.register || 'native_short_form'),
      styleWeights: Object.fromEntries(STYLE_OVERLAY_FIELDS.map(([key]) => [key, Number(directions[key] || 0)])),
      characterCardPreview: null,
      compositionPreview: null,
      status: 'idle',
      inFlight: false
    };
  }
  function syncV2DraftToAuthoritative() {
    let doc;
    try { doc = JSON.parse(state.draftText || prettyAuthoritative()); }
    catch { doc = cloneJson(authoritative()) || {}; }
    doc.personaProfile = doc.personaProfile && typeof doc.personaProfile === 'object' ? doc.personaProfile : {};
    doc.personaProfile.description = state.v2.personaDescription;
    doc.personaProfile.characterCard = cloneJson(state.v2.characterCard);
    doc.personaProfile.exampleDialogues = cloneJson(state.v2.examples);
    doc.personaProfile.localeProfile = { locale: state.v2.locale };
    doc.personaProfile.chatRegister = { channel: 'whatsapp', register: state.v2.chatRegister };
    doc.replyStylePolicy = doc.replyStylePolicy && typeof doc.replyStylePolicy === 'object' ? doc.replyStylePolicy : {};
    doc.replyStylePolicy.directions = { ...(doc.replyStylePolicy.directions || {}), ...state.v2.styleWeights };
    state.draftText = JSON.stringify(doc, null, 2);
    state.dirty = true;
    const editor = $('personaJsonEditor');
    if (editor) editor.value = state.draftText;
  }
  function collectV2Controls() {
    const value = id => String($(id)?.value || '');
    state.v2.personaDescription = value('personaV2PersonaDescription');
    state.v2.characterCard.name = value('personaV2CharacterName');
    state.v2.characterCard.description = value('personaV2CharacterDescription');
    state.v2.characterCard.personality = value('personaV2Personality');
    state.v2.characterCard.scenario = value('personaV2Scenario');
    state.v2.characterCard.characterNote = {
      ...state.v2.characterCard.characterNote,
      content: value('personaV2CharacterNote')
    };
    state.v2.locale = value('personaV2Locale') || 'de-DE';
    state.v2.chatRegister = value('personaV2ChatRegister') || 'native_short_form';
    state.v2.examples = [...document.querySelectorAll('[data-persona-example-row]')].map(row => ({
      user: String(row.querySelector('[data-persona-example-user]')?.value || '').trim(),
      assistant: String(row.querySelector('[data-persona-example-assistant]')?.value || '').trim()
    })).filter(row => row.user || row.assistant);
    if (!state.v2.examples.length) state.v2.examples = [{ user: '', assistant: '' }];
    for (const [key] of STYLE_OVERLAY_FIELDS) {
      state.v2.styleWeights[key] = Number(document.querySelector(`[data-persona-style="${key}"]`)?.value || 0);
    }
    syncV2DraftToAuthoritative();
  }
  function compositionInput() {
    const labels = STYLE_OVERLAY_FIELDS.filter(([key]) => Number(state.v2.styleWeights[key] || 0) > 0).map(([, label]) => label);
    return {
      personaCard: { description: state.v2.personaDescription },
      characterCard: cloneJson(state.v2.characterCard),
      relationshipCard: v2RelationshipProjection(),
      localeProfile: { locale: state.v2.locale },
      chatRegister: { channel: 'whatsapp', register: state.v2.chatRegister },
      styleOverlay: { labels, weights: cloneJson(state.v2.styleWeights), intensity: authoritative()?.replyStylePolicy?.intensity || 'natural' },
      exampleDialogues: cloneJson(state.v2.examples)
    };
  }
  function exampleRowsHtml() {
    return state.v2.examples.map((row, index) => `<div class="persona-example-row" data-persona-example-row>
      <label>用户示例<input data-persona-example-user value="${htmlAttr(row.user || '')}" aria-label="Example Dialogues 用户示例 ${index + 1}"/></label>
      <label>AI 示例<input data-persona-example-assistant value="${htmlAttr(row.assistant || '')}" aria-label="Example Dialogues AI 示例 ${index + 1}"/></label>
      <button type="button" data-persona-example-remove="${htmlAttr(index)}" ${state.v2.examples.length <= 1 ? 'disabled' : ''}>移除</button>
    </div>`).join('');
  }
  function styleOverlayHtml() {
    return STYLE_OVERLAY_FIELDS.map(([key, label]) => `<label class="persona-style-control"><span>${htmlText(label)}</span><input type="range" min="0" max="100" step="5" value="${htmlAttr(Number(state.v2.styleWeights[key] || 0))}" data-persona-style="${htmlAttr(key)}" aria-label="Style Overlay ${htmlAttr(label)}"/><output>${htmlText(Number(state.v2.styleWeights[key] || 0))}</output></label>`).join('');
  }
  function v2WorkbenchHtml() {
    const preview = state.v2.characterCardPreview;
    const composition = state.v2.compositionPreview;
    const relationship = v2RelationshipProjection();
    const statusClass = state.v2.status === 'error' ? 'error' : state.v2.status === 'success' ? 'success' : state.dirty ? 'dirty' : '';
    return `<section class="persona-card persona-v2-workbench ${htmlAttr(statusClass)}" aria-label="Persona Character V2 structured editor">
      <header><div><small>SillyTavern 1.18.0 · structured composition</small><h3>Persona / Character 结构化编辑</h3></div><span class="persona-pill ${htmlAttr(state.v2.status === 'success' ? 'ok' : state.v2.status === 'error' ? 'bad' : '')}">${state.v2.inFlight ? 'loading' : state.dirty ? 'dirty' : 'ready'}</span></header>
      <div class="persona-v2-toolbar"><span>保留操作：${LEGACY_ACTION_LABELS.map(htmlText).join(' · ')}</span><button type="button" data-persona-compile-preview ${state.v2.inFlight ? 'disabled' : ''}>生成组合预览</button></div>
      <div class="persona-character-card">
        <div><h4>Character Card</h4><p>PNG / JSON 由后端 SillyTavern parser 解析与校验，浏览器不重写 PNG 解析。</p></div>
        <label class="persona-file-label">导入 Character Card<input id="personaCharacterCardFile" type="file" accept="image/png,.png,application/json,.json" aria-label="Character Card PNG 或 JSON"/></label>
        <button type="button" data-persona-card-preview ${state.v2.inFlight ? 'disabled' : ''}>预览 Character Card</button>
        <button type="button" data-persona-card-apply ${preview ? '' : 'disabled'}>应用到当前 Persona</button>
        <div class="persona-card-preview" aria-live="polite">${preview ? `<b>${htmlText(preview.characterCard?.name || '未命名角色')}</b><span>${htmlText(preview.spec || '')} ${htmlText(preview.specVersion || '')}</span><p>${htmlText(preview.characterCard?.description || '无 Description')}</p>` : '<span>尚未选择或预览 Character Card</span>'}</div>
      </div>
      <div class="persona-structured">
        <label>Persona Description<textarea id="personaV2PersonaDescription" aria-label="Persona Description">${htmlText(state.v2.personaDescription)}</textarea></label>
        <label>Character Name<input id="personaV2CharacterName" value="${htmlAttr(state.v2.characterCard.name || '')}"/></label>
        <label>Character Description<textarea id="personaV2CharacterDescription">${htmlText(state.v2.characterCard.description || '')}</textarea></label>
        <label>Personality<textarea id="personaV2Personality">${htmlText(state.v2.characterCard.personality || '')}</textarea></label>
        <label>Scenario<textarea id="personaV2Scenario">${htmlText(state.v2.characterCard.scenario || '')}</textarea></label>
        <label>Character Note<textarea id="personaV2CharacterNote">${htmlText(state.v2.characterCard.characterNote?.content || '')}</textarea></label>
      </div>
      <div class="persona-example"><div class="persona-section-title"><div><small>Example Dialogues</small><h4>示例对话</h4></div><button type="button" data-persona-example-add>新增示例</button></div>${exampleRowsHtml()}</div>
      <div class="persona-style"><div class="persona-section-title"><div><small>Style Overlay</small><h4>12 项结构化风格权重</h4></div><span>0–100</span></div><div class="persona-style-grid">${styleOverlayHtml()}</div></div>
      <div class="persona-locale"><label>Locale Profile<select id="personaV2Locale"><option value="de-DE" ${state.v2.locale === 'de-DE' ? 'selected' : ''}>de-DE</option><option value="de-AT" ${state.v2.locale === 'de-AT' ? 'selected' : ''}>de-AT</option></select></label><label>Chat Register<select id="personaV2ChatRegister"><option value="native_short_form" selected>native_short_form</option></select></label></div>
      <div class="persona-relationship"><div class="persona-section-title"><div><small>Relationship Card</small><h4>关系上下文投影</h4></div><span class="persona-pill">只读 · read-only</span></div><pre>${htmlText(JSON.stringify(relationship, null, 2))}</pre></div>
      <div class="persona-preview"><div class="persona-section-title"><div><small>compile-context</small><h4>组合预览</h4></div><span>${composition ? `${htmlText(composition.units?.length || 0)} units` : '尚未编译'}</span></div><pre aria-live="polite">${htmlText(composition ? JSON.stringify(composition, null, 2) : '点击“生成组合预览”后，由后端 compiler 返回 SillyTavern-backed composition。')}</pre></div>
    </section>`;
  }

  async function previewCharacterCard() {
    const file = $('personaCharacterCardFile')?.files?.[0];
    if (!file) throw new Error('请先选择 Character Card PNG 或 JSON 文件');
    if (file.size > 8 * 1024 * 1024) throw new Error('Character Card 文件不能超过 8mb');
    state.v2.inFlight = true; state.v2.status = 'loading'; render();
    try {
      const response = await fetchPersona('/api/v2/persona/character-card/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer(), retryAttempts: 1, timeoutMs: 12000
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload?.error?.message || payload?.message || `Character Card 预览失败 (${response.status})`);
      state.v2.characterCardPreview = payload.preview || null;
      state.v2.status = 'success';
      notify('Character Card 解析与校验通过');
    } catch (error) {
      state.v2.status = 'error';
      throw error;
    } finally { state.v2.inFlight = false; render(); }
  }
  function applyCharacterCard() {
    const preview = state.v2.characterCardPreview;
    if (!preview?.characterCard) throw new Error('请先完成 Character Card 预览');
    const card = preserveNormalizedCharacterCard(preview.characterCard);
    state.v2.characterCard = {
      ...card,
      name: String(card.name || ''), description: String(card.description || ''), personality: String(card.personality || ''), scenario: String(card.scenario || ''),
      characterNote: { content: String(card.postHistoryInstructions || ''), depth: 4, role: 'system' },
      characterBook: card.characterBook && typeof card.characterBook === 'object' ? cloneJson(card.characterBook) : undefined
    };
    syncV2DraftToAuthoritative();
    state.v2.status = 'success';
    render();
    notify('Character Card 已应用到当前 Persona 草稿；保存新版本后持久化');
  }
  async function compileCompositionPreview() {
    collectV2Controls();
    state.v2.inFlight = true; state.v2.status = 'loading'; render();
    try {
      const payload = await request(`/api/v2/persona/${profileId()}/compile-context`, { method: 'POST', body: JSON.stringify({ composition: compositionInput() }) });
      state.v2.compositionPreview = payload.context?.persona?.composition || payload.composition || null;
      state.v2.status = 'success';
      notify('Persona 组合预览已更新');
    } catch (error) { state.v2.status = 'error'; throw error; }
    finally { state.v2.inFlight = false; render(); }
  }

  function optionsHtml(rows, valueKey, label) {
    return rows.map(row => {
      const value = String(row?.[valueKey] || '');
      return `<option value="${htmlAttr(value)}" ${value === profileId() ? 'selected' : ''}>${htmlText(label(row))}</option>`;
    }).join('');
  }

  function managerHtml() {
    const scope = activeScope();
    const profileOptions = optionsHtml(state.profiles, 'profileId', row => `${row.profileId} · v${row.activeVersion}`);
    const contactBinding = state.bindings.find(row => row.scopeType === 'contact' && row.scopeId === scope.contactId);
    const conversationBinding = state.bindings.find(row => row.scopeType === 'conversation' && row.scopeId === scope.conversationId);
    return `<section class="persona-card persona-manager"><header><div><small>动态人设控制台</small><h3>版本、作用域与当前生效人设</h3></div><span class="persona-pill ok">${htmlText(state.effective?.effectiveLabel || '等待解析')}</span></header>
      <div class="persona-manager-grid">
        <label>当前编辑版本<select id="personaProfileSelect">${profileOptions || `<option value="${htmlAttr(profileId())}">${htmlText(profileId())}</option>`}</select></label>
        <label>创建新 Persona<div class="persona-inline"><input id="personaNewProfileId" placeholder="例如：work-persona" maxlength="128"/><button data-persona-create>创建空白</button></div></label>
        <label>可编辑预设<div class="persona-inline"><select id="personaPresetSelect">${state.presets.map(row => `<option value="${htmlAttr(row.presetId)}">${htmlText(row.title)}</option>`).join('')}</select><button data-persona-load-preset>创建预设 Persona</button></div></label>
        <label>联系人覆盖 <small>${htmlText(scope.contactId || '未选择联系人')}</small><div class="persona-inline"><select id="personaContactBinding"><option value="">继承上一级</option>${state.profiles.map(row => `<option value="${htmlAttr(row.profileId)}" ${row.profileId === contactBinding?.profileId ? 'selected' : ''}>${htmlText(row.profileId)} · v${htmlText(row.activeVersion)}</option>`).join('')}</select><button data-persona-bind="contact" ${scope.contactId ? '' : 'disabled'}>应用</button><button data-persona-clear="contact" ${contactBinding ? '' : 'disabled'}>清除</button></div></label>
        <label>会话临时调整 <small>${htmlText(scope.conversationId || '未选择会话')}</small><div class="persona-inline"><select id="personaConversationBinding"><option value="">继承上一级</option>${state.profiles.map(row => `<option value="${htmlAttr(row.profileId)}" ${row.profileId === conversationBinding?.profileId ? 'selected' : ''}>${htmlText(row.profileId)} · v${htmlText(row.activeVersion)}</option>`).join('')}</select><select id="personaConversationIntensity"><option value="natural">自然</option><option value="obvious">明显</option><option value="strong">强烈</option></select><button data-persona-bind="conversation" ${scope.conversationId ? '' : 'disabled'}>临时应用</button><button data-persona-clear="conversation" ${conversationBinding ? '' : 'disabled'}>清除</button></div></label>
      </div>
      <p class="persona-effective-note">当前生效：${htmlText(state.effective?.effectiveLabel || '尚未解析')}。修改版本或作用域后，下一条 AI 回复立即重新编译，不需要重启或重新登录。</p>
    </section>`;
  }

  function summaryCardsHtml() {
    const current = state.current || {};
    const content = current.version?.content || {};
    const core = content.authoritative?.coreIdentity || {};
    const validation = state.validation || { valid: false, errors: [], warnings: [] };
    return `<div class="persona-summary">
      <article><span>当前版本</span><b>v${htmlText(version())}</b><small>${htmlText(current.version?.createdAt || content.metadata?.updatedAt || '尚未更新')}</small></article>
      <article><span>运行模式</span><b>${core.mode === 'fictional_roleplay' ? '虚构角色' : '已核验真实'}</b><small>${core.truthPolicy?.liveReplyMode === 'verified_only' ? '真实会话仅使用已核验事实' : '请检查真实性策略'}</small></article>
      <article><span>一致性</span><b class="${htmlAttr(validation.valid ? 'ok' : 'bad')}">${validation.valid ? '通过' : '需修复'}</b><small>${htmlText((validation.errors || []).length)} 项错误 · ${htmlText((validation.warnings || []).length)} 项提醒</small></article>
      <article><span>Persona 身份</span><b>${htmlText(content.metadata?.title || core.displayName || '未命名')}</b><small>${htmlText(content.metadata?.locale || '')} · SHA ${htmlText(String(current.version?.contentSha256 || '').slice(0, 10))}</small></article>
    </div>`;
  }

  function validationHtml() {
    const validation = state.validation || { checks: [] };
    const rows = Array.isArray(validation.checks) ? validation.checks : [];
    return `<section class="persona-card"><header><div><small>自动一致性门禁</small><h3>时间线、语言、披露与真实性检查</h3></div><span class="persona-pill ${htmlAttr(validation.valid ? 'ok' : 'bad')}">${validation.valid ? '全部通过' : '存在阻断'}</span></header>
      <div class="persona-checks">${rows.length ? rows.map(row => `<article class="${htmlAttr(row.pass ? 'pass' : row.severity === 'warning' ? 'warn' : 'fail')}"><i>${row.pass ? '✓' : row.severity === 'warning' ? '!' : '×'}</i><div><b>${htmlText(row.rule || row.name || '')}</b><p>${htmlText(row.message || row.detail || '')}</p></div></article>`).join('') : '<div class="persona-empty"><b>尚未运行校验</b><p>点击顶部“校验人物基线”。</p></div>'}</div>
    </section>`;
  }

  function historyHtml() {
    const rows = state.versions.slice(0, 20);
    const diff = state.versionDiff;
    return `<section class="persona-card"><header><div><small>版本历史</small><h3>不可变版本、字段差异与安全回滚</h3></div><span class="persona-pill">${htmlText(rows.length)} 个版本</span></header>
      <div class="persona-history">${rows.length ? rows.map(row => {
        const metadata = row.metadata || {};
        const versionNumber = Number(row.version || 0);
        return `<article><div><b>v${htmlText(versionNumber)} · ${htmlText(row.reason || row.operation || '人物更新')}</b><p>${htmlText(row.source || 'user')} · ${htmlText(row.createdAt || '')}</p><p>父版本 v${htmlText(Number(row.parentVersion || 0))} · SHA ${htmlText(String(row.contentSha256 || '').slice(0, 12))} · 变更 ${htmlText((row.changedPaths || []).length)} 项</p><p>审批：${htmlText(metadata.approvalMode || '历史版本')} · 操作者：${htmlText(metadata.actor || row.source || 'unknown')}${row.rollbackOfVersion ? ` · 回滚来源 v${htmlText(Number(row.rollbackOfVersion))}` : ''}</p></div><div><button data-persona-diff="${htmlAttr(versionNumber)}">查看差异</button>${versionNumber !== version() ? `<button data-persona-rollback="${htmlAttr(versionNumber)}">回滚到此版本</button>` : '<em>当前</em>'}</div></article>`;
      }).join('') : '<div class="persona-empty"><b>暂无版本历史</b></div>'}</div>
      ${diff ? `<details open class="persona-version-diff"><summary>v${htmlText(diff.fromVersion)} → v${htmlText(diff.toVersion)} 字段差异（${htmlText(diff.diff?.changedCount || 0)}）</summary><p>旧 SHA：${htmlText(diff.diff?.beforeSha256 || '')}</p><p>新 SHA：${htmlText(diff.diff?.afterSha256 || '')}</p><pre>${htmlText(JSON.stringify(diff.diff?.changes || [], null, 2))}</pre></details>` : ''}
    </section>`;
  }

  function pendingHtml() {
    const rows = state.pendingChanges.filter(row => row.state === 'pending');
    return `<section class="persona-card"><header><div><small>学习防火墙</small><h3>待人工确认的人物事实建议</h3></div><span class="persona-pill">${htmlText(rows.length)} 项</span></header>
      <div class="persona-pending">${rows.length ? rows.map(row => `<article><div><b>${htmlText(row.reason || 'AI 建议修改')}</b><p>${htmlText(row.source || 'ai-suggestion')} · 基于 v${htmlText(Number(row.baseVersion || 0))} · ${htmlText(row.createdAt || '')}</p><pre>${htmlText(JSON.stringify(row.patch || {}, null, 2))}</pre></div><footer><button data-persona-change="${htmlAttr(row.changeId)}" data-decision="rejected">拒绝</button><button class="primary" data-persona-change="${htmlAttr(row.changeId)}" data-decision="approved">批准并生成新版本</button></footer></article>`).join('') : '<div class="persona-empty"><b>没有待确认修改</b><p>AI 学习只能提出建议，不会自动覆盖人物核心事实。</p></div>'}</div>
    </section>`;
  }

  function editorHtml() {
    return `<section class="persona-card persona-editor-card"><header><div><small>权威人物数据</small><h3>高级 JSON 编辑</h3></div><span class="persona-pill">保存后生成新版本</span></header>
      <div class="persona-editor-note"><b>真实会话与虚构模拟已隔离</b><p>出生、家庭、创伤、医疗、事业、财务和旅行只有人工保存或批准后才会改变。虚构事实不会自动进入真实联系人回复。</p></div>
      <textarea id="personaJsonEditor" spellcheck="false">${htmlText(state.draftText || prettyAuthoritative())}</textarea>
      <label class="persona-reason">变更原因<input id="personaChangeReason" placeholder="例如：更新年龄、城市、职业或回复风格"/></label>
      <input id="personaImportFile" type="file" accept="application/json,.json" hidden/>
    </section>`;
  }

  function emptyHtml() {
    return `${managerHtml()}<div class="persona-empty"><b>当前 Persona 尚未初始化</b><p>可以创建空白版本，也可以载入任一可编辑预设。预设只是起点，不会写死角色。</p><div class="persona-empty-actions"><button data-persona-init="empty">创建空白 Persona</button><button class="primary" data-persona-init="default">载入所选可编辑预设</button></div></div>`;
  }

  function render() {
    const host = $('aiwPersonaPanel');
    if (!host) return;
    if (state.loading) {
      host.innerHTML = '<div class="persona-empty"><b>正在读取人物基线</b><p>校验版本、披露策略、真实性防火墙和待审批变更。</p></div>';
      return;
    }
    if (!state.loaded) {
      load().catch(error => {
        host.innerHTML = `<div class="persona-empty"><b>人物基线读取失败</b><p>${htmlText(error.message || '人物基线服务暂未连接')}</p><button type="button" data-persona-retry>重新读取</button></div>`;
        host.querySelector('[data-persona-retry]')?.addEventListener('click', () => { state.loaded = false; load().catch(nextError => notify(nextError.message || '人物基线读取失败', 'error')); });
      });
      return;
    }
    if (!state.current) {
      host.innerHTML = emptyHtml();
      const badge = $('aiwPersonaVersion');
      if (badge) badge.textContent = '0';
      return;
    }
    host.innerHTML = `${managerHtml()}${summaryCardsHtml()}${v2WorkbenchHtml()}${readablePersonaHtml()}<div class="persona-grid">${editorHtml()}${validationHtml()}${historyHtml()}${pendingHtml()}</div>`;
    const editor = $('personaJsonEditor');
    editor?.addEventListener('input', () => { state.dirty = true; state.draftText = editor.value; });
    const badge = $('aiwPersonaVersion');
    if (badge) badge.textContent = version();
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    render();
    try {
      const scope = activeScope();
      const query = new URLSearchParams();
      if (scope.contactId) query.set('contactId', scope.contactId);
      if (scope.conversationId) query.set('conversationId', scope.conversationId);
      const [profilesPayload, presetsPayload, scopesPayload, effectivePayload] = await Promise.all([
        request('/api/v2/persona/profiles?limit=200'),
        request('/api/v2/persona/presets'),
        request('/api/v2/persona/scopes?limit=500'),
        request(`/api/v2/persona/effective?${query.toString()}`).catch(() => ({ effective: null }))
      ]);
      state.profiles = profilesPayload.profiles || [];
      state.presets = presetsPayload.presets || [];
      state.bindings = scopesPayload.bindings || [];
      state.effective = effectivePayload.effective || null;
      if (state.profiles.length && !state.profiles.some(row => row.profileId === profileId())) {
        state.profileId = state.effective?.profileId || state.profiles[0].profileId;
        writePersonaProfileId(state.profileId);
      }
      const currentResponse = await fetchPersona(`/api/v2/persona/${profileId()}/current`, { retryAttempts: 3, timeoutMs: 12000 });
      if (currentResponse.status === 404) {
        state.current = null;
        state.versions = [];
        state.pendingChanges = [];
        state.validation = null;
        state.draftText = '';
        state.loaded = true;
        return;
      }
      const currentPayload = await currentResponse.json().catch(() => ({}));
      if (!currentResponse.ok) throw new Error(currentPayload.message || `人物基线读取失败（${currentResponse.status}）`);
      const [versionsPayload, pendingPayload, validationPayload] = await Promise.all([
        request(`/api/v2/persona/${profileId()}/versions?limit=100`),
        request(`/api/v2/persona/${profileId()}/pending-changes?limit=100`),
        request(`/api/v2/persona/${profileId()}/validate`, { method: 'POST', body: JSON.stringify({ document: currentPayload.version?.content }) })
      ]);
      state.current = currentPayload;
      state.versions = versionsPayload.versions || [];
      state.pendingChanges = pendingPayload.pendingChanges || [];
      state.validation = validationPayload.validation || null;
      state.draftText = JSON.stringify(currentPayload.version?.content?.authoritative || {}, null, 2);
      hydrateV2Draft(currentPayload);
      state.loaded = true;
      state.dirty = false;
      window.YanceR32PersonaBrainStatus?.refresh?.();
    } finally {
      state.loading = false;
      render();
    }
  }

  function parseEditor() {
    const editor = $('personaJsonEditor');
    if (!editor) throw new Error('人物编辑器尚未载入');
    state.draftText = editor.value;
    try { return JSON.parse(state.draftText); }
    catch (error) { throw new Error(`JSON 格式错误：${error.message}`); }
  }

  async function validate() {
    collectV2Controls();
    const data = parseEditor();
    const payload = await request(`/api/v2/persona/${profileId()}/validate`, { method: 'POST', body: JSON.stringify({ authoritative: data }) });
    state.validation = payload.validation;
    render();
    notify(payload.validation.valid ? '人物一致性检查通过' : '人物基线存在阻断，请先修复', payload.validation.valid ? 'success' : 'warning');
    return payload.validation;
  }

  async function save() {
    collectV2Controls();
    const data = parseEditor();
    const validationPayload = await request(`/api/v2/persona/${profileId()}/validate`, { method: 'POST', body: JSON.stringify({ authoritative: data }) });
    state.validation = validationPayload.validation;
    if (!state.validation.valid) {
      render();
      notify('存在一致性阻断，未保存新版本', 'error');
      return;
    }
    const reason = $('personaChangeReason')?.value?.trim() || '';
    if (!reason) throw new Error('保存新版本前必须填写变更原因');
    const previewPayload = await request(`/api/v2/persona/${profileId()}/authoritative/preview`, {
      method: 'POST',
      body: JSON.stringify({ authoritative: data })
    });
    const preview = previewPayload.preview || {};
    if (!preview.diff?.changed) {
      notify('人物基线没有实际字段变化', 'warning');
      return;
    }
    const paths = (preview.diff.changedPaths || []).slice(0, 12);
    const confirmed = await window.YanceDialogs.confirm({
      title: '确认保存人物新版本',
      message: `将从 v${preview.currentVersion} 生成新版本，共 ${preview.diff.changedCount} 项字段变化。\n\n${paths.join('\n')}${preview.diff.changedCount > paths.length ? '\n…' : ''}\n\n变更原因：${reason}`,
      submitLabel: '确认并生成新版本'
    });
    if (!confirmed) return;
    await request(`/api/v2/persona/${profileId()}/authoritative`, {
      method: 'PUT',
      body: JSON.stringify({
        authoritative: data,
        expectedVersion: version(),
        reason,
        source: 'user',
        actor: 'user',
        previewReceipt: preview.previewReceipt
      })
    });
    state.versionDiff = null;
    await load();
    notify(`人物基线已保存为 v${version()}`);
  }

  async function initialize(kind) {
    const endpoint = kind === 'default' ? 'initialize-default' : 'initialize';
    const presetId = $('personaPresetSelect')?.value || state.presets[0]?.presetId || '';
    await request(`/api/v2/persona/${profileId()}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({ presetId, reason: kind === 'default' ? 'Initialize editable persona preset from workbench' : 'Initialize empty persona from workbench', source: 'user' })
    });
    await load();
    notify(kind === 'default' ? '可编辑人设预设已载入' : '空白 Persona 已创建');
  }

  async function loadVersionDiff(targetVersion) {
    const fromVersion = Math.max(1, Number(targetVersion || 1) - 1);
    const toVersion = Number(targetVersion || 0);
    const payload = await request(`/api/v2/persona/${profileId()}/diff?fromVersion=${encodeURIComponent(fromVersion)}&toVersion=${encodeURIComponent(toVersion)}`);
    state.versionDiff = payload;
    render();
  }

  async function rollback(targetVersion) {
    if (!await window.YanceDialogs.confirm({ title: '回滚人物基线', message: `确认回滚到人物版本 v${targetVersion}？系统会生成新的回滚版本，不会删除历史。`, submitLabel: '生成回滚版本' })) return;
    const result = await request(`/api/v2/persona/${profileId()}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion, expectedVersion: version(), reason: `User rollback to persona version ${targetVersion}`, source: 'user', actor: 'user' })
    });
    if (result.rollbackVerification && (!result.rollbackVerification.authoritativeMatch || !result.rollbackVerification.learnedMatch)) {
      throw new Error('回滚校验未通过，系统已阻止宣称成功');
    }
    state.versionDiff = null;
    await load();
    notify(`已回滚并生成 v${version()}`);
  }

  async function decideChange(changeId, decision) {
    await request(`/api/v2/persona/${profileId()}/pending-changes/${encodeURIComponent(changeId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, decidedBy: 'user', reason: decision === 'approved' ? 'User approved persona fact change' : 'User rejected persona fact change' })
    });
    await load();
    notify(decision === 'approved' ? '建议已批准并写入新版本' : '建议已拒绝');
  }

  async function exportJson() {
    const payload = await request(`/api/v2/persona/${profileId()}/export`);
    const blob = new Blob([JSON.stringify(payload.exportedPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    if (!security.setUrlAttribute) throw new Error('安全下载组件不可用');
    security.setUrlAttribute(anchor, 'href', url, { allowBlob: true, allowHttp: false, allowHttps: false, allowRelative: false });
    anchor.download = `Yance_Persona_${profileId()}_v${version()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('人物基线 JSON 已导出');
  }

  function chooseImport() { $('personaImportFile')?.click(); }
  async function importFile(file) {
    if (!file) return;
    const raw = await file.text();
    let exportedPayload;
    try { exportedPayload = JSON.parse(raw); }
    catch (error) { throw new Error(`导入文件不是有效 JSON：${error.message}`); }
    await request(`/api/v2/persona/${profileId()}/import`, { method: 'POST', body: JSON.stringify({ exportedPayload }) });
    await load();
    notify('人物基线已导入并保留版本历史');
  }

  async function switchProfile(nextProfileId) {
    const next = String(nextProfileId || '').trim();
    if (!next || next === profileId()) return;
    state.profileId = next;
    writePersonaProfileId(next);
    state.loaded = false;
    state.dirty = false;
    state.draftText = '';
    state.versionDiff = null;
    await load();
  }

  async function createProfile(usePreset = false) {
    const next = String($('personaNewProfileId')?.value || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(next)) throw new Error('新 Persona ID 只能使用字母、数字、点、下划线、冒号或短横线');
    const presetId = $('personaPresetSelect')?.value || state.presets[0]?.presetId || '';
    const endpoint = usePreset ? 'initialize-default' : 'initialize';
    await request(`/api/v2/persona/${encodeURIComponent(next)}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({ presetId, reason: usePreset ? 'Create editable persona from preset' : 'Create empty editable persona', source: 'user' })
    });
    state.profileId = next;
    writePersonaProfileId(next);
    state.loaded = false;
    await load();
    notify(usePreset ? '已从可编辑预设创建 Persona' : '已创建空白 Persona');
  }

  async function bindScope(scopeType) {
    const scope = activeScope();
    const scopeId = scopeType === 'contact' ? scope.contactId : scope.conversationId;
    if (!scopeId) throw new Error(scopeType === 'contact' ? '请先选择联系人' : '请先选择会话');
    const select = $(scopeType === 'contact' ? 'personaContactBinding' : 'personaConversationBinding');
    const selectedProfileId = String(select?.value || '').trim();
    const existing = state.bindings.find(row => row.scopeType === scopeType && row.scopeId === scopeId);
    const body = {
      profileId: selectedProfileId,
      expectedBindingVersion: existing?.bindingVersion,
      temporary: scopeType === 'conversation',
      expiresAt: scopeType === 'conversation' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : '',
      styleOverlay: scopeType === 'conversation' ? { intensity: $('personaConversationIntensity')?.value || 'natural' } : {}
    };
    await request(`/api/v2/persona/scopes/${scopeType}/${encodeURIComponent(scopeId)}`, { method: 'PUT', body: JSON.stringify(body) });
    await load();
    notify(scopeType === 'contact' ? '联系人专属人设已立即生效' : '会话级临时人设已立即生效');
  }

  async function clearScope(scopeType) {
    const scope = activeScope();
    const scopeId = scopeType === 'contact' ? scope.contactId : scope.conversationId;
    if (!scopeId) return;
    await request(`/api/v2/persona/scopes/${scopeType}/${encodeURIComponent(scopeId)}`, { method: 'DELETE' });
    await load();
    notify(scopeType === 'contact' ? '联系人覆盖已清除' : '会话临时调整已清除');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'aiwPersonaValidate') validate().catch(error => notify(error.message, 'error'));
    if (button.id === 'aiwPersonaSave') save().catch(error => notify(error.message, 'error'));
    if (button.id === 'aiwPersonaExport') exportJson().catch(error => notify(error.message, 'error'));
    if (button.id === 'aiwPersonaImport') chooseImport();
    if (button.hasAttribute('data-persona-card-preview')) previewCharacterCard().catch(error => notify(error.message, 'error'));
    if (button.hasAttribute('data-persona-card-apply')) { try { applyCharacterCard(); } catch (error) { notify(error.message, 'error'); } }
    if (button.hasAttribute('data-persona-compile-preview')) compileCompositionPreview().catch(error => notify(error.message, 'error'));
    if (button.hasAttribute('data-persona-example-add')) { collectV2Controls(); state.v2.examples.push({ user: '', assistant: '' }); render(); }
    if (button.dataset.personaExampleRemove != null) { collectV2Controls(); state.v2.examples.splice(Number(button.dataset.personaExampleRemove), 1); if (!state.v2.examples.length) state.v2.examples.push({ user: '', assistant: '' }); render(); }
    if (button.hasAttribute('data-persona-create')) createProfile(false).catch(error => notify(error.message, 'error'));
    if (button.hasAttribute('data-persona-load-preset')) createProfile(true).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaBind) bindScope(button.dataset.personaBind).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaClear) clearScope(button.dataset.personaClear).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaInit) initialize(button.dataset.personaInit).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaRollback) rollback(Number(button.dataset.personaRollback)).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaDiff) loadVersionDiff(Number(button.dataset.personaDiff)).catch(error => notify(error.message, 'error'));
    if (button.dataset.personaChange) decideChange(button.dataset.personaChange, button.dataset.decision).catch(error => notify(error.message, 'error'));
  });
  document.addEventListener('input', event => {
    if (event.target?.matches?.('#personaV2PersonaDescription,#personaV2CharacterName,#personaV2CharacterDescription,#personaV2Personality,#personaV2Scenario,#personaV2CharacterNote,[data-persona-example-user],[data-persona-example-assistant],[data-persona-style]')) {
      if (event.target.matches('[data-persona-style]')) event.target.parentElement?.querySelector('output') && (event.target.parentElement.querySelector('output').textContent = event.target.value);
      collectV2Controls();
    }
  });
  document.addEventListener('change', event => {
    if (event.target?.id === 'personaCharacterCardFile') {
      state.v2.characterCardPreview = null;
      state.v2.status = 'idle';
      const applyButton = document.querySelector('[data-persona-card-apply]');
      if (applyButton) applyButton.disabled = true;
      const previewHost = document.querySelector('.persona-card-preview');
      if (previewHost) previewHost.textContent = '文件已更换，请重新预览 Character Card';
    }
    if (event.target?.id === 'personaV2Locale' || event.target?.id === 'personaV2ChatRegister') collectV2Controls();
    if (event.target?.id === 'personaImportFile') importFile(event.target.files?.[0]).catch(error => notify(error.message, 'error'));
    if (event.target?.id === 'personaProfileSelect') switchProfile(event.target.value).catch(error => notify(error.message, 'error'));
  });

  window.addEventListener('yance:r32-active-contact-changed', () => {
    if (!state.dirty) load().catch(error => notify(error.message, 'error'));
  });

  window.yanceDesktop?.onDesktopEvent?.(event => {
    if (!String(event?.type || '').startsWith('persona.')) return;
    window.YanceR32PersonaBrainStatus?.refresh?.();
    const active = document.querySelector('.aiw30-tab[data-aiw-tab="persona"].active');
    if (active && !state.dirty) load().catch(error => notify(error.message, 'error'));
  });

  window.__YancePersonaWorkbench = { render, load, validate, save, version, state };
  if (document.querySelector('.aiw30-tab[data-aiw-tab="persona"].active')) render();
})();
