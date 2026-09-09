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
  loadPeopleProjections,
  loadProductAppearance,
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
  ConversationRef,
  GroupConversationProjection,
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
  navigateConversation?: (
    relationship: RelationshipProjection,
    conversation: ConversationRef,
  ) => Promise<boolean>;
  navigateGroupConversation?: (
    conversation: GroupConversationProjection,
  ) => Promise<boolean>;
  navigateProductHome?: () => Promise<void> | void;
  readRoomStateEvents?: ReadRoomStateEvents;
  openUserSettings?: (destination:"account"|"security"|"sessions")=>void;
  requestLogout?: ()=>void;
};

const loadRelationshipProjectionsForPeople = loadPeopleProjections;

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


type ProductModelRuntimeRecord = Record<string, unknown>;

type ProductModelRuntimeDesktopApi = {
  getProductModelRuntimeState: () => Promise<unknown>;
  mutateProductModelRuntime: (input: Record<string, unknown>) => Promise<unknown>;
};

function modelRuntimeRecord(value: unknown): ProductModelRuntimeRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProductModelRuntimeRecord : {};
}

function modelRuntimeRows(value: unknown): ProductModelRuntimeRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is ProductModelRuntimeRecord => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    : [];
}

function modelRuntimeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function modelRuntimeNumber(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function modelRuntimeBytes(value: unknown): string {
  const bytes = modelRuntimeNumber(value);
  if (bytes <= 0) return "未知";
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

function modelRuntimePlannerCandidates(catalog: ProductModelRuntimeRecord): ProductModelRuntimeRecord[] {
  return modelRuntimeRows(catalog.models).flatMap((model) => {
    const runtimeCandidates = Array.isArray(model.runtimeCandidates) ? model.runtimeCandidates : [];
    return runtimeCandidates.map((runtimeId) => ({
      model: {
        id: modelRuntimeText(model.id),
        parameterCountB: modelRuntimeNumber(model.parameterCountB),
        quantizedBytes: modelRuntimeNumber(model.quantizedBytes),
      },
      runtime: { id: modelRuntimeText(runtimeId) },
      benchmark: {},
    }));
  });
}

function productModelRuntimeApi(): ProductModelRuntimeDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<ProductModelRuntimeDesktopApi> }).yanceDesktop;
  if (!api
    || typeof api.getProductModelRuntimeState !== "function"
    || typeof api.mutateProductModelRuntime !== "function") return null;
  return api as ProductModelRuntimeDesktopApi;
}

