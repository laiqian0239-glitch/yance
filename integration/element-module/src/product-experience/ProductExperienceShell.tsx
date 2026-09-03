import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearningWorkspace } from "../LearningWorkspace";
import { AnimatePresence, motion } from "motion/react";
import { BilingualSearchPanel } from "./BilingualSearchPanel";
import { PeopleSurface, type PeopleHomeView } from "./PeopleSurface";
import { RelationshipAssistant } from "./RelationshipAssistant";
import { RelationshipOverlayHost } from "./RelationshipOverlayHost";
import { RelationshipWorld } from "./RelationshipWorld";
import { ProductSystemSettingsSurface } from "./ProductSystemSettingsSurface";
import { PlatformAccountsSurface } from "./PlatformAccountsSurface";
import {
  loadProductAppearance,
  loadRelationshipProjections,
  subscribeRelationshipEvents,
  updateProductAppearance,
  type ProductAppearanceProjection,
} from "./experienceProjection";
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
type ReadRoomStateEvents = (
  roomId: string,
  eventType: string,
) => readonly { stateKey: string; content: Record<string, unknown> }[];

export type ProductAppearanceHost = {
  setFontScale: (percent: number) => Promise<void>;
  setTheme: (theme: {
    id: string;
    name: string;
    isDark: boolean;
    colors?: Record<string, string>;
    compound?: Record<string, string>;
  }) => Promise<void>;
};

type ProductExperienceShellProps = {
  appearanceHost?: ProductAppearanceHost;
  navigateSearchResult?: (relationship: RelationshipProjection) => Promise<boolean>;
  readRoomStateEvents?: ReadRoomStateEvents;
};

const EMPTY_APPEARANCE: ProductAppearanceProjection = {
  available: false,
  fontScale: 100,
  themeId: "",
  themes: [],
};

function elementCustomThemeColors(semanticVariables: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(semanticVariables)
      .filter(([token, value]) => token.startsWith("--") && Boolean(value))
      .map(([token, value]) => [token.slice(2), value]),
  );
}

function semanticThemeVariables(appearance: ProductAppearanceProjection): Readonly<Record<string, string>> {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.semanticVariables || {};
}

