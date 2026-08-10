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

const STATE_INDEX: Readonly<Record<RelationshipAiState, number>> = Object.freeze(
  Object.fromEntries(RELATIONSHIP_STATES.map((value, index) => [value, index])) as Record<RelationshipAiState, number>,
);

const STATE_MACHINE = "Relationship";

export function RiveRelationshipCompanion({ state, reducedMotion }: RiveRelationshipCompanionProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => new URL("./assets/yance-relationship-orb.riv", import.meta.url).href, []);
  const { rive, RiveComponent } = useRive({
    src,
    stateMachines: STATE_MACHINE,
    autoplay: true,
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
    const syncVisibility = (): void => {
      if (document.visibilityState === "hidden") rive.stopRendering();
      else rive.startRendering();
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [rive]);

  return (
    <div
      className="yance-rive-companion"
      data-ai-state={state}
      role="status"
      aria-live="polite"
      aria-label={`Relationship AI ${state}`}
    >
      {!failed ? <RiveComponent aria-hidden="true" /> : <span className="yance-rive-fallback" aria-hidden="true">●</span>}
      <span className="yance-sr-only">AI state: {state}</span>
    </div>
  );
}
