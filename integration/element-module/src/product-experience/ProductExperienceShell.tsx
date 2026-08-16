import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearningWorkspace } from "../LearningWorkspace";
import { AnimatePresence, motion } from "motion/react";
import { BilingualSearchPanel } from "./BilingualSearchPanel";
import { PeopleSurface, type PeopleHomeView } from "./PeopleSurface";
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
  const [status, setStatus] = useState("正在加载关系");
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [learningAdminVisible, setLearningAdminVisible] = useState(false);
  const [aiState, setAiState] = useState<RelationshipAiState>("idle");
  const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
  const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
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
      setFocusedRelationshipId((current) => (
        current && !next.some((row) => row.id === current) ? "" : current
      ));
      setLoading(false);
      setStatus(next.length ? `已载入 ${next.length} 段关系` : "暂无可用关系");
      const selectedRelationshipId = selectedRelationshipIdRef.current;
      if (selectedRelationshipId && !next.some((row) => row.id === selectedRelationshipId)) {
        clearSelectedRelationship();
      }
    } catch {
      if (generation !== refreshGenerationRef.current) return;
      setRelationships([]);
      setFocusedRelationshipId("");
      setLoading(false);
      setStatus("关系数据暂不可用");
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
    setStatus("已打开关系");
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
      aria-label="Yance 关系智能操作系统"
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
                <strong>正在加载关系</strong>
                <span>正在读取已有的可信关系投影。</span>
              </div>
            ) : (
              <PeopleSurface
                relationships={relationships}
                selectedRelationshipId={session.selectedRelationshipId}
                focusedRelationshipId={focusedRelationshipId}
                viewMode={peopleHomeView}
                reducedMotion={preferences.reducedMotion}
                onViewModeChange={setPeopleHomeView}
                onFocus={setFocusedRelationshipId}
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
                  <RelationshipAssistant relationship={selectedRelationship} onStateChange={setAiState} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <details
        className="yance-experience-settings"
        onToggle={(event) => {
          if (!event.currentTarget.open) setLearningAdminVisible(false);
        }}
      >
        <summary>体验设置</summary>
        <div className="yance-settings-grid">
          <label>
            <span>声音</span>
            <select value={preferences.soundMode} onChange={(event) => preferences.setSoundMode(event.target.value as SoundMode)}>
              <option value="Off">关闭</option>
              <option value="Essential only">仅必要提示</option>
              <option value="Immersive">沉浸</option>
            </select>
          </label>
          <label>
            <span>动效</span>
            <select value={preferences.motionMode} onChange={(event) => preferences.setMotionMode(event.target.value as MotionMode)}>
              <option value="Standard">标准</option>
              <option value="Reduced">减少动效</option>
            </select>
          </label>
          <label>
            <span>氛围</span>
            <select value={preferences.atmosphere} onChange={(event) => preferences.setAtmosphere(event.target.value as RelationshipAtmosphere)}>
              <option value="Quiet">安静</option>
              <option value="Warm">温暖</option>
              <option value="Vivid">鲜活</option>
            </select>
          </label>
        </div>
        {preferences.reducedMotion ? <p className="yance-reduced-motion-note">已启用减少动效；状态变化仍会清晰显示，但不会进行空间移动。</p> : null}
        <div className="yance-learning-settings-actions">
          {learningAdminVisible ? (
            <button type="button" aria-expanded="true" onClick={() => setLearningAdminVisible(false)}>收起学习控制</button>
          ) : (
            <button type="button" aria-expanded="false" onClick={() => setLearningAdminVisible(true)}>学习控制</button>
          )}
        </div>
        {learningAdminVisible ? <LearningWorkspace /> : null}
      </details>

      <RelationshipOverlayHost />
    </main>
  );
}
