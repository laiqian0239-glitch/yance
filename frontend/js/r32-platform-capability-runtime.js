(function attachPlatformCapabilityRuntime(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YancePlatformCapabilityRuntime = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis, function createPlatformCapabilityRuntime(root) {
  'use strict';

  const STATE_LABELS = Object.freeze({
    supported: '平台支持',
    partial: '部分支持',
    policy: '受平台政策限制',
    permission: '需要额外权限',
    unsupported: '当前平台不支持',
    unavailable: '当前账号不可用',
    unknown: '能力尚未确认'
  });


  const LEGACY_TO_CANONICAL = Object.freeze({
    text:'message.text.send',image:'message.media.image.send',video:'message.media.video.send',gif:'message.media.gif.send',
    sticker:'message.media.sticker.send',animatedSticker:'message.media.animated_sticker.send',voice:'message.media.voice.send',
    file:'message.media.file.send',quote:'message.quote.send',reaction:'message.reaction.send',revoke:'message.revoke',
    readReceipt:'message.read_receipt.send',typingSend:'presence.typing.send',incomingTyping:'presence.typing.receive',
    terminalPresence:'presence.contact.receive',contacts:'contacts.sync',groups:'conversation.group',proactiveSend:'message.proactive.send',historySync:'history.sync'
  });

  const FALLBACK_NOTES = Object.freeze({
    quote: '当前平台没有正式引用回复能力',
    reaction: '当前平台没有正式消息回应能力',
    revoke: '当前平台或当前消息不允许撤回',
    sticker: '当前平台没有可用的贴纸发送链',
    animatedSticker: '当前平台的动态贴纸发送链尚未完成',
    incomingTyping: '当前平台没有稳定的对方输入状态',
    terminalPresence: '当前平台没有稳定的联系人上线/离线状态',
    historySync: '当前权限不支持完整历史会话同步'
  });

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function normalizeState(value) {
    if (value === true) return 'supported';
    if (value === false) return 'unsupported';
    const state = clean(value).toLowerCase();
    if (['supported', 'partial', 'policy', 'permission', 'unsupported', 'unavailable'].includes(state)) return state;
    return 'unknown';
  }

  function resolveCapability(contact = {}, name, fallback = false) {
    const contracts = contact.capabilityContracts || contact.capability_contracts || {};
    const compact = contact.capabilities || {};
    const canonicalName = LEGACY_TO_CANONICAL[name] || name;
    const contract = contracts[name] || contracts[canonicalName];
    if (contract && typeof contract === 'object') {
      const support = clean(contract.support || contract.state).toLowerCase();
      const availability = clean(contract.availability).toLowerCase();
      const state = availability === 'ready'
        ? (support === 'constrained' ? 'partial' : support === 'unsupported' ? 'unsupported' : 'supported')
        : availability === 'degraded' ? 'partial'
          : availability === 'unsupported' ? 'unsupported'
            : ['blocked','not-configured','onboarding'].includes(availability) ? 'unavailable'
              : normalizeState(contract.state || contract.support);
      return {
        name,
        canonicalName,
        state,
        availability,
        support,
        supported: ['supported', 'partial', 'policy', 'permission'].includes(state),
        fullySupported: state === 'supported',
        note: clean(contract.reason || contract.note) || FALLBACK_NOTES[name] || '',
        reasonCode: clean(contract.reasonCode),
        constraints: Array.isArray(contract.constraints) ? contract.constraints.map(value=>typeof value==='string'?clean(value):value).filter(Boolean) : [],
        source: 'PlatformCapabilityAuthority'
      };
    }
    if (Object.prototype.hasOwnProperty.call(compact, name)) {
      const state = normalizeState(compact[name]);
      return {
        name,
        state,
        supported: ['supported', 'partial', 'policy', 'permission'].includes(state),
        fullySupported: state === 'supported',
        note: FALLBACK_NOTES[name] || '',
        constraints: [],
        source: 'compact'
      };
    }
    const state = normalizeState(fallback);
    return {
      name,
      state,
      supported: ['supported', 'partial', 'policy', 'permission'].includes(state),
      fullySupported: state === 'supported',
      note: FALLBACK_NOTES[name] || '',
      constraints: [],
      source: 'fallback'
    };
  }

  function actionDecision(contact = {}, name, options = {}) {
    const capability = resolveCapability(contact, name, options.fallback ?? false);
    const platform = clean(contact.platform || options.routeContext?.platform || '当前平台');
    const route = options.routeContext || {};
    let visible = capability.supported || options.showUnavailable === true;
    let enabled = capability.supported;
    let reason = capability.note;
    const protocol = { state: capability.state, label: STATE_LABELS[capability.state] || STATE_LABELS.unknown, supported: capability.supported };
    const account = {
      state: clean(route.sourceAccountId) ? (route.accountConnected === false ? 'unavailable' : 'ready') : 'missing',
      label: clean(route.sourceAccountId) ? (route.accountConnected === false ? '当前账号未连接' : `当前账号已连接：${clean(route.sourceAccountIdentity) || '账号名称待同步'}`) : '当前会话未绑定账号'
    };
    const target = clean(route.targetIdentity);
    const routeState = {
      state: target ? (clean(route.conflict) ? 'blocked' : 'ready') : 'missing',
      label: target ? (clean(route.conflict) ? `当前会话路由不可用：${clean(route.conflict)}` : `当前目标：${target}`) : '当前会话缺少目标号码、JID 或 Page 身份'
    };
    if (options.requiresOwnMessage && options.fromMe !== true) {
      enabled = false;
      visible = options.showUnavailable === true;
      reason = '只能对自己发送的消息执行此操作';
    }
    if (options.requiresMedia && options.hasMedia !== true) {
      enabled = false;
      visible = false;
      reason = '当前消息不是媒体消息';
    }
    if (options.requiresAccount || options.evaluateRoute === true) {
      if (!clean(route.sourceAccountId || contact.accountId)) {
        enabled = false;
        visible = true;
        reason = '平台协议支持，但当前会话没有绑定发送账号';
      } else if (route.accountConnected === false) {
        enabled = false;
        visible = true;
        reason = '平台协议支持，但当前发送账号尚未连接';
      } else if (!target) {
        enabled = false;
        visible = true;
        reason = '平台协议支持，但当前会话缺少目标号码、JID 或 Page 身份';
      } else if (clean(route.conflict)) {
        enabled = false;
        visible = true;
        reason = `平台协议支持，但当前会话路由被阻断：${clean(route.conflict)}`;
      } else if (capability.supported) {
        reason = [capability.note, account.label, routeState.label].filter(Boolean).join('；');
      }
    }
    return {
      ...capability,
      platform,
      visible,
      enabled,
      reason: reason || (capability.supported ? `${platform} 协议支持，当前路由可用` : `${platform} 当前不支持此能力`),
      stateLabel: STATE_LABELS[capability.state] || STATE_LABELS.unknown,
      protocol,
      account,
      route: routeState
    };
  }

  const authorityCache = new Map();
  async function refreshContact(contact = {}, options = {}) {
    const platform = clean(contact.platform).toLowerCase();
    const accountId = clean(contact.accountId || contact.sourceAccountId);
    if (!platform || !accountId || typeof fetch !== 'function') return contact;
    const key = `${platform}:${accountId}`;
    const cached = authorityCache.get(key);
    if (!options.force && cached && Date.now() - cached.at < 15000) return Object.assign(contact, cached.value);
    const response = await fetch(`/api/r32/system/platform-capabilities?platform=${encodeURIComponent(platform)}&accountId=${encodeURIComponent(accountId)}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `能力状态读取失败 ${response.status}`);
    const account = payload.capabilities?.platforms?.[platform]?.accounts?.find(row=>clean(row.accountId)===accountId) || null;
    if (!account) return contact;
    const capabilityContracts = Object.fromEntries((account.capabilities||[]).map(row=>[row.capabilityId,row]));
    const capabilities = {};
    for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
      const row = capabilityContracts[canonical];
      capabilities[legacy] = Boolean(row && row.enabled === true);
    }
    const value = { capabilities, capabilityContracts, capabilityAuthority: { authority:'PlatformCapabilityAuthority', platform, accountId, accountAvailability:account.availability, generatedAt:payload.capabilities.generatedAt } };
    authorityCache.set(key,{at:Date.now(),value}); Object.assign(contact,value);
    try { root?.dispatchEvent?.(new CustomEvent('yance:capabilities-updated',{detail:{platform,accountId,contact}})); } catch (_) {}
    return contact;
  }

  function summarize(contact = {}, names = [], options = {}) {
    return names.map(name => actionDecision(contact, name, { showUnavailable: true, evaluateRoute: true, ...options })).map(row => ({
      name: row.name,
      state: row.state,
      stateLabel: row.stateLabel,
      enabled: row.enabled,
      note: row.reason,
      constraints: row.constraints,
      protocol: row.protocol,
      account: row.account,
      route: row.route
    }));
  }

  return { STATE_LABELS, FALLBACK_NOTES, LEGACY_TO_CANONICAL, normalizeState, resolveCapability, actionDecision, refreshContact, summarize };
});
