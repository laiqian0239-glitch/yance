import React, { useEffect, useRef, useState } from "react";
import {
  deleteRelationshipGoal,
  loadRelationshipAssistant,
  setRelationshipGoalPaused,
  subscribeRelationshipEvents,
  updateRelationshipGoal,
} from "./experienceProjection";
import type {
  RelationshipAiState,
  RelationshipAssistantProjection,
  RelationshipProjection,
} from "./experienceTypes";

type RelationshipAssistantProps = {
  relationship: RelationshipProjection;
  onStateChange?: (state: RelationshipAiState) => void;
};

const RELATIONSHIP_ASSISTANT_REFRESH_MS = 5000;

function statusText(projection: RelationshipAssistantProjection | null): string {
  if (!projection) return "Loading relationship intelligence";
  if (!projection.agentReady) return projection.agentStatus || "AI unavailable";
  if (projection.goal.exists === true) return projection.goal.paused ? "Goal paused" : "Goal active";
  return "AI ready · no private intention yet";
}

export function RelationshipAssistant({ relationship, onStateChange }: RelationshipAssistantProps): React.JSX.Element {
  const [projection, setProjection] = useState<RelationshipAssistantProjection | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading relationship intelligence");
  const dirtyDraftRef = useRef(false);

  const applyProjection = (next: RelationshipAssistantProjection, syncDraft: boolean): void => {
    setProjection(next);
    if (syncDraft && !dirtyDraftRef.current) {
      setDraft(next.goal.exists === true ? next.goal.goalText : "");
    }
    setStatus(statusText(next));
    onStateChange?.(next.agentReady ? "ready" : "error");
  };

  const refresh = async (syncDraft = false): Promise<void> => {
    try {
      const next = await loadRelationshipAssistant(relationship.id);
      applyProjection(next, syncDraft);
    } catch {
      setProjection(null);
      setStatus("Private intention unavailable");
      onStateChange?.("error");
    }
  };

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    dirtyDraftRef.current = false;
    setDraft("");
    onStateChange?.("wake");

    const load = async (syncDraft: boolean): Promise<void> => {
      try {
        const next = await loadRelationshipAssistant(relationship.id);
        if (!cancelled) applyProjection(next, syncDraft);
      } catch {
        if (!cancelled) {
          setProjection(null);
          setStatus("Private intention unavailable");
          onStateChange?.("error");
        }
      }
    };

    const scheduleRefresh = (): void => {
      refreshTimer = window.setTimeout(async () => {
        await load(false);
        if (!cancelled) scheduleRefresh();
      }, RELATIONSHIP_ASSISTANT_REFRESH_MS);
    };

    void load(true).finally(() => {
      if (!cancelled) scheduleRefresh();
    });

    const unsubscribe = subscribeRelationshipEvents((contactId) => {
      if (contactId === relationship.id && !cancelled) void load(false);
    });

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [relationship.id]);

  const save = async (): Promise<void> => {
    const goalText = draft.trim();
    if (!goalText || busy) return;
    setBusy(true);
    onStateChange?.("listening");
    try {
      const next = await updateRelationshipGoal(relationship.id, goalText);
      dirtyDraftRef.current = false;
      setProjection(next);
      setDraft(next.goal.goalText);
      setStatus(next.goal.paused ? "Goal paused" : "Goal active");
      onStateChange?.("ready");
    } catch {
      setStatus("Could not update the private intention");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async (): Promise<void> => {
    if (!projection || projection.goal.exists !== true || busy) return;
    setBusy(true);
    try {
      const next = await setRelationshipGoalPaused(relationship.id, !projection.goal.paused);
      setProjection(next);
      setStatus(next.goal.paused ? "Goal paused" : "Goal active");
      onStateChange?.("ready");
    } catch {
      setStatus("Could not change the private intention");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!projection || projection.goal.exists !== true || busy) return;
    setBusy(true);
    try {
      await deleteRelationshipGoal(relationship.id);
      dirtyDraftRef.current = false;
      setDraft("");
      await refresh(true);
      setStatus("Private intention removed");
    } catch {
      setStatus("Could not remove the private intention");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const intelligence = relationship.relationshipIntelligence;
  const relationshipInsight = intelligence?.summary
    || intelligence?.analysisStatusLabel
    || "No confirmed relationship insight yet.";
  const nextStep = intelligence?.next || "No trusted next step is available yet.";
  const progressPath = projection?.goal.exists === true ? projection.goal.progress.path : [];

  return (
    <aside className="yance-assistant" aria-label="Private Quest">
      <header>
        <div>
          <span className="yance-eyebrow">Private Quest</span>
          <strong>Stay close to what matters with {relationship.name}</strong>
        </div>
        <span className="yance-agent-dot" data-ready={projection?.agentReady || undefined} aria-hidden="true" />
      </header>

      <p className="yance-assistant-status" role="status" aria-live="polite">{status}</p>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-intention">
        <h3 id="yance-private-quest-intention">Current intention</h3>
        <label className="yance-goal-field">
          <span className="yance-sr-only">Private intention</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={draft}
            disabled={busy}
            onFocus={() => onStateChange?.("listening")}
            onBlur={() => onStateChange?.(projection?.agentReady ? "ready" : "idle")}
            onChange={(event) => {
              dirtyDraftRef.current = true;
              setDraft(event.target.value);
            }}
            placeholder="What matters in this relationship right now?"
          />
        </label>
        <div className="yance-assistant-actions">
          <button type="button" onClick={() => void save()} disabled={busy || !draft.trim()}>Save intention</button>
          <button type="button" onClick={() => void togglePaused()} disabled={busy || projection?.goal.exists !== true}>
            {projection?.goal.paused ? "Resume" : "Pause"}
          </button>
          <button type="button" onClick={() => void remove()} disabled={busy || projection?.goal.exists !== true}>Remove</button>
        </div>
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-progress">
        <h3 id="yance-private-quest-progress">Progress</h3>
        {progressPath.length ? (
          <ol className="yance-private-quest-progress">
            {progressPath.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
          </ol>
        ) : (
          <p className="yance-private-quest-empty">Progress is not available yet.</p>
        )}
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-insight">
        <h3 id="yance-private-quest-insight">Relationship insight</h3>
        <p>{relationshipInsight}</p>
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-next">
        <h3 id="yance-private-quest-next">Next step</h3>
        <p>{nextStep}</p>
      </section>
    </aside>
  );
}
