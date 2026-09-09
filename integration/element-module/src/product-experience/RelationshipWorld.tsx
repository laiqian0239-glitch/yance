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
type RelationshipWorldProps = {
  relationship: RelationshipProjection; aiState: RelationshipAiState; reducedMotion: boolean;
  assistantVisible: boolean; onBack: () => void; onToggleAssistant: () => void;
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
  return event.sourceLabel || "关系证据";
}
function timelineAuthorityLabel(value: string): string {
  if (value === "graphiti_temporal_inference") return "关系线索";
  if (value === "user_annotation") return "用户标注";
  return "暂无关系证据";
}

export function RelationshipWorld({
  relationship, aiState, reducedMotion, assistantVisible, onBack, onToggleAssistant,
  onOpenConversation, mergeTargets = [], onRefresh,
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
  const refresh = async (): Promise<void> => {
    await onRefresh?.();
    try {
      const rows = await loadRelationshipDataTargets(relationship.id);
      setDataTargets(rows);
      setSelectedDataTargetId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
    } catch { /* existing view remains authoritative when refresh transport is unavailable */ }
  };

  return <section className="yance-relationship-world" aria-labelledby="yance-relationship-title">
    <header className="yance-world-header">
      <button type="button" className="yance-back" onClick={onBack} aria-label="返回我的关系">←</button>
      <motion.div layoutId={reducedMotion ? undefined : `relationship-avatar-${relationship.id}`}
        className="yance-world-avatar" aria-hidden="true">
        {relationship.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : relationship.name.trim().slice(0, 2).toUpperCase()}
      </motion.div>
      <div className="yance-world-identity"><span className="yance-eyebrow">关系世界</span>
        <h2 id="yance-relationship-title">{relationship.name}</h2><p>{relationship.subtitle}</p></div>
      <button type="button" className="yance-ai-toggle" aria-pressed={assistantVisible}
        aria-label={assistantVisible ? "收起私人任务" : "打开私人任务"} onClick={onToggleAssistant}>私人任务</button>
    </header>

    <div className="yance-world-presence">
      <RiveRelationshipCompanion state={aiState} reducedMotion={reducedMotion} />
      <div className="yance-world-copy"><strong>真实对话保持原样</strong>
        <span>言策在关系周围组织上下文、重要时刻和工具，同时保留真实消息时间线、输入框和发送链路。</span></div>
    </div>

    <section className="yance-relationship-conversations" aria-label="关系中的对话">
      <header><span className="yance-eyebrow">对话</span><strong>选择要继续的对话</strong></header>
      {relationship.conversations.length ? <div className="yance-relationship-conversation-list">
        {relationship.conversations.map((conversation) => <button key={conversation.id} type="button"
          aria-pressed={selectedConversationId === conversation.id}
          onClick={() => { setSelectedConversationId(conversation.id); onOpenConversation(conversation.id); }}>
          <strong>{conversation.title || "对话"}</strong><span>{conversation.platform || "已连接"}</span></button>)}
      </div> : <p role="status">当前人物还没有可继续的对话。</p>}
    </section>

    <section aria-label="今天想聊什么">
      <header><span className="yance-eyebrow">今天想聊什么</span><strong>{localDate}</strong></header>
      <textarea value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="写下今天想聊的方向" maxLength={4000} />
      <div>
        <button type="button" disabled={!goalText.trim()} onClick={() => void upsertDailyChatGoal(relationship.id, localDate, goalText.trim())
          .then(() => setGoalStatus("今天的聊天目标已保存")).catch(() => setGoalStatus("保存失败"))}>保存</button>
        <button type="button" onClick={() => void deleteDailyChatGoal(relationship.id, localDate)
          .then(() => { setGoalText(""); setGoalStatus("今天的聊天目标已删除"); }).catch(() => setGoalStatus("删除失败"))}>删除</button>
      </div>{goalStatus ? <p role="status">{goalStatus}</p> : null}
    </section>

    <section aria-label="今日回顾">
      <header><span className="yance-eyebrow">今日回顾</span><strong>{timeZone || "时区不可用"}</strong></header>
      {reviewStatus ? <p role="status">{reviewStatus}</p> : null}
      {review ? <>{review.coverageComplete !== true ? <p role="status">当天消息未能完整扫描，本次回顾不完整</p> : null}
        {([["问题", review.problems], ["做得好的", review.successes], ["下一步", review.nextActions]] as const).map(([label, lane]) =>
          <div key={label}><strong>{label}</strong>{lane.length
            ? <ul>{lane.map((row, index) => <li key={`${label}-${index}`}>{laneLabel(row)}</li>)}</ul>
            : <p>暂无已确认内容</p>}</div>)}</> : null}
    </section>

    <section aria-label="共同时刻">
      <header><span className="yance-eyebrow">共同时刻</span><strong>照片与视频</strong></header>
      <button type="button" onClick={() => { captureExperienceFocus(); requestRelationshipOverlay("photo"); }}>打开照片与视频</button>
    </section>

    <section aria-label="人物设定">
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
      <label><span>预览 Character Card</span><input type="file" accept=".png,.json,image/png,application/json"
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

    <details><summary>关系数据</summary>
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
        <label><span>关系证据</span><select value={selectedDataTargetId} onChange={(e) => setSelectedDataTargetId(e.target.value)}>
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
      </div> : <p>当前没有可修正或标记的关系证据。</p>}
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
    </details>

    <section className="yance-relationship-intelligence" data-state={intelligence?.state || "unavailable"}
      data-authority="RelationshipProjectionAuthority" aria-label="关系智能">
      <header className="yance-relationship-intelligence__header"><div><span className="yance-eyebrow">关系智能</span>
        <strong>{intelligence?.analysisStatusLabel || "暂无已确认的关系智能"}</strong></div>
        <span className="yance-relationship-intelligence__authority">可信关系投影</span></header>
      {intelligence ? <><div className="yance-relationship-intelligence__provenance">
        <div><span>AI 分析</span><strong>{hasAiAnalysis ? intelligence.state === "stale" ? "AI 推断待更新" : "AI 推断已就绪" : "AI 推断待执行"}</strong></div>
        <div><span>证据来源</span><strong>{timelineAuthorityLabel(intelligence.timelineAuthority)}</strong></div></div>
        {hasAiAnalysis && (intelligence.stage || intelligence.summary || intelligence.next)
          ? <dl className="yance-relationship-intelligence__analysis">
            {intelligence.stage ? <div><dt>阶段</dt><dd>{intelligence.stage}</dd></div> : null}
            {intelligence.summary ? <div><dt>关系摘要</dt><dd>{intelligence.summary}</dd></div> : null}
            {intelligence.next ? <div><dt>下一步</dt><dd>{intelligence.next}</dd></div> : null}</dl>
          : <p className="yance-relationship-intelligence__pending">关系洞察仍在等待可信分析。</p>}
        {events.length ? <ol className="yance-relationship-intelligence__events" aria-label="关系证据时间线">
          {events.map((event, index) => <li key={`${event.at}-${event.title}-${index}`}>
            <div className="yance-relationship-intelligence__event-head"><strong>{event.title}</strong>
              <span data-source={event.source}>{evidenceSourceLabel(event)}</span></div>
            {event.detail && event.detail !== event.title ? <p>{event.detail}</p> : null}
            {event.at && Number.isFinite(Date.parse(event.at)) ? <time dateTime={event.at}>{new Date(event.at).toLocaleDateString()}</time> : null}
          </li>)}</ol> : <p className="yance-relationship-intelligence__pending">尚无已确认的关系证据。</p>}</>
        : <p className="yance-relationship-intelligence__pending">暂无已确认的关系智能。</p>}
    </section>

    <div className="yance-world-meta" aria-label="关系上下文">
      <span>{relationship.platform || "已连接"}</span>
      {relationship.updatedAt ? <span>更新于 {new Date(relationship.updatedAt).toLocaleDateString()}</span> : null}
    </div>
  </section>;
}
