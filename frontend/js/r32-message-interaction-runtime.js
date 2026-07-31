(function attachMessageInteractionRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceMessageInteractionRuntime = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis, function createMessageInteractionRuntime() {
  'use strict';

  function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function unreadCount(record = {}) {
    return Math.max(0, Math.trunc(numeric(
      record.unreadCount ?? record.unread_count ?? record.unread,
      0
    )));
  }

  function badgeLabel(record = {}) {
    const count = unreadCount(record);
    if (!count) return '';
    return count > 99 ? '99+' : String(count);
  }

  function clearUnread(record = {}) {
    record.unread = 0;
    record.unreadCount = 0;
    record.unread_count = 0;
    return record;
  }

  function distanceFromBottom(metrics = {}) {
    return Math.max(0,
      numeric(metrics.scrollHeight) - numeric(metrics.scrollTop) - numeric(metrics.clientHeight)
    );
  }

  function isNearBottom(metrics = {}, threshold = 100) {
    return distanceFromBottom(metrics) < Math.max(0, numeric(threshold, 100));
  }

  function shouldLoadOlder(options = {}) {
    if (options.restoring === true) return false;
    const scrollTop = Math.max(0, numeric(options.scrollTop));
    const threshold = Math.max(0, numeric(options.threshold, 140));
    return scrollTop < threshold;
  }

  function normalizeScrollState(value) {
    if (value == null) return null;
    if (typeof value === 'number' || typeof value === 'string') {
      const scrollTop = Math.max(0, numeric(value));
      return { version: 3, mode: 'offset', scrollTop };
    }
    if (typeof value !== 'object') return null;
    const mode = ['bottom', 'anchor', 'offset'].includes(String(value.mode || ''))
      ? String(value.mode)
      : 'offset';
    const state = {
      version: 3,
      mode,
      scrollTop: Math.max(0, numeric(value.scrollTop))
    };
    if (mode === 'anchor') {
      state.messageId = String(value.messageId || '').trim();
      state.externalMessageId = String(value.externalMessageId || '').trim();
      state.offsetPx = numeric(value.offsetPx);
      if (!state.messageId && !state.externalMessageId) state.mode = 'offset';
    }
    return state;
  }

  function scrollStateIsBottom(value) {
    return normalizeScrollState(value)?.mode === 'bottom';
  }

  function decideScrollAfterRender(options = {}) {
    const sameConversation = options.sameConversation === true;
    const previousCount = Math.max(0, Math.trunc(numeric(options.previousCount)));
    const nextCount = Math.max(0, Math.trunc(numeric(options.nextCount)));
    const nextScrollHeight = Math.max(0, numeric(options.nextScrollHeight));
    const nextClientHeight = Math.max(0, numeric(options.nextClientHeight));
    const maxScrollTop = Math.max(0, nextScrollHeight - nextClientHeight);
    const previousScrollTop = Math.max(0, numeric(options.previousScrollTop));
    const savedScrollTop = options.savedScrollTop == null
      ? null
      : Math.max(0, numeric(options.savedScrollTop));
    const newMessageCount = sameConversation ? Math.max(0, nextCount - previousCount) : 0;

    if (!sameConversation) {
      return {
        scrollTop: savedScrollTop == null ? maxScrollTop : Math.min(savedScrollTop, maxScrollTop),
        showNewMessage: false,
        newMessageCount: 0,
        autoScrolled: savedScrollTop == null
      };
    }

    if (options.wasNearBottom === true) {
      return {
        scrollTop: maxScrollTop,
        showNewMessage: false,
        newMessageCount,
        autoScrolled: true
      };
    }

    return {
      scrollTop: Math.min(previousScrollTop, maxScrollTop),
      showNewMessage: newMessageCount > 0,
      newMessageCount,
      autoScrolled: false
    };
  }

  return {
    unreadCount,
    badgeLabel,
    clearUnread,
    distanceFromBottom,
    isNearBottom,
    shouldLoadOlder,
    normalizeScrollState,
    scrollStateIsBottom,
    decideScrollAfterRender
  };
});
