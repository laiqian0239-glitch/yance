import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  loadHumanTypingProjection,
  loadPersonaEffective,
  loadPlatformAccounts,
  runPlatformAccountCommand,
  type PlatformAccountProjection,
} from "./experienceProjection";
import { playExperienceSound } from "./experienceSound";
import type {
  ConversationRef,
  GroupConversationProjection,
  RelationshipProjection,
  SoundMode,
} from "./experienceTypes";

export type PeopleHomeView = "list" | "universe";
type PeopleFilter = "all" | "facebook" | "telegram" | "whatsapp";

type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  groups: readonly GroupConversationProjection[];
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  selectedRelationshipId: string;
  focusedRelationshipId: string;
  viewMode: PeopleHomeView;
  reducedMotion: boolean;
  soundMode: SoundMode;
  getMatrixUserId?: () => string;
  onViewModeChange: (view: PeopleHomeView) => void;
  onFocus: (relationshipId: string) => void;
  onSelect: (relationshipId: string) => void;
  onContinueConversation: (relationship: RelationshipProjection, conversation: ConversationRef) => void;
  onSelectGroup: (conversation: GroupConversationProjection) => void;
  onConnectAccounts: () => void;
  onRefreshRelationships: () => Promise<void>;
};

type UniversePosition = { x: number; y: number; ring: number };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

function relationshipAvatar(
  relationship: RelationshipProjection,
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode,
  size = "40px",
): React.ReactNode {
  if (relationship.avatarUrl) return <img src={relationship.avatarUrl} alt="" />;
  const roomId = String(relationship.matrixRoomId || "").trim();
  if (roomId && renderRoomAvatar) {
    try {
      return renderRoomAvatar(roomId, size);
    } catch {
      // Element remains the fallback authority when Product has no resolved contact photo.
    }
  }
  return <span>{initials(relationship.name)}</span>;
}

function relationshipInsightState(value?: string): string {
  const state = String(value || "").trim().toLowerCase();
  if (!state || state === "unavailable" || state === "pending") return "待形成";
  if (state === "stale") return "待更新";
  if (state === "ready" || state === "available" || state === "complete") return "已就绪";
  return "已读取";
}

function relativeDate(value?: string): string {
  if (!value) return "暂无最近互动";
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "最近有互动";
  const diff = Math.max(0, Date.now() - stamp);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`;
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))} 天前`;
  return new Date(stamp).toLocaleDateString();
}

function universePosition(index: number, count: number): UniversePosition {
  const boundedCount = Math.max(1, count);
  if (boundedCount <= 8) {
    const angle = ((index / boundedCount) * Math.PI * 2) - (Math.PI / 2);
    const radius = 30;
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, ring: 0 };
  }
  const capacities = [8, 12, 16];
  const radii = [18, 31, 44];
  const ring = index < capacities[0] ? 0 : index < capacities[0] + capacities[1] ? 1 : 2;
  const ringStart = ring === 0 ? 0 : ring === 1 ? capacities[0] : capacities[0] + capacities[1];
  const ringCount = Math.min(capacities[ring], Math.max(1, boundedCount - ringStart));
  const slot = Math.min(index - ringStart, ringCount - 1);
  const phase = -(Math.PI / 2) + (ring % 2 === 1 ? Math.PI / ringCount : 0);
  const angle = phase + ((slot / ringCount) * Math.PI * 2);
  const radius = radii[ring];
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, ring };
}

function relationshipMatchesQuery(relationship: RelationshipProjection, query: string): boolean {
  if (!query) return true;
  const haystack = [
    relationship.name,
    relationship.subtitle,
    relationship.platform,
    relationship.lastMessage,
    ...relationship.conversations.flatMap((conversation) => [conversation.title, conversation.platform, conversation.chatJid]),
  ].map((value) => String(value || "").toLocaleLowerCase()).join("\n");
  return haystack.includes(query.toLocaleLowerCase());
}

function relationshipPlatformFilter(relationship: RelationshipProjection): Exclude<PeopleFilter, "all"> | "" {
  const conversation = relationship.conversations.find((row) => !row.archived) || relationship.conversations[0];
  const platform = String(relationship.platform || conversation?.platform || "").trim().toLowerCase();
  if (platform.includes("facebook")) return "facebook";
  if (platform.includes("telegram")) return "telegram";
  if (platform.includes("whatsapp")) return "whatsapp";
  return "";
}

