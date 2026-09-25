import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { RiveRelationshipCompanion } from "./RiveRelationshipCompanion";
import {
  correctInference, deleteDailyChatGoal, exportConversation, importPersona, listPersonaProfiles, listPersonaVersions,
  loadDailyChatGoal, loadDailyReview, loadPersonaEffective, loadRelationshipDataTargets, markRelationshipKeyNode,
  mergeContacts, previewPersonaCharacterCard, reviewContactProfile, setConversationArchived, setConversationPinned,
  setPersonaScope, undoContactMerge, unmarkRelationshipKeyNode, upsertDailyChatGoal,
} from "./experienceProjection";
import { captureExperienceFocus, requestRelationshipOverlay } from "./experienceSession";
import type {
  DailyReviewProjection, PersonaEffectiveProjection, PersonaProfileProjection, RelationshipAiState,
  RelationshipIntelligenceEvent, RelationshipProjection,
} from "./experienceTypes";

type MergeTarget = { id: string; name: string };
type RelationshipDataTarget = { id: string; kind: "timeline" | "signal"; label: string };
type CharacterCardPreview = { ok?: boolean; name?: string; description?: string };
type WorldTab = "overview" | "moments" | "journey" | "history" | "insights";
type RelationshipObjectFilter = "recent" | "important" | "all";
type RelationshipWorldProps = {
  relationship: RelationshipProjection; relationships: readonly RelationshipProjection[];
  aiState: RelationshipAiState; reducedMotion: boolean;
  assistantVisible: boolean; onBack: () => void; onToggleAssistant: () => void;
  onSelectRelationship: (relationshipId: string) => void;
  onOpenConversation: (conversationId: string) => void; mergeTargets?: readonly MergeTarget[];
  onRefresh?: () => void | Promise<void>;
};
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function laneLabel(value: unknown): string {
  const row = record(value); return text(row.title || row.label || row.value || row.text || row.summary);
}
function browserLocalDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (kind: string): string => parts.find((part) => part.type === kind)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function browserTimeZone(): string {
  const value = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  if (!value) return "";
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date()); return value; }
  catch { return ""; }
}
function evidenceSourceLabel(event: RelationshipIntelligenceEvent): string {
  if (event.source === "graphiti") return event.kind === "fact" && /用户确认/u.test(event.sourceLabel) ? "用户确认" : "关系线索";
  if (event.source === "user_annotation") return "用户标注";
  return event.sourceLabel || "关系记录";
}
function timelineAuthorityLabel(value: string): string {
  if (value === "graphiti_temporal_inference") return "关系线索";
  if (value === "user_annotation") return "用户标注";
  return "暂无关系记录";
}

