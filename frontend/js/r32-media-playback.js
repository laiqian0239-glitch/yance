(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceMediaPlayback = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const state = {
    settings: { stickerAutoplay: true, pauseAnimationWhenHidden: true },
    loaded: false
  };

  function normalizeSettings(value = {}) {
    return {
      stickerAutoplay: value.stickerAutoplay !== false,
      pauseAnimationWhenHidden: value.pauseAnimationWhenHidden !== false
    };
  }

  function shouldPause() {
    if (state.settings.stickerAutoplay !== true) return true;
    return state.settings.pauseAnimationWhenHidden === true && Boolean(root?.document?.hidden);
  }

  function setImageSource(img, source) {
    if (!img) return '';
    const setUrlAttribute = root?.YanceSecurity?.setUrlAttribute;
    if (typeof setUrlAttribute !== 'function') {
      img.removeAttribute?.('src');
      return '';
    }
    return setUrlAttribute(img, 'src', source, { allowDataImage: true, allowBlob: true, allowRelative: true });
  }

  function pauseImage(img) {
    if (!img) return;
    const current = img.getAttribute('src') || '';
    if (current && current !== TRANSPARENT_PIXEL) img.dataset.animatedSource = current;
    setImageSource(img, TRANSPARENT_PIXEL);
    img.dataset.animationPaused = '1';
  }

  function resumeImage(img) {
    if (!img) return;
    const source = img.dataset.animatedSource || '';
    if (source) setImageSource(img, source);
    delete img.dataset.animationPaused;
  }

  function applyCard(card) {
    if (!card || card.dataset.animatedMedia !== '1') return;
    const img = card.querySelector('img');
    const button = card.querySelector('[data-media-play-toggle]');
    const paused = shouldPause();
    card.classList.toggle('media-animation-paused', paused);
    card.dataset.animationState = paused ? 'paused' : 'playing';
    if (paused) pauseImage(img); else resumeImage(img);
    if (button) {
      button.textContent = paused ? '播放动态贴纸' : '暂停动态贴纸';
      button.setAttribute('aria-pressed', paused ? 'false' : 'true');
    }
  }

  function apply(rootNode = root?.document) {
    if (!rootNode?.querySelectorAll) return;
    rootNode.querySelectorAll('[data-animated-media="1"]').forEach(applyCard);
    root?.document?.documentElement?.classList.toggle('media-animation-paused', shouldPause());
  }

  function enhance(rootNode = root?.document) {
    if (!rootNode?.querySelectorAll) return;
    rootNode.querySelectorAll('[data-animated-media="1"]').forEach(card => {
      const img = card.querySelector('img');
      if (img && !img.dataset.animatedSource) img.dataset.animatedSource = img.getAttribute('src') || '';
      let button = card.querySelector('[data-media-play-toggle]');
      if (!button) {
        button = root.document.createElement('button');
        button.type = 'button';
        button.className = 'media-play-toggle';
        button.dataset.mediaPlayToggle = '1';
        button.addEventListener('click', event => {
          event.preventDefault();
          const currentlyPaused = card.dataset.animationState === 'paused';
          if (currentlyPaused) {
            resumeImage(img);
            card.dataset.animationState = 'playing';
            card.classList.remove('media-animation-paused');
            button.textContent = '暂停动态贴纸';
            button.setAttribute('aria-pressed', 'true');
          } else {
            pauseImage(img);
            card.dataset.animationState = 'paused';
            card.classList.add('media-animation-paused');
            button.textContent = '播放动态贴纸';
            button.setAttribute('aria-pressed', 'false');
          }
        });
        card.appendChild(button);
      }
      applyCard(card);
    });
  }

  function setSettings(next = {}) {
    state.settings = normalizeSettings({ ...state.settings, ...next });
    state.loaded = true;
    apply();
    return snapshot();
  }

  async function refreshSettings() {
    if (typeof root?.yanceDesktop?.getSettings !== 'function') {
      state.loaded = true;
      apply();
      return snapshot();
    }
    try {
      const settings = await root.yanceDesktop.getSettings();
      return setSettings(settings || {});
    } catch (_) {
      state.loaded = true;
      apply();
      return snapshot();
    }
  }

  function snapshot() {
    return Object.freeze({ settings: { ...state.settings }, loaded: state.loaded, paused: shouldPause() });
  }

  if (root?.document?.addEventListener) {
    root.document.addEventListener('visibilitychange', () => apply());
    root.addEventListener?.('yance:desktop-settings-changed', event => setSettings(event.detail || {}));
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => refreshSettings(), { once: true });
    else queueMicrotask(() => refreshSettings());
  }

  return Object.freeze({ normalizeSettings, shouldPause, setImageSource, enhance, apply, setSettings, refreshSettings, snapshot, TRANSPARENT_PIXEL });
});
