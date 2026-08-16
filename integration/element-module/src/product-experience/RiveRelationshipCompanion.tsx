import React, { useEffect, useMemo, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-canvas";
import type { RelationshipAiState } from "./experienceTypes";

type RiveRelationshipCompanionProps = {
  state: RelationshipAiState;
  reducedMotion: boolean;
};

const RELATIONSHIP_STATES: readonly RelationshipAiState[] = [
  "idle",
  "wake",
  "listening",
  "thinking",
  "ready",
  "speaking",
  "error",
];

const RELATIONSHIP_STATE_LABELS: Readonly<Record<RelationshipAiState, string>> = Object.freeze({
  idle: "静默",
  wake: "唤醒",
  listening: "倾听",
  thinking: "思考",
  ready: "就绪",
  speaking: "表达",
  error: "异常",
});

const STATE_INDEX: Readonly<Record<RelationshipAiState, number>> = Object.freeze(
  Object.fromEntries(RELATIONSHIP_STATES.map((value, index) => [value, index])) as Record<RelationshipAiState, number>,
);

const STATE_MACHINE = "Relationship";

export function RiveRelationshipCompanion({ state, reducedMotion }: RiveRelationshipCompanionProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const visibleState = RELATIONSHIP_STATE_LABELS[state];
  const src = useMemo(() => new URL("./assets/yance-relationship-orb.riv", import.meta.url).href, []);
  const { rive, RiveComponent } = useRive({
    src,
    stateMachines: STATE_MACHINE,
    autoplay: !reducedMotion,
    onLoadError: () => setFailed(true),
  });
  const relationshipState = useStateMachineInput(rive, STATE_MACHINE, "relationshipState", STATE_INDEX.idle);
  const reduceMotionInput = useStateMachineInput(rive, STATE_MACHINE, "reducedMotion", reducedMotion);

  useEffect(() => {
    if (relationshipState) relationshipState.value = STATE_INDEX[state];
  }, [relationshipState, state]);

  useEffect(() => {
    if (reduceMotionInput) reduceMotionInput.value = reducedMotion;
  }, [reduceMotionInput, reducedMotion]);

  useEffect(() => {
    if (!rive) return;
    const syncRendering = (): void => {
      if (reducedMotion || document.visibilityState === "hidden") rive.stopRendering();
      else rive.startRendering();
    };
    syncRendering();
    document.addEventListener("visibilitychange", syncRendering);
    return () => document.removeEventListener("visibilitychange", syncRendering);
  }, [rive, reducedMotion]);

  return (
    <div
      className="yance-rive-companion"
      data-ai-state={state}
      role="status"
      aria-live="polite"
      aria-label={`关系 AI · ${visibleState}`}
    >
      {reducedMotion ? (
        <span className="yance-rive-static-state" aria-hidden="true">{RELATIONSHIP_STATE_LABELS[state]}</span>
      ) : null}
      {!reducedMotion && !failed ? <RiveComponent aria-hidden="true" /> : null}
      {!reducedMotion && failed ? <span className="yance-rive-fallback" aria-hidden="true">●</span> : null}
      <span className="yance-sr-only">AI 状态：{RELATIONSHIP_STATE_LABELS[state]}</span>
    </div>
  );
}