function relationshipRecentMessage(relationship: RelationshipProjection): string {
  const blocked = new Set(
    [
      relationship.name,
      relationship.platform,
      relationship.subtitle,
      ...relationship.conversations.flatMap((conversation) => [conversation.title, conversation.platform]),
    ]
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const candidates = [
    ...relationship.conversations.map((conversation) => String(conversation.lastMessage || "").trim()),
    String(relationship.lastMessage || "").trim(),
  ];
  return candidates.find((candidate) => candidate && !blocked.has(candidate.toLocaleLowerCase())) || "";
}

function personaScopeLabel(value?: string): string {
  const scope = String(value || "").trim().toLowerCase();
  if (scope.includes("conversation")) return "本次对话";
  if (scope.includes("contact")) return "联系人覆盖";
  if (scope.includes("global")) return "全局默认";
  return scope ? "现有人格系统" : "待形成";
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "账号服务没有返回可用结果，请检查账号连接后重试。";
}

export function PeopleSurface({
  relationships,
  groups,
  renderRoomAvatar,
  selectedRelationshipId,
  focusedRelationshipId,
  viewMode,
  reducedMotion,
  soundMode,
  getMatrixUserId,
  onViewModeChange,
  onFocus,
  onSelect,
  onContinueConversation,
  onSelectGroup,
  onConnectAccounts,
  onRefreshRelationships,
}: PeopleSurfaceProps): React.JSX.Element {
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [query, setQuery] = useState("");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addContactLoading, setAddContactLoading] = useState(false);
  const [addContactBusy, setAddContactBusy] = useState(false);
  const [addContactAccounts, setAddContactAccounts] = useState<readonly PlatformAccountProjection[]>([]);
  const [selectedAddContactAccountId, setSelectedAddContactAccountId] = useState("");
  const [addContactIdentifier, setAddContactIdentifier] = useState("");
  const [addContactStatus, setAddContactStatus] = useState("");
  const [humanTypingModeLabel, setHumanTypingModeLabel] = useState("读取中");
  const [effectivePersonaLabel, setEffectivePersonaLabel] = useState("待形成");
  const [effectivePersonaScope, setEffectivePersonaScope] = useState("待形成");

  useEffect(() => {
    let current = true;
    void loadHumanTypingProjection()
      .then((projection) => { if (current) setHumanTypingModeLabel(projection.modeLabel); })
      .catch(() => { if (current) setHumanTypingModeLabel("不可用"); });
    return () => { current = false; };
  }, []);

  const visibleRelationships = useMemo(() => {
    const normalizedQuery = query.trim();
    let rows = [...relationships].filter((row) => relationshipMatchesQuery(row, normalizedQuery));
    if (filter !== "all") rows = rows.filter((row) => relationshipPlatformFilter(row) === filter);
    return rows;
  }, [relationships, filter, query]);

  const focusedRelationship = visibleRelationships.find((row) => row.id === focusedRelationshipId)
    || visibleRelationships.find((row) => row.id === selectedRelationshipId)
    || visibleRelationships[0]
    || null;
  const focusedIntelligence = focusedRelationship?.relationshipIntelligence;
  const latestEvidence = focusedIntelligence?.events.at(-1) || null;
  const primaryConversation = focusedRelationship?.conversations.find((row) => !row.archived)
    || focusedRelationship?.conversations[0]
    || null;
  const focusedRecentMessage = focusedRelationship ? relationshipRecentMessage(focusedRelationship) : "";
  const platformCounts = useMemo(() => ({
    facebook: relationships.filter((row) => relationshipPlatformFilter(row) === "facebook").length,
    telegram: relationships.filter((row) => relationshipPlatformFilter(row) === "telegram").length,
    whatsapp: relationships.filter((row) => relationshipPlatformFilter(row) === "whatsapp").length,
  }), [relationships]);

  useEffect(() => {
    let current = true;
    if (!focusedRelationship) {
      setEffectivePersonaLabel("待形成");
      setEffectivePersonaScope("待形成");
      return () => { current = false; };
    }
    void loadPersonaEffective({ contactId: focusedRelationship.id, conversationId: primaryConversation?.id })
      .then((persona) => {
        if (!current) return;
        setEffectivePersonaLabel(persona.available ? ([persona.profileName, persona.version].filter(Boolean).join(" · ") || "已生效") : "待形成");
        setEffectivePersonaScope(persona.available ? personaScopeLabel(persona.sourceScope) : "待形成");
      })
      .catch(() => {
        if (current) { setEffectivePersonaLabel("待形成"); setEffectivePersonaScope("待形成"); }
      });
    return () => { current = false; };
  }, [focusedRelationship?.id, primaryConversation?.id]);
  const emptyPeopleHome = relationships.length === 0 && groups.length === 0;
  const universeRelationships = visibleRelationships.slice(0, 36);
  const denseUniverse = universeRelationships.length >= 8;
  const universeEntries = universeRelationships.map((relationship, index) => ({
    relationship,
    position: universePosition(index, universeRelationships.length),
  }));

  const directChatAccounts = useMemo(
    () => addContactAccounts.filter((account) => account.authority.toLowerCase().startsWith("mautrix-")),
    [addContactAccounts],
  );
  const selectedAddContactAccount = directChatAccounts.find((account) => account.id === selectedAddContactAccountId) || null;

  const chooseFocus = (relationship: RelationshipProjection): void => {
    playExperienceSound(soundMode, "open");
    onFocus(relationship.id);
  };

  const enterWorld = (): void => {
    if (!focusedRelationship) return;
    playExperienceSound(soundMode, "confirm");
    onSelect(focusedRelationship.id);
  };

  const continueConversation = (): void => {
    if (!focusedRelationship || !primaryConversation) return;
    playExperienceSound(soundMode, "confirm");
    onContinueConversation(focusedRelationship, primaryConversation);
  };

  const openAddContact = async (): Promise<void> => {
    playExperienceSound(soundMode, "open");
    setAddContactOpen(true);
    setAddContactLoading(true);
    setAddContactStatus("正在读取当前真实账号连接…");
    setAddContactIdentifier("");
    try {
      const matrixUserId = getMatrixUserId?.().trim() || "";
      if (!matrixUserId) {
        setAddContactAccounts([]);
        setSelectedAddContactAccountId("");
        setAddContactStatus("当前账号连接尚未就绪。请先完成账号登录，再添加联系人。");
        return;
      }
      const accounts = await loadPlatformAccounts(matrixUserId);
      setAddContactAccounts(accounts);
      const supported = accounts.filter((account) => account.authority.toLowerCase().startsWith("mautrix-"));
      const preferred = supported.find((account) => account.isDefault) || supported[0] || null;
      setSelectedAddContactAccountId(preferred?.id || "");
      setAddContactStatus(supported.length
        ? "选择已连接账号并输入平台联系人标识。言策会通过该账号定位真实直聊。"
        : "当前已连接账号没有提供可用的真实直聊创建能力。请先管理账号连接。");
    } catch (error) {
      setAddContactAccounts([]);
      setSelectedAddContactAccountId("");
      setAddContactStatus(errorText(error));
    } finally {
      setAddContactLoading(false);
    }
  };

  const submitAddContact = async (): Promise<void> => {
    if (addContactBusy) return;
    const matrixUserId = getMatrixUserId?.().trim() || "";
    const identifier = addContactIdentifier.trim();
    if (!matrixUserId) {
      setAddContactStatus("当前账号连接尚未就绪，暂时不能定位真实直聊。");
      return;
    }
    if (!selectedAddContactAccount || !identifier) {
      setAddContactStatus("请选择支持真实直聊的账号，并填写联系人标识。");
      return;
    }
    setAddContactBusy(true);
    setAddContactStatus(`正在通过 ${selectedAddContactAccount.label} 定位真实直聊…`);
    try {
      const result = await runPlatformAccountCommand(
        selectedAddContactAccount.id,
        "provisioning-direct-chat-ensure",
        { identifier, matrixUserId },
      );
      const roomId = String(result.roomId || result.room_id || "").trim();
      if (!roomId) throw new Error("平台没有返回可用的真实会话，未创建本地联系人。");
      await onRefreshRelationships();
      setAddContactStatus(`真实直聊已由 ${selectedAddContactAccount.label} 定位并刷新到 People。`);
      setAddContactIdentifier("");
      playExperienceSound(soundMode, "confirm");
    } catch (error) {
      setAddContactStatus(errorText(error));
    } finally {
      setAddContactBusy(false);
    }
  };

  if (viewMode === "universe") {
    return (
      <section className="yance-people yance-people--universe" aria-label="关系宇宙">
        <header className="yance-people-modebar">
          <div>
            <span className="yance-eyebrow">Relationship Universe</span>
            <h2>关系宇宙</h2>
          </div>
          <div className="yance-people-modebar__actions">
            <button type="button" onClick={() => onViewModeChange("list")}>返回首页</button>
          </div>
        </header>
        <section className="yance-relationship-universe" aria-labelledby="yance-relationship-universe-title">
          <div className="yance-relationship-universe__canvas">
            <header className="yance-relationship-universe__heading">
              <div>
                <span className="yance-eyebrow">沉浸关系视图</span>
                <h3 id="yance-relationship-universe-title">从你出发，看见每段关系</h3>
              </div>
              <p>空间位置只用于导航，不代表亲密度、重要性或关系强弱。</p>
            </header>
            <div className="yance-relationship-universe__stage" data-dense={denseUniverse || undefined}>
              <svg className="yance-relationship-universe__spokes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {universeEntries.map(({ relationship, position }) => (
                  <line key={`spoke-${relationship.id}`} className="yance-relationship-universe__spoke" x1="50" y1="50" x2={position.x} y2={position.y} />
                ))}
              </svg>
              <div className="yance-relationship-universe__center" aria-hidden="true"><span>我</span></div>
              {universeEntries.map(({ relationship, position }) => {
                const focused = relationship.id === focusedRelationship?.id;
                const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel || "关系洞察待形成";
                return (
                  <motion.button
                    key={relationship.id}
                    type="button"
                    className="yance-relationship-universe__node"
                    data-focused={focused || undefined}
                    data-ring={position.ring}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                    aria-pressed={focused}
                    aria-label={`查看 ${relationship.name} 的关系洞察。${analysisStatusLabel}`}
                    onClick={() => chooseFocus(relationship)}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                  >
                    <span id={`relationship-avatar-${relationship.id}`} className="yance-relationship-universe__node-avatar" aria-hidden="true">
                      {relationshipAvatar(relationship, renderRoomAvatar, "42px")}
                    </span>
                    <span className="yance-relationship-universe__node-copy">
                      <strong>{relationship.name}</strong>
                      <span>{analysisStatusLabel}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
          <aside className="yance-relationship-universe__insight" aria-label="关系洞察">
            {focusedRelationship ? (
              <>
                <span className="yance-eyebrow">当前焦点</span>
                <h3>{focusedRelationship.name}</h3>
                <p>{focusedRelationship.subtitle}</p>
                <dl className="yance-relationship-universe__facts">
                  <div><dt>状态</dt><dd>{focusedIntelligence?.analysisStatusLabel || "待形成"}</dd></div>
                  {focusedIntelligence?.stage ? <div><dt>阶段</dt><dd>{focusedIntelligence.stage}</dd></div> : null}
                  {focusedIntelligence?.summary ? <div><dt>关系摘要</dt><dd>{focusedIntelligence.summary}</dd></div> : null}
                  {latestEvidence ? <div><dt>最近时刻</dt><dd>{latestEvidence.title}</dd></div> : null}
                </dl>
                <button type="button" className="yance-relationship-universe__enter" onClick={enterWorld}>进入关系世界</button>
              </>
            ) : (
              <div className="yance-empty yance-empty--onboarding" role="status">
                <span className="yance-eyebrow">从真实连接开始</span>
                <strong>这里还没有关系</strong>
                <p>连接你常用的聊天平台后，真实联系人和对话会逐步出现在这里。</p>
                <button type="button" className="yance-button-primary" onClick={onConnectAccounts}>连接聊天平台</button>
              </div>
            )}
          </aside>
        </section>
      </section>
    );
  }

  return (
    <section className="yance-people yance-people-home yance-people-home-v4" data-empty={emptyPeopleHome || undefined} aria-label="People 首页">

      <aside className="yance-v4-contacts" aria-label="联系人">
        <header><h2>联系人</h2><button type="button" onClick={openAddContact}>＋ 添加联系人</button></header>
        <label className="yance-v4-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索联系人、平台或消息…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索联系人" /></label>
        <div className="yance-v4-filters" aria-label="关系筛选">
          {([["all", `全部 ${relationships.length}`], ["facebook", `Facebook ${platformCounts.facebook}`], ["telegram", `Telegram ${platformCounts.telegram}`], ["whatsapp", `WhatsApp ${platformCounts.whatsapp}`]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="yance-v4-contact-list" role="list">
          {visibleRelationships.map((relationship) => {
            const active = relationship.id === focusedRelationship?.id;
            const conversation = relationship.conversations.find((row) => !row.archived) || relationship.conversations[0];
            return <motion.button key={relationship.id} type="button" role="listitem" className="yance-v4-contact" data-selected={active || undefined}
              onClick={() => chooseFocus(relationship)} onFocus={() => onFocus(relationship.id)} whileTap={reducedMotion ? undefined : { scale: 0.985 }}>
              <span className="yance-v4-contact__avatar" aria-hidden="true">{relationshipAvatar(relationship, renderRoomAvatar, "44px")}</span>
              <span className="yance-v4-contact__copy"><strong>{relationship.name}</strong><span>{relationship.platform || "已连接关系"} · {relativeDate(relationship.recentAt || relationship.updatedAt)}</span></span>
              {conversation ? <span className="yance-v4-contact__action" aria-hidden="true">继续对话</span> : null}
              {relationship.unreadCount > 0 ? <span className="yance-v4-contact__unread">{relationship.unreadCount}</span> : null}
            </motion.button>;
          })}
          {!visibleRelationships.length ? <div className="yance-v4-empty" role="status"><strong>{query.trim() ? "没有匹配的真实联系人" : "这里会出现真实联系人"}</strong><span>{query.trim() ? "换一个姓名、平台或对话标识继续搜索。" : "连接平台后，已有会话会安全地投影到 People。"}</span>{!query.trim() ? <button type="button" onClick={onConnectAccounts}>连接聊天平台</button> : null}</div> : null}
        </div>
        {groups.length ? <details className="yance-v4-groups"><summary>群聊 · {groups.length}</summary>{groups.map((group) => <button key={group.id} type="button" onClick={() => onSelectGroup(group)}>{group.title}</button>)}</details> : null}
      </aside>

      <main className="yance-v4-main" aria-label="今天值得关注">
        <header className="yance-v4-page-title yance-v4-page-title--compact"><div className="yance-v4-page-title__line"><h1>今天值得关注</h1><p>不是看数据，而是知道现在最值得处理哪段关系</p></div><time dateTime={new Date().toISOString().slice(0, 10)}>{new Date().toLocaleDateString()}</time></header>
        {focusedRelationship ? <>
          <article className="yance-v4-focus-card">
            <div className="yance-v4-focus-card__identity"><span className="yance-v4-focus-card__avatar" aria-hidden="true">{relationshipAvatar(focusedRelationship, renderRoomAvatar, "72px")}</span><div><span>继续对话 · 当前最值得接住</span><h2>{focusedRelationship.name}</h2><p className="yance-v4-focus-card__summary">{focusedIntelligence?.summary || focusedRelationship.subtitle || "这段关系正在基于真实互动形成可靠画像。"}</p>{focusedRecentMessage ? <blockquote className="yance-v4-focus-card__message">“{focusedRecentMessage}”</blockquote> : null}</div></div>
            <dl><div><dt>最近互动</dt><dd>{relativeDate(focusedRelationship.recentAt || focusedRelationship.updatedAt)}</dd></div><div><dt>关系状态</dt><dd>{relationshipInsightState(focusedIntelligence?.state)}</dd></div><div><dt>当前人格</dt><dd>{effectivePersonaLabel}{effectivePersonaScope !== "待形成" ? ` · ${effectivePersonaScope}` : ""}</dd></div></dl>
            <div className="yance-v4-focus-card__next"><span>言策建议的下一步</span><strong>{focusedIntelligence?.next || "保持温度，先回应真实对话，再决定是否继续话题。"}</strong></div>
            <div className="yance-v4-focus-card__actions"><button type="button" onClick={continueConversation} disabled={!primaryConversation}>继续 {focusedRelationship.name} 的对话</button><button type="button" onClick={enterWorld}>查看关系上下文</button></div>
          </article>
          <section className="yance-v4-section" aria-labelledby="yance-v4-attention"><header><h2 id="yance-v4-attention">我现在最应该关注谁</h2><span>按未完成对话、关系节奏与近期互动排序</span></header><div className="yance-v4-attention-list">
            {visibleRelationships.slice(0, 3).map((relationship) => <button key={relationship.id} type="button" onClick={() => chooseFocus(relationship)}><span className="yance-v4-contact__avatar" aria-hidden="true">{relationshipAvatar(relationship, renderRoomAvatar, "38px")}</span><span><strong>{relationship.name}</strong><small>{relationship.unreadCount ? `有 ${relationship.unreadCount} 条消息等待回应` : relationshipRecentMessage(relationship) || relationship.subtitle || "最近有真实互动"}</small></span><em>{relationship.id === focusedRelationship.id ? "当前关注" : "查看关系 ›"}</em></button>)}
          </div></section>
          <section className="yance-v4-section yance-v4-recent" aria-labelledby="yance-v4-recent"><header><h2 id="yance-v4-recent">最近的人</h2><span>来自现有联系人投影</span></header><div>{visibleRelationships.slice(0, 4).map((relationship) => <button key={relationship.id} type="button" onClick={() => chooseFocus(relationship)}><span className="yance-v4-contact__avatar" aria-hidden="true">{relationshipAvatar(relationship, renderRoomAvatar, "38px")}</span><strong>{relationship.name}</strong><small>{relationship.platform || "真实联系人"} · {relativeDate(relationship.recentAt || relationship.updatedAt)}</small></button>)}</div></section>
        </> : <div className="yance-v4-empty" role="status"><h2>{query.trim() ? "没有匹配的真实联系人" : "从真实关系开始"}</h2><p>{query.trim() ? "当前筛选不会生成虚构人物；换一个搜索词即可返回。" : "没有联系人时，言策不会编造演示人物或对话。"}</p>{!query.trim() ? <button type="button" onClick={onConnectAccounts}>连接聊天平台</button> : null}</div>}
      </main>

      <aside className="yance-v4-guide" aria-label="今日关系导航">
        <header><h2>今日关系导航</h2><span>只显示需要处理的事</span></header>
        {focusedRelationship ? <>
          <section className="yance-v4-guide__persona"><span>当前生效人格</span><strong>{effectivePersonaLabel}</strong><p>{effectivePersonaScope} · 当前关注 {focusedRelationship.name}</p></section>
          <section><h3>关系提醒</h3><ul>{focusedRelationship.unreadCount ? <li>有 {focusedRelationship.unreadCount} 条消息尚未回应</li> : null}<li>{latestEvidence?.title || "继续互动后会形成下一条可信关系时刻"}</li><li>关系洞察：{focusedIntelligence?.analysisStatusLabel || "待形成"}</li></ul></section>
          <section><h3>今日目标</h3><p>{focusedIntelligence?.next || "保持关系节奏，优先处理未完成的真实对话。"}</p></section>
          <section className="yance-v4-guide__environment"><h3>全局环境</h3><p>真人打字 · 全局：{humanTypingModeLabel}</p><p>{relationships.length} 位联系人 · {groups.length} 个群聊</p></section>
        </> : null}
      </aside>

      {addContactOpen ? (
        <div className="yance-v4-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !addContactBusy) setAddContactOpen(false);
        }}>
          <aside className="yance-v4-add-contact" role="dialog" aria-modal="true" aria-labelledby="yance-v4-add-contact-title">
            <header>
              <div><span className="yance-eyebrow">真实账号能力</span><h2 id="yance-v4-add-contact-title">添加联系人</h2></div>
              <button type="button" onClick={() => setAddContactOpen(false)} disabled={addContactBusy} aria-label="关闭添加联系人">×</button>
            </header>
            <p>言策不会建立本地假联系人。提交后会通过所选平台账号定位真实会话，再刷新 People。</p>
            {addContactLoading ? <div className="yance-v4-add-contact__loading" role="status">正在读取真实账号…</div> : (
              <>
                {directChatAccounts.length ? (
                  <label className="yance-v4-field"><span>平台账号</span><select value={selectedAddContactAccountId} onChange={(event) => setSelectedAddContactAccountId(event.target.value)} disabled={addContactBusy}>
                    {directChatAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.platform || "已连接平台"}</option>)}
                  </select></label>
                ) : (
                  <div className="yance-v4-add-contact__owner-empty"><strong>没有可用的真实直聊账号</strong><span>当前账号没有提供可用的真实直聊能力。</span><button type="button" onClick={onConnectAccounts}>管理账号连接</button></div>
                )}
                <label className="yance-v4-field"><span>联系人标识</span><input value={addContactIdentifier} onChange={(event) => setAddContactIdentifier(event.target.value)} disabled={addContactBusy || !directChatAccounts.length} placeholder="例如 Telegram 用户 ID / 平台支持的精确标识" autoComplete="off" /></label>
                <div className="yance-v4-add-contact__status" role="status" aria-live="polite">{addContactStatus}</div>
                <footer><button type="button" onClick={() => setAddContactOpen(false)} disabled={addContactBusy}>取消</button><button type="button" className="yance-button-primary" onClick={() => void submitAddContact()} disabled={addContactBusy || !selectedAddContactAccount || !addContactIdentifier.trim()}>{addContactBusy ? "正在定位真实会话…" : "添加并刷新 People"}</button></footer>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
