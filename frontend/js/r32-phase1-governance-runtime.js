(() => {
  'use strict';

  const client = window.YanceStoreClient;
  const security = window.YanceSecurity;
  if (!security?.escapeHtmlText || !security?.escapeHtmlAttribute) throw new Error('YANCE_SECURITY_AUTHORITY_UNAVAILABLE');
  const htmlText = security.escapeHtmlText;
  const htmlAttr = security.escapeHtmlAttribute;
  const state = {
    contactId: '',
    governance: null,
    governanceLoading: false,
    personaFingerprint: '',
    personaTranslation: null,
    personaLoading: false,
    searchTimer: null,
    searchRequest: 0
  };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function activeSnapshot() { return window.YanceActiveContactStore?.getSnapshot?.() || {}; }
  function activeContactId() { return clean(activeSnapshot().contactId || window.__Y27?.getState?.().activeId); }
  function notify(message, type = 'success') {
    window.YanceSystemStatus?.show?.(type, message, {
      duration: type === 'error' ? 6200 : type === 'warning' ? 4200 : 2200,
      source: 'phase1-governance'
    });
  }
  function percent(value) { return `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`; }
  function dateLabel(value) {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? clean(value) || '—' : date.toLocaleString('zh-CN', { hour12: false });
  }
  function scopeLabel(scope) { return ({ contact: '当前联系人', platform: '当前平台', global: '全局风格' })[scope] || scope; }
  function reasonLabel(reason) {
    const value = clean(reason);
    if (!value) return '学习更新';
    if (value.startsWith('restore:')) return '版本恢复';
    if (value.startsWith('preference:disable')) return '停用偏好';
    if (value.startsWith('preference:enable')) return '启用偏好';
    if (value.startsWith('preference:delete')) return '删除偏好';
    if (value.startsWith('feedback:')) return '行为反馈学习';
    return value;
  }

  function governanceHost() {
    const panel = document.getElementById('aiwLearningPanel');
    if (!panel) return null;
    let host = document.getElementById('phase1LearningGovernance');
    if (!host) {
      host = document.createElement('section');
      host.id = 'phase1LearningGovernance';
      host.className = 'phase1-governance';
      panel.prepend(host);
    }
    return host;
  }

  function renderGovernance() {
    const host = governanceHost();
    if (!host) return;
    const contactId = activeContactId();
    if (!contactId) {
      host.innerHTML = '<div class="phase1-empty"><b>选择联系人后查看真实学习闭环</b><p>这里读取数据库中的联系人、平台与全局三层学习，不读取界面占位开关。</p></div>';
      return;
    }
    if (state.governanceLoading) {
      host.innerHTML = '<div class="phase1-loading"><i></i><span>正在读取真实学习版本、偏好与发送反馈…</span></div>';
      return;
    }
    const data = state.governance;
    if (!data || state.contactId !== contactId) {
      host.innerHTML = '<div class="phase1-empty"><b>尚未加载学习治理数据</b><button type="button" data-governance-refresh>立即加载</button></div>';
      return;
    }
    const effectiveCount = Number(data.truth?.effectivePreferenceCount || 0);
    const layers = ['contact', 'platform', 'global'].map(scope => data.layers?.[scope] || { scope, preferences: [] });
    host.innerHTML = `
      <header class="phase1-governance-head">
        <div><small>真实 AI 学习治理</small><h3>${htmlText(data.contactName || contactId)}</h3><p>实际生效顺序：全局 → ${htmlText(data.platform || '平台')} → 当前联系人；后层覆盖前层。</p></div>
        <div class="phase1-truth"><b>${htmlText(effectiveCount)}</b><span>条真实生效偏好</span><button type="button" data-governance-refresh>刷新</button><button type="button" class="danger" data-learning-forget>永久忘记</button></div>
      </header>
      <div class="phase1-layer-grid">
        ${layers.map(layer => renderLayer(layer, data.versions?.[layer.scope] || [])).join('')}
      </div>
      ${renderLearningQuality(data.quality || {})}
      ${renderLearningLifecycle(data.lifecycleEvents || [])}
      ${renderLearningEvents(data.events || [])}`;
    bindGovernanceActions(host);
  }

  function renderLayer(layer, versions) {
    const rows = Array.isArray(layer.preferences) ? layer.preferences : [];
    return `<article class="phase1-layer" data-learning-scope="${htmlAttr(layer.scope)}">
      <header><div><b>${htmlText(scopeLabel(layer.scope))}</b><span>${htmlText(layer.id || '未建立')}</span></div><em>v${htmlText(layer.version || 0)}</em></header>
      <div class="phase1-layer-stats"><span>启用 ${htmlText(layer.activeCount || 0)}</span><span>停用 ${htmlText(layer.disabledCount || 0)}</span><span>证据 ${htmlText(layer.evidenceCount || 0)}</span></div>
      <div class="phase1-preferences">
        ${rows.length ? rows.map(row => `<div class="phase1-preference ${htmlAttr(row.disabled ? 'disabled' : '')}">
          <div><b>${htmlText(row.key)}</b><p>${htmlText(row.value)}</p><small>置信度 ${htmlText(percent(row.confidence))} · 证据 ${htmlText(row.evidenceCount || 0)} · ${htmlText(dateLabel(row.updatedAt))}</small></div>
          <div class="phase1-preference-actions">
            <button type="button" data-learning-action="${htmlAttr(row.disabled ? 'enable' : 'disable')}" data-learning-key="${htmlAttr(row.key)}" data-learning-scope="${htmlAttr(layer.scope)}">${row.disabled ? '启用' : '停用'}</button>
            <button type="button" class="danger" data-learning-action="delete" data-learning-key="${htmlAttr(row.key)}" data-learning-scope="${htmlAttr(layer.scope)}">删除</button>
          </div>
        </div>`).join('') : '<div class="phase1-empty compact"><b>暂无已审核偏好</b><p>只有真实发送与人工反馈形成稳定证据后才会出现。</p></div>'}
      </div>
      <details class="phase1-versions"><summary>版本历史（${htmlText(versions.length)}）</summary>
        <div>${versions.slice(0, 12).map(row => `<div><span><b>v${htmlText(row.version)}</b> ${htmlText(reasonLabel(row.reason))}<small>${htmlText(dateLabel(row.createdAt))}</small></span><button type="button" data-learning-restore="${htmlAttr(row.version)}" data-learning-scope="${htmlAttr(layer.scope)}" ${Number(row.version) === Number(layer.version) ? 'disabled' : ''}>恢复</button></div>`).join('') || '<p>暂无历史版本</p>'}</div>
      </details>
    </article>`;
  }

  function renderLearningQuality(quality = {}) {
    const statusLabel = ({ healthy: '健康', watch: '需关注', insufficient: '证据不足' })[quality.status] || '尚未评估';
    const metrics = [
      ['候选接受率', quality.acceptanceRate, `${quality.sentCount || 0}/${quality.decisionCount || 0}`],
      ['平均编辑距离', quality.averageEditDistance, `${quality.editedCount || 0} 次编辑`],
      ['语言错误率', quality.languageErrorRate, `${quality.languageMismatchCount || 0}/${quality.languageCheckedCount || 0}`],
      ['风险事件率', quality.riskRate, `${quality.riskEventCount || 0}/${quality.sampleSize || 0}`],
      ['学习命中率', quality.learningHitRate, `${quality.learningHitCount || 0}/${quality.learningEligibleCount || 0}`]
    ];
    return `<section class="phase2-learning-quality ${htmlAttr(quality.status || 'unknown')}"><header><div><small>AI 学习质量</small><h3>${htmlText(statusLabel)}</h3><p>基于真实发送、拒绝、编辑、语言和学习命中记录，不读取占位开关。</p></div><em>${htmlText(quality.sampleSize || 0)} 个样本</em></header><div class="phase2-quality-grid">${metrics.map(([label,value,detail])=>`<article><span>${htmlText(label)}</span><b>${htmlText(percent(value || 0))}</b><small>${htmlText(detail)}</small></article>`).join('')}</div>${quality.sufficientEvidence===false?'<p class="phase2-quality-note">至少需要 3 次真实发送或拒绝，才能判断学习质量是否稳定。</p>':''}${Array.isArray(quality.byModel)&&quality.byModel.length?`<details><summary>按模型查看</summary><div class="phase2-quality-models">${quality.byModel.slice(0,8).map(row=>`<div><b>${htmlText(row.model)}</b><span>发送 ${htmlText(row.sent)} · 拒绝 ${htmlText(row.rejected)} · 编辑距离 ${htmlText(percent(row.averageEditDistance||0))}</span></div>`).join('')}</div></details>`:''}</section>`;
  }

  function renderLearningEvents(events) {
    const rows = Array.isArray(events) ? events.slice(0, 12) : [];
    return `<details class="phase1-learning-events"><summary>最近学习事件与双语证据：实际进入学习的正负样本（${htmlText(rows.length)}）</summary>
      <div>${rows.map(row => `<article>
        <header><b>${htmlText(row.eventType || row.type || '学习事件')}</b><span>${htmlText(dateLabel(row.observedAt || row.createdAt))}</span></header>
        ${clean(row.finalText || row.sentText || row.text) ? `<p lang="${htmlAttr(row.targetLanguage || '')}">${htmlText(row.finalText || row.sentText || row.text)}</p>` : ''}
        ${clean(row.translatedZh) ? `<p class="zh">中文：${htmlText(row.translatedZh)}</p>` : ''}
        <small>${[row.platform, row.modelId || row.model, row.replyTask, row.styleVariant].map(clean).filter(Boolean).map(htmlText).join(' · ') || '等待真实发送与模型元数据'}</small>
      </article>`).join('') || '<div class="phase1-empty compact"><b>暂无实际学习样本</b><p>只有带原因的拒绝，或启用学习且真实发送成功的回复才会进入这里。</p></div>'}</div>
    </details>`;
  }

  function renderLearningLifecycle(events) {
    const rows = Array.isArray(events) ? events.slice(0, 24) : [];
    const stageLabel = { generated:'生成', accepted:'接受', edited:'编辑', rejected:'拒绝', send_confirmed:'确认发送', queued:'发送队列', sent:'发送成功', failed:'发送失败' };
    return `<details class="phase1-learning-events" open><summary>候选到发送的真实生命周期（${htmlText(rows.length)}）</summary><div>${rows.map(row => `<article class="${htmlAttr(row.statusTruth || '')}"><header><b>${htmlText(stageLabel[row.stage] || row.statusLabel || row.stage)}</b><span>${htmlText(dateLabel(row.occurredAt))}</span></header>${clean(row.finalText || row.originalText) ? `<p>${htmlText(row.finalText || row.originalText)}</p>` : ''}${clean(row.rejectionReason) ? `<p class="zh">拒绝原因：${htmlText(row.rejectionReason)}</p>` : ''}${clean(row.error) ? `<p class="zh">失败原因：${htmlText(row.error)}</p>` : ''}<small>${[row.platform, row.sourceAccountId, row.conversationId].map(clean).filter(Boolean).map(htmlText).join(' · ')} · ${row.learningEligible ? (row.learningApplied ? '已进入学习' : '符合学习条件但尚未写入') : '未进入学习'}</small></article>`).join('') || '<div class="phase1-empty compact"><b>暂无候选生命周期记录</b><p>生成、接受、编辑、拒绝、发送确认、成功或失败会分别如实显示。</p></div>'}</div></details>`;
  }

  function bindGovernanceActions(host) {
    host.querySelectorAll('[data-governance-refresh]').forEach(button => button.onclick = () => loadGovernance(true));
    host.querySelectorAll('[data-learning-forget]').forEach(button => button.onclick = async () => {
      const confirmed = await window.YanceDialogs?.confirm?.({
        title: '永久忘记该联系人的回复学习',
        message: '这会删除联系人学习事件、当前画像、历史版本，以及平台/全局学习中的该联系人证据。此操作不可恢复。',
        danger: true,
        submitLabel: '永久忘记'
      });
      if (!confirmed) return;
      button.disabled = true;
      try {
        state.governance = await client.forgetReplyLearning(activeContactId(), { confirmForget: true, actor: 'user' });
        notify('该联系人的回复学习与跨范围证据已永久删除');
        renderGovernance();
      } catch (error) { notify(error.message || '永久忘记学习失败', 'error'); }
      finally { button.disabled = false; }
    });
    host.querySelectorAll('[data-learning-action]').forEach(button => button.onclick = async () => {
      const action = button.dataset.learningAction;
      const key = button.dataset.learningKey;
      const scope = button.dataset.learningScope;
      if (action === 'delete' && !await window.YanceDialogs.confirm({ title: '删除学习偏好', message: `确认删除“${key}”这条${scopeLabel(scope)}学习吗？此操作会创建可恢复的新版本。`, danger: true, submitLabel: '删除' })) return;
      button.disabled = true;
      try {
        state.governance = await client.updateLearningPreference(activeContactId(), scope, key, action, { actor: 'user' });
        notify(action === 'delete' ? '学习偏好已删除，可从版本历史恢复' : action === 'disable' ? '学习偏好已停用' : '学习偏好已启用');
        renderGovernance();
      } catch (error) { notify(error.message || '学习偏好更新失败', 'error'); }
      finally { button.disabled = false; }
    });
    host.querySelectorAll('[data-learning-restore]').forEach(button => button.onclick = async () => {
      const version = Number(button.dataset.learningRestore || 0);
      const scope = button.dataset.learningScope;
      if (!await window.YanceDialogs.confirm({ title: '恢复学习版本', message: `确认将${scopeLabel(scope)}学习恢复到 v${version}？当前状态会先保留为历史版本。`, submitLabel: '恢复版本' })) return;
      button.disabled = true;
      try {
        state.governance = await client.restoreLearningScope(activeContactId(), scope, version, { actor: 'user' });
        notify(`已恢复到 v${version}`);
        renderGovernance();
      } catch (error) { notify(error.message || '学习版本恢复失败', 'error'); }
      finally { button.disabled = false; }
    });
  }

  async function loadGovernance(force = false) {
    const contactId = activeContactId();
    if (!contactId || !client?.getLearningGovernance) return renderGovernance();
    if (!force && state.contactId === contactId && state.governance) return renderGovernance();
    state.contactId = contactId;
    state.governanceLoading = true;
    renderGovernance();
    try { state.governance = await client.getLearningGovernance(contactId, { eventLimit: 80, versionLimit: 24 }); }
    catch (error) { state.governance = null; notify(error.message || '学习治理读取失败', 'error'); }
    finally { state.governanceLoading = false; renderGovernance(); }
  }

  function personaHost() {
    const panel = document.getElementById('aiwPersonaPanel');
    if (!panel) return null;
    let host = document.getElementById('phase1PersonaChineseLayer');
    if (!host) {
      host = document.createElement('section');
      host.id = 'phase1PersonaChineseLayer';
      host.className = 'phase1-persona-zh';
      panel.prepend(host);
    }
    return host;
  }

  function personaPayload() {
    const workbench = window.__YancePersonaWorkbench;
    const content = workbench?.state?.current?.version?.content?.authoritative || null;
    return content && typeof content === 'object' ? content : null;
  }

  function renderPersonaChinese() {
    const host = personaHost();
    if (!host) return;
    const source = personaPayload();
    if (!source) {
      host.innerHTML = '<div class="phase1-empty"><b>Persona 中文理解层等待加载</b><p>加载 Persona 后，这里会显示中文理解并保留权威原始 JSON。</p></div>';
      return;
    }
    if (state.personaLoading) {
      host.innerHTML = '<div class="phase1-loading"><i></i><span>正在把 Persona 中的外语说明转换为中文理解…</span></div>';
      return;
    }
    const result = state.personaTranslation;
    const receipt = result?.translationReceipt || {};
    const degraded = result && result.translationStatus !== 'success';
    const attempts = Array.isArray(receipt.attempts) ? receipt.attempts : [];
    host.innerHTML = `<header><div><small>Persona 中文理解层</small><h3>给你看的中文，不改变权威原文和真实发送语言</h3></div><button type="button" data-persona-translate>${result?.translationStatus === 'success' ? '重新生成中文' : '生成中文理解'}</button></header>
      ${degraded ? `<div class="phase1-error"><b>${htmlText(result.translationErrorCode || 'PERSONA_CHINESE_UNDERSTANDING_DEGRADED')}</b><p>${htmlText(result.translationError || '中文理解暂不可用')}</p><p>权威原文保持不变；失败结果不会覆盖 Persona 原始内容，也不会直接进入真实发送或学习。</p></div>` : ''}
      ${result?.translated?.profile ? `<details open><summary>中文 Persona</summary><pre>${htmlText(JSON.stringify(result.translated.profile, null, 2))}</pre></details>` : '<p>当前显示权威原文。中文理解只用于你阅读；模型失败时保持原文，不生成伪成功结果。</p>'}
      <details><summary>权威原文</summary><pre>${htmlText(JSON.stringify(source, null, 2))}</pre></details>
      ${Object.keys(receipt).length ? `<details><summary>翻译执行回执</summary><div class="phase1-receipt"><p>状态：${htmlText(receipt.status || result?.translationStatus || '')} · 原因：${htmlText(receipt.reasonCode || '')}</p><p>模型：${htmlText(receipt.selectedModel || receipt.selectedModelId || result?.translationModel || '未选出')} · 主备回退：${receipt.fallbackUsed ? '是' : '否'} · 同模型结构修复：${receipt.schemaRepairUsed ? '是' : '否'}</p><p>结构完整性：${receipt.structureIntegrity?.pass ? '通过' : '未通过'} · 回执：${htmlText(String(receipt.receiptSha256 || '').slice(0, 16))}</p>${attempts.length ? `<pre>${htmlText(JSON.stringify(attempts, null, 2))}</pre>` : ''}</div></details>` : ''}
      <footer>${htmlText(result?.translationModel ? `翻译模型：${result.translationModel} · ${dateLabel(result.translatedAt)}` : '尚未形成合格翻译回执')}</footer>`;
    host.querySelector('[data-persona-translate]')?.addEventListener('click', () => translatePersona(true));
  }

  async function translatePersona(force = false) {
    const source = personaPayload();
    if (!source || !client?.translateStructured) return renderPersonaChinese();
    const fingerprint = JSON.stringify(source);
    if (!force && fingerprint === state.personaFingerprint && state.personaTranslation) return renderPersonaChinese();
    state.personaFingerprint = fingerprint;
    state.personaLoading = true;
    renderPersonaChinese();
    try {
      state.personaTranslation = await client.translateStructured({
        contactId: activeContactId(),
        profile: source,
        fingerprint,
        dedupeKey: `persona-zh:${window.__YancePersonaWorkbench?.state?.profileId || 'owner'}:${window.__YancePersonaWorkbench?.version?.() || 0}`
      });
    } catch (error) {
      state.personaTranslation = {
        translationStatus: 'failed',
        translationErrorCode: error.code || 'PERSONA_TRANSLATION_TRANSPORT_FAILED',
        translationError: error.message || 'Persona 中文转换失败',
        translated: {},
        originalPreserved: true,
        safeForDisplayOnly: true,
        translationReceipt: {
          authority: 'YanceStructuredChineseUnderstandingAuthority',
          status: 'failed',
          reasonCode: error.code || 'PERSONA_TRANSLATION_TRANSPORT_FAILED',
          attempts: [],
          structureIntegrity: { pass: false, errors: [] }
        }
      };
    } finally { state.personaLoading = false; renderPersonaChinese(); }
  }

  function ensureSearchDialog() {
    let dialog = document.getElementById('phase1GlobalSearchDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'phase1GlobalSearchDialog';
    dialog.className = 'phase1-search-dialog';
    dialog.innerHTML = `<header><div><small>双语全文搜索</small><h2>联系人、原文、中文译文、标签与事实</h2></div><button type="button" data-search-close>关闭</button></header>
      <section><input type="search" data-global-search-input placeholder="输入姓名、号码、德语/英语原文或中文含义" autocomplete="off"><div class="phase1-search-summary" data-search-summary>输入关键词开始搜索</div><div class="phase1-search-results" data-search-results></div></section>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-search-close]').onclick = () => dialog.close();
    const input = dialog.querySelector('[data-global-search-input]');
    input.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => runSearch(input.value, dialog), 180);
    });
    dialog.addEventListener('close', () => { input.value = ''; dialog.querySelector('[data-search-results]').innerHTML = ''; });
    return dialog;
  }

  async function runSearch(query, dialog = ensureSearchDialog()) {
    const value = clean(query);
    const results = dialog.querySelector('[data-search-results]');
    const summary = dialog.querySelector('[data-search-summary]');
    const request = ++state.searchRequest;
    if (!value) { summary.textContent = '输入关键词开始搜索'; results.innerHTML = ''; return; }
    summary.textContent = '正在同时搜索原文与中文译文…';
    try {
      const payload = await client.searchWorkspace(value, { limit: 100 });
      if (request !== state.searchRequest) return;
      const contacts = payload.contacts || [];
      const messages = payload.messages || [];
      summary.textContent = `找到 ${contacts.length} 个联系人、${messages.length} 条双语消息`;
      results.innerHTML = `${contacts.length ? `<h3>联系人</h3>${contacts.map(row => `<button type="button" class="phase1-search-row" data-search-contact="${htmlAttr(row.conversationId || row.contactId || row.id)}"><b>${htmlText(row.name || row.phone || '未命名联系人')}</b><span>${htmlText([row.platform, row.phone].filter(Boolean).join(' · '))}</span></button>`).join('')}` : ''}
        ${messages.length ? `<h3>消息</h3>${messages.map(row => `<button type="button" class="phase1-search-row message" data-search-conversation="${htmlAttr(row.conversationId)}" data-search-message="${htmlAttr(row.messageId)}"><b>${htmlText(row.contactName || row.platform || '会话消息')}</b><p>${htmlText(row.text || '[媒体消息]')}</p>${row.translatedZh ? `<p class="zh">中文：${htmlText(row.translatedZh)}</p>` : ''}<span>${htmlText([row.platform, row.sourceLanguage, dateLabel(row.sentAt)].filter(Boolean).join(' · '))}</span></button>`).join('')}` : ''}
        ${!contacts.length && !messages.length ? '<div class="phase1-empty"><b>没有找到结果</b><p>可尝试姓名、号码、原文关键词或中文译文。</p></div>' : ''}`;
      results.querySelectorAll('[data-search-contact]').forEach(button => button.onclick = () => openSearchResult(button.dataset.searchContact, '', dialog));
      results.querySelectorAll('[data-search-conversation]').forEach(button => button.onclick = () => openSearchResult(button.dataset.searchConversation, button.dataset.searchMessage, dialog));
    } catch (error) {
      if (request !== state.searchRequest) return;
      summary.textContent = '搜索失败';
      results.innerHTML = `<div class="phase1-error">${htmlText(error.message || '双语搜索失败')}</div>`;
    }
  }

  async function openSearchResult(conversationId, messageId, dialog) {
    dialog.close();
    const id = clean(conversationId);
    if (!id) return;
    try {
      if (typeof window.__Y27?.openConversationPage === 'function') await window.__Y27.openConversationPage(id);
      else window.dispatchEvent(new CustomEvent('yance:open-conversation', { detail: { conversationId: id } }));
      if (!messageId) return;
      await new Promise(resolve => setTimeout(resolve, 320));
      const selector = `.msg[data-message-id="${CSS.escape(messageId)}"],.msg[data-external-message-id="${CSS.escape(messageId)}"]`;
      const target = document.querySelector(selector);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        target.classList.add('phase1-search-hit');
        setTimeout(() => target.classList.remove('phase1-search-hit'), 2200);
      } else notify('已打开会话；目标消息不在当前已加载历史中', 'warning');
    } catch (error) { notify(error.message || '无法定位搜索结果', 'error'); }
  }

  function openSearch() {
    const dialog = ensureSearchDialog();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector('[data-global-search-input]')?.focus());
  }

  function installSearchAuthority() {
    const bind = element => {
      if (!element || element.dataset.phase1SearchBound === '1') return;
      element.dataset.phase1SearchBound = '1';
      element.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); openSearch(); }, true);
    };
    bind(document.getElementById('navSearch'));
    bind(document.getElementById('titleGlobalSearch'));
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    }, true);
  }

  function refreshVisiblePanels() {
    governanceHost();
    personaHost();
    const learningActive = document.querySelector('.aiw30-tab[data-aiw-tab="learning"].active');
    const personaActive = document.querySelector('.aiw30-tab[data-aiw-tab="persona"].active');
    if (learningActive) loadGovernance(); else renderGovernance();
    if (personaActive) { renderPersonaChinese(); translatePersona(false); } else renderPersonaChinese();
  }

  function install() {
    installSearchAuthority();
    refreshVisiblePanels();
    window.YanceActiveContactStore?.subscribe?.(() => {
      state.contactId = '';
      state.governance = null;
      loadGovernance(true);
      renderPersonaChinese();
    }, { fireImmediately: false });
    document.addEventListener('click', event => {
      const tab = event.target.closest('.aiw30-tab');
      if (tab) requestAnimationFrame(refreshVisiblePanels);
    });
    window.yanceDesktop?.onDesktopEvent?.(event => {
      if (/^ai\.replyFeedback\./.test(clean(event?.type))) loadGovernance(true);
      if (/^persona\./.test(clean(event?.type))) setTimeout(() => { state.personaFingerprint = ''; translatePersona(false); }, 100);
    });
    const observer = new MutationObserver(() => {
      if (!document.getElementById('phase1LearningGovernance') || !document.getElementById('phase1PersonaChineseLayer')) refreshVisiblePanels();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.YancePhase1Governance = Object.freeze({ install, loadGovernance, openSearch, translatePersona });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
