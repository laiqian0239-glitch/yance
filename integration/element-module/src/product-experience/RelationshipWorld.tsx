import React from "react";
import { motion } from "motion/react";
import { RiveRelationshipCompanion } from "./RiveRelationshipCompanion";
import type {
  RelationshipAiState,
  RelationshipIntelligenceEvent,
  RelationshipProjection,
} from "./experienceTypes";

type RelationshipWorldProps = {
  relationship: RelationshipProjection;
  aiState: RelationshipAiState;
  reducedMotion: boolean;
  assistantVisible: boolean;
  onBack: () => void;
  onToggleAssistant: () => void;
  onOpenConversation: (conversationId: string) => void;
};

function evidenceSourceLabel(event: RelationshipIntelligenceEvent): string {
  if (event.source === "graphiti") {
    return event.kind === "fact" && /用户确认/u.test(event.sourceLabel)
      ? "Graphiti · 用户确认"
      : "Graphiti · AI 推断";
  }
  if (event.source === "user_annotation") return "用户标注";
  return event.sourceLabel || "关系证据";
}

function timelineAuthorityLabel(value: string): string {
  if (value === "graphiti_temporal_inference") return "Graphiti · AI 推断";
  if (value === "user_annotation") return "用户标注";
  return "暂无关系证据";
}

export function RelationshipWorld({
  relationship,
  aiState,
  reducedMotion,
  assistantVisible,
  onBack,
  onToggleAssistant,
  onOpenConversation,
}: RelationshipWorldProps): React.JSX.Element {
  const intelligence = relationship.relationshipIntelligence;
  const hasAiAnalysis = intelligence?.source === "ai_analysis";
  const events = intelligence?.events || [];

  return (
    <section className="yance-relationship-world" aria-labelledby="yance-relationship-title">
      <header className="yance-world-header">
        <button type="button" className="yance-back" onClick={onBack} aria-label="返回我的关系">←</button>
        <motion.div
          layoutId={reducedMotion ? undefined : `relationship-avatar-${relationship.id}`}
          className="yance-world-avatar"
          aria-hidden="true"
        >
          {relationship.avatarUrl
            ? <img src={relationship.avatarUrl} alt="" />
            : relationship.name.trim().slice(0, 2).toUpperCase()}
        </motion.div>
        <div className="yance-world-identity">
          <span className="yance-eyebrow">关系世界</span>
          <h2 id="yance-relationship-title">{relationship.name}</h2>
          <p>{relationship.subtitle}</p>
        </div>
        <button
          type="button"
          className="yance-ai-toggle"
          aria-pressed={assistantVisible}
          aria-label={assistantVisible ? "收起私人任务" : "打开私人任务"}
          onClick={onToggleAssistant}
        >
          私人任务
        </button>
      </header>

      <div className="yance-world-presence">
        <RiveRelationshipCompanion state={aiState} reducedMotion={reducedMotion} />
        <div className="yance-world-copy">
          <strong>真实对话保持原样</strong>
          <span>言策在关系周围组织上下文、重要时刻和工具，同时保留真实消息时间线和输入框。</span>
        </div>
      </div>

      <section
        className="yance-relationship-conversations"
        aria-label="关系中的对话"
        data-conversation-count={relationship.conversations.length}
      >
        <header>
          <span className="yance-eyebrow">对话</span>
          <strong>
            {relationship.conversations.length
              ? "选择要继续的对话"
              : "还没有可继续的对话"}
          </strong>
        </header>

        {relationship.conversations.length ? (
          <div className="yance-relationship-conversation-list">
            {relationship.conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onOpenConversation(conversation.id)}
                data-conversation-id={conversation.id}
              >
                <strong>{conversation.title || "对话"}</strong>
                <span>
                  {[conversation.platform, conversation.accountId]
                    .filter(Boolean)
                    .join(" · ") || "已连接对话"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p role="status">
            当前人物没有唯一可打开的会话；言策不会猜测或自动选择其它人的对话。
          </p>
        )}
      </section>

      <section
        className="yance-relationship-intelligence"
        data-state={intelligence?.state || "unavailable"}
        data-authority="RelationshipProjectionAuthority"
        aria-label="关系智能"
      >
        <header className="yance-relationship-intelligence__header">
          <div>
            <span className="yance-eyebrow">关系智能</span>
            <strong>{intelligence?.analysisStatusLabel || "暂无已确认的关系智能"}</strong>
          </div>
          <span className="yance-relationship-intelligence__authority">可信关系投影</span>
        </header>

        {intelligence ? (
          <>
            <div className="yance-relationship-intelligence__provenance">
              <div>
                <span>AI 分析</span>
                <strong>
                  {hasAiAnalysis
                    ? intelligence.state === "stale" ? "上次 AI 分析 · 正在等待更新" : "AI 分析已就绪"
                    : "AI 分析待执行"}
                </strong>
              </div>
              <div>
                <span>证据来源</span>
                <strong>{timelineAuthorityLabel(intelligence.timelineAuthority)}</strong>
              </div>
            </div>

            {hasAiAnalysis && (intelligence.stage || intelligence.summary || intelligence.next) ? (
              <dl className="yance-relationship-intelligence__analysis">
                {intelligence.stage ? (
                  <div>
                    <dt>阶段</dt>
                    <dd>{intelligence.stage}</dd>
                  </div>
                ) : null}
                {intelligence.summary ? (
                  <div>
                    <dt>关系摘要</dt>
                    <dd>{intelligence.summary}</dd>
                  </div>
                ) : null}
                {intelligence.next ? (
                  <div>
                    <dt>下一步</dt>
                    <dd>{intelligence.next}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="yance-relationship-intelligence__pending">
                关系智能仍在等待可信 AI 分析；在分析完成前，不会断言阶段、摘要或下一步。
              </p>
            )}

            {events.length ? (
              <ol className="yance-relationship-intelligence__events" aria-label="关系证据时间线">
                {events.map((event, index) => (
                  <li key={`${event.at}-${event.title}-${index}`}>
                    <div className="yance-relationship-intelligence__event-head">
                      <strong>{event.title}</strong>
                      <span data-source={event.source}>{evidenceSourceLabel(event)}</span>
                    </div>
                    {event.detail && event.detail !== event.title ? <p>{event.detail}</p> : null}
                    {event.at && Number.isFinite(Date.parse(event.at))
                      ? <time dateTime={event.at}>{new Date(event.at).toLocaleDateString()}</time>
                      : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="yance-relationship-intelligence__pending">尚无 Graphiti 或用户标注的真实关系证据。</p>
            )}
          </>
        ) : (
          <p className="yance-relationship-intelligence__pending">
            暂无已确认的关系智能。现有会话数据仍然可用，但不会因此生成未经确认的关系判断。
          </p>
        )}
      </section>

      <div className="yance-world-meta" aria-label="关系上下文">
        <span>{relationship.platform || "已连接"}</span>
        {relationship.updatedAt ? <span>更新于 {new Date(relationship.updatedAt).toLocaleDateString()}</span> : null}
      </div>
    </section>
  );
}
