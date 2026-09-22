import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { playExperienceSound } from "./experienceSound";
import type {
  ConversationRef,
  GroupConversationProjection,
  RelationshipProjection,
  SoundMode,
} from "./experienceTypes";

export type PeopleHomeView = "list" | "universe";
type PeopleFilter = "all" | "unread" | "favorite" | "recent";
type CompactPane = "people" | "portrait" | "actions";

type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  groups: readonly GroupConversationProjection[];
  renderRoomAvatar?: (roomId: string, size?: string) => React.ReactNode;
  selectedRelationshipId: string;
  focusedRelationshipId: string;
  viewMode: PeopleHomeView;
  reducedMotion: boolean;
  soundMode: SoundMode;
  onViewModeChange: (view: PeopleHomeView) => void;
  onFocus: (relationshipId: string) => void;
  onSelect: (relationshipId: string) => void;
  onContinueConversation: (relationship: RelationshipProjection, conversation: ConversationRef) => void;
  onSelectGroup: (conversation: GroupConversationProjection) => void;
  onConnectAccounts: () => void;
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

export function PeopleSurface({
  relationships,
  groups,
  renderRoomAvatar,
  selectedRelationshipId,
  focusedRelationshipId,
  viewMode,
  reducedMotion,
  soundMode,
  onViewModeChange,
  onFocus,
  onSelect,
  onContinueConversation,
  onSelectGroup,
  onConnectAccounts,
}: PeopleSurfaceProps): React.JSX.Element {
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [compactPane, setCompactPane] = useState<CompactPane>("portrait");

  const visibleRelationships = useMemo(() => {
    const rows = [...relationships];
    if (filter === "unread") return rows.filter((row) => row.unreadCount > 0);
    if (filter === "favorite") return rows.filter((row) => row.favorite === true);
    if (filter === "recent") return rows.sort((a, b) => String(b.recentAt || "").localeCompare(String(a.recentAt || "")));
    return rows;
  }, [relationships, filter]);

  const focusedRelationship = visibleRelationships.find((row) => row.id === focusedRelationshipId)
    || visibleRelationships.find((row) => row.id === selectedRelationshipId)
    || visibleRelationships[0]
    || null;
  const focusedIntelligence = focusedRelationship?.relationshipIntelligence;
  const latestEvidence = focusedIntelligence?.events.at(-1) || null;
  const primaryConversation = focusedRelationship?.conversations.find((row) => !row.archived)
    || focusedRelationship?.conversations[0]
    || null;
  const emptyPeopleHome = relationships.length === 0 && groups.length === 0;
  const universeRelationships = visibleRelationships.slice(0, 36);
  const denseUniverse = universeRelationships.length >= 8;
  const universeEntries = universeRelationships.map((relationship, index) => ({
    relationship,
    position: universePosition(index, universeRelationships.length),
  }));

  const chooseFocus = (relationship: RelationshipProjection): void => {
    playExperienceSound(soundMode, "open");
    onFocus(relationship.id);
    setCompactPane("portrait");
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
    <section className="yance-people yance-people-home" data-empty={emptyPeopleHome || undefined} aria-label="People Home">
      <div className="yance-people-compact-switch" role="tablist" aria-label="紧凑窗口分区">
        <button type="button" role="tab" aria-selected={compactPane === "people"} onClick={() => setCompactPane("people")}>重要的人</button>
        <button type="button" role="tab" aria-selected={compactPane === "portrait"} onClick={() => setCompactPane("portrait")}>关系画像</button>
        <button type="button" role="tab" aria-selected={compactPane === "actions"} onClick={() => setCompactPane("actions")}>现在值得做什么</button>
      </div>

      <div className="yance-people-desktop">
        <aside className="yance-people-roster" data-compact-active={compactPane === "people" || undefined} aria-label="重要的人">
          <header className="yance-people-roster__header">
            <div>
              <span className="yance-eyebrow">People Home</span>
              <h2>重要的人</h2>
            </div>
            {relationships.length ? <span className="yance-count">{relationships.length}</span> : null}
          </header>
          {relationships.length ? (
            <div className="yance-people-filter" aria-label="关系筛选">
              {([["all", "全部"], ["unread", "未读"], ["favorite", "收藏"], ["recent", "最近"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>
          ) : null}
          <div className="yance-people-list" role="list" aria-label="关系列表">
            {visibleRelationships.map((relationship) => {
              const active = relationship.id === focusedRelationship?.id;
              return (
                <motion.button
                  key={relationship.id}
                  type="button"
                  role="listitem"
                  className="yance-person-card"
                  data-selected={active || undefined}
                  aria-pressed={active}
                  onClick={() => chooseFocus(relationship)}
                  onFocus={() => onFocus(relationship.id)}
                  onPointerEnter={() => onFocus(relationship.id)}
                  whileTap={reducedMotion ? undefined : { scale: 0.985 }}
                >
                  <span id={`relationship-avatar-${relationship.id}`} className="yance-avatar" aria-hidden="true">
                    {relationshipAvatar(relationship, renderRoomAvatar, "40px")}
                  </span>
                  <span className="yance-person-copy">
                    <span className="yance-person-copy__line">
                      <strong>{relationship.name}</strong>
                      {relationship.favorite ? <span aria-label="收藏">★</span> : null}
                    </span>
                    <span className="yance-person-preview">{relationship.lastMessage || relationship.subtitle || "已连接关系"}</span>
                    <span className="yance-person-date">{relativeDate(relationship.recentAt || relationship.updatedAt)}</span>
                  </span>
                  {relationship.unreadCount > 0 ? <span className="yance-person-unread">{relationship.unreadCount}</span> : null}
                </motion.button>
              );
            })}
            {!visibleRelationships.length ? (
              filter === "all" && !relationships.length ? (
                <div className="yance-empty yance-empty--roster" role="status">
                  <strong>这里会出现你真正联系的人</strong>
                  <span>完成一次真实平台连接后，联系人会按现有会话进入这里。</span>
                </div>
              ) : <div className="yance-empty" role="status"><strong>当前筛选下暂无关系</strong><span>试试切换到“全部”查看已有关系。</span></div>
            ) : null}
          </div>
          {groups.length ? (
            <details className="yance-people-groups" aria-labelledby="yance-groups-title">
              <summary id="yance-groups-title">群聊 · {groups.length}</summary>
              <div className="yance-people-list">
                {groups.map((group) => (
                  <button key={group.id} type="button" className="yance-person-card" data-conversation-kind="group" onClick={() => onSelectGroup(group)}>
                    <span className="yance-avatar" aria-hidden="true">{initials(group.title)}</span>
                    <span className="yance-person-copy"><strong>{group.title}</strong><span>{group.platform || "群聊"}</span></span>
                    {group.unreadCount > 0 ? <span className="yance-person-unread">{group.unreadCount}</span> : null}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </aside>

        <main className="yance-relationship-portrait" data-compact-active={compactPane === "portrait" || undefined} aria-label="关系画像">
          {focusedRelationship ? (
            <>
              <section className="yance-portrait-hero">
                <div className="yance-portrait-photo" aria-hidden="true">
                  {relationshipAvatar(focusedRelationship, renderRoomAvatar, "72px")}
                </div>
                <div className="yance-portrait-identity">
                  <span className="yance-eyebrow">Relationship Portrait</span>
                  <h2>{focusedRelationship.name}{focusedRelationship.favorite ? <span aria-label="收藏"> ★</span> : null}</h2>
                  <div className="yance-portrait-chips">
                    {focusedRelationship.platform ? <span>{focusedRelationship.platform}</span> : null}
                    <span>{focusedRelationship.conversations.length} 个真实对话</span>
                    {focusedRelationship.unreadCount > 0 ? <span>{focusedRelationship.unreadCount} 条未读</span> : null}
                  </div>
                  <blockquote>{focusedIntelligence?.summary || focusedRelationship.lastMessage || focusedRelationship.subtitle || "这段关系的可信画像正在形成。"}</blockquote>
                  <div className="yance-portrait-actions">
                    <button type="button" className="yance-button-primary" disabled={!primaryConversation} onClick={continueConversation}>继续对话</button>
                    <button type="button" className="yance-button-secondary" onClick={enterWorld}>进入关系世界</button>
                    <button type="button" className="yance-button-quiet" onClick={() => onViewModeChange("universe")}>关系宇宙</button>
                  </div>
                </div>
              </section>

              <section className="yance-portrait-dashboard">
                <article className="yance-portrait-card yance-portrait-status">
                  <span className="yance-eyebrow">关系状态</span>
                  <strong>{focusedIntelligence?.analysisStatusLabel || "关系洞察待形成"}</strong>
                  <p>{focusedIntelligence?.stage || "言策不会用本地行为猜测亲密度或关系阶段。"}</p>
                </article>
                <article className="yance-portrait-card">
                  <span className="yance-eyebrow">关系维度</span>
                  <dl className="yance-portrait-facts">
                    <div><dt>最近互动</dt><dd>{relativeDate(focusedRelationship.recentAt || focusedRelationship.updatedAt)}</dd></div>
                    <div><dt>真实对话</dt><dd>{focusedRelationship.conversations.length}</dd></div>
                    <div><dt>关系洞察</dt><dd>{relationshipInsightState(focusedIntelligence?.state)}</dd></div>
                  </dl>
                </article>
                <article className="yance-portrait-card yance-portrait-mini-universe">
                  <span className="yance-eyebrow">我们的关系世界</span>
                  <button type="button" onClick={() => onViewModeChange("universe")} aria-label="打开关系宇宙">
                    <span className="yance-mini-orbit"><span>♥</span></span>
                    <strong>进入沉浸关系视图</strong>
                  </button>
                </article>
              </section>

              <section className="yance-portrait-moments" aria-label="最近的时刻">
                <header><div><span className="yance-eyebrow">Recent Moments</span><strong>最近的时刻</strong></div></header>
                <div className="yance-moment-strip">
                  {focusedIntelligence?.events.length ? focusedIntelligence.events.slice(-4).reverse().map((event, index) => (
                    <article key={`${event.at}-${index}`}>
                      <span>{event.at && Number.isFinite(Date.parse(event.at)) ? new Date(event.at).toLocaleDateString() : "关系时刻"}</span>
                      <strong>{event.title}</strong>
                      {event.detail && event.detail !== event.title ? <p>{event.detail}</p> : null}
                    </article>
                  )) : <article><span>关系时刻</span><strong>等待下一次可信互动</strong><p>有真实事件后会自动出现在这里。</p></article>}
                </div>
              </section>
            </>
          ) : (
            <div className="yance-empty yance-empty--hero" role="status">
              <div className="yance-empty__relationship-orbit" aria-hidden="true">
                <span className="yance-empty__orbit-node yance-empty__orbit-node--one">•</span>
                <span className="yance-empty__orbit-node yance-empty__orbit-node--two">•</span>
                <span className="yance-empty__orbit-node yance-empty__orbit-node--three">•</span>
                <span className="yance-empty__orbit-core">✦</span>
              </div>
              <span className="yance-eyebrow">从真实关系开始</span>
              <strong>把重要的人，带进言策</strong>
              <span>连接你正在使用的聊天平台。言策只基于真实联系人、真实会话和真实关系时刻建立关系视图。</span>
              <div className="yance-empty__actions">
                <button type="button" className="yance-button-primary" onClick={onConnectAccounts}>连接聊天平台</button>
              </div>
            </div>
          )}
        </main>

        <aside className="yance-next-actions" data-compact-active={compactPane === "actions" || undefined} aria-label="现在值得做什么">
          <header><span className="yance-eyebrow">下一步</span><h2>{focusedRelationship ? "现在值得做什么" : "连接之后会发生什么"}</h2></header>
          {focusedRelationship ? (
            <>
              <div className="yance-action-recommendations">
                {focusedIntelligence?.next ? (
                  <article className="yance-action-card yance-action-card--highlight"><span>关系洞察</span><strong>{focusedIntelligence.next}</strong></article>
                ) : null}
                {focusedRelationship.unreadCount ? (
                  <article className="yance-action-card"><span>未读消息</span><strong>有 {focusedRelationship.unreadCount} 条消息等待回应</strong></article>
                ) : null}
                {latestEvidence ? (
                  <article className="yance-action-card"><span>最近关系时刻</span><strong>{latestEvidence.title}</strong></article>
                ) : null}
                {!focusedIntelligence?.next && !focusedRelationship.unreadCount && !latestEvidence ? (
                  <article className="yance-action-card">
                    <span>保持联系</span>
                    <strong>继续真实对话，或进入关系世界查看已有内容</strong>
                  </article>
                ) : null}
              </div>
              <div className="yance-next-actions__primary">
                <button type="button" className="yance-button-primary" onClick={enterWorld}>进入关系世界</button>
                <button type="button" className="yance-button-secondary" onClick={continueConversation} disabled={!primaryConversation}>继续对话</button>
              </div>
              <section className="yance-relationship-dynamics">
                <span className="yance-eyebrow">关系动态</span>
                <ul>
                  <li><strong>最近互动</strong><span>{relativeDate(focusedRelationship.recentAt || focusedRelationship.updatedAt)}</span></li>
                  <li><strong>对话</strong><span>{focusedRelationship.conversations.length} 个真实会话</span></li>
                  <li><strong>分析状态</strong><span>{focusedIntelligence?.analysisStatusLabel || "待形成"}</span></li>
                </ul>
              </section>
              <blockquote className="yance-relationship-quote">好的关系，是让彼此成为更好的人。</blockquote>
            </>
          ) : (
            <ol className="yance-onboarding-guide">
              <li><span>01</span><div><strong>连接真实平台</strong><p>从你正在使用的聊天平台开始，不创建假联系人或演示会话。</p></div></li>
              <li><span>02</span><div><strong>整理真实关系</strong><p>已有联系人、会话和关系时刻进入 People Home。</p></div></li>
              <li><span>03</span><div><strong>进入关系世界</strong><p>有真实数据后再开启关系洞察、对话与 AI 辅助。</p></div></li>
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}
