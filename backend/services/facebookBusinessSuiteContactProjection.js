'use strict';

const FACEBOOK_PAGE_CHANNEL = 'Channel::FacebookPage';
const PLACEHOLDER_NAMES = new Set(['', 'john doe', 'facebook user', 'facebook 用户', 'unknown', 'unknown user']);

function clean(value) { return value == null ? '' : String(value).trim(); }
function unique(values = []) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }
function stripTrailingSlash(value) { return clean(value).replace(/\/+$/u, ''); }
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
function usableName(value) { const name = clean(value); return name && !PLACEHOLDER_NAMES.has(name.toLowerCase()) ? name : ''; }
function sourceIdsForContact(contact = {}) {
  return unique((Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [])
    .filter(row => clean(row?.inbox?.channel_type) === FACEBOOK_PAGE_CHANNEL)
    .map(row => row?.source_id));
}
function runtimeConfig() {
  return {
    baseUrl: stripTrailingSlash(process.env.CHATWOOT_BASE_URL),
    accountId: clean(process.env.CHATWOOT_ACCOUNT_ID),
    accessToken: clean(process.env.CHATWOOT_API_ACCESS_TOKEN)
  };
}
function requireRuntimeConfig() {
  const config = runtimeConfig();
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw Object.assign(new Error(`Chatwoot profile projection runtime missing: ${missing.join(', ')}`), { code: 'FACEBOOK_PROFILE_ENRICHMENT_RUNTIME_NOT_CONFIGURED', status: 503 });
  return config;
}
async function chatwootJson(config, relativePath, options = {}) {
  const response = await fetch(`${config.baseUrl}${relativePath}`, {
    ...options,
    headers: { accept: 'application/json', api_access_token: config.accessToken, ...(options.headers || {}) }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw Object.assign(new Error(text || `Chatwoot returned HTTP ${response.status}`), { code: 'FACEBOOK_PROFILE_ENRICHMENT_CHATWOOT_ERROR', status: response.status });
  }
  return response.json().catch(() => ({}));
}
async function defaultListContacts() {
  const config = requireRuntimeConfig();
  const contacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await chatwootJson(config, `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts?page=${page}&sort=last_activity_at`);
    const rows = Array.isArray(data?.payload) ? data.payload : [];
    contacts.push(...rows);
    const total = Number(data?.meta?.count || data?.meta?.total_count || 0);
    if (!rows.length || (total > 0 && contacts.length >= total)) break;
  }
  return contacts;
}
async function defaultPatchContact(contactId, patch) {
  const config = requireRuntimeConfig();
  return chatwootJson(config, `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch)
  });
}
function createFacebookBusinessSuiteContactProjection(deps = {}) {
  const listContacts = deps.listContacts || defaultListContacts;
  const patchContact = deps.patchContact || defaultPatchContact;
  return {
    async projectBatch(profiles = []) {
      const contacts = await listContacts();
      const result = { observed: Array.isArray(profiles) ? profiles.length : 0, updated: 0, skipped: 0, ambiguous: 0, unmatched: 0, failed: 0, results: [] };
      for (const profile of Array.isArray(profiles) ? profiles : []) {
        const sourceIds = unique(profile?.sourceIds);
        const displayName = usableName(profile?.displayName);
        const avatarUrl = safeAvatarUrl(profile?.avatarUrl);
        if (!sourceIds.length || (!displayName && !avatarUrl)) {
          result.skipped += 1;
          result.results.push({ status: 'skipped', sourceIds });
          continue;
        }
        const matches = contacts.filter(contact => sourceIdsForContact(contact).some(id => sourceIds.includes(id)));
        if (matches.length > 1) {
          result.ambiguous += 1;
          result.results.push({ status: 'ambiguous', sourceIds, matchCount: matches.length });
          continue;
        }
        if (matches.length !== 1) {
          result.unmatched += 1;
          result.results.push({ status: 'unmatched', sourceIds });
          continue;
        }
        const contact = matches[0];
        const patch = {};
        if (displayName && clean(contact.name) !== displayName) patch.name = displayName;
        if (avatarUrl && !clean(contact.thumbnail || contact.avatar_url)) patch.avatar_url = avatarUrl;
        if (!Object.keys(patch).length) {
          result.skipped += 1;
          result.results.push({ status: 'skipped', contactId: String(contact.id), sourceIds });
          continue;
        }
        try {
          await patchContact(String(contact.id), patch);
          result.updated += 1;
          result.results.push({ status: 'updated', contactId: String(contact.id), sourceIds, attemptedPatch: patch });
        } catch (error) {
          result.failed += 1;
          result.results.push({ status: 'failed', contactId: String(contact.id), sourceIds, attemptedPatch: patch, code: clean(error?.code || error?.message, 'PROFILE_UPDATE_FAILED') });
        }
      }
      return result;
    }
  };
}
const defaultProjection = createFacebookBusinessSuiteContactProjection();
module.exports = { FACEBOOK_PAGE_CHANNEL, createFacebookBusinessSuiteContactProjection, projectBatch: profiles => defaultProjection.projectBatch(profiles), runtimeConfig, safeAvatarUrl, sourceIdsForContact, usableName };
