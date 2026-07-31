'use strict';
(() => {
  if (window.YanceConversationCenterV3) return;
  const $ = id => document.getElementById(id);
  const state = { expanded: false, aiMode: 'daily' };
  const replySource='ai_routed_model';
  try { state.aiMode = localStorage.getItem('yance:r32:conversation-ai-mode:v3') === 'advanced' ? 'advanced' : 'daily'; } catch (_) {}

  function text(node, fallback = '') { return String(node?.textContent || fallback).trim(); }
  function safeButtonClick(selector) {
    const button = document.querySelector(selector);
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  }
  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }
  function trackCandidate(row, signalType, mode) {
    const candidateId = String(row?.candidateId || '').trim();
    const store = window.YanceStoreClient;
    if (!candidateId || !store?.recordCandidateInteraction) return;
    store.recordCandidateInteraction(candidateId, {
      signalType,
      interactionMode: mode,
      finalText: String(row?.foreign || ''),
      interactionId: globalThis.crypto?.randomUUID?.() || `quick-candidate-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }).catch(error => console.warn('[R13 quick candidate learning]', error?.message || error));
  }
  function dispatchInput(rowValue, mode = 'replace') {
    const input = $('composerText');
    if (!input || input.disabled) return;
    const row = rowValue && typeof rowValue === 'object' ? rowValue : { foreign: rowValue, candidateId: '' };
    const next = String(row.foreign || '').trim();
    if (!next) return;
    const current = String(input.value || '').trim();
    const commit = () => {
      input.value = mode === 'append' && current ? `${current}\n${next}` : next;
      if (row.candidateId) input.dataset.aiCandidateId = row.candidateId;
      input.dataset.replySource = replySource;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      trackCandidate(row, mode === 'append' ? 'candidate_appended' : 'candidate_used', `right-ai-${mode}`);
    };
    if (mode === 'append' || !current || current === next) { commit(); return; }
    const dialogs = window.YanceDialogs;
    if (dialogs?.confirm) {
      dialogs.confirm({
        title: '替换当前草稿',
        message: '输入框已有内容。替换只会修改草稿，不会自动发送。',
        submitLabel: '替换',
        cancelLabel: '保留原草稿'
      }).then(ok => { if (ok) commit(); });
      return;
    }
    commit();
  }

  function candidateRows() {
    return [...document.querySelectorAll('#candidateList .candidate')].map((node, index) => ({
      index,
      node,
      title: text(node.querySelector('.candidate-head h4'), `候选 ${index + 1}`),
      foreign: text(node.querySelector('.reply')),
      chinese: text(node.querySelector('.candidate-cn')).replace(/^中文回译[:：]?\s*/, '').replace(/^中文释义[:：]?\s*/, ''),
      route: text(node.querySelector('.candidate-route-line i')),
      candidateId: String(node.dataset.candidateId || '').trim()
    })).filter(row => row.foreign);
  }

  function processPresentation() {
    const source = $('candidateProcessStatus');
    const sourceLabel = source?.querySelector('span');
    const stateName = String(source?.dataset.state || 'idle');
    const label = text(sourceLabel, stateName === 'running' ? '正在生成候选…' : '等待生成候选');
    const sourceAction = $('candidateProcessAction');
    return {
      state: stateName,
      label,
      actionLabel: sourceAction && !sourceAction.hidden ? text(sourceAction, '重试') : (stateName === 'running' ? '取消' : '生成候选'),
      canRun: stateName !== 'running' || Boolean(sourceAction && !sourceAction.hidden),
      run: () => {
        if (sourceAction && !sourceAction.hidden && !sourceAction.disabled) sourceAction.click();
        else if (stateName !== 'running') safeButtonClick('#generateCandidates');
      }
    };
  }

  function syncProcessState(rows = candidateRows()) {
    const host = $('aiCandidateProcess');
    const label = host?.querySelector('span');
    const button = $('aiCandidateProcessAction');
    const current = processPresentation();
    if (!host || !label || !button) return;
    const effectiveState = rows.length ? 'success' : current.state;
    host.dataset.state = effectiveState;
    label.textContent = rows.length ? `已生成 ${rows.length} 条候选，点击“填入”后仍需人工发送` : current.label;
    button.hidden = rows.length > 0 && current.state !== 'error' && current.state !== 'stale';
    button.disabled = !current.canRun;
    button.textContent = current.actionLabel;
    button.onclick = current.run;
  }

  function renderQuickReplies() {
    const host = $('aiDailyCandidates');
    const meta = $('quickReplyMeta');
    const expand = $('quickReplyExpand');
    if (!host) return;
    const rows = candidateRows();
    const limit = state.expanded ? 5 : 3;
    const visible = rows.slice(0, limit);
    if (meta) meta.textContent = rows.length ? `${visible.length}/${rows.length} 条可用` : processPresentation().label;
    const heading = $('aiDailyCandidateHeading');
    if (heading) heading.textContent = '快捷候选';
    document.querySelectorAll('[data-quick-tune]').forEach(button => {
      button.disabled=!rows.length;
      button.setAttribute('aria-disabled', String(!rows.length));
      button.title = rows.length ? '基于第一条候选重新生成' : '需要先生成至少一条真实候选';
    });
    if (expand) {
      expand.hidden = rows.length <= 3;
      expand.textContent = state.expanded ? '收起' : '展开到 5 条';
      expand.setAttribute('aria-expanded', String(state.expanded));
    }
    if (!rows.length) {
      host.innerHTML = '<article class="ai-daily-candidate empty"><b>尚未生成候选</b><p>系统会在理解和导演完成后自动生成。失败时上方会显示具体原因和重试入口。</p></article>';
      syncProcessState(rows);
      return;
    }
    host.innerHTML = visible.map((row, renderIndex) => `
      <article class="ai-daily-candidate" data-right-candidate-index="${renderIndex}">
        <header><b>${escapeHtml(row.title)}</b><span>${escapeHtml(row.route || '云端质量路由')}</span></header>
        <p class="ai-candidate-foreign">${escapeHtml(row.foreign)}</p>
        <p class="ai-candidate-cn">${escapeHtml(row.chinese || '中文释义等待生成')}</p>
        <footer><button type="button" data-right-candidate-action="append">追加</button><button type="button" class="primary" data-right-candidate-action="use">填入</button></footer>
      </article>`).join('');
    host.querySelectorAll('[data-right-candidate-action]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const card = button.closest('[data-right-candidate-index]');
      const row = visible[Number(card?.dataset.rightCandidateIndex || 0)];
      if (row) dispatchInput(row, button.dataset.rightCandidateAction === 'append' ? 'append' : 'replace');
    }));
    host.querySelectorAll('.ai-daily-candidate').forEach(card => card.addEventListener('dblclick', () => {
      const row = visible[Number(card.dataset.rightCandidateIndex || 0)];
      if (row) dispatchInput(row, 'replace');
    }));
    syncProcessState(rows);
  }

  function syncDailyDashboard() {
    const status = $('analysisStatus');
    const statusText = $('aiDailyStatusText');
    const statusPill = $('aiDailyStatusPill');
    if (statusText) statusText.textContent = text(status, '等待选择真实会话');
    if (statusPill) {
      const current = text(status, '等待');
      statusPill.textContent = /完成/.test(current) ? '理解完成' : /失败|未配置|不完整/.test(current) ? '需要处理' : '运行中';
    }
    const intent = $('aiDailyIntent'); if (intent) intent.textContent = text($('analysisIntentText'), '尚未完成真实理解');
    const target = $('aiDailyTarget'); if (target) target.textContent = text($('strategyRecommendationTitle'), '等待真实分析后确定本轮目标');
    const memory = $('aiDailyMemory'); if (memory) memory.textContent = text($('analysisMemoryCount'), '0 条有效记忆');
    const evidence = $('aiDailyEvidence'); if (evidence) evidence.textContent = `${document.querySelectorAll('#analysisEvidence .evidence-row').length} 条证据`;
    renderQuickReplies();
  }

  function applyAiMode(mode) {
    state.aiMode = mode === 'advanced' ? 'advanced' : 'daily';
    const ai = document.querySelector('.ai');
    const dashboard = $('aiDailyDashboard');
    const toggle = $('aiModeToggle');
    ai?.classList.toggle('ai-advanced-mode', state.aiMode === 'advanced');
    if (dashboard) dashboard.hidden = state.aiMode === 'advanced';
    if (toggle) {
      toggle.textContent = state.aiMode === 'advanced' ? '日常模式' : '高级';
      toggle.setAttribute('aria-pressed', String(state.aiMode === 'advanced'));
      toggle.title = state.aiMode === 'advanced' ? '返回简洁的日常AI视图' : '展开理解、导演、候选、Persona与学习';
    }
    try { localStorage.setItem('yance:r32:conversation-ai-mode:v3', state.aiMode); } catch (_) {}
    syncDailyDashboard();
  }

  function bind() {
    $('quickReplyExpand')?.addEventListener('click', () => { state.expanded = !state.expanded; renderQuickReplies(); });
    $('aiModeToggle')?.addEventListener('click', () => applyAiMode(state.aiMode === 'advanced' ? 'daily' : 'advanced'));
    $('aiDailyOpenUnderstanding')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#mainTabs [data-tab="understanding"]'); });
    $('aiDailyRunUnderstanding')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#mainTabs [data-tab="understanding"]'); setTimeout(() => $('goDirector')?.click(), 0); });
    $('aiDailyOpenDirector')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#mainTabs [data-tab="director"]'); });
    $('aiDailyOpenAdvancedDirector')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#mainTabs [data-tab="director"]'); });
    $('aiDailyOpenCandidates')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#mainTabs [data-tab="candidates"]'); });
    $('aiDailyOpenProfile')?.addEventListener('click', () => { applyAiMode('advanced'); safeButtonClick('#utilityTabs [data-tab="notes"]'); });
    document.querySelectorAll('[data-quick-tune]').forEach(button => button.addEventListener('click', () => {
      const label = button.dataset.quickTune;
      const first = document.querySelector('#candidateList .candidate');
      if (!first) return;
      const target = [...first.querySelectorAll('.micro-tune button,.candidate-actions button')].find(node => text(node) === label || text(node).includes(label));
      if (target) target.click();
    }));
  }

  function observe() {
    const candidate = $('candidateList');
    if (candidate) new MutationObserver(() => { renderQuickReplies(); syncDailyDashboard(); }).observe(candidate, { childList: true, subtree: true, characterData: true });
    const process = $('candidateProcessStatus');
    if (process) new MutationObserver(() => renderQuickReplies()).observe(process, { childList: true, subtree: true, characterData: true, attributes: true });
    ['analysisStatus', 'analysisIntentText', 'strategyRecommendationTitle', 'analysisMemoryCount', 'analysisEvidence'].forEach(id => {
      const node = $(id);
      if (node) new MutationObserver(syncDailyDashboard).observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
    });
    window.addEventListener('yance:r32-contact-selected', () => { state.expanded = false; setTimeout(syncDailyDashboard, 0); });
    window.addEventListener('yance:r32-data-ready', syncDailyDashboard);
  }

  function init() {
    bind();
    observe();
    applyAiMode(state.aiMode);
    document.documentElement.dataset.conversationCenter = 'v3';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  window.YanceConversationCenterV3 = Object.freeze({ renderQuickReplies, syncDailyDashboard, applyAiMode, getState: () => ({ ...state }) });
})();
