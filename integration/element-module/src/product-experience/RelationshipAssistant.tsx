import React, { useEffect, useRef, useState } from "react";
import {
  deleteRelationshipGoal,
  loadRelationshipAssistant,
  setRelationshipGoalPaused,
  subscribeRelationshipEvents,
  updateRelationshipGoal,
} from "./experienceProjection";
import type { RelationshipAiState, RelationshipAssistantProjection } from "./experienceTypes";

type RelationshipAssistantProps = {
  relationshipId: string;
  onStateChange?: (state: RelationshipAiState) => void;
};

const RELATIONSHIP_ASSISTANT_REFRESH_MS = 5000;

function statusText(projection: RelationshipAssistantProjection | null): string {
  if (!projection) return "Loading relationship intelligence";
  if (!projection.agentReady) return projection.agentStatus || "AI unavailable";
  if (projection.goal.exists === true) return projection.goal.paused ? "Goal paused" : "Goal active";
  return "AI ready · no conversation objective";
}

export function RelationshipAssistant({ relationshipId, onStateChange }: RelationshipAssistantProps): React.JSX.Element {
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
      const next = await loadRelationshipAssistant(relationshipId);
      applyProjection(next, syncDraft);
    } catch {
      setProjection(null);
      setStatus("Relationship intelligence unavailable");
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
        const next = await loadRelationshipAssistant(relationshipId);
        if (!cancelled) applyProjection(next, syncDraft);
      } catch {
        if (!cancelled) {
          setProjection(null);
          setStatus("Relationship intelligence unavailable");
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
      if (contactId === relationshipId && !cancelled) void load(false);
    });

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [relationshipId]);

  const save = async (): Promise<void> => {
    const goalText = draft.trim();
    if (!goalText || busy) return;
    setBusy(true);
    onStateChange?.("listening");
    try {
      const next = await updateRelationshipGoal(relationshipId, goalText);
      dirtyDraftRef.current = false;
      setProjection(next);
      setDraft(next.goal.goalText);
      setStatus(next.goal.paused ? "Goal paused" : "Goal active");
      onStateChange?.("ready");
    } catch {
      setStatus("Could not update the conversation objective");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async (): Promise<void> => {
    if (!projection || projection.goal.exists !== true || busy) return;
    setBusy(true);
    try {
      const next = await setRelationshipGoalPaused(relationshipId, !projection.goal.paused);
      setProjection(next);
      setStatus(next.goal.paused ? "Goal paused" : "Goal active");
      onStateChange?.("ready");
    } catch {
      setStatus("Could not change the conversation objective");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!projection || projection.goal.exists !== true || busy) return;
    setBusy(true);
    try {
      await deleteRelationshipGoal(relationshipId);
      dirtyDraftRef.current = false;
      setDraft("");
      await refresh(true);
      setStatus("Conversation objective removed");
    } catch {
      setStatus("Could not remove the conversation objective");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-assistant" aria-label="Relationship AI">
      <header>
        <div>
          <span className="yance-eyebrow">Private AI layer</span>
          <strong>Guide this relationship</strong>
        </div>
        <span className="yance-agent-dot" data-ready={projection?.agentReady || undefined} aria-hidden="true" />
      </header>

      <p className="yance-assistant-status" role="status" aria-live="polite">{status}</p>

      <label className="yance-goal-field">
        <span>Conversation objective</span>
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
          placeholder="Naturally guide the conversation toward what matters today."
        />
      </label>

      <div className="yance-assistant-actions">
        <button type="button" onClick={() => void save()} disabled={busy || !draft.trim()}>Save objective</button>
        <button type="button" onClick={() => void togglePaused()} disabled={busy || projection?.goal.exists !== true}>
          {projection?.goal.paused ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={() => void remove()} disabled={busy || projection?.goal.exists !== true}>Remove</button>
      </div>

      <dl className="yance-assistant-facts">
        <div><dt>Letta</dt><dd>{projection?.agentStatus || "Unavailable"}</dd></div>
        <div><dt>Agents</dt><dd>{projection?.agentCount ?? 0}</dd></div>
        <div><dt>Recent context</dt><dd>{projection?.recentConversationCount ?? 0}</dd></div>
      </dl>
    </aside>
  );
}
