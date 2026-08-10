import React from "react";
import { motion } from "motion/react";
import { RiveRelationshipCompanion } from "./RiveRelationshipCompanion";
import type { RelationshipAiState, RelationshipProjection } from "./experienceTypes";

type RelationshipWorldProps = {
  relationship: RelationshipProjection;
  aiState: RelationshipAiState;
  reducedMotion: boolean;
  assistantVisible: boolean;
  onBack: () => void;
  onToggleAssistant: () => void;
};

export function RelationshipWorld({
  relationship,
  aiState,
  reducedMotion,
  assistantVisible,
  onBack,
  onToggleAssistant,
}: RelationshipWorldProps): React.JSX.Element {
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

      <div className="yance-world-meta" aria-label="Relationship context">
        <span>{relationship.platform || "Connected"}</span>
        {relationship.updatedAt ? <span>Updated {new Date(relationship.updatedAt).toLocaleDateString()}</span> : null}
      </div>
    </section>
  );
}