export function RelationshipWorld({
  relationship, relationships, aiState, reducedMotion, assistantVisible, onBack, onToggleAssistant,
  onSelectRelationship, onOpenConversation, mergeTargets = [], onRefresh,
}: RelationshipWorldProps): React.JSX.Element {
  const intelligence = relationship.relationshipIntelligence;
  const hasAiAnalysis = intelligence?.source === "ai_analysis";
  const events = intelligence?.events || [];
  const localDate = useMemo(browserLocalDate, [relationship.id]);
  const timeZone = useMemo(browserTimeZone, [relationship.id]);
  const [selectedConversationId, setSelectedConversationId] = useState(
    relationship.conversations.length === 1 ? relationship.conversations[0].id : "",
  );
  const selectedConversation = relationship.conversations.find((row) => row.id === selectedConversationId) || null;
  const [goalText, setGoalText] = useState("");
  const [goalStatus, setGoalStatus] = useState("");
  const [review, setReview] = useState<DailyReviewProjection | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [profiles, setProfiles] = useState<readonly PersonaProfileProjection[]>([]);
  const [effectivePersona, setEffectivePersona] = useState<PersonaEffectiveProjection | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [versions, setVersions] = useState<readonly Record<string, unknown>[]>([]);
  const [cardPreview, setCardPreview] = useState<CharacterCardPreview | null>(null);
  const [personaStatus, setPersonaStatus] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeJournalId, setMergeJournalId] = useState("");
  const [dataTargets, setDataTargets] = useState<readonly RelationshipDataTarget[]>([]);
  const [selectedDataTargetId, setSelectedDataTargetId] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [dataStatus, setDataStatus] = useState("");
  const [worldTab, setWorldTab] = useState<WorldTab>("overview");
  const [objectQuery, setObjectQuery] = useState("");
  const [objectFilter, setObjectFilter] = useState<RelationshipObjectFilter>("recent");

  useEffect(() => {
    let cancelled = false;
    void loadDailyChatGoal(relationship.id, localDate)
      .then((payload) => { if (!cancelled) setGoalText(text(payload.goalText)); })
      .catch(() => { if (!cancelled) setGoalStatus("今天的聊天目标暂不可用"); });
    return () => { cancelled = true; };
  }, [relationship.id, localDate]);

  useEffect(() => {
    let cancelled = false;
    if (!timeZone) {
      setReview(null); setReviewStatus("当前时区不可用，今日回顾不会猜测日期边界");
      return () => { cancelled = true; };
    }
    void loadDailyReview(relationship.id, localDate, timeZone)
      .then((payload) => { if (!cancelled) { setReview(payload); setReviewStatus(""); } })
      .catch(() => { if (!cancelled) setReviewStatus("今日回顾暂不可用"); });
    return () => { cancelled = true; };
  }, [relationship.id, localDate, timeZone]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPersonaProfiles(),
      loadPersonaEffective({ contactId: relationship.id, conversationId: selectedConversation?.id }),
    ]).then(([profileRows, effective]) => {
      if (cancelled) return;
      setProfiles(profileRows); setEffectivePersona(effective);
      if (effective.profileId) setSelectedProfileId(effective.profileId);
    }).catch(() => { if (!cancelled) setPersonaStatus("人物设定暂不可用"); });
    return () => { cancelled = true; };
  }, [relationship.id, selectedConversation?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProfileId) { setVersions([]); return () => { cancelled = true; }; }
    void listPersonaVersions(selectedProfileId).then((rows) => { if (!cancelled) setVersions(rows); })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [selectedProfileId]);

  useEffect(() => {
    let cancelled = false;
    void loadRelationshipDataTargets(relationship.id)
      .then((rows) => {
        if (cancelled) return;
        setDataTargets(rows);
        setSelectedDataTargetId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
      })
      .catch(() => { if (!cancelled) { setDataTargets([]); setSelectedDataTargetId(""); } });
    return () => { cancelled = true; };
  }, [relationship.id]);

  const selectedDataTarget = dataTargets.find((row) => row.id === selectedDataTargetId) || null;
  const relationshipObjects = useMemo(() => {
    const query = objectQuery.trim().toLocaleLowerCase();
    const matchesQuery = (row: RelationshipProjection): boolean => !query || [
      row.name, row.subtitle, row.platform, row.lastMessage,
    ].some((value) => text(value).toLocaleLowerCase().includes(query));
    let rows = relationships.filter(matchesQuery);
    if (objectFilter === "important") rows = rows.filter((row) => row.favorite || row.unreadCount > 0);
    if (objectFilter === "recent") rows = [...rows].sort((left, right) =>
      (Date.parse(right.recentAt || right.updatedAt || "") || 0) - (Date.parse(left.recentAt || left.updatedAt || "") || 0));
    return rows;
  }, [relationships, objectFilter, objectQuery]);
  const primaryConversation = selectedConversation
    || relationship.conversations.find((row) => !row.archived)
    || relationship.conversations[0]
    || null;
  const recentEvents = [...events].slice(-4).reverse();
  const boundaryEvents = events.filter((event) => /boundary|promise|边界|承诺/iu.test(`${event.kind} ${event.title}`));
  const openLoopEvents = events.filter((event) => /open|loop|pending|未完成|待回应|待办/iu.test(`${event.kind} ${event.title}`));
  const openPrimaryConversation = (): void => {
    if (!primaryConversation) return;
    setSelectedConversationId(primaryConversation.id);
    onOpenConversation(primaryConversation.id);
  };
  const refresh = async (): Promise<void> => {
    await onRefresh?.();
    try {
      const rows = await loadRelationshipDataTargets(relationship.id);
      setDataTargets(rows);
      setSelectedDataTargetId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
    } catch { /* existing view remains authoritative when refresh transport is unavailable */ }
  };

  return <section className="yance-relationship-world yance-relationship-world-v4" data-world-tab={worldTab} aria-labelledby="yance-relationship-title">
    <div className="yance-rw-v4__workspace">
      <aside className="yance-rw-v4__objects" aria-label="关系对象">
        <header><div><span className="yance-eyebrow">People</span><h2>关系对象</h2></div><span>{relationships.length} 人</span></header>
        <label className="yance-rw-v4__search"><span aria-hidden="true">⌕</span><input type="search" value={objectQuery}
          onChange={(event) => setObjectQuery(event.currentTarget.value)} placeholder="搜索人物、平台或最近消息…" aria-label="搜索关系对象" /></label>
        <div className="yance-rw-v4__object-filters" aria-label="关系对象筛选">
          {([["recent", "最近"], ["important", "重要"], ["all", "全部"]] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={objectFilter === value} onClick={() => setObjectFilter(value)}>{label}</button>)}
        </div>
        <div className="yance-rw-v4__object-list" role="list">
          {relationshipObjects.map((row) => <button key={row.id} type="button" role="listitem" aria-current={row.id === relationship.id ? "page" : undefined}
            onClick={() => onSelectRelationship(row.id)}>
            <span className="yance-rw-v4__object-avatar" aria-hidden="true">{row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : row.name.trim().slice(0, 2).toUpperCase()}</span>
            <span className="yance-rw-v4__object-copy"><strong>{row.name}</strong><small>{row.platform || "真实关系"} · {row.recentAt || row.updatedAt ? new Date(row.recentAt || row.updatedAt || "").toLocaleDateString() : "暂无最近互动"}</small>
              <em>{row.relationshipIntelligence?.stage || row.relationshipIntelligence?.analysisStatusLabel || "关系洞察待形成"}</em></span>
            {row.unreadCount > 0 ? <span className="yance-rw-v4__object-unread">{row.unreadCount}</span> : null}
          </button>)}
          {!relationshipObjects.length ? <p className="yance-rw-v4__empty">没有匹配的真实关系对象。</p> : null}
        </div>
      </aside>
      <main className="yance-rw-v4__main">
    <header className="yance-world-header yance-rw-v4__header">
      <button type="button" className="yance-back" onClick={onBack} aria-label="返回我的关系">←</button>
      <div className="yance-world-identity"><span className="yance-eyebrow">关系世界</span>
        <h2 id="yance-relationship-title">{relationship.name} 的关系世界</h2>
        <p>关系、共同时段、目标与历史都围绕同一个真实人物展开，不复制聊天时间线。</p></div>
      <span className="yance-rw-v4__analysis-state">{intelligence?.analysisStatusLabel || "关系洞察待形成"}</span>
      <button type="button" className="yance-ai-toggle" aria-pressed={assistantVisible}
        aria-label={assistantVisible ? "收起私人任务" : "打开私人任务"} onClick={onToggleAssistant}>私人任务</button>
    </header>

    <nav className="yance-rw-v4__tabs" aria-label="关系世界视图">
      {([["overview", "总览"], ["moments", "共同时段"], ["journey", "关系图"], ["history", "历史"], ["insights", "洞察"]] as const)
        .map(([value, label]) => <button key={value} type="button" aria-current={worldTab === value ? "page" : undefined}
          onClick={() => setWorldTab(value)}>{label}</button>)}
    </nav>

    <article className="yance-rw-v4__hero">
      <div className="yance-rw-v4__hero-person">
        <motion.div layoutId={reducedMotion ? undefined : `relationship-avatar-${relationship.id}`}
          className="yance-world-avatar" aria-hidden="true">
          {relationship.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : relationship.name.trim().slice(0, 2).toUpperCase()}
        </motion.div>
        <div><span className="yance-eyebrow">当前关系</span><h3>{relationship.name}</h3>
          <p>{relationship.subtitle || relationship.platform || "真实关系"}</p></div>
      </div>
      <div className="yance-rw-v4__hero-summary">
        <strong>{intelligence?.summary || "关系结论只会在真实互动形成足够证据后出现。"}</strong>
        <p>{relationship.lastMessage || "最近互动会继续由真实对话和关系证据更新。"}</p>
      </div>
      <dl className="yance-rw-v4__hero-facts">
        <div><dt>当前阶段</dt><dd>{intelligence?.stage || "待建立"}</dd></div>
        <div><dt>最近互动</dt><dd>{relationship.recentAt || relationship.updatedAt ? new Date(relationship.recentAt || relationship.updatedAt || "").toLocaleDateString() : "暂无记录"}</dd></div>
        <div><dt>互动节奏</dt><dd>{intelligence?.momentum || "暂无可确认趋势"}</dd></div>
      </dl>
      <div className="yance-rw-v4__hero-actions">
        <button type="button" className="yance-button-primary" disabled={!primaryConversation} onClick={openPrimaryConversation}>进入真实对话</button>
        <button type="button" onClick={() => setWorldTab("moments")}>共同片段</button>
        <button type="button" onClick={() => setWorldTab("insights")}>编辑关系信息</button>
      </div>
    </article>

    <div className="yance-rw-v4__overview-grid">
      <section className="yance-rw-v4__journey" hidden={worldTab !== "overview" && worldTab !== "journey"} aria-label="关系旅程">
        <header><div><h3>关系旅程</h3><span>只呈现已确认或可追溯的关系记录</span></div><button type="button" onClick={() => setWorldTab("history")}>查看完整历史</button></header>
        {events.length ? <ol>{events.slice(-5).map((event, index) => <li key={`${event.at}-${event.title}-${index}`}>
          <span aria-hidden="true" /><div><strong>{event.title}</strong><p>{event.detail || evidenceSourceLabel(event)}</p></div>
          {event.at && Number.isFinite(Date.parse(event.at)) ? <time dateTime={event.at}>{new Date(event.at).toLocaleDateString()}</time> : null}
        </li>)}</ol> : <p className="yance-rw-v4__empty">还没有可确认的关系旅程节点。</p>}
      </section>
      <section className="yance-rw-v4__moments" hidden={worldTab !== "overview" && worldTab !== "moments"} aria-label="共同时刻">
        <header><div><h3>共同时刻</h3><span>来自真实关系证据，不复制聊天内容</span></div></header>
        <div>{recentEvents.length ? recentEvents.map((event, index) => <button key={`${event.at}-${event.title}-${index}`} type="button"
          disabled={!primaryConversation} onClick={openPrimaryConversation}><span>{evidenceSourceLabel(event)}</span><strong>{event.title}</strong>
          <small>{event.at && Number.isFinite(Date.parse(event.at)) ? new Date(event.at).toLocaleDateString() : "已记录"}</small><em>打开相关对话 ›</em></button>)
          : <p className="yance-rw-v4__empty">还没有可展示的共同时刻。</p>}</div>
      </section>
      <section className="yance-rw-v4__goal" hidden={worldTab !== "overview" && worldTab !== "insights"} aria-label="当前目标与下一步">
        <header><h3>当前目标与下一步</h3><span>只显示与当前关系有关的目标</span></header>
        <div><span>当前私密意图</span><strong>{goalText || "今天还没有已保存的关系目标"}</strong></div>
        <div><span>建议的下一步</span><strong>{intelligence?.next || "等待更多真实互动后再形成建议"}</strong></div>
      </section>
      <section className="yance-rw-v4__signals" hidden={worldTab !== "overview" && worldTab !== "insights"} aria-label="最近关系信号">
        <header><h3>最近关系信号</h3><span>事实优先，推断可追溯</span></header>
        <dl><div><dt>阶段</dt><dd>{intelligence?.stage || "待建立"}</dd></div><div><dt>互动变化</dt><dd>{intelligence?.momentum || "暂无可确认趋势"}</dd></div>
          <div><dt>信息来源</dt><dd>{intelligence ? timelineAuthorityLabel(intelligence.timelineAuthority) : "暂无关系记录"}</dd></div></dl>
      </section>
    </div>

    <div className="yance-world-presence yance-rw-v4__presence">
      <RiveRelationshipCompanion state={aiState} reducedMotion={reducedMotion} />
      <div className="yance-world-copy"><strong>继续真实对话</strong>
        <span>消息会保持在原有会话中，言策只把与你们有关的上下文、重要时刻和工具整理在这里。</span></div>
    </div>

    <section className="yance-relationship-conversations yance-relationship-primary yance-rw-v4__history-panel" data-yance-primary-conversation aria-label="关系中的对话">
      <header><span className="yance-eyebrow">对话</span><strong>选择要继续的对话</strong></header>
      {relationship.conversations.length ? <div className="yance-relationship-conversation-list">
        {relationship.conversations.map((conversation) => <button key={conversation.id} type="button"
          aria-pressed={selectedConversationId === conversation.id}
          onClick={() => { setSelectedConversationId(conversation.id); onOpenConversation(conversation.id); }}>
          <strong>{conversation.title || "对话"}</strong><span>{conversation.platform || "已连接"}</span></button>)}
      </div> : <p role="status">当前人物还没有可继续的对话。</p>}
    </section>

    <section className="yance-relationship-moments yance-rw-v4__moments-tools" aria-label="共同时刻与陪伴工具">
      <header><span className="yance-eyebrow">共同时刻与陪伴</span><strong>照片 · 语音 · 实时陪伴</strong></header>
      <div className="yance-relationship-companion-actions">
        <button type="button" onClick={() => { captureExperienceFocus(); requestRelationshipOverlay("photo"); }}>
          <span aria-hidden="true">▧</span><strong>照片与视频</strong><small>共同回忆与媒体</small>
        </button>
        <button type="button" onClick={() => { captureExperienceFocus(); requestRelationshipOverlay("voice"); }}>
          <span aria-hidden="true">◉</span><strong>语音</strong><small>当前关系的语音空间</small>
        </button>
        <button type="button" onClick={() => { captureExperienceFocus(); requestRelationshipOverlay("live"); }}>
          <span aria-hidden="true">✦</span><strong>实时陪伴</strong><small>当前关系的 Live 空间</small>
        </button>
      </div>
    </section>

    <details className="yance-relationship-details yance-rw-v4__advanced">
      <summary><span>关系详情</span><small>目标、回顾、人物设定与数据管理</small></summary>
      <div className="yance-relationship-details__body">
    <section className="yance-relationship-detail-card" aria-label="今天想聊什么">
      <header><span className="yance-eyebrow">今天想聊什么</span><strong>{localDate}</strong></header>
      <textarea value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="写下今天想聊的方向" maxLength={4000} />
      <div>
        <button type="button" disabled={!goalText.trim()} onClick={() => void upsertDailyChatGoal(relationship.id, localDate, goalText.trim())
          .then(() => setGoalStatus("今天的聊天目标已保存")).catch(() => setGoalStatus("保存失败"))}>保存</button>
        <button type="button" onClick={() => void deleteDailyChatGoal(relationship.id, localDate)
          .then(() => { setGoalText(""); setGoalStatus("今天的聊天目标已删除"); }).catch(() => setGoalStatus("删除失败"))}>删除</button>
      </div>{goalStatus ? <p role="status">{goalStatus}</p> : null}
    </section>

    <section className="yance-relationship-detail-card" aria-label="今日回顾">
      <header><span className="yance-eyebrow">今日回顾</span><strong>{timeZone || "时区不可用"}</strong></header>
      {reviewStatus ? <p role="status">{reviewStatus}</p> : null}
      {review ? <>{review.coverageComplete !== true ? <p role="status">当天消息未能完整扫描，本次回顾不完整</p> : null}
        {([["问题", review.problems], ["做得好的", review.successes], ["下一步", review.nextActions]] as const).map(([label, lane]) =>
          <div key={label}><strong>{label}</strong>{lane.length
            ? <ul>{lane.map((row, index) => <li key={`${label}-${index}`}>{laneLabel(row)}</li>)}</ul>
            : <p>暂无已确认内容</p>}</div>)}</> : null}
    </section>

    <section className="yance-relationship-detail-card" aria-label="人物设定">
      <header><span className="yance-eyebrow">人物设定</span><strong>{effectivePersona?.profileName || "尚未绑定"}</strong></header>
      <label><span>人物设定</span><select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
        <option value="">请选择</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
      <div>
        <button type="button" disabled={!selectedProfileId} onClick={() => void setPersonaScope("contact", relationship.id, selectedProfileId)
          .then(() => setPersonaStatus("已绑定到这个人物")).catch(() => setPersonaStatus("绑定失败"))}>绑定到人物</button>
        <button type="button" disabled={!selectedProfileId || !selectedConversation} onClick={() => {
          if (!selectedConversation) return;
          void setPersonaScope("conversation", selectedConversation.id, selectedProfileId)
            .then(() => setPersonaStatus("已绑定到当前对话")).catch(() => setPersonaStatus("绑定失败"));
        }}>绑定到当前对话</button>
      </div>
      {versions.length ? <p>已有 {versions.length} 个版本</p> : null}
      <label><span>预览人物设定文件</span><input type="file" accept=".png,.json,image/png,application/json"
        onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file) return;
          void file.arrayBuffer().then((bytes) => previewPersonaCharacterCard(new Uint8Array(bytes)))
            .then(setCardPreview).catch(() => setPersonaStatus("预览失败")); }} /></label>
      {cardPreview?.ok ? <p>{cardPreview.name || "未命名人物设定"}：{cardPreview.description}</p> : null}
      <label><span>导入已导出的人物设定</span><input type="file" accept=".json,application/json" disabled={!selectedProfileId}
        onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file || !selectedProfileId) return;
          void file.text().then((raw) => JSON.parse(raw) as unknown).then((payload) => importPersona(selectedProfileId, payload))
            .then(() => setPersonaStatus("人物设定已导入")).catch(() => setPersonaStatus("导入失败")); }} /></label>
      {personaStatus ? <p role="status">{personaStatus}</p> : null}
    </section>

    <section className="yance-relationship-detail-card yance-relationship-data" aria-label="关系数据"><header><span className="yance-eyebrow">关系数据</span><strong>管理与修正</strong></header>
      <label><span>当前对话</span><select value={selectedConversationId} onChange={(e) => setSelectedConversationId(e.target.value)}>
        <option value="">请选择</option>{relationship.conversations.map((conversation) =>
          <option key={conversation.id} value={conversation.id}>{conversation.title || "对话"}</option>)}</select></label>
      <div>
        <button type="button" disabled={!selectedConversation} onClick={() => { if (!selectedConversation) return;
          void exportConversation(selectedConversation.id).then(() => setDataStatus("导出已完成")).catch(() => setDataStatus("导出失败")); }}>导出对话</button>
        <button type="button" disabled={!selectedConversation} onClick={() => { if (!selectedConversation) return;
          void setConversationArchived(selectedConversation.sessionKey, !selectedConversation.archived).then(async () => {
            setDataStatus(selectedConversation.archived ? "已恢复对话" : "已归档对话"); await refresh();
          }).catch(() => setDataStatus("归档操作失败")); }}>{selectedConversation?.archived ? "恢复对话" : "归档对话"}</button>
        <button type="button" disabled={!selectedConversation} onClick={() => { if (!selectedConversation) return;
          void setConversationPinned(selectedConversation.sessionKey, !selectedConversation.pinned).then(async () => {
            setDataStatus(selectedConversation.pinned ? "已取消收藏" : "已收藏"); await refresh();
          }).catch(() => setDataStatus("收藏操作失败")); }}>{selectedConversation?.pinned ? "取消收藏" : "收藏"}</button>
      </div>
      <div>
        <button type="button" onClick={() => void reviewContactProfile({
          contactId: relationship.id, decision: "approved", decidedBy: "user",
        }).then(async () => { setDataStatus("待审核人物画像已批准"); await refresh(); })
          .catch(() => setDataStatus("当前没有可批准的待审核人物画像"))}>批准待审核人物画像</button>
        <button type="button" onClick={() => void reviewContactProfile({
          contactId: relationship.id, decision: "rejected", decidedBy: "user",
        }).then(async () => { setDataStatus("待审核人物画像已拒绝"); await refresh(); })
          .catch(() => setDataStatus("当前没有可拒绝的待审核人物画像"))}>拒绝待审核人物画像</button>
      </div>
      {dataTargets.length ? <div>
        <label><span>关系记录</span><select value={selectedDataTargetId} onChange={(e) => setSelectedDataTargetId(e.target.value)}>
          {dataTargets.map((target) => <option key={`${target.kind}:${target.id}`} value={target.id}>{target.label}</option>)}
        </select></label>
        <label><span>修正说明</span><input value={correctionText} maxLength={500}
          onChange={(e) => setCorrectionText(e.target.value)} placeholder="写下对这条关系判断的修正" /></label>
        <button type="button" disabled={!selectedDataTarget || !correctionText.trim()} onClick={() => {
          if (!selectedDataTarget || !correctionText.trim()) return;
          void correctInference({
            contactId: relationship.id,
            targetType: selectedDataTarget.kind,
            targetId: selectedDataTarget.id,
            correction: { note: correctionText.trim() },
            reason: "用户修正",
            correctedBy: "user",
          }).then(async () => { setCorrectionText(""); setDataStatus("关系判断修正已保存"); await refresh(); })
            .catch(() => setDataStatus("关系判断修正失败"));
        }}>保存修正</button>
        <button type="button" disabled={!selectedDataTarget || selectedDataTarget.kind !== "timeline"} onClick={() => {
          if (!selectedDataTarget || selectedDataTarget.kind !== "timeline") return;
          void markRelationshipKeyNode({ contactId: relationship.id, eventId: selectedDataTarget.id })
            .then(async () => { setDataStatus("已标记为关键节点"); await refresh(); })
            .catch(() => setDataStatus("关键节点标记失败"));
        }}>标为关键节点</button>
        <button type="button" disabled={!selectedDataTarget || selectedDataTarget.kind !== "timeline"} onClick={() => {
          if (!selectedDataTarget || selectedDataTarget.kind !== "timeline") return;
          void unmarkRelationshipKeyNode({ contactId: relationship.id, eventId: selectedDataTarget.id })
            .then(async () => { setDataStatus("已取消关键节点"); await refresh(); })
            .catch(() => setDataStatus("取消关键节点失败"));
        }}>取消关键节点</button>
      </div> : <p>当前没有可修正或标记的关系记录。</p>}
      {mergeTargets.length ? <><label><span>合并另一个联系人</span><select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
        <option value="">请选择联系人</option>{mergeTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
        <button type="button" disabled={!mergeTargetId} onClick={() => {
          if (!mergeTargetId || !window.confirm("确认合并这两个联系人？")) return;
          void mergeContacts(relationship.id, mergeTargetId).then(async (receipt) => {
            const journalId = text(receipt.journalId || record(receipt.merge).journalId); setMergeJournalId(journalId);
            setDataStatus(journalId ? "联系人已合并，可立即撤销" : "合并完成"); await refresh();
          }).catch(() => setDataStatus("合并失败"));
        }}>确认合并</button></> : null}
      {mergeJournalId ? <button type="button" onClick={() => void undoContactMerge(relationship.id, mergeJournalId)
        .then(async () => { setMergeJournalId(""); setDataStatus("刚才的合并已撤销"); await refresh(); })
        .catch(() => setDataStatus("撤销失败"))}>撤销刚才的合并</button> : null}
      {dataStatus ? <p role="status">{dataStatus}</p> : null}
    </section>

      </div>
    </details>

    <section className="yance-relationship-intelligence yance-rw-v4__insights-panel" data-state={intelligence?.state || "unavailable"}
      data-authority="RelationshipProjectionAuthority" aria-label="关系洞察">
      <header className="yance-relationship-intelligence__header"><div><span className="yance-eyebrow">关系洞察</span>
        <strong>{intelligence?.analysisStatusLabel || "暂无已确认的关系洞察"}</strong></div>
        <span className="yance-relationship-intelligence__authority">基于真实互动</span></header>
      {intelligence ? <><div className="yance-relationship-intelligence__provenance">
        <div><span>分析状态</span><strong>{hasAiAnalysis ? intelligence.state === "stale" ? "需要更新" : "已形成" : "等待分析"}</strong></div>
        <div><span>信息来源</span><strong>{timelineAuthorityLabel(intelligence.timelineAuthority)}</strong></div></div>
        {hasAiAnalysis && (intelligence.stage || intelligence.summary || intelligence.next)
          ? <dl className="yance-relationship-intelligence__analysis">
            {intelligence.stage ? <div><dt>阶段</dt><dd>{intelligence.stage}</dd></div> : null}
            {intelligence.summary ? <div><dt>关系摘要</dt><dd>{intelligence.summary}</dd></div> : null}
            {intelligence.next ? <div><dt>下一步</dt><dd>{intelligence.next}</dd></div> : null}</dl>
          : <p className="yance-relationship-intelligence__pending">关系洞察仍在等待可信分析。</p>}
        {events.length ? <ol className="yance-relationship-intelligence__events" aria-label="关系记录时间线">
          {events.map((event, index) => <li key={`${event.at}-${event.title}-${index}`}>
            <div className="yance-relationship-intelligence__event-head"><strong>{event.title}</strong>
              <span data-source={event.source}>{evidenceSourceLabel(event)}</span></div>
            {event.detail && event.detail !== event.title ? <p>{event.detail}</p> : null}
            {event.at && Number.isFinite(Date.parse(event.at)) ? <time dateTime={event.at}>{new Date(event.at).toLocaleDateString()}</time> : null}
          </li>)}</ol> : <p className="yance-relationship-intelligence__pending">尚无已确认的关系记录。</p>}</>
        : <p className="yance-relationship-intelligence__pending">暂无已确认的关系洞察。</p>}
    </section>

    <div className="yance-world-meta yance-rw-v4__meta" aria-label="关系上下文">
      <span>{relationship.platform || "已连接"}</span>
      {relationship.updatedAt ? <span>更新于 {new Date(relationship.updatedAt).toLocaleDateString()}</span> : null}
    </div>
      </main>
      <aside className="yance-rw-v4__person" aria-label="当前人物">
        <header><div><span className="yance-eyebrow">关系上下文</span><h2>当前人物</h2></div><strong>{relationship.name}</strong></header>
        <section><h3>人物事实</h3><dl>
          <div><dt>平台</dt><dd>{relationship.platform || "已连接关系"}</dd></div>
          <div><dt>真实对话</dt><dd>{relationship.conversations.length}</dd></div>
          <div><dt>最近互动</dt><dd>{relationship.recentAt || relationship.updatedAt ? new Date(relationship.recentAt || relationship.updatedAt || "").toLocaleDateString() : "暂无记录"}</dd></div>
          <div><dt>关系阶段</dt><dd>{intelligence?.stage || "待建立"}</dd></div>
        </dl></section>
        <section><h3>关系边界</h3>{boundaryEvents.length ? <ul>{boundaryEvents.slice(-4).map((event, index) =>
          <li key={`${event.at}-${event.title}-${index}`}>{event.title}</li>)}</ul> : <p>暂无已确认的关系边界或承诺记录。</p>}</section>
        <section><h3>未完成事项</h3><ul>
          {relationship.unreadCount > 0 ? <li>有 {relationship.unreadCount} 条真实消息等待处理</li> : null}
          {openLoopEvents.slice(-3).map((event, index) => <li key={`${event.at}-${event.title}-${index}`}>{event.title}</li>)}
          {relationship.unreadCount === 0 && !openLoopEvents.length ? <li>暂无可确认的未完成事项</li> : null}
        </ul></section>
        <section><h3>当前人格</h3><dl>
          <div><dt>人格</dt><dd>{effectivePersona?.profileName || "尚未绑定"}</dd></div>
          <div><dt>作用域</dt><dd>{effectivePersona?.sourceScope || "使用默认作用域"}</dd></div>
          {effectivePersona?.version ? <div><dt>版本</dt><dd>{effectivePersona.version}</dd></div> : null}
        </dl></section>
        <button type="button" className="yance-rw-v4__conversation-cta" disabled={!primaryConversation} onClick={openPrimaryConversation}>进入 {relationship.name} 的真实对话</button>
        <div className="yance-rw-v4__authority"><span>关系智能</span><strong>{intelligence?.analysisStatusLabel || "等待真实关系数据"}</strong></div>
      </aside>
    </div>
  </section>;
}