function ProductModelRuntimeSupportSurface(): React.JSX.Element {
  const api = useMemo(() => productModelRuntimeApi(), []);
  const [modelRuntime, setModelRuntime] = useState<ProductModelRuntimeRecord>({});
  const [feedback, setFeedback] = useState("正在读取高级系统支持状态");
  const [busy, setBusy] = useState(false);
  const [runtimeTargetName, setRuntimeTargetName] = useState("");
  const [localAssetPath, setLocalAssetPath] = useState("");
  const [expectedSha256, setExpectedSha256] = useState("");
  const [requiredBytes, setRequiredBytes] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://127.0.0.1:11434");
  const [ollamaRequestId, setOllamaRequestId] = useState("");

  const refreshModelRuntime = useCallback(async (): Promise<void> => {
    if (!api) {
      setFeedback("高级系统支持桥接暂不可用；不会创建本地替代状态。");
      return;
    }
    setBusy(true);
    try {
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      setFeedback("高级系统支持状态已从现有权威刷新");
    } catch {
      setFeedback("高级系统支持状态读取失败；保留现有权威，不启用静默降级。");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshModelRuntime();
  }, [refreshModelRuntime]);

  const mutateModelRuntime = useCallback(async (
    input: Record<string, unknown>,
    successMessage: string,
  ): Promise<unknown> => {
    if (!api || busy) return null;
    setBusy(true);
    try {
      const result = await api.mutateProductModelRuntime(input);
      setFeedback(successMessage);
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      return result;
    } catch {
      setFeedback("模型运行态操作失败；正式回复仍由 LiteLLM Model Brain 处理，不做本地静默回退。");
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  const brainState = modelRuntimeRecord(modelRuntime.modelBrain);
  const brain = modelRuntimeRecord(brainState.modelBrain);
  const brainRuntime = modelRuntimeRecord(brainState.runtime);
  const catalog = modelRuntimeRecord(modelRuntime.catalog);
  const hardwareRoot = modelRuntimeRecord(modelRuntime.hardware);
  const hardware = modelRuntimeRecord(hardwareRoot.hardware);
  const adaptiveLocal = modelRuntimeRecord(modelRuntime.adaptiveLocal);
  const catalogRows = modelRuntimeRows(catalog.models);
  const materializations = modelRuntimeRows(adaptiveLocal.materializations);
  const pulls = modelRuntimeRows(adaptiveLocal.pulls);
  const brainHealth = modelRuntimeText(
    brain.health || brain.state || brainRuntime.health || brainRuntime.state || brainState.status,
    brainState.ok === false ? "不可用" : "状态已读取",
  );
  const brainAuthority = modelRuntimeText(brain.authority || brain.litellm || brainRuntime.authority, "LiteLLM");

  const planAdaptiveLocal = async (): Promise<void> => {
    const candidates = modelRuntimePlannerCandidates(catalog);
    if (!candidates.length) {
      setFeedback("当前自适应本地模型目录没有可规划候选。");
      return;
    }
    const result = modelRuntimeRecord(await mutateModelRuntime(
      { action: "plan-adaptive-local", candidates },
      "自适应本地规划已完成；结果来自现有 planner authority。",
    ));
    const best = modelRuntimeRecord(result.best);
    if (Object.keys(best).length) {
      setFeedback(`规划结果：${modelRuntimeText(best.modelId, "模型")} / ${modelRuntimeText(best.runtimeId, "运行时")} · ${modelRuntimeText(best.capabilityClass, "未知能力级别")}`);
    }
  };

  const pullOllama = async (): Promise<void> => {
    if (!ollamaModel.trim()) {
      setFeedback("请输入要下载的 Ollama 模型名称。");
      return;
    }
    const requestId = ollamaRequestId.trim() || globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`;
    setOllamaRequestId(requestId);
    await mutateModelRuntime(
      {
        action: "pull-ollama-model",
        model: ollamaModel.trim(),
        endpoint: ollamaEndpoint.trim(),
        requestId,
      },
      "Ollama 模型下载请求已完成；状态已刷新。",
    );
  };

  return (
    <section aria-label="高级系统支持" data-yance-secondary-system-support>
      <header>
        <h4>高级系统支持</h4>
        <p>仅在明确展开后投影现有模型运行权威；不会创建第二套路由器、运行时或静默回退。</p>
        <button type="button" onClick={() => void refreshModelRuntime()} disabled={busy}>刷新支持状态</button>
      </header>
      <p role="status" aria-live="polite">{feedback}</p>
      <div className="yance-settings-grid">
        <section>
          <h5>Model Brain</h5>
          <p>Model Brain 运行状态：{brainHealth}</p>
          <p>正式路由权威：{brainAuthority.includes("LiteLLM") ? brainAuthority : `LiteLLM · ${brainAuthority}`}</p>
          <p>LiteLLM 继续负责 quick_reply / deep_reply / director；本地模型不会静默替代正式回复。</p>
        </section>

        <section>
          <h5>自适应本地运行态</h5>
          <p>目录：{catalogRows.length} 个模型 · 已 materialize：{materializations.length} 项 · 下载任务：{pulls.length} 项</p>
          <p>
            硬件：RAM 可用 {modelRuntimeBytes(hardware.memoryFreeBytes || hardware.freeMemoryBytes)}
            {" · "}
            GPU VRAM {modelRuntimeBytes(hardware.gpuVramBytes || hardware.vramBytes)}
          </p>
          <button type="button" disabled={busy || catalogRows.length === 0} onClick={() => void planAdaptiveLocal()}>
            规划自适应本地运行时
          </button>
          <ul>
            {catalogRows.slice(0, 8).map((row) => (
              <li key={modelRuntimeText(row.id, modelRuntimeText(row.displayName, "model"))}>
                {modelRuntimeText(row.displayName, modelRuntimeText(row.id, "模型"))}
                {" · "}
                {Array.isArray(row.runtimeCandidates) ? row.runtimeCandidates.map((value) => modelRuntimeText(value)).filter(Boolean).join(" / ") : "运行时待定"}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h5>安装 / 移除本地运行时</h5>
          <label><span>目标名称</span><input value={runtimeTargetName} onChange={(event) => setRuntimeTargetName(event.target.value)} placeholder="例如 llama-runtime.zip" /></label>
          <label><span>本机已验证资产路径</span><input value={localAssetPath} onChange={(event) => setLocalAssetPath(event.target.value)} placeholder="本机路径" /></label>
          <label><span>SHA-256</span><input value={expectedSha256} onChange={(event) => setExpectedSha256(event.target.value)} placeholder="预期 SHA-256" /></label>
          <label><span>所需字节数</span><input inputMode="numeric" value={requiredBytes} onChange={(event) => setRequiredBytes(event.target.value)} /></label>
          <div className="yance-learning-settings-actions">
            <button
              type="button"
              disabled={busy || !runtimeTargetName || !localAssetPath || !expectedSha256}
              onClick={() => void mutateModelRuntime(
                {
                  action: "materialize-adaptive-runtime",
                  consent: true,
                  targetName: runtimeTargetName,
                  localAssetPath,
                  expectedSha256,
                  requiredBytes: modelRuntimeNumber(requiredBytes),
                },
                "本地运行时安装 / materialize 完成；状态已刷新。",
              )}
            >安装本地运行时</button>
            <button
              type="button"
              disabled={busy || !runtimeTargetName}
              onClick={() => void mutateModelRuntime(
                { action: "remove-adaptive-runtime", targetName: runtimeTargetName },
                "本地运行时已移除；状态已刷新。",
              )}
            >移除本地运行时</button>
          </div>
        </section>

        <section>
          <h5>Ollama 模型下载</h5>
          <label><span>模型</span><input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} placeholder="例如 qwen3:8b" /></label>
          <label><span>Ollama 地址</span><input value={ollamaEndpoint} onChange={(event) => setOllamaEndpoint(event.target.value)} /></label>
          <div className="yance-learning-settings-actions">
            <button type="button" disabled={busy || !ollamaModel.trim()} onClick={() => void pullOllama()}>下载 Ollama 模型</button>
            <button
              type="button"
              disabled={busy || !ollamaRequestId}
              onClick={() => void mutateModelRuntime(
                { action: "cancel-ollama-pull", requestId: ollamaRequestId },
                "已请求取消 Ollama 下载。",
              )}
            >取消 Ollama 下载</button>
          </div>
        </section>
      </div>
    </section>
  );
}

type ProductRuntimeSafetyDesktopApi = {
  getState?: () => Promise<unknown>;
  getRuntimeProjection?: () => Promise<unknown>;
  onBackendState?: (callback: (payload: unknown) => void) => (() => void);
  onRuntimeProjection?: (callback: (payload: unknown) => void) => (() => void);
  onRuntimeHealth?: (callback: (payload: unknown) => void) => (() => void);
};

type ProductRuntimeSafetyBanner = {
  state: "offline" | "backend-unready" | "safe-mode" | "degraded";
  title: string;
  detail: string;
} | null;

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runtimeDesktopApi(): ProductRuntimeSafetyDesktopApi | null {
  return (window as unknown as { yanceDesktop?: ProductRuntimeSafetyDesktopApi }).yanceDesktop || null;
}

function projectRuntimeSafety(
  browserOnline: boolean,
  backendReady: boolean | null,
  projection: Record<string, unknown>,
  health: Record<string, unknown>,
  projectionUnavailable: boolean,
): ProductRuntimeSafetyBanner {
  if (!browserOnline) {
    return { state: "offline", title: "网络已离线", detail: "需要联网的关系同步与外部平台操作会暂时不可用。" };
  }
  if (backendReady === false) {
    return { state: "backend-unready", title: "本地服务未就绪", detail: "可在体验设置的运行安全与恢复中重启后台服务。" };
  }
  const runtime = runtimeRecord(projection.runtime);
  if (String(runtime.operatingMode || "") === "safeMode") {
    return { state: "safe-mode", title: "安全模式已启用", detail: "部分操作受限；退出前会由现有 RecoveryManager 签发一次性授权。" };
  }
  const lifecycleState = String(runtime.lifecycleState || "");
  const reasonCode = String(health.reasonCode || "");
  if (
    projectionUnavailable
    || health.fatal === true
    || health.recoverable === true
    || runtime.localReady === false
    || Boolean(lifecycleState && lifecycleState !== "running")
  ) {
    return {
      state: "degraded",
      title: "运行状态需要处理",
      detail: reasonCode
        ? `运行健康异常：${reasonCode}。可在体验设置中执行恢复操作。`
        : "运行投影尚未恢复到正常就绪状态；可在体验设置中执行恢复操作。",
    };
  }
  return null;
}

function semanticThemeVariables(appearance: ProductAppearanceProjection): Readonly<Record<string, string>> {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.semanticVariables || {};
}

export function ProductExperienceShell({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  navigateGroupConversation,
  navigateProductHome,
  readRoomStateEvents,
  openUserSettings,
  requestLogout,
}: ProductExperienceShellProps): React.JSX.Element {
  const [relationships, setRelationships] = useState<readonly RelationshipProjection[]>([]);
  const [groups, setGroups] = useState<readonly GroupConversationProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在加载关系");
  const [appearance, setAppearance] = useState<ProductAppearanceProjection>(EMPTY_APPEARANCE);
  const [appearanceStatus, setAppearanceStatus] = useState("正在同步外观设置");
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [learningAdminVisible, setLearningAdminVisible] = useState(false);
  const [modelSupportVisible, setModelSupportVisible] = useState(false);
  const [aiState, setAiState] = useState<RelationshipAiState>("idle");
  const [peopleHomeView, setPeopleHomeView] = useState<PeopleHomeView>("list");
  const [focusedRelationshipId, setFocusedRelationshipId] = useState("");
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [runtimeBackendReady, setRuntimeBackendReady] = useState<boolean | null>(null);
  const [runtimeProjection, setRuntimeProjection] = useState<Record<string, unknown>>({});
  const [runtimeHealth, setRuntimeHealth] = useState<Record<string, unknown>>({});
  const [runtimeProjectionUnavailable, setRuntimeProjectionUnavailable] = useState(false);
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

  useEffect(() => {
    const api = runtimeDesktopApi();
    let active = true;
    const onOnline = (): void => setBrowserOnline(true);
    const onOffline = (): void => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const applyBackendState = (payload: unknown): void => {
      if (!active) return;
      const backend = runtimeRecord(payload);
      if (typeof backend.ready === "boolean") setRuntimeBackendReady(backend.ready);
    };
    const applyProjection = (payload: unknown): void => {
      if (!active) return;
      setRuntimeProjection(runtimeRecord(payload));
      setRuntimeHealth({});
      setRuntimeProjectionUnavailable(false);
    };
    const applyHealth = (payload: unknown): void => {
      if (active) setRuntimeHealth(runtimeRecord(payload));
    };

    if (api?.getState) {
      void api.getState().then((payload) => {
        const backend = runtimeRecord(runtimeRecord(payload).backend);
        applyBackendState(backend);
      }, () => {
        if (active) setRuntimeBackendReady(false);
      });
    }
    if (api?.getRuntimeProjection) {
      void api.getRuntimeProjection().then(applyProjection, () => {
        if (active) setRuntimeProjectionUnavailable(true);
      });
    }

    const unsubscribeBackend = api?.onBackendState?.(applyBackendState);
    const unsubscribeProjection = api?.onRuntimeProjection?.(applyProjection);
    const unsubscribeHealth = api?.onRuntimeHealth?.(applyHealth);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubscribeBackend?.();
      unsubscribeProjection?.();
      unsubscribeHealth?.();
    };
  }, []);

  const refreshRelationships = useCallback(async (): Promise<void> => {
    const generation = ++refreshGenerationRef.current;
    try {
      const next = await loadRelationshipProjectionsForPeople();
      if (generation !== refreshGenerationRef.current) return;
      setRelationships(next.relationships);
      setGroups(next.groups);
      setFocusedRelationshipId((current) => (
        current && !next.relationships.some((row) => row.id === current) ? "" : current
      ));
      setLoading(false);
      setStatus(
        next.relationships.length || next.groups.length
          ? `已载入 ${next.relationships.length} 段关系 · ${next.groups.length} 个群聊`
          : "暂无可用关系或群聊",
      );
      const selectedRelationshipId = selectedRelationshipIdRef.current;
      if (selectedRelationshipId && !next.relationships.some((row) => row.id === selectedRelationshipId)) {
        clearSelectedRelationship();
      }
    } catch {
      if (generation !== refreshGenerationRef.current) return;
      setRelationships([]);
      setGroups([]);
      setFocusedRelationshipId("");
      setLoading(false);
      setStatus("关系与群聊数据暂不可用");
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

  const runtimeSafetyBanner = useMemo(
    () => projectRuntimeSafety(
      browserOnline,
      runtimeBackendReady,
      runtimeProjection,
      runtimeHealth,
      runtimeProjectionUnavailable,
    ),
    [browserOnline, runtimeBackendReady, runtimeHealth, runtimeProjection, runtimeProjectionUnavailable],
  );

  const chooseRelationship = (relationshipId: string): void => {
    selectRelationship(relationshipId);
    setStatus("已打开关系");
  };

  const openConversation = async (conversationId: string): Promise<void> => {
    if (!selectedRelationship) {
      setStatus("请先选择一个人");
      return;
    }

    const conversation = selectedRelationship.conversations
      .find((row) => row.id === conversationId);

    if (!conversation) {
      setStatus("该对话已不可用；不会自动选择其它对话");
      return;
    }

    if (!navigateConversation) {
      setStatus("真实对话导航暂不可用");
      return;
    }

    try {
      const opened = await navigateConversation(selectedRelationship, conversation);
      setStatus(opened
        ? "已进入对话"
        : "没有找到唯一匹配的真实对话；请检查账号同步状态");
    } catch {
      setStatus("对话解析失败；言策没有执行猜测性跳转");
    }
  };

  const openGroupConversation = async (
    conversation: GroupConversationProjection,
  ): Promise<void> => {
    if (!navigateGroupConversation) {
      setStatus("真实群聊导航暂不可用");
      return;
    }

    try {
      const opened = await navigateGroupConversation(conversation);
      setStatus(opened
        ? "已进入群聊"
        : "没有找到唯一匹配的真实群聊；请检查账号同步状态");
    } catch {
      setStatus("群聊解析失败；言策没有执行猜测性跳转");
    }
  };

  const returnToPeople = (): void => {
    if (!navigateProductHome) {
      setStatus("返回联系人暂不可用；当前关系上下文保持不变");
      return;
    }
    void Promise.resolve(navigateProductHome())
      .then(() => setStatus("已返回联系人"))
      .catch(() => setStatus("返回联系人失败；当前关系上下文保持不变"));
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
      {runtimeSafetyBanner ? (
        <div
          className="yance-appearance-status yance-runtime-safety-banner"
          data-runtime-safety={runtimeSafetyBanner.state}
          role="status"
          aria-live="polite"
        >
          <strong>{runtimeSafetyBanner.title}</strong>
          <span>{runtimeSafetyBanner.detail}</span>
        </div>
      ) : null}

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
                groups={groups}
                selectedRelationshipId={session.selectedRelationshipId}
                focusedRelationshipId={focusedRelationshipId}
                viewMode={peopleHomeView}
                reducedMotion={preferences.reducedMotion}
                onViewModeChange={setPeopleHomeView}
                onFocus={setFocusedRelationshipId}
                onSelect={chooseRelationship}
                onSelectGroup={(conversation) => {
                  void openGroupConversation(conversation);
                }}
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
              onBack={returnToPeople}
              onToggleAssistant={toggleAssistant}
              onOpenConversation={(conversationId) => {
                void openConversation(conversationId);
              }}
              mergeTargets={relationships
                .filter((row) => row.id !== selectedRelationship.id)
                .map((row) => ({ id: row.id, name: row.name }))}
              onRefresh={refreshRelationships}
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
        <ProductSystemSettingsSurface openUserSettings={openUserSettings} requestLogout={requestLogout} />

        <section className="yance-learning-disclosure" aria-label="学习与成长">
          <header>
            <div><strong>学习与成长</strong><p>仅在需要复盘学习记录与反馈时打开。</p></div>
          </header>
          <button type="button" aria-expanded={learningAdminVisible} disabled={learningAdminVisible} onClick={() => setLearningAdminVisible(true)}>学习控制</button>
          {learningAdminVisible ? <LearningWorkspace /> : null}
          {learningAdminVisible ? (
            <button type="button" onClick={() => setLearningAdminVisible(false)}>收起学习控制</button>
          ) : null}
        </section>

        <div className="yance-learning-settings-actions">
          <button type="button" onClick={() => setModelSupportVisible((value) => !value)}>
            {modelSupportVisible ? "收起高级系统支持" : "高级系统支持"}
          </button>
        </div>
        {modelSupportVisible && (
          <details open>
            <summary>高级系统支持</summary>
            <ProductModelRuntimeSupportSurface />
          </details>
        )}

      </details>

      <RelationshipOverlayHost readRoomStateEvents={readRoomStateEvents} />
    </main>
  );
}
