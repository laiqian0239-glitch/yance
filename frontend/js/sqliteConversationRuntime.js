(() => {
  'use strict';

  const { setUrlAttribute } = window.YanceSecurity;

  let initialized = false;

  const AVATAR_FIELDS = Object.freeze([
    'customAvatar',
    'avatar',
    'avatar_url',
    'photo_url',
    'avatarUrl',
    'photoUrl',
    'avatarRemoteUrl',
    'avatar_remote_url'
  ]);

  const AVATAR_GRADIENTS = Object.freeze([
    'linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))',
    'linear-gradient(135deg,var(--accent-secondary),var(--accent-tertiary))',
    'linear-gradient(135deg,var(--status-success),var(--accent-primary))',
    'linear-gradient(135deg,var(--status-warning),var(--accent-tertiary))',
    'linear-gradient(135deg,var(--accent-tertiary),var(--accent-secondary))',
    'linear-gradient(135deg,var(--status-danger),var(--status-warning))',
    'linear-gradient(135deg,var(--accent-primary),var(--status-info))',
    'linear-gradient(135deg,var(--accent-tertiary),var(--status-danger))'
  ]);

  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function avatarVersion(record = {}) {
    return clean(record.avatarUpdatedAt || record.avatar_updated_at || record.payload?.avatarUpdatedAt || record.payload?.avatar_updated_at);
  }

  function safeLocalAvatarUrl(value, record = {}, field = '') {
    const raw = clean(value);
    if (!raw) return '';
    if (field === 'customAvatar' && (/^data:image\/(?:png|jpeg|webp|gif);/i.test(raw) || raw.startsWith('blob:'))) return raw;
    let parsed;
    try { parsed = new URL(raw, window.location.origin); } catch (_) { return ''; }
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/r32/messages/media/')) return '';
    const version = avatarVersion(record);
    if (version) parsed.searchParams.set('v', version);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function resolveAvatarUrl(record = {}) {
    for (const field of AVATAR_FIELDS) {
      const value = safeLocalAvatarUrl(record?.[field], record, field);
      if (value) return value;
    }

    const payloads = [record?.payload, record?.contact, record?.profile];
    for (const payload of payloads) {
      if (!payload || payload === record) continue;
      for (const field of AVATAR_FIELDS) {
        const value = safeLocalAvatarUrl(payload?.[field], { ...record, ...payload }, field);
        if (value) return value;
      }
    }

    return '';
  }

  function resolveDisplayName(record = {}) {
    for (const field of [
      'title', 'displayName', 'display_name', 'contactName', 'contact_name',
      'ownerSavedName', 'owner_saved_name', 'savedName', 'saved_name',
      'whatsappName', 'whatsapp_name', 'pushName', 'push_name', 'name'
    ]) {
      const value = clean(record?.[field]);
      if (value) return value;
    }
    return '联系人';
  }

  function initials(name) {
    const value = clean(name) || '?';
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      return parts.slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase();
    }
    const characters = Array.from(value);
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)) {
      return characters[0] || '?';
    }
    return characters.slice(0, 2).join('').toUpperCase() || '?';
  }

  function avatarGradient(name) {
    let hash = 0;
    for (const character of Array.from(clean(name) || '?')) {
      hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    }
    return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
  }

  function applyHostBaseStyle(host) {
    Object.assign(host.style, {
      alignItems: 'center',
      borderRadius: '50%',
      display: 'inline-flex',
      flex: '0 0 auto',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative'
    });
  }

  function clearAvatarVisual(host) {
    for (const node of [...host.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.avatarDecoration === 'true') continue;
      node.remove();
    }
  }

  function renderFallback(host, recordOrName, state = 'unavailable') {
    if (!host) return null;
    const name = typeof recordOrName === 'string'
      ? clean(recordOrName) || '联系人'
      : resolveDisplayName(recordOrName || {});

    clearAvatarVisual(host);
    const fallback = document.createElement('span');
    fallback.dataset.avatarFallbackContent = 'true';
    fallback.textContent = initials(name);
    Object.assign(fallback.style, {
      alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', width: '100%'
    });
    host.prepend(fallback);
    host.dataset.avatarState = state;
    host.dataset.avatarFallback = 'true';
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', `${name}头像`);
    host.title = name;

    applyHostBaseStyle(host);
    Object.assign(host.style, {
      background: avatarGradient(name),
      color: 'var(--avatar-text)',
      fontWeight: '750',
      letterSpacing: '.02em',
      lineHeight: '1',
      textAlign: 'center',
      userSelect: 'none'
    });
    return host;
  }

  function reportAvatarFailure(record = {}) {
    const accountId = clean(record.accountId || record.account_id);
    const conversationId = clean(record.conversationId || record.sessionKey || record.session_key || record.id);
    if (!accountId || !conversationId || record.__avatarFailureReported === true) return;
    record.__avatarFailureReported = true;
    fetch(`/api/r32/accounts/${encodeURIComponent(accountId)}/avatar-load-failure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, errorCode: 'frontend-load-failed' })
    }).catch(() => {});
  }

  function bindImageFallback(image, recordOrName = {}) {
    if (!image) return image;
    const host = image.parentElement;
    if (!host) return image;
    const name = typeof recordOrName === 'string'
      ? clean(recordOrName) || clean(image.alt).replace(/头像$/u, '') || '联系人'
      : resolveDisplayName(recordOrName || {}) || clean(image.alt).replace(/头像$/u, '') || '联系人';

    let fallbackApplied = false;
    image.onerror = () => {
      if (fallbackApplied || !image.isConnected) return;
      fallbackApplied = true;
      image.style.display = 'none';
      image.removeAttribute('src');
      renderFallback(host, name, 'frontend_load_failed');
      if (recordOrName && typeof recordOrName === 'object') reportAvatarFailure(recordOrName);
    };
    return image;
  }

  function mountAvatar(host, record = {}) {
    if (!host) return null;
    const name = resolveDisplayName(record);
    const avatarUrl = resolveAvatarUrl(record);

    clearAvatarVisual(host);
    host.dataset.avatarState = avatarUrl ? 'loading' : 'unavailable';
    host.dataset.avatarFallback = 'false';
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', `${name}头像`);
    host.title = name;
    applyHostBaseStyle(host);

    if (!avatarUrl) return renderFallback(host, name, 'unavailable');

    const image = document.createElement('img');
    image.alt = `${name}头像`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.avatarImage = 'true';
    Object.assign(image.style, {
      borderRadius: 'inherit',
      display: 'block',
      height: '100%',
      objectFit: 'cover',
      objectPosition: 'center',
      width: '100%'
    });

    host.prepend(image);
    bindImageFallback(image, record);
    image.onload = () => {
      if (!image.isConnected) return;
      host.dataset.avatarState = 'loaded';
      host.dataset.avatarFallback = 'false';
    };

    // onerror 必须先绑定，再赋值 src，避免缓存失败图片漏过降级处理。
    setUrlAttribute(image, 'src', avatarUrl, { allowHttp: true, allowHttps: true, allowBlob: true, allowDataImage: true, allowRelative: true });
    return host;
  }

  function enhanceAvatarImages(root = document) {
    root.querySelectorAll('.avatar img:not([data-avatar-bound])').forEach(image => {
      image.dataset.avatarBound = 'true';
      image.loading = 'lazy';
      image.decoding = 'async';
      const name = clean(image.alt).replace(/头像$/u, '') || clean(image.closest('[data-avatar-name]')?.dataset.avatarName) || '联系人';
      bindImageFallback(image, name);
    });
  }

  window.YanceAvatarRuntime = Object.freeze({
    fields: AVATAR_FIELDS,
    resolveAvatarUrl,
    safeLocalAvatarUrl,
    avatarVersion,
    resolveDisplayName,
    initials,
    renderFallback,
    bindImageFallback,
    mountAvatar,
    enhanceAvatarImages
  });

  async function init() {
    if (initialized) return window.__Y27?.getState?.() || null;
    initialized = true;
    if (!window.__Y27?.bootstrapR32) throw new Error('R32_WORKSPACE_RUNTIME_NOT_READY');
    return window.__Y27.bootstrapR32(false);
  }

  async function reload() {
    if (!window.__Y27?.bootstrapR32) throw new Error('R32_WORKSPACE_RUNTIME_NOT_READY');
    return window.__Y27.bootstrapR32(true);
  }

  async function openConversation(sessionKey) {
    if (!sessionKey) return null;
    window.__Y27?.openConversationPage?.(sessionKey);
    return window.__Y27?.loadConversationMessages?.(sessionKey, true) || null;
  }

  window.YanceSQLiteConversationRuntime = {
    init,
    reload,
    openConversation,
    getState: () => window.__Y27?.getState?.() || null
  };
})();
