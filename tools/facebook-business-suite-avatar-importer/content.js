'use strict';

(() => {
  if (window.__YANCE_FACEBOOK_AVATAR_IMPORTER__) return;
  window.__YANCE_FACEBOOK_AVATAR_IMPORTER__ = true;

  const contacts = new Map();
  let previewRows = [];
  let busy = false;
  let panel;
  let statusNode;
  let countNode;
  let importButton;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value == null ? '' : value).replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const normalized = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 24 && rect.height >= 24 && rect.bottom > 110 && rect.top < innerHeight && rect.right > 50 && rect.left < Math.min(620, innerWidth * 0.46) && style.visibility !== 'hidden' && style.display !== 'none';
  }
  function plausibleName(value) {
    const text = clean(value);
    if (text.length < 2 || text.length > 90) return false;
    if (/^(Messenger|Instagram|WhatsApp|Facebook|所有消息|未读|广告回复|后续跟进|今天|昨天|周[一二三四五六日]|星期|online|offline)$/i.test(text)) return false;
    if (/^\d{1,2}:\d{2}$/.test(text) || /^\d+[分小时天周月年前]/.test(text)) return false;
    return /[\p{L}\p{N}]/u.test(text);
  }
  function rowForImage(image) {
    let node = image;
    let fallback = image.parentElement;
    for (let depth = 0; depth < 9 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      const rect = node.getBoundingClientRect();
      if (rect.left < 650 && rect.width >= 220 && rect.width <= 620 && rect.height >= 45 && rect.height <= 180) {
        fallback = node;
        const role = node.getAttribute('role');
        if (role === 'row' || role === 'listitem' || node.tagName === 'A') return node;
      }
    }
    return fallback;
  }
  function nameFrom(image, row) {
    const alt = clean(image.getAttribute('alt') || image.getAttribute('aria-label'));
    if (plausibleName(alt) && !/头像|profile picture|photo/i.test(alt)) return alt;
    const lines = String(row?.innerText || row?.textContent || '').split(/\n+/).map(clean).filter(Boolean);
    return lines.find(plausibleName) || '';
  }
  function threadInfo(row) {
    const anchor = row?.closest?.('a[href]') || row?.querySelector?.('a[href]');
    const href = anchor?.href || location.href;
    let threadId = '';
    try {
      const url = new URL(href, location.href);
      for (const key of ['selected_item_id', 'thread_id', 'conversation_id', 'item_id', 'selectedItemId']) {
        if (url.searchParams.get(key)) { threadId = url.searchParams.get(key); break; }
      }
      if (!threadId) {
        const match = url.pathname.match(/(?:thread|conversation|inbox)[/_-]([A-Za-z0-9_.:-]{6,})/i);
        if (match) threadId = match[1];
      }
    } catch (_) {}
    return { href, threadId: clean(threadId) };
  }
  function scanLoaded() {
    let added = 0;
    for (const image of document.querySelectorAll('img[src]')) {
      if (!visible(image)) continue;
      const src = String(image.currentSrc || image.src || '');
      if (!/^(https:|data:image|blob:)/i.test(src)) continue;
      const row = rowForImage(image);
      const displayName = nameFrom(image, row);
      if (!displayName) continue;
      const { href, threadId } = threadInfo(row);
      const lines = String(row?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
      const snippet = lines.find(line => line !== displayName && plausibleName(line)) || '';
      const key = `${normalized(displayName)}|${src}`;
      if (contacts.has(key)) continue;
      contacts.set(key, { entryId: crypto.randomUUID(), displayName, avatarUrl: src, threadUrl: href, threadId, snippet });
      added += 1;
    }
    updateCounts();
    return added;
  }
  function scrollContainer() {
    const candidates = [];
    for (const element of document.querySelectorAll('div,section,main')) {
      const rect = element.getBoundingClientRect();
      if (rect.left > 650 || rect.width < 240 || rect.width > 650 || rect.height < 300) continue;
      if (element.scrollHeight <= element.clientHeight + 160) continue;
      const overflow = getComputedStyle(element).overflowY;
      if (!/(auto|scroll)/.test(overflow)) continue;
      candidates.push({ element, score: element.scrollHeight - element.clientHeight + (rect.left < 100 ? -500 : 0) });
    }
    return candidates.sort((a, b) => b.score - a.score)[0]?.element || null;
  }
  async function autoScan() {
    if (busy) return;
    busy = true; setStatus('正在扫描当前联系人并自动滚动…');
    try {
      const scroller = scrollContainer();
      if (!scroller) { scanLoaded(); throw new Error('未找到联系人列表滚动区域，请先打开 Meta Business Suite 收件箱'); }
      let stagnant = 0;
      let previousCount = contacts.size;
      for (let step = 0; step < 120; step += 1) {
        scanLoaded();
        if (contacts.size === previousCount) stagnant += 1; else stagnant = 0;
        previousCount = contacts.size;
        const before = scroller.scrollTop;
        scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(260, scroller.clientHeight * 0.82));
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await wait(650);
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 12;
        setStatus(`已发现 ${contacts.size} 个头像，正在继续加载…`);
        if (atBottom && stagnant >= 3) break;
      }
      scanLoaded();
      setStatus(`扫描完成，共发现 ${contacts.size} 个联系人头像，正在匹配言策联系人…`);
      await preview();
    } catch (error) { setStatus(error.message, true); }
    finally { busy = false; }
  }
  async function preview() {
    if (!contacts.size) return setStatus('未发现联系人头像，请确认左侧联系人列表已经加载', true);
    const response = await chrome.runtime.sendMessage({ type: 'YANCE_PREVIEW_CONTACTS', contacts: [...contacts.values()] });
    if (!response?.ok) return setStatus(response?.message || '匹配预览失败', true);
    const byId = new Map((response.results || []).map(row => [row.entryId, row]));
    previewRows = [...contacts.values()].map(row => ({ ...row, ...(byId.get(row.entryId) || { status: 'unmatched' }) }));
    const matchedRows = previewRows.filter(row => row.status === 'matched');
    const matched = matchedRows.length;
    const fresh = matchedRows.filter(row => row.action === 'new').length;
    const changed = matchedRows.filter(row => row.action === 'changed').length;
    const unchanged = matchedRows.filter(row => row.action === 'unchanged').length;
    const messageDiffs = matchedRows.filter(row => row.messagePreviewDiff).length;
    const ambiguous = previewRows.filter(row => row.status === 'ambiguous').length;
    const unmatched = previewRows.filter(row => row.status === 'unmatched').length;
    const actionable = fresh + changed;
    importButton.disabled = actionable === 0;
    importButton.hidden = actionable === 0;
    setStatus(`网页伴侣对账完成：新增头像 ${fresh}，头像变化 ${changed}，无需更新 ${unchanged}，潜在新会话 ${unmatched}，消息摘要差异 ${messageDiffs}。${actionable ? '确认后只导入新增或变化头像。' : '当前头像均已是最新。'}`);
    updateCounts();
  }
  async function inlineImage(contact) {
    const src = String(contact.avatarUrl || '');
    if (!/^(blob:|data:image)/i.test(src)) return '';
    const response = await fetch(src);
    const blob = await response.blob();
    if (blob.size > 4 * 1024 * 1024) throw new Error(`${contact.displayName} 头像超过 4MB`);
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error || new Error('读取头像失败')); reader.readAsDataURL(blob); });
  }
  async function importMatched() {
    if (busy) return;
    const matched = previewRows.filter(row => row.status === 'matched' && row.action !== 'unchanged');
    if (!matched.length) return setStatus('没有可导入的匹配头像', true);
    busy = true; importButton.disabled = true; setStatus(`正在准备 ${matched.length} 个头像…`);
    try {
      const prepared = [];
      for (const row of matched) prepared.push({ ...row, inlineImageBase64: await inlineImage(row) });
      const response = await chrome.runtime.sendMessage({ type: 'YANCE_IMPORT_CONTACTS', contacts: prepared });
      if (!response?.ok) throw new Error(response?.message || '批量导入失败');
      setStatus(`导入完成：成功 ${response.summary.imported}，跳过 ${response.summary.skipped}，失败 ${response.summary.failed}。返回言策即可看到头像。`, response.summary.failed > 0);
      importButton.hidden = true;
    } catch (error) { setStatus(error.message, true); importButton.disabled = false; }
    finally { busy = false; }
  }
  function setStatus(text, error = false) {
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.classList.toggle('error', error);
  }
  function updateCounts() {
    if (countNode) countNode.textContent = `${contacts.size} 个已发现`;
  }
  function createPanel() {
    panel = document.createElement('section');
    panel.id = 'yance-avatar-importer';
    panel.innerHTML = `<header><b>言策网页伴侣</b><span id="yance-avatar-count">0 个已发现</span><button id="yance-avatar-collapse" type="button">−</button></header><main><p id="yance-avatar-status">请先在言策统一账号中心开启网页伴侣窗口。</p><div><button id="yance-avatar-scan" type="button">扫描当前已加载</button><button id="yance-avatar-auto" class="primary" type="button">自动滚动扫描与对账</button><button id="yance-avatar-import" class="primary" type="button" hidden>导入新增或变化头像</button></div><small>读取本页已显示的联系人名称、头像和最近消息摘要，用于头像补全与差异预览；不读取 Cookie、Token 或密码，也不会直接写入消息。</small></main>`;
    document.documentElement.appendChild(panel);
    statusNode = panel.querySelector('#yance-avatar-status');
    countNode = panel.querySelector('#yance-avatar-count');
    importButton = panel.querySelector('#yance-avatar-import');
    panel.querySelector('#yance-avatar-scan').onclick = async () => { scanLoaded(); await preview(); };
    panel.querySelector('#yance-avatar-auto').onclick = autoScan;
    importButton.onclick = importMatched;
    panel.querySelector('#yance-avatar-collapse').onclick = event => { panel.classList.toggle('collapsed'); event.currentTarget.textContent = panel.classList.contains('collapsed') ? '+' : '−'; };
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'YANCE_AVATAR_IMPORT_PROGRESS') return;
    if (message.stage === 'download') setStatus(`正在下载并写入头像 ${message.completed}/${message.total}…`);
    if (message.stage === 'complete') setStatus(`导入完成：成功 ${message.summary.imported}，跳过 ${message.summary.skipped}，失败 ${message.summary.failed}。`, message.summary.failed > 0);
  });
  createPanel();
  chrome.runtime.sendMessage({ type: 'YANCE_GET_STATUS' }).then(response => {
    if (response?.ok && response.session?.active) setStatus(`已连接言策网页伴侣：${response.session.pageName || response.session.accountName}。可开始增量扫描与对账。`);
    else setStatus(response?.message || '请先在言策统一账号中心开启网页伴侣窗口。', true);
  }).catch(error => setStatus(error.message, true));
})();
