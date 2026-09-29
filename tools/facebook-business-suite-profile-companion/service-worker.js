'use strict';

const ENDPOINT = 'http://127.0.0.1:27632/api/r32/accounts/facebook/profile-enrichment';
const BUSINESS_SUITE_INBOX = 'https://business.facebook.com/latest/inbox/all';

async function postProfiles(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) return { ok: true, skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yance-extension-id': chrome.runtime.id
      },
      body: JSON.stringify({ profiles }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Yance profile projection HTTP ${response.status}`);
    return response.json().catch(() => ({ ok: true }));
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBusinessSuiteInbox() {
  const tabs = await chrome.tabs.query({ url: 'https://business.facebook.com/*' });
  if (tabs.length) return tabs[0].id || 0;
  const tab = await chrome.tabs.create({ url: BUSINESS_SUITE_INBOX, active: false });
  return tab?.id || 0;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'YANCE_FACEBOOK_PROFILES_OBSERVED') return false;
  postProfiles(message.profiles)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onStartup.addListener(() => { void ensureBusinessSuiteInbox().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void ensureBusinessSuiteInbox().catch(() => {}); });
