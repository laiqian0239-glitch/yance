(function initContactSafeRenderers(root, factory) {
  const security = root?.YanceSecurity || (typeof require === 'function' ? require('./r32-security') : null);
  const presentation = root?.YanceBusinessPresentation || (typeof require === 'function' ? require('./r32-business-presentation-authority') : null);
  const api = factory(security, presentation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceContactSafeRenderers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContactSafeRenderers(Security, Presentation) {
  'use strict';
  if (!Security) throw new Error('YanceSecurity must load before contact safe renderers');

  const { createElement: make, replaceChildren, setUrlAttribute, toText } = Security;
  const avatarUrlOptions = { allowHttp: true, allowHttps: true, allowBlob: true, allowDataImage: true, allowRelative: true };
  const businessIdentity = (value, options = {}) => Presentation?.businessIdentity?.(value, options) || toText(value, options.fallback || '身份待确认');
  const businessPlatform = value => Presentation?.label?.('platform', value, toText(value, '未知平台')) || toText(value, '未知平台');
  const contactBusinessIdentity = (contact = {}, fallback = '平台身份待确认') => {
    const phone = toText(contact.phone);
    if (phone) return businessIdentity(phone, { platform: contact.platform, kind: 'phone', fallback });
    return businessIdentity(contact.stableId || contact.platformIdentity || contact.externalId, { platform: contact.platform, kind: 'platform', fallback });
  };

  function technicalDetailsNode(documentRef, rows = {}) {
    const host = make(documentRef, 'div', { className: 'business-technical-details' });
    const toggle = make(documentRef, 'button', { className: 'business-technical-toggle', text: '查看技术身份', attributes: { type: 'button', 'aria-expanded': 'false' } });
    const list = make(documentRef, 'dl', { attributes: { hidden: '' } });
    for (const [label, value] of Object.entries(rows)) {
      const text = toText(value);
      if (!text) continue;
      list.append(make(documentRef, 'dt', { text: label }), make(documentRef, 'dd', { text }));
    }
    toggle.onclick = () => {
      const expanded = toggle.getAttribute?.('aria-expanded') === 'true';
      toggle.setAttribute?.('aria-expanded', expanded ? 'false' : 'true');
      if (expanded) list.setAttribute?.('hidden', '');
      else list.removeAttribute?.('hidden');
    };
    host.append(toggle, list);
    return host;
  }

  function addLine(documentRef, host, value, first = false) {
    if (!first) host.appendChild(documentRef.createElement('br'));
    host.append(toText(value));
  }

  function avatarNode(documentRef, contact, avatarResolver) {
    const wrapper = make(documentRef, 'div', { className: 'avatar' });
    const runtime = documentRef?.defaultView?.YanceAvatarRuntime || globalThis?.YanceAvatarRuntime;
    if (runtime?.mountAvatar) {
      runtime.mountAvatar(wrapper, contact || {});
      return wrapper;
    }
    const image = make(documentRef, 'img', { attributes: { alt: `${toText(contact?.name, '联系人')}头像` } });
    let fallbackApplied = false;
    image.onerror = () => {
      if (fallbackApplied) return;
      fallbackApplied = true;
      image.removeAttribute('src');
      wrapper.textContent = Array.from(toText(contact?.name, '?')).slice(0, 2).join('') || '?';
    };
    setUrlAttribute(image, 'src', avatarResolver(contact), avatarUrlOptions);
    wrapper.appendChild(image);
    return wrapper;
  }

  function renderMergeOptions(documentRef, select, candidates, selectedId = '') {
    const options = (candidates || []).map((candidate, index) => {
      const option = make(documentRef, 'option', { text: `${toText(candidate.name)} · ${contactBusinessIdentity(candidate, '平台身份待确认')}` });
      option.value = toText(candidate.id);
      option.selected = selectedId ? candidate.id === selectedId : index === 0;
      return option;
    });
    replaceChildren(select, options);
    return options;
  }

  function renderMergeCard(documentRef, host, contact) {
    const title = make(documentRef, 'b', { text: contact?.name });
    const details = make(documentRef, 'span');
    addLine(documentRef, details, contactBusinessIdentity(contact, '平台身份待确认'), true);
    addLine(documentRef, details, businessIdentity(contact?.stableId,{platform:contact?.platform,kind:'platform',fallback:'稳定身份待确认'}));
    addLine(documentRef, details, `未读 ${Number(contact?.unread || 0)} · ${(contact?.tags || []).map(toText).join(' / ')}`);
    replaceChildren(host, title, details);
  }

  function renderMergeChecklist(documentRef, host, targetName) {
    const rows = [
      `聊天记录与未读消息合并到 ${toText(targetName)}`,
      '头像优先保留自定义头像，客户备注冲突会并列保留',
      '稳定身份与平台来源保留在证据链，可在本次会话中撤销'
    ].map(text => make(documentRef, 'div', {
      children: [make(documentRef, 'i', { text: '✓' }), make(documentRef, 'span', { text })]
    }));
    replaceChildren(host, rows);
  }

  function renderWorkbenchQueue(documentRef, host, queue, selectedIdentity) {
    const buttons = [];
    for (const contact of queue || []) {
      const button = make(documentRef, 'button', {
        className: contact.id === selectedIdentity ? 'active' : '',
        dataset: { queueId: contact.id },
        children: [
          make(documentRef, 'b', { text: contact.name }),
          make(documentRef, 'span', { text: `${contact.duplicate ? '疑似重复 · ' : ''}待确认` })
        ]
      });
      buttons.push(button);
    }
    if (!buttons.length) {
      buttons.push(make(documentRef, 'button', {
        children: [make(documentRef, 'b', { text: '暂无待确认对象' }), make(documentRef, 'span', { text: '身份队列已清空' })]
      }));
    }
    replaceChildren(host, buttons);
    return buttons.filter(button => button.dataset.queueId);
  }

  function appendTag(documentRef, host, text) {
    host.appendChild(make(documentRef, 'i', { text }));
  }

  function renderIdentityList(documentRef, host, rows, selectedIdentity, avatarResolver, primaryState) {
    const buttons = [];
    if (!(rows || []).length) {
      replaceChildren(host, make(documentRef, 'div', {
        className: 'ui-empty-state',
        children: [make(documentRef, 'div', { children: [
          make(documentRef, 'div', { className: 'ui-empty-orb' }),
          make(documentRef, 'b', { text: '当前筛选下没有联系人' }),
          make(documentRef, 'p', { text: '调整筛选条件或清空搜索关键词后再试。' })
        ] })]
      }));
      return buttons;
    }

    for (const contact of rows) {
      const top = make(documentRef, 'div', {
        className: 'identity26-top',
        children: [make(documentRef, 'b', { text: contact.name })]
      });
      if (contact.online) top.appendChild(make(documentRef, 'span', {
        className: 'live', children: [make(documentRef, 'i'), '在线']
      }));
      const tags = make(documentRef, 'div', { className: 'identity26-tags' });
      appendTag(documentRef, tags, businessPlatform(contact.platform));
      for (const tag of contact.tags || []) appendTag(documentRef, tags, tag);
      if (contact.pending) appendTag(documentRef, tags, '新联系人');
      if (contact.maintained) appendTag(documentRef, tags, '资料已维护');
      if (contact.bound) appendTag(documentRef, tags, '已绑定客户');
      if (contact.duplicate) appendTag(documentRef, tags, '疑似重复');
      if (contact.archived) appendTag(documentRef, tags, '已归档');

      const state = make(documentRef, 'em', {
        className: `identity26-state${contact.bound ? ' ok' : ''}`,
        text: primaryState(contact)
      });
      const button = make(documentRef, 'button', {
        className: `identity26-card${contact.id === selectedIdentity ? ' active' : ''}`,
        dataset: { identityId: contact.id },
        children: [
          avatarNode(documentRef, contact, avatarResolver),
          make(documentRef, 'div', { className: 'identity26-main', children: [
            top,
            make(documentRef, 'p', { text: `${contactBusinessIdentity(contact, '平台身份待确认')} · ${toText(contact.source)}` }),
            tags
          ] }),
          make(documentRef, 'div', { className: 'identity26-side', children: [
            make(documentRef, 'time', { text: contact.time }), state
          ] })
        ]
      });
      buttons.push(button);
    }
    replaceChildren(host, buttons);
    return buttons;
  }

  function actionButton(documentRef, action, label, primary = false) {
    return make(documentRef, 'button', {
      className: primary ? 'primary' : '',
      text: label,
      dataset: { contactAction: action }
    });
  }

  function renderIdentityDetail(documentRef, heroHost, gridHost, contact, latest, auditRows, avatarResolver, primaryState, nextAction) {
    const meta = make(documentRef, 'div', { className: 'detail26-meta', children: [
      make(documentRef, 'span', { text: primaryState(contact) }),
      make(documentRef, 'span', { text: `可信度 ${Number(contact.confidence || 0)}%` })
    ] });
    if (contact.duplicate) meta.appendChild(make(documentRef, 'span', { className: 'warn', text: '疑似重复身份' }));
    if (contact.online) meta.appendChild(make(documentRef, 'span', { text: '● 在线' }));

    const actions = [
      actionButton(documentRef, 'confirm', contact.pending ? '确认身份并绑定客户' : '打开客户档案', true),
      actionButton(documentRef, 'notes', '编辑客户备注'),
      actionButton(documentRef, 'avatar', '编辑头像'),
      actionButton(documentRef, 'associate', contact.customerProfileId && contact.contactId && contact.customerProfileId !== contact.contactId ? '解除客户档案关联' : '关联跨平台客户档案')
    ];
    if (contact.duplicate) actions.push(actionButton(documentRef, 'merge', '处理重复身份'));
    actions.push(
      actionButton(documentRef, 'history', '进入对应会话'),
      actionButton(documentRef, 'archive', contact.archived ? '恢复客户' : '归档客户'),
      actionButton(documentRef, 'ignore', '忽略此项')
    );

    replaceChildren(heroHost,
      make(documentRef, 'div', { className: 'detail26-profile', children: [
        avatarNode(documentRef, contact, avatarResolver),
        make(documentRef, 'div', { children: [
          make(documentRef, 'h2', { text: contact.name }),
          make(documentRef, 'p', { text: `${contactBusinessIdentity(contact, '平台身份待确认')} · ${businessPlatform(contact.platform)}` }),
          meta
        ] })
      ] }),
      make(documentRef, 'div', { className: 'detail26-actions', children: [
        ...actions,
        technicalDetailsNode(documentRef, {
          '平台': businessPlatform(contact.platform),
          '联系电话': contact.phone,
          '稳定身份': contact.stableId,
          '会话标识': contact.id,
          '账号实例': contact.accountId
        })
      ] })
    );

    const facts = [
      ['联系人类型', contact.system ? '系统服务' : '真实联系人', `来源 ${toText(contact.source)}`],
      ['客户档案', contact.bound ? '已绑定' : '尚未绑定', Array.isArray(contact.linkedIdentities) && contact.linkedIdentities.length > 1 ? `已明确关联 ${contact.linkedIdentities.length} 个平台身份；底层会话仍隔离` : contact.bound ? '会话和客户备注可同步' : '仍未进入客户链'],
      ['稳定身份', businessIdentity(contact.stableId,{platform:contact.platform,kind:'platform',fallback:'待确认'}), '精确平台身份已移入技术详情，业务页面不直接展示内部标识'],
      ['唯一下一步', nextAction(contact), '按流程完成联系人资料']
    ].map(([label, value, note]) => make(documentRef, 'article', { className: 'detail26-fact', children: [
      make(documentRef, 'span', { text: label }), make(documentRef, 'b', { text: value }), make(documentRef, 'small', { text: note })
    ] }));

    const evidence = make(documentRef, 'div', { className: 'evidence26', children: [
      make(documentRef, 'article', { children: [make(documentRef, 'b', { text: '平台真实身份' }), make(documentRef, 'p', { text: `号码与稳定标识来自 ${toText(contact.platform)} 当前连接，不把消息正文当成姓名。` }), make(documentRef, 'em', { text: `可信 ${Number(contact.confidence || 0)}%` })] }),
      make(documentRef, 'article', { children: [make(documentRef, 'b', { text: '联系人资料' }), make(documentRef, 'p', { text: '显示名、地区、语言和标签来自联系人目录与人工维护。' }), make(documentRef, 'em', { text: contact.maintained ? '资料已维护' : '仍待补充' })] }),
      make(documentRef, 'article', { children: [make(documentRef, 'b', { text: '客户档案绑定' }), make(documentRef, 'p', { text: contact.bound ? '已经绑定长期客户档案，客户备注可以同步。' : '尚未绑定，不会将AI推断自动写成确认事实。' }), make(documentRef, 'em', { text: contact.bound ? '已绑定' : '未绑定' })] })
    ] });

    const detailSection = (title, subtitle, body) => make(documentRef, 'section', { className: 'detail26-section', children: [
      make(documentRef, 'header', { children: [make(documentRef, 'h3', { text: title }), make(documentRef, 'span', { text: subtitle })] }),
      make(documentRef, 'div', { className: 'detail26-body', children: [body] })
    ] });

    const recentText = latest?.cn || latest?.text || contact.snippet;
    const suggestion = make(documentRef, 'div', { className: 'detail26-two', children: [
      make(documentRef, 'article', { className: 'detail26-next', children: [make(documentRef, 'small', { text: '系统建议' }), make(documentRef, 'h4', { text: nextAction(contact) }), make(documentRef, 'p', { text: contact.note })] }),
      make(documentRef, 'article', { className: 'detail26-recent', children: [make(documentRef, 'b', { text: contact.name }), make(documentRef, 'p', { text: recentText }), make(documentRef, 'small', { text: contact.snippet })] })
    ] });

    const auditList = make(documentRef, 'div', { className: 'audit-list' });
    for (const row of auditRows) auditList.appendChild(make(documentRef, 'div', { className: 'audit-row', children: [
      make(documentRef, 'time', { text: row.time }),
      make(documentRef, 'div', { children: [make(documentRef, 'b', { text: row.title }), make(documentRef, 'p', { text: row.detail })] })
    ] }));

    replaceChildren(gridHost,
      facts,
      detailSection('身份证据链', '平台事实、人工确认与客户档案分层', evidence),
      detailSection('处理建议与最近会话', `当前对象 ${toText(contact.name)}`, suggestion),
      detailSection('操作记录', '与会话中心共用状态', auditList)
    );
    return actions;
  }

  return Object.freeze({ renderMergeOptions, renderMergeCard, renderMergeChecklist, renderWorkbenchQueue, renderIdentityList, renderIdentityDetail, contactBusinessIdentity });
});
