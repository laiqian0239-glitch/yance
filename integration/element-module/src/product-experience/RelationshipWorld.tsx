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
};

function evidenceSourceLabel(event: RelationshipIntelligenceEvent): string {
  if (event.source === "graphiti") {
    return event.kind === "fact" && /用户确认/u.test(event.sourceLabel)
      ? "Graphiti · 用户确认"
      : "Graphiti · AI inference";
  }
  if (event.source === "user_annotation") return "用户标注 · User annotation";
  return event.sourceLabel || "Relationship evidence";
}

function timelineAuthorityLabel(value: string): string {
  if (value === "graphiti_temporal_inference") return "Graphiti temporal inference";
  if (value === "user_annotation") return "User annotation";
  return "No relationship evidence";
}

export function RelationshipWorld({
  relationship,
  aiState,
  reducedMotion,
  assistantVisible,
  onBack,
  onToggleAssistant,
}: RelationshipWorldProps): React.JSX.Element {
  const intelligence = relationship.relationshipIntelligence;
  const hasAiAnalysis = intelligence?.source === "ai_analysis";
  const events = intelligence?.events || [];

  return (
    <section className="yance-relationship-world" aria-labelledby="yance-relationship-title">
      <header className="yance-world-header">
        <button type="button" className="yance-back" onClick={onBack} aria-label="Back to People">←</button>
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
          <span className="yance-eyebrow">Relationship World</span>
          <h2 id="yance-relationship-title">{relationship.name}</h2>
          <p>{relationship.subtitle}</p>
        </div>
        <button
          type="button"
          className="yance-ai-toggle"
          aria-pressed={assistantVisible}
          aria-label={assistantVisible ? "Hide relationship AI" : "Show relationship AI"}
          onClick={onToggleAssistant}
        >
          AI
        </button>
      </header>

      <div className="yance-world-presence">
        <RiveRelationshipCompanion state={aiState} reducedMotion={reducedMotion} />
        <div className="yance-world-copy">
          <strong>Conversation stays in Element</strong>
          <span>Yance keeps context, moments and tools around the relationship without replacing the Matrix timeline.</span>
        </div>
      </div>

      <section
        className="yance-relationship-intelligence"
        data-state={intelligence?.state || "unavailable"}
        aria-label="Relationship intelligence"
      >
        <header className="yance-relationship-intelligence__header">
          <div>
            <span className="yance-eyebrow">Relationship intelligence</span>
            <strong>{intelligence?.analysisStatusLabel || "No confirmed relationship intelligence"}</strong>
          </div>
          <span className="yance-relationship-intelligence__authority">RelationshipProjectionAuthority</span>
        </header>

        {intelligence ? (
          <>
            <div className="yance-relationship-intelligence__provenance">
              <div>
                <span>AI analysis</span>
                <strong>
                  {hasAiAnalysis
                    ? intelligence.state === "stale" ? "Last AI analysis · update pending" : "AI analysis ready"
                    : "AI analysis pending"}
                </strong>
              </div>
              <div>
                <span>Evidence authority</span>
                <strong>{timelineAuthorityLabel(intelligence.timelineAuthority)}</strong>
              </div>
            </div>

            {hasAiAnalysis && (intelligence.stage || intelligence.summary || intelligence.next) ? (
              <dl className="yance-relationship-intelligence__analysis">
                {intelligence.stage ? (
                  <div>
                    <dt>Stage</dt>
                    <dd>{intelligence.stage}</dd>
                  </div>
                ) : null}
                {intelligence.summary ? (
                  <div>
                    <dt>Summary</dt>
                    <dd>{intelligence.summary}</dd>
                  </div>
                ) : null}
                {intelligence.next ? (
                  <div>
                    <dt>Next action</dt>
                    <dd>{intelligence.next}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="yance-relationship-intelligence__pending">
                Relationship intelligence pending; no stage, summary or next action is asserted without AI analysis.
              </p>
            )}

            {events.length ? (
              <ol className="yance-relationship-intelligence__events" aria-label="Relationship evidence timeline">
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
              <p className="yance-relationship-intelligence__pending">No Graphiti or user annotation evidence is available yet.</p>
            )}
          </>
        ) : (
          <p className="yance-relationship-intelligence__pending">
            No confirmed relationship intelligence. Existing conversation data remains available without inferred relationship claims.
          </p>
        )}
      </section>

      <div className="yance-world-meta" aria-label="Relationship context">
        <span>{relationship.platform || "Connected"}</span>
        {relationship.updatedAt ? <span>Updated {new Date(relationship.updatedAt).toLocaleDateString()}</span> : null}
      </div>
    </section>
  );
}
