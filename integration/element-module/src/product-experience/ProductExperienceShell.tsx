import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearningWorkspace } from "../LearningWorkspace";
import { AnimatePresence, motion } from "motion/react";
import { BilingualSearchPanel } from "./BilingualSearchPanel";
import { PeopleSurface } from "./PeopleSurface";
import { RelationshipAssistant } from "./RelationshipAssistant";
import { RelationshipOverlayHost } from "./RelationshipOverlayHost";
import { RelationshipWorld } from "./RelationshipWorld";
import { loadRelationshipProjections, subscribeRelationshipEvents } from "./experienceProjection";
import { useExperiencePreferences } from "./experiencePreferences";
import {
  clearSelectedRelationship,
  selectRelationship,
  useExperienceSession,
} from "./experienceSession";
import type {
  MotionMode,
  RelationshipAiState,
  RelationshipAtmosphere,
  RelationshipProjection,
  SoundMode,
} from "./experienceTypes";
import "./ProductExperienceShell.css";

type ProductExperienceShellProps = {
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
};

export function ProductExperienceShell({ navigateSearchResult }: ProductExperienceShellProps): React.JSX.Element {
  const [relationships, setRelationships] = useState<readonly RelationshipProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading relationships");
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [aiState, setAiState] = useState<RelationshipAiState>("idle");
  const session = useExperienceSession();
  const preferences = useExperiencePreferences();
  const selectedRelationshipIdRef = useRef(session.selectedRelationshipId);
  const refreshGenerationRef = useRef(0);

  useEffect(() => {
    selectedRelationshipIdRef.current = session.selectedRelationshipId;
  }, [session.selectedRelationshipId]);

  const refreshRelationships = useCallback(async (): Promise<void> => {
    const generation = ++refreshGenerationRef.current;
    try {
      const next = await loadRelationshipProjections();
      if (generation !== refreshGenerationRef.current) return;
      setRelationships(next);
      setLoading(false);
      setStatus(next.length ? `${next.length} relationships ready` : "No relationships available yet");
      const selectedRelationshipId = selectedRelationshipIdRef.current;
      if (selectedRelationshipId && !next.some((row) => row.id === selectedRelationshipId)) {
        clearSelectedRelationship();
      }
    } catch {
      if (generation !== refreshGenerationRef.current) return;
      setRelationships([]);
      setLoading(false);
      setStatus("Relationship data unavailable");
    }
  }, []);

  useEffect(() => {
    void refreshRelationships();
  }, [refreshRelationships]);

  useEffect(() => {
    return subscribeRelationshipEvents(() => {
      void refreshRelationships();
    });
  }, [refreshRelationships]);

  useEffect(() => {
    setAssistantVisible(false);
    setAiState("idle");
  }, [session.selectedRelationshipId]);

  const selectedRelationship = useMemo(
    () => relationships.find((row) => row.id === session.selectedRelationshipId) || null,
    [relationships, session.selectedRelationshipId],
  );

  const chooseRelationship = (relationshipId: string): void => {
    selectRelationship(relationshipId);
    setStatus("Relationship opened");
  };

  const toggleAssistant = (): void => {
    setAssistantVisible((visible) => {
      const next = !visible;
      setAiState(next ? "wake" : "idle");
      return next;
    });
  };

  return (
    <main
      className="yance-product-shell"
      data-yance-workspace
      data-atmosphere={preferences.atmosphere.toLowerCase()}
      data-reduced-motion={preferences.reducedMotion || undefined}
      aria-label="Yance Living Relationship OS"
    >
      <div className="yance-shell-status yance-sr-only" role="status" aria-live="polite">{status}</div>

      <BilingualSearchPanel
        relationships={relationships}
        reducedMotion={preferences.reducedMotion}
        onSelectRelationship={chooseRelationship}
        onNavigateRelationship={navigateSearchResult}
      />

      <AnimatePresence mode="wait" initial={false}>
        {!selectedRelationship ? (
          <motion.div
            key="people"
            className="yance-shell-scene"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: -8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.18 }}
          >
            {loading ? (
              <div className="yance-empty" role="status" aria-live="polite">
                <strong>Loading people</strong>
                <span>Reading your existing relationship projection.</span>
              </div>
            ) : (
              <PeopleSurface
                relationships={relationships}
                selectedRelationshipId={session.selectedRelationshipId}
                reducedMotion={preferences.reducedMotion}
                onSelect={chooseRelationship}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key={selectedRelationship.id}
            className="yance-shell-scene"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: 8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.18 }}
          >
            <RelationshipWorld
              relationship={selectedRelationship}
              aiState={aiState}
              reducedMotion={preferences.reducedMotion}
              assistantVisible={assistantVisible}
              onBack={clearSelectedRelationship}
              onToggleAssistant={toggleAssistant}
            />
            <AnimatePresence initial={false}>
              {assistantVisible ? (
                <motion.div
                  key="assistant"
                  initial={preferences.reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={preferences.reducedMotion ? undefined : { opacity: 0, y: 6 }}
                  transition={{ duration: preferences.reducedMotion ? 0 : 0.16 }}
                >
                  <RelationshipAssistant relationshipId={selectedRelationship.id} onStateChange={setAiState} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <LearningWorkspace />

      <details className="yance-experience-settings">
        <summary>Experience</summary>
        <div className="yance-settings-grid">
          <label>
            <span>Sound</span>
            <select value={preferences.soundMode} onChange={(event) => preferences.setSoundMode(event.target.value as SoundMode)}>
              <option>Off</option>
              <option>Essential only</option>
              <option>Immersive</option>
            </select>
          </label>
          <label>
            <span>Motion</span>
            <select value={preferences.motionMode} onChange={(event) => preferences.setMotionMode(event.target.value as MotionMode)}>
              <option>Standard</option>
              <option>Reduced</option>
            </select>
          </label>
          <label>
            <span>Atmosphere</span>
            <select value={preferences.atmosphere} onChange={(event) => preferences.setAtmosphere(event.target.value as RelationshipAtmosphere)}>
              <option>Quiet</option>
              <option>Warm</option>
              <option>Vivid</option>
            </select>
          </label>
        </div>
        {preferences.reducedMotion ? <p className="yance-reduced-motion-note">Reduced motion is active; state changes remain visible without spatial travel.</p> : null}
      </details>

      <RelationshipOverlayHost />
    </main>
  );
}
