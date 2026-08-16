import React from "react";
import { motion } from "motion/react";
import type { RelationshipProjection } from "./experienceTypes";

type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  selectedRelationshipId: string;
  reducedMotion: boolean;
  onSelect: (relationshipId: string) => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

export function PeopleSurface({
  relationships,
  selectedRelationshipId,
  reducedMotion,
  onSelect,
}: PeopleSurfaceProps): React.JSX.Element {
  return (
    <section className="yance-people" aria-label="People">
      <header className="yance-section-heading">
        <div>
          <span className="yance-eyebrow">People</span>
          <h2>Your relationships</h2>
        </div>
        <span className="yance-count" aria-label={`${relationships.length} relationships`}>{relationships.length}</span>
      </header>

      {relationships.length ? (
        <div className="yance-people-list" role="list" aria-label="Relationship list">
          {relationships.map((relationship) => {
            const selected = relationship.id === selectedRelationshipId;
            const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel
              || "No confirmed relationship intelligence";
            return (
              <motion.button
                layout={!reducedMotion}
                key={relationship.id}
                type="button"
                role="listitem"
                className="yance-person-card"
                data-selected={selected || undefined}
                data-intelligence-state={relationship.relationshipIntelligence?.state || "unavailable"}
                aria-pressed={selected}
                aria-label={`Open relationship with ${relationship.name}. ${analysisStatusLabel}`}
                onClick={() => onSelect(relationship.id)}
                whileTap={reducedMotion ? undefined : { scale: 0.985 }}
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              >
                <span className="yance-avatar" aria-hidden="true">
                  {relationship.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : initials(relationship.name)}
                </span>
                <span className="yance-person-copy">
                  <strong>{relationship.name}</strong>
                  <span>{relationship.subtitle}</span>
                  <span className="yance-person-intelligence-status">{analysisStatusLabel}</span>
                </span>
                <span className="yance-person-open" aria-hidden="true">›</span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div className="yance-empty" role="status">
          <strong>No relationships yet</strong>
          <span>People will appear here from your existing Yance customer data.</span>
        </div>
      )}
    </section>
  );
}
