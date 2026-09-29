'use strict';

(function publish(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.YanceFacebookProfileExtractor = api;
})(() => {
  function clean(value) { return value == null ? '' : String(value).trim(); }
  function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
  function sourceIdsFromHref(href) {
    const raw = clean(href);
    if (!raw) return [];
    try {
      const url = new URL(raw, 'https://business.facebook.com/');
      const values = [];
      for (const key of ['asset_id', 'selected_item_id', 'thread_id', 'contact_id']) {
        const value = clean(url.searchParams.get(key));
        if (/^\d{5,}$/u.test(value)) values.push(value);
      }
      const pathIds = url.pathname.match(/\b\d{8,}\b/gu) || [];
      return unique([...values, ...pathIds]);
    } catch (_) { return []; }
  }
  function safeAvatarUrl(value) {
    const raw = clean(value);
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:') return '';
      if (!(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fbcdn.net' || host.endsWith('.fbcdn.net') || host === 'fbsbx.com' || host.endsWith('.fbsbx.com'))) return '';
      return url.toString();
    } catch (_) { return ''; }
  }
  function displayNameFromNode(node) {
    if (!node || typeof node.querySelector !== 'function') return '';
    const image = node.matches?.('img') ? node : node.querySelector('img[alt]');
    const imageAlt = clean(image?.getAttribute?.('alt'));
    if (imageAlt && imageAlt.length <= 120) return imageAlt;
    const labelled = node.matches?.('[aria-label]') ? node : node.querySelector('[aria-label]');
    const aria = clean(labelled?.getAttribute?.('aria-label'));
    if (aria && aria.length <= 120 && !/^(facebook|messenger|meta business suite)$/iu.test(aria)) return aria;
    return '';
  }
  function avatarFromNode(node) {
    if (!node || typeof node.querySelector !== 'function') return '';
    const images = node.matches?.('img[src]') ? [node] : [...node.querySelectorAll('img[src]')];
    for (const image of images) {
      const url = safeAvatarUrl(image.currentSrc || image.src || image.getAttribute?.('src'));
      if (url) return url;
    }
    return '';
  }
  function sanitizeObservedProfile(input = {}) {
    return {
      sourceIds: unique(Array.isArray(input.sourceIds) ? input.sourceIds : sourceIdsFromHref(input.href)),
      displayName: clean(input.displayName).slice(0, 160),
      avatarUrl: safeAvatarUrl(input.avatarUrl),
      href: clean(input.href).slice(0, 1000)
    };
  }
  function profileFromAnchor(anchor) {
    if (!anchor) return null;
    const href = clean(anchor.href || anchor.getAttribute?.('href'));
    const sourceIds = sourceIdsFromHref(href);
    if (!sourceIds.length) return null;
    const container = anchor.closest?.('[role="row"], [role="listitem"]') || anchor.parentElement || anchor;
    return sanitizeObservedProfile({
      sourceIds,
      href,
      displayName: displayNameFromNode(container),
      avatarUrl: avatarFromNode(container)
    });
  }
  return { avatarFromNode, displayNameFromNode, profileFromAnchor, safeAvatarUrl, sanitizeObservedProfile, sourceIdsFromHref };
});
