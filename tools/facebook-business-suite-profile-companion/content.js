'use strict';

(() => {
  const extractor = globalThis.YanceFacebookProfileExtractor;
  if (!extractor || !globalThis.chrome?.runtime?.sendMessage) return;

  const selector = [
    'a[href*="selected_item_id="]',
    'a[href*="thread_id="]',
    'a[href*="contact_id="]'
  ].join(',');
  let pendingTimer = null;

  function collectProfiles() {
    const profiles = [];
    const unique = new Set();
    for (const anchor of document.querySelectorAll(selector)) {
      const profile = extractor.profileFromAnchor(anchor);
      if (!profile?.sourceIds?.length || (!profile.displayName && !profile.avatarUrl)) continue;
      const key = `${profile.sourceIds.join(',')}|${profile.displayName}|${profile.avatarUrl}`;
      if (unique.has(key)) continue;
      unique.add(key);
      profiles.push(profile);
    }
    return profiles;
  }

  function projectVisibleProfiles() {
    const profiles = collectProfiles();
    if (!profiles.length) return;
    try { chrome.runtime.sendMessage({ type: 'YANCE_FACEBOOK_PROFILES_OBSERVED', profiles }); } catch (_) {}
  }

  function scheduleProjection() {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      projectVisibleProfiles();
    }, 350);
  }

  const observer = new MutationObserver(scheduleProjection);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'src', 'alt', 'aria-label']
  });
  scheduleProjection();
})();
