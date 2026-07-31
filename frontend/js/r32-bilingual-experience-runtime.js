(() => {
'use strict';

const TRANSLATION_MODEL_TIMEOUT_MS = 180000;
const TRANSLATION_JOB_WAIT_TIMEOUT_MS = 420000;
const { escapeHtmlText: htmlText, escapeHtmlAttribute: htmlAttr } = window.YanceSecurity;

const q = id => document.getElementById(id);
const LANGUAGE_OPTIONS = [
  ['', '自动识别客户语言'],
  ['de', '德语'],
  ['en', '英语'],
  ['fr', '法语'],
  ['es', '西班牙语'],
  ['it', '意大利语'],
  ['pt', '葡萄牙语'],
  ['ru', '俄语'],
  ['tr', '土耳其语'],
  ['ar', '阿拉伯语'],
  ['zh', '中文']
];
let contactToken = 0;
const autoTranslationQueued = new Set();
let autoTranslationTimer = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function notify(message, type = 'success') {
  window.YanceSystemStatus?.show?.(type, message, {
    duration: type === 'error' ? 6200 : type === 'warning' ? 4200 : 2200,
    source: 'bilingual-experience'
  });
}

function currentLanguageScope() {
  const activeId = clean(window.YanceActiveContactStore?.getSnapshot?.().contactId || window.__Y27?.getState?.().activeId);
  const contact = window.YanceActiveContactStore?.getContact?.(activeId) || null;
  return {
    contactId: clean(contact?.contactId || activeId),
    conversationId: clean(contact?.id || contact?.conversationId || activeId),
    platform: clean(contact?.platform),
    sourceAccountId: clean(contact?.accountId || contact?.sourceAccountId),
    platformContactIdentity: clean(contact?.platformContactIdentity || contact?.chatJid || contact?.externalId || contact?.phone),
    canonicalContactId: clean(contact?.canonicalContactId || contact?.contactId)
  };
}

function currentContactId() {
  const scope = currentLanguageScope();
  return scope.contactId || scope.conversationId;
}

function mountControls() {
  const route = document.querySelector('.chat-route');
  if (!route) return false;
  if (!q('chatTranslationMode')) {
    const mode = document.createElement('select');
    mode.id = 'chatTranslationMode';
    mode.className = 'chat-bilingual-select';
    mode.setAttribute('aria-label', '聊天翻译显示模式');
    mode.title = '选择原文、中文或双语显示';
    mode.innerHTML = '<option value="both">双语</option><option value="translation">中文</option><option value="original">原文</option>';
    mode.value = window.YanceConversationCenterV2?.getTranslationMode?.() || 'both';
    mode.onchange = () => window.YanceConversationCenterV2?.setTranslationMode?.(mode.value);
    route.appendChild(mode);
  }
  if (!q('chatLanguageSelect')) {
    const language = document.createElement('select');
    language.id = 'chatLanguageSelect';
    language.className = 'chat-bilingual-select chat-language-select';
    language.setAttribute('aria-label', '当前联系人回复语言');
    language.title = '锁定发给当前客户的语言；中文只用于你理解';
    language.innerHTML = LANGUAGE_OPTIONS.map(([value, label]) => `<option value="${htmlAttr(value)}">${htmlText(label)}</option>`).join('');
    language.onchange = async () => {
      const contactId = currentContactId();
      if (!contactId) return notify('请先选择联系人', 'warning');
      language.disabled = true;
      try {
        const profile = await window.YanceStoreClient?.setContactLanguage?.(contactId, language.value, currentLanguageScope());
        const active = clean(profile?.userOverride || profile?.currentLanguage || profile?.primaryLanguage);
        language.value = clean(profile?.userOverride);
        notify(active ? `已将当前客户回复语言锁定为 ${languageLabel(active)}` : '已恢复自动识别客户语言');
        window.dispatchEvent(new CustomEvent('yance:contact-language-updated', { detail: { contactId, languageProfile: profile } }));
      } catch (error) {
        notify(error.message || '客户语言保存失败', 'error');
        await syncLanguage();
      } finally {
        language.disabled = false;
      }
    };
    route.appendChild(language);
  }
  return true;
}

function languageLabel(code) {
  return LANGUAGE_OPTIONS.find(([value]) => value === clean(code).toLowerCase())?.[1] || clean(code) || '自动识别';
}

async function syncLanguage() {
  mountControls();
  const select = q('chatLanguageSelect');
  const contactId = currentContactId();
  const token = ++contactToken;
  if (!select) return;
  if (!contactId) {
    select.value = '';
    select.disabled = true;
    select.title = '选择联系人后可锁定客户语言';
    return;
  }
  select.disabled = true;
  try {
    const profile = await window.YanceStoreClient?.getContactLanguage?.(contactId, currentLanguageScope());
    if (token !== contactToken || contactId !== currentContactId()) return;
    select.value = clean(profile?.userOverride);
    const active = clean(profile?.userOverride || profile?.currentLanguage || profile?.primaryLanguage);
    select.title = profile?.userOverride
      ? `已人工锁定：${languageLabel(active)}。中文界面不会改变外发语言。`
      : `自动识别：${languageLabel(active)} · 置信度 ${Math.round(Number(profile?.confidence || 0) * 100)}%`;
  } catch (error) {
    select.title = error.message || '客户语言读取失败';
  } finally {
    if (token === contactToken) select.disabled = false;
  }
}

async function waitForTranslationJob(job, button) {
  let current = job;
  const startedAt = Date.now();
  while (current && ['queued', 'running'].includes(current.status)) {
    button.textContent = `${current.status === 'queued' ? '等待中' : '翻译中'} ${Math.round(Number(current.progress || 0))}% · 取消`;
    button.dataset.translationJobId = current.id;
    await new Promise(resolve => setTimeout(resolve, 550));
    if (Date.now() - startedAt > TRANSLATION_JOB_WAIT_TIMEOUT_MS) throw new Error('翻译任务等待超时，可稍后重试');
    current = await window.YanceStoreClient?.getTranslationJob?.(current.id);
  }
  return current;
}

async function retryTranslation(button) {
  const message = button.closest('.msg');
  const messageId = clean(message?.dataset.messageId || message?.dataset.externalMessageId);
  if (!messageId) return notify('无法识别这条消息', 'error');
  const activeJobId = clean(button.dataset.translationJobId);
  if (activeJobId && /取消/.test(button.textContent || '')) {
    try {
      await window.YanceStoreClient?.cancelTranslationJob?.(activeJobId);
      button.dataset.translationJobId = '';
      button.textContent = '重试';
      notify('已取消翻译', 'warning');
    } catch (error) { notify(error.message || '取消翻译失败', 'error'); }
    return;
  }
  button.disabled = false;
  button.textContent = '创建任务…';
  try {
    const job = await window.YanceStoreClient?.createTranslationJob?.(messageId, { force: true, forceNew: true, timeoutMs: TRANSLATION_MODEL_TIMEOUT_MS });
    if (!job?.id) {
      await window.YanceStoreClient?.translateMessage?.(messageId, { force: true, timeoutMs: TRANSLATION_MODEL_TIMEOUT_MS });
      notify('中文翻译已重新生成');
      return;
    }
    const completed = await waitForTranslationJob(job, button);
    if (completed?.status === 'success') notify('中文翻译已重新生成');
    else if (completed?.status === 'cancelled') notify('已取消翻译', 'warning');
    else if (completed?.status === 'skipped') notify('这条消息不需要翻译', 'warning');
    else throw new Error(completed?.error || '中文翻译失败');
  } catch (error) {
    notify(error.message || '中文翻译重试失败', 'error');
  } finally {
    button.dataset.translationJobId = '';
    button.disabled = false;
    button.textContent = '重试';
  }
}

async function queueMissingTranslations(root = document) {
  const allHosts = [...document.querySelectorAll?.('.msg[data-auto-translation-needed="1"]') || []];
  const visibleIds = new Set(allHosts.map(host => clean(host.dataset.messageId || host.dataset.externalMessageId)).filter(Boolean));
  for (const queuedId of [...autoTranslationQueued]) if (!visibleIds.has(queuedId)) autoTranslationQueued.delete(queuedId);
  const hosts = [...root.querySelectorAll?.('.msg[data-auto-translation-needed="1"]') || []].slice(0, 12);
  for (const host of hosts) {
    const messageId = clean(host.dataset.messageId || host.dataset.externalMessageId);
    if (!messageId || autoTranslationQueued.has(messageId)) continue;
    autoTranslationQueued.add(messageId);
    try {
      const job = await window.YanceStoreClient?.createTranslationJob?.(messageId, {
        force: false,
        forceNew: false,
        background: true,
        timeoutMs: TRANSLATION_MODEL_TIMEOUT_MS
      });
      if (!job || !['queued', 'running'].includes(clean(job.status).toLowerCase())) autoTranslationQueued.delete(messageId);
    } catch (error) {
      autoTranslationQueued.delete(messageId);
      const translation = host.querySelector('.translation-auto-needed');
      if (translation) {
        translation.classList.remove('translation-pending');
        translation.classList.add('translation-failed');
        translation.textContent = error.message || '中文翻译任务创建失败';
        hydrateTranslationFailures(host);
      }
    }
  }
}
function scheduleMissingTranslations(root = document) {
  clearTimeout(autoTranslationTimer);
  autoTranslationTimer = setTimeout(() => queueMissingTranslations(root), 120);
}

function hydrateTranslationFailures(root = document) {
  root.querySelectorAll?.('.translation-failed').forEach(host => {
    if (host.querySelector('[data-retry-translation]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.retryTranslation = '1';
    button.textContent = '重试';
    button.onclick = () => retryTranslation(button);
    host.append(' · ', button);
  });
}

function syncMode() {
  const select = q('chatTranslationMode');
  if (select) select.value = window.YanceConversationCenterV2?.getTranslationMode?.() || 'both';
}

function install() {
  mountControls();
  syncMode();
  syncLanguage();
  hydrateTranslationFailures();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) { hydrateTranslationFailures(node); scheduleMissingTranslations(node); }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.YanceActiveContactStore?.subscribe?.(() => { autoTranslationQueued.clear(); syncLanguage(); scheduleMissingTranslations(document); }, { fireImmediately: false });
  window.addEventListener('yance:conversation-layout-changed', syncMode);
  window.addEventListener('yance:contact-language-updated', syncLanguage);
  window.addEventListener('message:translation-updated', event => {
    const messageId=clean(event.detail?.messageId||event.detail?.id);if(messageId)autoTranslationQueued.delete(messageId);
    hydrateTranslationFailures();
  });
  window.addEventListener('yance:r32-messages-rendered', () => scheduleMissingTranslations(document));
  scheduleMissingTranslations(document);
}

window.YanceBilingualExperience = Object.freeze({ install, syncLanguage, retryTranslation, hydrateTranslationFailures, queueMissingTranslations });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
})();
