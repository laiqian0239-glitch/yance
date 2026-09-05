import React from "react";
import { motion } from "motion/react";
import type { RelationshipProjection } from "./experienceTypes";

export type PeopleHomeView = "list" | "universe";

type PeopleSurfaceProps = {
  relationships: readonly RelationshipProjection[];
  selectedRelationshipId: string;
  focusedRelationshipId: string;
  viewMode: PeopleHomeView;
  reducedMotion: boolean;
  onViewModeChange: (view: PeopleHomeView) => void;
  onFocus: (relationshipId: string) => void;
  onSelect: (relationshipId: string) => void;
};

type UniversePosition = {
  x: number;
  y: number;
  ring: number;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

function universePosition(index: number, count: number): UniversePosition {
  const boundedCount = Math.max(1, count);
  if (boundedCount <= 8) {
    const angle = ((index / boundedCount) * Math.PI * 2) - (Math.PI / 2);
    const radius = 30;
    return {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      ring: 0,
    };
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
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
    ring,
  };
}

export function PeopleSurface({
  relationships,
  selectedRelationshipId,
  focusedRelationshipId,
  viewMode,
  reducedMotion,
  onViewModeChange,
  onFocus,
  onSelect,
}: PeopleSurfaceProps): React.JSX.Element {
  const focusedRelationship = relationships.find((row) => row.id === focusedRelationshipId) || null;
  const focusedIntelligence = focusedRelationship?.relationshipIntelligence;
  const latestEvidence = focusedIntelligence && focusedIntelligence.events.length
    ? focusedIntelligence.events[focusedIntelligence.events.length - 1]
    : null;
  const denseUniverse = relationships.length >= 8;
  const universeRelationships = relationships.slice(0, 36);

  return (
    <section className="yance-people" aria-label="我的关系">
      <header className="yance-section-heading yance-people-heading">
        <div>
          <span className="yance-eyebrow">关系</span>
          <h2>我的关系</h2>
        </div>
        <span className="yance-count" aria-label={`${relationships.length} 段关系`}>{relationships.length}</span>
      </header>

      <div className="yance-people-view-switch" aria-label="关系视图">
        <button
          type="button"
          aria-pressed={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
        >
          列表
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "universe"}
          onClick={() => onViewModeChange("universe")}
        >
          关系宇宙
        </button>
      </div>

      {!relationships.length ? (
        <div className="yance-empty" role="status">
          <strong>暂无关系</strong>
          <span>已有联系人和会话会在这里形成你的关系空间。</span>
        </div>
      ) : viewMode === "list" ? (
        <div className="yance-people-list" role="list" aria-label="关系列表">
          {relationships.map((relationship) => {
            const selected = relationship.id === selectedRelationshipId;
            const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel
              || "暂无已确认的关系智能";
            return (
              <motion.button
                layout={!reducedMotion}
                key={relationship.id}
                type="button"
                role="listitem"
                className="yance-person-card"
                data-selected={selected || undefined}
                data-conversation-count={relationship.conversations.length}
                data-intelligence-state={relationship.relationshipIntelligence?.state || "unavailable"}
                aria-pressed={selected}
                aria-label={`打开与 ${relationship.name} 的关系。${analysisStatusLabel}`}
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
                  <span>
                    {relationship.conversations.length === 0
                      ? "尚无可打开的对话"
                      : relationship.conversations.length === 1
                        ? "1 个对话"
                        : `${relationship.conversations.length} 个对话 · 进入后选择`}
                  </span>
                  <span className="yance-person-intelligence-status">{analysisStatusLabel}</span>
                </span>
                <span className="yance-person-open" aria-hidden="true">›</span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <section className="yance-relationship-universe" aria-labelledby="yance-relationship-universe-title">
          <div className="yance-relationship-universe__canvas">
            <header className="yance-relationship-universe__heading">
              <div>
                <span className="yance-eyebrow">沉浸视图</span>
                <h3 id="yance-relationship-universe-title">关系宇宙</h3>
              </div>
              <p>从你出发，看见每段关系正在发生什么</p>
            </header>

            <div
              className="yance-relationship-universe__stage"
              data-dense={denseUniverse || undefined}
              aria-label="关系宇宙"
            >
              <svg
                className="yance-relationship-universe__spokes"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {universeRelationships.map((relationship, index) => {
                  const position = universePosition(index, universeRelationships.length);
                  return (
                    <line
                      key={`spoke-${relationship.id}`}
                      className="yance-relationship-universe__spoke"
                      x1="50"
                      y1="50"
                      x2={position.x}
                      y2={position.y}
                    />
                  );
                })}
              </svg>

              <div className="yance-relationship-universe__center" aria-hidden="true">
                <span>我</span>
              </div>

              {universeRelationships.map((relationship, index) => {
                const position = universePosition(index, universeRelationships.length);
                const focused = relationship.id === focusedRelationshipId;
                const selected = relationship.id === selectedRelationshipId;
                const analysisStatusLabel = relationship.relationshipIntelligence?.analysisStatusLabel
                  || "暂无已确认的关系智能";
                return (
                  <motion.button
                    key={relationship.id}
                    type="button"
                    className="yance-relationship-universe__node"
                    data-focused={focused || undefined}
                    data-selected={selected || undefined}
                    data-ring={position.ring}
                    data-intelligence-state={relationship.relationshipIntelligence?.state || "unavailable"}
                    style={{
                      left: `${position.x}%`,
                      top: `${position.y}%`,
                      ...(denseUniverse ? {
                        width: "44px",
                        height: "44px",
                        minHeight: "44px",
                        padding: "3px",
                        borderRadius: "50%",
                        gridTemplateColumns: "1fr",
                        boxSizing: "border-box",
                      } : {}),
                    }}
                    aria-pressed={focused}
                    aria-label={`查看 ${relationship.name} 的关系洞察。${analysisStatusLabel}`}
                    onClick={() => onFocus(relationship.id)}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                    transition={{ duration: reducedMotion ? 0 : 0.16 }}
                  >
                    <span className="yance-relationship-universe__node-avatar" aria-hidden="true">
                      {relationship.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : initials(relationship.name)}
                    </span>
                    {denseUniverse ? null : (
                      <span className="yance-relationship-universe__node-copy">
                        <strong>{relationship.name}</strong>
                        <span>{analysisStatusLabel}</span>
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
            {relationships.length > universeRelationships.length ? (
              <p className="yance-relationship-universe__overflow-note" role="status">
                关系宇宙一次显示 36 段关系；切换“列表”可查看全部 {relationships.length} 段。
              </p>
            ) : null}
          </div>

          <aside className="yance-relationship-universe__insight" aria-label="可信关系洞察">
            {focusedRelationship ? (
              <>
                <header>
                  <span className="yance-eyebrow">可信关系洞察</span>
                  <h3>{focusedRelationship.name}</h3>
                  <p>{focusedRelationship.subtitle}</p>
                </header>
                <dl className="yance-relationship-universe__facts">
                  <div>
                    <dt>关系状态</dt>
                    <dd>{focusedIntelligence?.analysisStatusLabel || "暂无已确认的关系智能"}</dd>
                  </div>
                  {focusedIntelligence?.stage ? (
                    <div>
                      <dt>阶段</dt>
                      <dd>{focusedIntelligence.stage}</dd>
                    </div>
                  ) : null}
                  {focusedIntelligence?.summary ? (
                    <div>
                      <dt>关系摘要</dt>
                      <dd>{focusedIntelligence.summary}</dd>
                    </div>
                  ) : null}
                  {focusedIntelligence?.next ? (
                    <div>
                      <dt>下一步</dt>
                      <dd>{focusedIntelligence.next}</dd>
                    </div>
                  ) : null}
                  {latestEvidence ? (
                    <div>
                      <dt>最近证据</dt>
                      <dd>{latestEvidence.title}{latestEvidence.sourceLabel ? ` · ${latestEvidence.sourceLabel}` : ""}</dd>
                    </div>
                  ) : null}
                </dl>
                {!focusedIntelligence ? (
                  <p className="yance-relationship-universe__pending">暂无已确认的关系智能；这里不会根据本地行为猜测关系含义。</p>
                ) : null}
                <button
                  type="button"
                  className="yance-relationship-universe__enter"
                  onClick={() => onSelect(focusedRelationship.id)}
                >
                  进入关系世界
                </button>
              </>
            ) : (
              <div className="yance-relationship-universe__prompt" role="status">
                <span className="yance-eyebrow">可信关系洞察</span>
                <strong>选择一个人，查看可信关系洞察</strong>
                <p>位置只用于空间编排，不代表亲密度、重要性或关系强弱。</p>
              </div>
            )}
          </aside>
        </section>
      )}
    </section>
  );
}