export function ProductExperienceShell({
  appearanceHost,
  navigateSearchResult,
  readRoomStateEvents,
}: ProductExperienceShellProps): React.JSX.Element {
  const [relationships, setRelationships] = useState<readonly RelationshipProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在加载关系");
  const [appearance, setAppearance] = useState<ProductAppearanceProjection>(EMPTY_APPEARANCE);
  const [appearanceStatus, setAppearanceStatus] = useState("正在同步外观设置");
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [learningAdminVisible, setLearningAdminVisible] = useState(false);
  const [aiState, setAiState] = useState<RelationshipAiState>("idle");
  const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
  const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
  const session = useExperienceSession();
  const preferences = useExperiencePreferences();
  const selectedRelationshipIdRef = useRef(session.selectedRelationshipId);
  const refreshGenerationRef = useRef(0);
  const appearanceMutationRef = useRef<Promise<void>>(Promise.resolve());
  const appearanceGenerationRef = useRef(0);
  const documentSemanticVariablesRef = useRef<Map<string, string | null>>(new Map());

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

  const reconcileHostAppearance = useCallback(async (next: ProductAppearanceProjection): Promise<void> => {
    if (!appearanceHost || !next.available) return;
    await appearanceHost.setFontScale(next.fontScale);
    const activeTheme = next.themes.find((theme) => theme.id === next.themeId);
    if (!activeTheme) return;
    await appearanceHost.setTheme({
      id: activeTheme.id,
      name: activeTheme.name,
      isDark: activeTheme.isDark,
      colors: elementCustomThemeColors(activeTheme.semanticVariables),
      compound: { ...activeTheme.elementCompound },
    });
  }, [appearanceHost]);

  const refreshAppearance = useCallback(async (): Promise<ProductAppearanceProjection> => {
    const next = await loadProductAppearance();
    setAppearance(next);
    if (!next.available) {
      setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
      return next;
    }
    await reconcileHostAppearance(next);
    setAppearanceStatus("外观已同步");
    return next;
  }, [reconcileHostAppearance]);

  const queueAppearanceUpdate = useCallback((input: { fontScale?: number; themeId?: string }): void => {
    const generation = ++appearanceGenerationRef.current;
    appearanceMutationRef.current = appearanceMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const next = await updateProductAppearance(input);
          if (generation !== appearanceGenerationRef.current) return;
          setAppearance(next);
          await reconcileHostAppearance(next);
          setAppearanceStatus("外观已同步");
        } catch {
          if (generation !== appearanceGenerationRef.current) return;
          setAppearanceStatus("外观设置保存失败，已恢复到持久化状态");
          try {
            await refreshAppearance();
          } catch {
            setAppearance(EMPTY_APPEARANCE);
            setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
          }
        }
      });
  }, [reconcileHostAppearance, refreshAppearance]);

  useEffect(() => {
    void refreshRelationships();
  }, [refreshRelationships]);

  useEffect(() => {
    void refreshAppearance().catch(() => {
      setAppearance(EMPTY_APPEARANCE);
      setAppearanceStatus("桌面外观同步不可用，当前界面将继承宿主外观");
    });
  }, [refreshAppearance]);

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const nextVariables = semanticThemeVariables(appearance);
    const previous = documentSemanticVariablesRef.current;

    for (const token of previous.keys()) {
      if (!Object.prototype.hasOwnProperty.call(nextVariables, token)) {
        const original = previous.get(token);
        if (original) rootStyle.setProperty(token, original);
        else rootStyle.removeProperty(token);
        previous.delete(token);
      }
    }

    for (const [token, value] of Object.entries(nextVariables)) {
      if (!token.startsWith("--") || !value) continue;
      if (!previous.has(token)) previous.set(token, rootStyle.getPropertyValue(token) || null);
      rootStyle.setProperty(token, value);
    }

    return () => {
      for (const [token, original] of previous.entries()) {
        if (original) rootStyle.setProperty(token, original);
        else rootStyle.removeProperty(token);
      }
      previous.clear();
    };
  }, [appearance]);

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
      data-theme-id={appearance.themeId || undefined}
      data-font-scale={appearance.available ? appearance.fontScale : undefined}
      aria-label="言策关系智能操作系统"
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
            <span>全局字号 <output>{appearance.fontScale}%</output></span>
            <input
              type="range"
              min={85}
              max={150}
              step={1}
              value={appearance.fontScale}
              disabled={!appearance.available}
              onChange={(event) => {
                const fontScale = Number(event.target.value);
                setAppearance((current) => ({ ...current, fontScale }));
                queueAppearanceUpdate({ fontScale });
              }}
            />
          </label>
          <label>
            <span>全局主题</span>
            <select
              value={appearance.themeId}
              disabled={!appearance.available || appearance.themes.length === 0}
              onChange={(event) => {
                const themeId = event.target.value;
                setAppearance((current) => ({ ...current, themeId }));
                queueAppearanceUpdate({ themeId });
              }}
            >
              {appearance.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </label>
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
        <p className="yance-appearance-status" role="status" aria-live="polite">{appearanceStatus}</p>
        {preferences.reducedMotion ? <p className="yance-reduced-motion-note">已启用减少动效；状态变化仍会清晰显示，但不会进行空间移动。</p> : null}

        <PlatformAccountsSurface />
        <ProductSystemSettingsSurface />

        <div className="yance-learning-settings-actions">
          {learningAdminVisible ? (
            <button type="button" aria-expanded="true" onClick={() => setLearningAdminVisible(false)}>收起学习控制</button>
          ) : (
            <button type="button" aria-expanded="false" onClick={() => setLearningAdminVisible(true)}>学习控制</button>
          )}
        </div>
        {learningAdminVisible ? <LearningWorkspace /> : null}
      </details>

      <RelationshipOverlayHost readRoomStateEvents={readRoomStateEvents} />
    </main>
  );
}
