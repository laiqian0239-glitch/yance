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
  if (!projection) return "正在加载关系智能";
  if (!projection.agentReady) return projection.agentStatus || "AI 暂不可用";
  if (projection.goal.exists === true) return projection.goal.paused ? "意图已暂停" : "意图进行中";
  return "AI 已就绪 · 尚未设置私密意图";
}

export function RelationshipAssistant({ relationship, onStateChange }: RelationshipAssistantProps): React.JSX.Element {
  const relationshipId = relationship.id;
  const [projection, setProjection] = useState<RelationshipAssistantProjection | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在加载关系智能");
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
      setStatus("私密意图暂不可用");
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
          setStatus("私密意图暂不可用");
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
      setStatus(next.goal.paused ? "意图已暂停" : "意图进行中");
      onStateChange?.("ready");
    } catch {
      setStatus("无法更新私密意图");
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
      setStatus(next.goal.paused ? "意图已暂停" : "意图进行中");
      onStateChange?.("ready");
    } catch {
      setStatus("无法更改私密意图状态");
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
      setStatus("私密意图已移除");
    } catch {
      setStatus("无法移除私密意图");
      onStateChange?.("error");
    } finally {
      setBusy(false);
    }
  };

  const intelligence = relationship.relationshipIntelligence;
  const relationshipInsight = intelligence?.summary
    || intelligence?.analysisStatusLabel
    || "暂无已确认的关系洞察。";
  const nextStep = intelligence?.next || "暂无可信的下一步建议。";
  const progressPath = projection?.goal.exists === true ? projection.goal.progress.path : [];

  return (
    <aside className="yance-assistant" aria-label="关系私密任务">
      <header>
        <div>
          <span className="yance-eyebrow">关系私密任务</span>
          <strong>专注于与 {relationship.name} 之间真正重要的事</strong>
        </div>
        <span className="yance-agent-dot" data-ready={projection?.agentReady || undefined} aria-hidden="true" />
      </header>

      <p className="yance-assistant-status" role="status" aria-live="polite">{status}</p>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-intention">
        <h3 id="yance-private-quest-intention">当前意图</h3>
        <label className="yance-goal-field">
          <span className="yance-sr-only">私密意图</span>
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
            placeholder="这段关系现在最重要的是什么？"
          />
        </label>
        <div className="yance-assistant-actions">
          <button type="button" onClick={() => void save()} disabled={busy || !draft.trim()}>保存意图</button>
          <button type="button" onClick={() => void togglePaused()} disabled={busy || projection?.goal.exists !== true}>
            {projection?.goal.paused ? "继续" : "暂停"}
          </button>
          <button type="button" onClick={() => void remove()} disabled={busy || projection?.goal.exists !== true}>移除</button>
        </div>
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-progress">
        <h3 id="yance-private-quest-progress">进展</h3>
        {progressPath.length ? (
          <ol className="yance-private-quest-progress">
            {progressPath.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
          </ol>
        ) : (
          <p className="yance-private-quest-empty">暂时还没有可用的进展记录。</p>
        )}
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-insight">
        <h3 id="yance-private-quest-insight">关系洞察</h3>
        <p>{relationshipInsight}</p>
      </section>

      <section className="yance-private-quest-section" aria-labelledby="yance-private-quest-next">
        <h3 id="yance-private-quest-next">下一步</h3>
        <p>{nextStep}</p>
      </section>
    </aside>
  );
}
