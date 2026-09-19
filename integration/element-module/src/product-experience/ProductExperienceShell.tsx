import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearningWorkspace } from "../LearningWorkspace";
import { AnimatePresence, motion } from "motion/react";
import { BilingualSearchPanel } from "./BilingualSearchPanel";
import { PeopleSurface, type PeopleHomeView } from "./PeopleSurface";
import { RelationshipAssistant } from "./RelationshipAssistant";
import { RelationshipOverlayHost } from "./RelationshipOverlayHost";
import { RelationshipWorld } from "./RelationshipWorld";
import { ProductSystemSettingsSurface, type ProductSettingsCategory } from "./ProductSystemSettingsSurface";
import { PlatformAccountsSurface } from "./PlatformAccountsSurface";

import {
  loadPeopleProjections,
  loadProductAppearance,
  subscribeRelationshipEvents,
  updateProductAppearance,
  type ProductAppearanceProjection,
} from "./experienceProjection";
import { useExperiencePreferences } from "./experiencePreferences";
import { playExperienceSound } from "./experienceSound";
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
  navigateRelationshipHome?: () => Promise<void> | void;
  renderRoomView?: (roomId: string, props?: {
    hideHeader?: boolean;
    hideComposer?: boolean;
    hideRightPanel?: boolean;
    hidePinnedMessageBanner?: boolean;
    hideWidgets?: boolean;
    enableReadReceiptsAndMarkersOnActivity?: boolean;
  }) => React.ReactNode;
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
  saveCredential?: (ref: string, value: Record<string, unknown>, requestId?: string) => Promise<unknown>;
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
  const [feedback, setFeedback] = useState("正在读取模型中心状态");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"cloud" | "local" | "activity">("cloud");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [compatibleEndpoint, setCompatibleEndpoint] = useState("https://api.openai.com/v1");
  const [compatibleKey, setCompatibleKey] = useState("");
  const [compatibleCredentialRef, setCompatibleCredentialRef] = useState("");
  const [compatibleModels, setCompatibleModels] = useState<readonly string[]>([]);
  const [compatibleSelected, setCompatibleSelected] = useState("");
  const [ollamaRequestId, setOllamaRequestId] = useState("");
  const [pendingDeleteModelId, setPendingDeleteModelId] = useState("");
  const ollamaEndpoint = "http://127.0.0.1:11434";
  const recommendedOllamaModel = "qwen3:8b";

  const refreshModelRuntime = useCallback(async (): Promise<void> => {
    if (!api) {
      setFeedback("模型服务暂不可用，请稍后重试。");
      return;
    }
    setBusy(true);
    try {
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      setFeedback("模型状态已刷新");
    } catch {
      setFeedback("模型状态读取失败，请稍后重试。");
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
      const resultRecord = modelRuntimeRecord(result);
      if (resultRecord.ok === false) {
        throw new Error(modelRuntimeText(resultRecord.message || resultRecord.reasonCode || resultRecord.code, "模型操作失败"));
      }
      setFeedback(successMessage);
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      return result;
    } catch (error) {
      setFeedback(error instanceof Error && error.message
        ? error.message
        : "模型操作失败，当前对话设置保持不变。");
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  // Mature authority: backend Model Brain / LiteLLM remains the sole physical provider/model/retry/fallback owner.
  const brainState = modelRuntimeRecord(modelRuntime.modelBrain);
  const brain = modelRuntimeRecord(brainState.modelBrain);
  const brainRuntime = modelRuntimeRecord(brainState.runtime);
  const modelStatus = modelRuntimeRecord(modelRuntime.modelStatus);
  const hardwareRoot = modelRuntimeRecord(modelRuntime.hardware);
  const hardware = modelRuntimeRecord(hardwareRoot.hardware);
  const adaptiveLocal = modelRuntimeRecord(modelRuntime.adaptiveLocal);
  const modelRows = modelRuntimeRows(modelStatus.models);
  const localModels = modelRows.filter((row) => modelRuntimeText(row.provider).toLowerCase() === "ollama");
  const cloudModels = modelRows.filter((row) => modelRuntimeText(row.provider).toLowerCase() !== "ollama");
  const openRouter = modelRuntimeRecord(modelStatus.openRouter);
  const pulls = modelRuntimeRows(adaptiveLocal.pulls);
  const activePull = pulls.find((row) => !["completed", "cancelled", "failed"].includes(modelRuntimeText(row.status).toLowerCase())) || null;
  const brainHealth = modelRuntimeText(
    brain.health || brain.state || brainRuntime.health || brainRuntime.state || brainState.status,
    brainState.ok === false ? "不可用" : "状态已读取",
  );
  const routeEvidence = modelRuntimeRecord(brainRuntime.lastEvidence || brain.lastEvidence);
  const selectedModel = modelRuntimeText(routeEvidence.selectedModel);
  const selectedProvider = modelRuntimeText(routeEvidence.provider);
  const logicalModel = modelRuntimeText(routeEvidence.logicalModel);
  const costUsd = modelRuntimeNumber(routeEvidence.costUsd);
  const retryCount = modelRuntimeNumber(routeEvidence.retryCount);
  const fallbackCount = modelRuntimeNumber(routeEvidence.fallbackCount);
  const openRouterConnected = ["ready", "catalog-ready", "connected"].includes(
    modelRuntimeText(openRouter.connectionState || openRouter.status).toLowerCase(),
  ) || openRouter.credentialConfigured === true;
  const verifiedModels = modelRows.filter((row) =>
    ["verified", "qualified"].includes(modelRuntimeText(row.qualification || row.qualificationStatus).toLowerCase()),
  );

  const scanLocalModels = async (): Promise<void> => {
    await mutateModelRuntime(
      { action: "scan-local-models" },
      "本地 AI 已扫描完成。",
    );
  };

  const pullRecommendedOllama = async (): Promise<void> => {
    const requestId = globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`;
    setOllamaRequestId(requestId);
    await mutateModelRuntime(
      {
        action: "pull-ollama-model",
        model: recommendedOllamaModel,
        endpoint: ollamaEndpoint,
        requestId,
      },
      `已提交 ${recommendedOllamaModel} 安装；下载状态已刷新。`,
    );
  };

  const setLocalModelEnabled = async (model: ProductModelRuntimeRecord, enabled: boolean): Promise<void> => {
    const modelId = modelRuntimeText(model.id);
    if (!modelId) return;
    setPendingDeleteModelId("");
    await mutateModelRuntime(
      {
        action: "set-local-model-enabled",
        modelId,
        enabled,
        reason: "product-model-center",
      },
      enabled ? "本地模型已重新启用。" : "本地模型已停用；如需永久删除，可再次确认删除。",
    );
  };

  const deleteLocalModel = async (model: ProductModelRuntimeRecord): Promise<void> => {
    const modelId = modelRuntimeText(model.id);
    const modelName = modelRuntimeText(model.name);
    if (!modelId || !modelName) return;
    if (pendingDeleteModelId !== modelId) {
      setPendingDeleteModelId(modelId);
      setFeedback(`再次点击“永久删除”将从本机 Ollama 删除 ${modelName}；此操作不可撤销。`);
      return;
    }
    await mutateModelRuntime(
      {
        action: "delete-local-model",
        modelId,
        confirmName: modelName,
      },
      `已永久删除本地模型 ${modelName}。`,
    );
    setPendingDeleteModelId("");
  };

  const configureOpenRouter = async (): Promise<void> => {
    if (!api?.saveCredential || !openRouterKey.trim()) {
      setFeedback("请输入 OpenRouter API Key；密钥只写入 Windows 安全存储。");
      return;
    }
    setBusy(true);
    try {
      const credentialRef = `model:openrouter:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const saved = modelRuntimeRecord(await api.saveCredential(credentialRef, {
        apiKey: openRouterKey.trim(),
        endpoint: "https://openrouter.ai/api/v1",
        provider: "openai-compatible",
        service: "openrouter",
      }));
      if (saved.ok === false || saved.runtimeConfirmed === false) {
        throw new Error(modelRuntimeText(saved.message || saved.reasonCode, "OpenRouter API Key 保存失败"));
      }
      setOpenRouterKey("");
      const configured = modelRuntimeRecord(await api.mutateProductModelRuntime({
        action: "configure-openrouter",
        credentialRef,
      }));
      if (configured.ok === false) {
        throw new Error(modelRuntimeText(configured.message || configured.reasonCode || configured.code, "OpenRouter 连接失败"));
      }
      setModelRuntime(modelRuntimeRecord(await api.getProductModelRuntimeState()));
      setFeedback("云端 AI 已连接，可以开始使用。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "OpenRouter 连接失败");
    } finally {
      setBusy(false);
    }
  };

  const discoverCompatibleCloud = async (): Promise<void> => {
    if (!api?.saveCredential || !compatibleEndpoint.trim() || !compatibleKey.trim()) {
      setFeedback("请填写 OpenAI 兼容地址与 API Key。");
      return;
    }
    setBusy(true);
    try {
      const credentialRef = `model:openai-compatible:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      const endpoint = compatibleEndpoint.trim();
      const saved = modelRuntimeRecord(await api.saveCredential(credentialRef, {
        apiKey: compatibleKey.trim(),
        endpoint,
        provider: "openai-compatible",
      }));
      if (saved.ok === false || saved.runtimeConfirmed === false) {
        throw new Error(modelRuntimeText(saved.message || saved.reasonCode, "API Key 保存失败"));
      }
      setCompatibleKey("");
      const discovered = modelRuntimeRecord(await api.mutateProductModelRuntime({
        action: "discover-compatible-cloud",
        endpoint,
        credentialRef,
      }));
      if (discovered.ok === false) {
        throw new Error(modelRuntimeText(discovered.message || discovered.reasonCode || discovered.code, "云端模型目录读取失败"));
      }
      const models = Array.isArray(discovered.models)
        ? discovered.models.map((value) => modelRuntimeText(value)).filter(Boolean)
        : [];
      setCompatibleCredentialRef(credentialRef);
      setCompatibleModels(models);
      setCompatibleSelected(models[0] || "");
      setFeedback(models.length ? `已找到 ${models.length} 个可用模型；请选择一个完成连接。` : "连接已验证，但服务没有返回可用模型。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "云端模型目录读取失败");
    } finally {
      setBusy(false);
    }
  };

  const registerCompatibleCloud = async (): Promise<void> => {
    if (!compatibleCredentialRef || !compatibleSelected) {
      setFeedback("请先读取模型目录并选择模型。");
      return;
    }
    await mutateModelRuntime(
      {
        action: "register-compatible-cloud",
        endpoint: compatibleEndpoint.trim(),
        credentialRef: compatibleCredentialRef,
        model: compatibleSelected,
      },
      "云端模型已连接。日常对话会自动选择可用模型。",
    );
  };

  return (
    <section className="yance-model-center" aria-label="模型中心" data-yance-model-center>
      <header className="yance-model-center__header">
        <div>
          <span className="yance-eyebrow">AI MODELS</span>
          <h3>模型中心</h3>
          <p>连接云端 AI 或使用本地 AI。日常对话由言策自动选择可用模型，本地模型不会在你不知情时替代正式回复。</p>
        </div>
        <button type="button" onClick={() => void refreshModelRuntime()} disabled={busy}>刷新</button>
      </header>

      <div className="yance-model-center__summary" aria-label="模型中心概览">
        <span data-state={brainHealth.toLowerCase()}><strong>AI 服务</strong>{brainHealth === "不可用" ? "暂不可用" : "已就绪"}</span>
        <span><strong>云端 AI</strong>{cloudModels.length ? `${cloudModels.length} 个可用` : "未连接"}</span>
        <span><strong>本地 AI</strong>{localModels.length ? `${localModels.length} 个已安装` : "未安装"}</span>
        <span><strong>可用模型</strong>{verifiedModels.length || "等待验证"}</span>
      </div>

      <nav className="yance-model-center__tabs" aria-label="模型中心分类">
        <button type="button" aria-current={tab === "cloud" ? "page" : undefined} onClick={() => setTab("cloud")}>云端 AI</button>
        <button type="button" aria-current={tab === "local" ? "page" : undefined} onClick={() => setTab("local")}>本地 AI</button>
        <button type="button" aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>使用记录</button>
      </nav>

      <p className="yance-model-center__feedback" role="status" aria-live="polite">{feedback}</p>

      {tab === "cloud" ? (
        <div className="yance-model-center__grid">
          <article className="yance-model-provider-card" data-connected={openRouterConnected || undefined}>
            <header>
              <div><span>推荐云端</span><h4>OpenRouter</h4></div>
              <em>{openRouterConnected ? "已连接" : "未连接"}</em>
            </header>
            <p>适合直接使用多家主流云端模型。连接成功后，日常对话仍由言策自动选择可用模型。</p>
            <details className="yance-model-advanced">
              <summary>{openRouterConnected ? "管理连接" : "高级连接设置"}</summary>
              <div>
                <label><span>访问密钥</span><input type="password" autoComplete="off" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="粘贴你的 OpenRouter Key" /></label>
                <p>密钥只保存到 Windows 安全存储，不显示在页面或日志中。</p>
                <button type="button" disabled={busy || !openRouterKey.trim()} onClick={() => void configureOpenRouter()}>
                  {openRouterConnected ? "重新验证连接" : "连接云端 AI"}
                </button>
              </div>
            </details>
          </article>

          <article className="yance-model-provider-card">
            <header>
              <div><span>兼容服务</span><h4>OpenAI 兼容 API</h4></div>
              <em>{compatibleModels.length ? `${compatibleModels.length} 个模型` : "未连接"}</em>
            </header>
            <p>如果你已经有其他兼容的云端 AI 服务，可以在这里连接；普通用户不需要配置这一项。</p>
            <details className="yance-model-advanced">
              <summary>高级连接设置</summary>
              <div>
                <label><span>服务地址</span><input value={compatibleEndpoint} onChange={(event) => setCompatibleEndpoint(event.target.value)} placeholder="https://…/v1" /></label>
                <label><span>访问密钥</span><input type="password" autoComplete="off" value={compatibleKey} onChange={(event) => setCompatibleKey(event.target.value)} /></label>
                <button type="button" disabled={busy || !compatibleEndpoint.trim() || !compatibleKey.trim()} onClick={() => void discoverCompatibleCloud()}>检查可用模型</button>
                {compatibleModels.length ? (
                  <div className="yance-model-compatible-choice">
                    <label><span>选择模型</span><select value={compatibleSelected} onChange={(event) => setCompatibleSelected(event.target.value)}>
                      {compatibleModels.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select></label>
                    <button type="button" disabled={busy || !compatibleSelected} onClick={() => void registerCompatibleCloud()}>连接这个模型</button>
                  </div>
                ) : null}
              </div>
            </details>
          </article>
        </div>
      ) : null}

      {tab === "local" ? (
        <div className="yance-model-local">
          <section className="yance-model-local__status">
            <div>
              <span className="yance-eyebrow">LOCAL AI</span>
              <h4>{localModels.length ? `已安装 ${localModels.length} 个本地模型` : "使用本地 AI"}</h4>
              <p>言策会自动检测本机模型服务。无需填写地址或模型名；安装完成后可以在这里启用、停用或删除。</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void scanLocalModels()}>扫描本地 AI</button>
          </section>

          {localModels.length ? (
            <div className="yance-model-local__cards">
              {localModels.map((model) => {
                const modelId = modelRuntimeText(model.id, modelRuntimeText(model.name, "ollama"));
                const modelName = modelRuntimeText(model.name, "本地模型");
                const disabled = model.userDisabled === true || model.enabled === false;
                return (
                  <article key={modelId}>
                    <div><span>Ollama</span><h5>{modelName}</h5></div>
                    <p>{modelRuntimeText(model.parameterSize || model.quantizationLevel || model.qualificationLabel, "已安装 · 等待可用性检查")}</p>
                    <em>{modelRuntimeBytes(model.sizeBytes)}</em>
                    <div className="yance-model-local__actions">
                      <button type="button" disabled={busy} onClick={() => void setLocalModelEnabled(model, disabled)}>
                        {disabled ? "重新启用" : "停用"}
                      </button>
                      {disabled ? (
                        <button type="button" className="yance-model-local__delete" disabled={busy}
                          onClick={() => void deleteLocalModel(model)}>
                          {pendingDeleteModelId === modelId ? "确认永久删除" : "永久删除"}
                        </button>
                      ) : <span>停用后可永久删除</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <article className="yance-model-recommendation">
              <div>
                <span className="yance-eyebrow">推荐安装</span>
                <h4>Qwen3 8B · Ollama</h4>
                <p>适合作为日常本地 AI。安装完成后会自动检查是否可用，不会在你不知情时替代云端 AI。</p>
              </div>
              <button type="button" disabled={busy || Boolean(activePull)} onClick={() => void pullRecommendedOllama()}>安装推荐模型</button>
            </article>
          )}

          <details className="yance-model-advanced yance-model-hardware-details">
            <summary>本机运行信息</summary>
            <div className="yance-model-hardware">
              <span><strong>可用内存</strong>{modelRuntimeBytes(hardware.memoryFreeBytes || hardware.freeMemoryBytes)}</span>
              <span><strong>GPU 显存</strong>{modelRuntimeBytes(hardware.gpuVramBytes || hardware.vramBytes)}</span>
              <span><strong>本地服务</strong>已由言策自动管理</span>
            </div>
          </details>

          {activePull ? (
            <div className="yance-model-download" role="status">
              <div><strong>正在安装 {modelRuntimeText(activePull.model, recommendedOllamaModel)}</strong><span>{modelRuntimeText(activePull.status, "下载中")}</span></div>
              <button type="button" disabled={busy || !ollamaRequestId} onClick={() => void mutateModelRuntime(
                { action: "cancel-ollama-pull", requestId: ollamaRequestId || modelRuntimeText(activePull.requestId) },
                "已请求取消 Ollama 下载。",
              )}>取消</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="yance-model-activity">
          <article>
            <span className="yance-eyebrow">RECENT AI</span>
            <h4>最近一次 AI 使用</h4>
            {selectedModel || selectedProvider || logicalModel ? (
              <>
                <dl>
                  <div><dt>使用模型</dt><dd>{selectedModel || "自动选择"}</dd></div>
                  <div><dt>云端服务</dt><dd>{selectedProvider || "自动选择"}</dd></div>
                  <div><dt>耗时</dt><dd>{modelRuntimeNumber(routeEvidence.latencyMs).toFixed(0)} ms</dd></div>
                  <div><dt>费用</dt><dd>${costUsd.toFixed(6)}</dd></div>
                </dl>
                <details className="yance-model-advanced">
                  <summary>运行详情</summary>
                  <dl>
                    <div><dt>任务类型</dt><dd>{logicalModel || "未报告"}</dd></div>
                    <div><dt>重试次数</dt><dd>{retryCount.toFixed(0)}</dd></div>
                    <div><dt>备用切换</dt><dd>{fallbackCount.toFixed(0)}</dd></div>
                  </dl>
                </details>
              </>
            ) : <p>还没有可展示的 AI 使用记录。完成一次真实对话后，这里会显示实际使用的模型与耗时。</p>}
          </article>
          <article>
            <span className="yance-eyebrow">AUTO SELECT</span>
            <h4>言策会自动选择合适的模型</h4>
            <p>你只需要连接可用的云端或本地 AI。日常对话的模型选择、失败重试和备用切换会由现有模型服务自动处理。</p>
          </article>
        </div>
      ) : null}
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
    return { state: "backend-unready", title: "本地服务暂未就绪", detail: "可在设置里的“高级恢复工具”中重启本地服务。" };
  }
  const runtime = runtimeRecord(projection.runtime);
  if (String(runtime.operatingMode || "") === "safeMode") {
    return { state: "safe-mode", title: "安全模式已启用", detail: "部分功能暂时受限；恢复正常模式时会执行现有安全校验。" };
  }
  const lifecycleState = String(runtime.lifecycleState || "");
  const lifecycleReady = !lifecycleState || lifecycleState === "running" || lifecycleState === "local_ready";
  const reasonCode = String(health.reasonCode || "");
  if (
    projectionUnavailable
    || health.fatal === true
    || health.recoverable === true
    || runtime.localReady === false
    || !lifecycleReady
  ) {
    return {
      state: "degraded",
      title: "运行状态需要处理",
      detail: reasonCode
        ? "部分本地功能暂时不可用；可在设置里的“高级恢复工具”中检查并恢复。"
        : "本地服务还没有恢复到正常状态；可在设置里的“高级恢复工具”中检查并恢复。",
    };
  }
  return null;
}

function semanticThemeVariables(appearance: ProductAppearanceProjection): Readonly<Record<string, string>> {
  return appearance.themes.find((theme) => theme.id === appearance.themeId)?.semanticVariables || {};
}

function YanceMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect width="256" height="256" rx="58" fill="currentColor" opacity="0.16" />
      <path d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z" fill="none" stroke="currentColor" strokeWidth="15" strokeLinejoin="round" />
      <path d="m86 142 33-32 25 22 34-37" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ProductRoomViewProjectionProps = {
  hideHeader?: boolean;
  hideComposer?: boolean;
  hideRightPanel?: boolean;
  hidePinnedMessageBanner?: boolean;
  hideWidgets?: boolean;
  enableReadReceiptsAndMarkersOnActivity?: boolean;
};

type ProductConversationSurfaceProps = {
  renderRoomView: (roomId: string, props?: ProductRoomViewProjectionProps) => React.ReactNode;
  onOpenRelationshipConversation: (relationship: RelationshipProjection, conversation: ConversationRef) => Promise<boolean>;
  onReturnToRelationship: () => Promise<void> | void;
  onReturnHome: () => Promise<void> | void;
};

function conversationInitials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] || ""}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "Y").toUpperCase();
}

export function ProductConversationSurface({
  renderRoomView,
  onOpenRelationshipConversation,
  onReturnToRelationship,
  onReturnHome,
}: ProductConversationSurfaceProps): React.JSX.Element {
  const session = useExperienceSession();
  const [relationships, setRelationships] = useState<readonly RelationshipProjection[]>([]);
  const [projectionStatus, setProjectionStatus] = useState("正在读取关系上下文");

  useEffect(() => {
    let current = true;
    void loadPeopleProjections()
      .then((payload) => {
        if (!current) return;
        setRelationships(payload.relationships);
        setProjectionStatus("");
      })
      .catch(() => {
        if (!current) return;
        setProjectionStatus("关系上下文暂不可用；真实对话仍保持可用");
      });
    return () => { current = false; };
  }, []);

  const relationship = useMemo(
    () => relationships.find((row) => row.id === session.selectedRelationshipId) || null,
    [relationships, session.selectedRelationshipId],
  );
  const conversation = useMemo(
    () => relationship?.conversations.find((row) => row.id === session.selectedConversationId) || null,
    [relationship, session.selectedConversationId],
  );
  const title = relationship?.name || conversation?.title || "真实对话";
  const platform = conversation?.platform || session.selectedConversationPlatform || "Matrix";
  const intelligence = relationship?.relationshipIntelligence;
  const latestMoment = intelligence?.events.at(-1) || null;
  const summary = intelligence?.summary || relationship?.subtitle || "真实的人，真实的对话，更温暖的互联。";
  const immersiveStyle = relationship?.avatarUrl
    ? ({ "--yance-conversation-bg": `url("${relationship.avatarUrl.replace(/"/gu, "%22")}")` } as React.CSSProperties)
    : undefined;

  const openRelationshipConversation = async (targetRelationship: RelationshipProjection): Promise<void> => {
    const targetConversation = targetRelationship.conversations.find((row) => !row.archived)
      || targetRelationship.conversations[0]
      || null;
    if (!targetConversation) {
      setProjectionStatus(`${targetRelationship.name} 暂无可用真实对话`);
      return;
    }
    try {
      const opened = await onOpenRelationshipConversation(targetRelationship, targetConversation);
      setProjectionStatus(opened ? `已进入 ${targetRelationship.name} 的真实对话` : "没有找到唯一匹配的真实对话");
    } catch {
      setProjectionStatus("对话解析失败；言策没有执行猜测性跳转");
    }
  };

  if (!session.activeMatrixRoomId) {
    return <section className="yance-product-conversation yance-product-conversation--empty" aria-label="言策对话">
      <div className="yance-empty" role="status">
        <strong>没有已绑定的真实对话</strong>
        <span>言策不会猜测 Matrix 房间；请返回关系页重新选择一个已解析会话。</span>
        <button type="button" onClick={() => void onReturnToRelationship()}>返回关系世界</button>
      </div>
    </section>;
  }

  return <section
    className="yance-product-conversation yance-product-conversation--immersive"
    aria-label={`与 ${title} 的言策对话`}
    style={immersiveStyle}
  >
    <header className="yance-product-conversation__topbar">
      <button type="button" className="yance-product-conversation__brand" onClick={() => void onReturnHome()} aria-label="返回言策首页">
        <span className="yance-product-conversation__brand-mark" aria-hidden="true"><YanceMark /></span>
        <span><strong>Yance 言策</strong><small>更懂你的关系世界</small></span>
      </button>
      <div className="yance-product-conversation__top-actions">
        <button type="button" onClick={() => void onReturnToRelationship()}>关系世界</button>
        <button type="button" onClick={() => void onReturnHome()}>首页</button>
      </div>
    </header>

    <section className="yance-product-conversation__hero" aria-label="当前对话关系">
      <div className="yance-product-conversation__hero-media" aria-hidden="true">
        {relationship?.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : null}
      </div>
      <div className="yance-product-conversation__hero-scrim" aria-hidden="true" />
      <div className="yance-product-conversation__profile">
        <span className="yance-product-conversation__avatar" aria-hidden="true">
          {relationship?.avatarUrl ? <img src={relationship.avatarUrl} alt="" /> : conversationInitials(title)}
        </span>
        <div className="yance-product-conversation__identity">
          <span className="yance-eyebrow">Relationship Conversation</span>
          <h2>{title}{relationship?.favorite ? <span aria-label="收藏"> ♥</span> : null}</h2>
          <p className="yance-product-conversation__presence">{platform} · 真实会话 · 普通重启恢复</p>
          <blockquote>{summary}</blockquote>
        </div>
      </div>

      <div className="yance-product-conversation__hero-context">
        {projectionStatus ? <span role="status">{projectionStatus}</span> : null}
        {intelligence?.analysisStatusLabel ? <span>{intelligence.analysisStatusLabel}</span> : null}
        {latestMoment ? <span>{latestMoment.title}</span> : null}
      </div>
    </section>

    <section className="yance-product-conversation__workspace" aria-label="联系人、真实对话与关系洞察">
      <aside className="yance-product-conversation__people" aria-label="对话联系人">
        <header>
          <span className="yance-eyebrow">People</span>
          <strong>重要的人</strong>
        </header>
        <div className="yance-product-conversation__people-list">
          {relationships.slice(0, 12).map((row) => {
            const targetConversation = row.conversations.find((item) => !item.archived) || row.conversations[0] || null;
            const active = row.id === relationship?.id;
            return <button
              key={row.id}
              type="button"
              data-active={active || undefined}
              aria-current={active ? "true" : undefined}
              disabled={!targetConversation}
              onClick={() => void openRelationshipConversation(row)}
            >
              <span className="yance-product-conversation__people-avatar" aria-hidden="true">
                {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : conversationInitials(row.name)}
              </span>
              <span className="yance-product-conversation__people-copy">
                <strong>{row.name}</strong>
                <small>{row.subtitle || targetConversation?.platform || "真实关系"}</small>
              </span>
              {row.unreadCount > 0 ? <em>{row.unreadCount}</em> : null}
            </button>;
          })}
        </div>
      </aside>

      <main className="yance-product-conversation__room" aria-label="真实对话时间线与输入框">
        <div className="yance-product-conversation__room-owner yance-sr-only">
          <span>真实对话</span>
          <strong>消息、发送与安全继续由现有消息系统处理</strong>
        </div>
        <div className="yance-product-conversation__room-view">
          {renderRoomView(session.activeMatrixRoomId, {
            hideHeader: true,
            hideRightPanel: true,
            hideWidgets: true,
            enableReadReceiptsAndMarkersOnActivity: true,
          })}
        </div>
      </main>

      <aside className="yance-product-conversation__insight" aria-label="关系洞察">
        <span className="yance-eyebrow">关系洞察</span>
        <h3>{title}</h3>
        <p>{summary}</p>
        <article>
          <span>关系状态</span>
          <strong>{intelligence?.analysisStatusLabel || "关系洞察待形成"}</strong>
          {intelligence?.stage ? <p>{intelligence.stage}</p> : null}
        </article>
        <article>
          <span>现在值得做什么</span>
          <strong>{intelligence?.next || "继续真实互动后，这里会逐步形成下一步建议。"}</strong>
        </article>
        <article>
          <span>最近的时刻</span>
          <strong>{latestMoment?.title || "等待下一次可信互动"}</strong>
          {latestMoment?.detail && latestMoment.detail !== latestMoment.title ? <p>{latestMoment.detail}</p> : null}
        </article>
        <button type="button" onClick={() => void onReturnToRelationship()}>进入关系世界</button>
      </aside>
    </section>
  </section>;
}


export function ProductExperienceShell({
  appearanceHost,
  navigateSearchResult,
  navigateConversation,
  navigateGroupConversation,
  navigateProductHome,
  navigateRelationshipHome,
  renderRoomView,
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
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsSection, setSettingsSection] = useState<ProductSettingsCategory | "learning">("security");
  const [settingsWindow, setSettingsWindow] = useState<"accounts" | "appearance" | "models" | null>(null);
  const [learningAdminVisible, setLearningAdminVisible] = useState(false);
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
  const homeRelationship = selectedRelationship
    || relationships.find((row) => row.id === focusedRelationshipId)
    || relationships[0]
    || null;

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
    playExperienceSound(preferences.soundMode, "open");
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
      data-conversation-active={session.activeMatrixRoomId || undefined}
      data-settings-active={settingsVisible || undefined}
      aria-label="言策"
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

      {!session.activeMatrixRoomId ? <>
      <nav className="yance-desktop-rail" aria-label="言策桌面功能">
        <div className="yance-desktop-rail__brand" aria-label="Yance 言策">
          <span aria-hidden="true"><YanceMark /></span>
          <strong>言策</strong>
        </div>
        <button type="button" aria-current={!settingsVisible && !selectedRelationship && peopleHomeView === "list" ? "page" : undefined} onClick={() => {
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(false);
          setPeopleHomeView("list");
          setAssistantVisible(false);
          if (selectedRelationship) returnToPeople();
        }}><span aria-hidden="true">⌂</span><strong>首页</strong></button>
        <button type="button" aria-current={!settingsVisible && !selectedRelationship && peopleHomeView === "universe" ? "page" : undefined} onClick={() => {
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(false);
          setPeopleHomeView("universe");
          setAssistantVisible(false);
          if (selectedRelationship) returnToPeople();
        }}><span aria-hidden="true">◉</span><strong>关系宇宙</strong></button>
        <button type="button" aria-current={!settingsVisible && Boolean(selectedRelationship) ? "page" : undefined} disabled={!homeRelationship} onClick={() => {
          if (!homeRelationship) return;
          playExperienceSound(preferences.soundMode, "confirm");
          setSettingsVisible(false);
          chooseRelationship(homeRelationship.id);
        }}><span aria-hidden="true">♡</span><strong>关系世界</strong></button>
        <button type="button" disabled={!homeRelationship?.conversations.length} onClick={() => {
          const conversation = homeRelationship?.conversations.find((row) => !row.archived) || homeRelationship?.conversations[0];
          if (!homeRelationship || !conversation || !navigateConversation) return;
          playExperienceSound(preferences.soundMode, "confirm");
          void navigateConversation(homeRelationship, conversation)
            .then((opened) => setStatus(opened ? "已进入对话" : "没有找到唯一匹配的真实对话"))
            .catch(() => setStatus("对话解析失败；言策没有执行猜测性跳转"));
        }}><span aria-hidden="true">◌</span><strong>对话</strong></button>
        <button type="button" disabled={!homeRelationship} aria-pressed={assistantVisible} onClick={() => {
          if (!homeRelationship) return;
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(false);
          chooseRelationship(homeRelationship.id);
          setAssistantVisible(true);
          setAiState("wake");
        }}><span aria-hidden="true">✦</span><strong>AI 助手</strong></button>
        <button type="button" aria-current={settingsVisible ? "page" : undefined} onClick={() => {
          playExperienceSound(preferences.soundMode, "open");
          setSettingsVisible(true);
          setLearningAdminVisible(false);
          setSettingsWindow(null);
          setAssistantVisible(false);
        }}><span aria-hidden="true">⚙</span><strong>设置</strong></button>
      </nav>

      <header className="yance-product-nav" aria-label="言策主导航">
        <div className="yance-product-nav__identity">
          <span className="yance-product-nav__mark" aria-hidden="true"><YanceMark /></span>
          <span className="yance-eyebrow">言策</span>
          <strong>{selectedRelationship ? selectedRelationship.name : "关系"}</strong>
        </div>
        {!settingsVisible ? (
          <BilingualSearchPanel
            relationships={relationships}
            reducedMotion={preferences.reducedMotion}
            onSelectRelationship={chooseRelationship}
            onNavigateRelationship={navigateSearchResult}
          />
        ) : null}
        <nav className="yance-product-nav__actions" aria-label="主要目的地">
          <button type="button" aria-current={!settingsVisible ? "page" : undefined} onClick={() => {
            playExperienceSound(preferences.soundMode, "open");
            setSettingsVisible(false); setLearningAdminVisible(false); setSettingsWindow(null);
            if (selectedRelationship) returnToPeople();
          }}>关系</button>
          <button type="button" aria-current={settingsVisible ? "page" : undefined}
            aria-expanded={settingsVisible} aria-controls="yance-secondary-settings"
            onClick={() => { playExperienceSound(preferences.soundMode, "open"); setSettingsVisible((value) => !value); setLearningAdminVisible(false); setSettingsWindow(null); setAssistantVisible(false); }}>设置</button>
        </nav>
      </header>
      </> : null}

      {!settingsVisible ? (
        session.activeMatrixRoomId && renderRoomView ? (
          <motion.div
            key="conversation"
            className="yance-shell-scene yance-shell-scene--conversation"
            initial={preferences.reducedMotion ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={preferences.reducedMotion ? undefined : { opacity: 0, x: 8 }}
            transition={{ duration: preferences.reducedMotion ? 0 : 0.16 }}
          >
            <ProductConversationSurface
              renderRoomView={renderRoomView}
              onOpenRelationshipConversation={async (targetRelationship, targetConversation) => {
                if (!navigateConversation) return false;
                return navigateConversation(targetRelationship, targetConversation);
              }}
              onReturnToRelationship={() => navigateRelationshipHome?.()}
              onReturnHome={() => navigateProductHome?.()}
            />
          </motion.div>
        ) : (
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
                <span>正在整理已有的人物、对话与关系记录。</span>
              </div>
            ) : (
              <PeopleSurface
                relationships={relationships}
                groups={groups}
                selectedRelationshipId={session.selectedRelationshipId}
                focusedRelationshipId={focusedRelationshipId}
                viewMode={peopleHomeView}
                reducedMotion={preferences.reducedMotion}
                soundMode={preferences.soundMode}
                onViewModeChange={setPeopleHomeView}
                onFocus={setFocusedRelationshipId}
                onSelect={chooseRelationship}
                onContinueConversation={(relationship, conversation) => {
                  if (!navigateConversation) {
                    setStatus("真实对话导航暂不可用");
                    return;
                  }
                  void navigateConversation(relationship, conversation)
                    .then((opened) => setStatus(opened ? "已进入对话" : "没有找到唯一匹配的真实对话"))
                    .catch(() => setStatus("对话解析失败；言策没有执行猜测性跳转"));
                }}
                onSelectGroup={(conversation) => {
                  void openGroupConversation(conversation);
                }}
                onConnectAccounts={() => {
                  playExperienceSound(preferences.soundMode, "open");
                  setSettingsVisible(true);
                  setSettingsWindow("accounts");
                  setLearningAdminVisible(false);
                  setAssistantVisible(false);
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
        )
      ) : null}

      {settingsVisible ? (
        <section id="yance-secondary-settings" className="yance-secondary-settings" aria-label="设置">
          <header className="yance-secondary-settings__header">
            <div>
              <span className="yance-eyebrow">Yance Settings</span>
              <h2>设置</h2>
              <p>{settingsWindow ? "独立桌面设置面板" : "安全、桌面行为、通知、数据与关于"}</p>
            </div>
            <div className="yance-secondary-settings__header-actions">
              <button type="button" aria-pressed={settingsWindow === "accounts"} onClick={() => setSettingsWindow("accounts")}>账号与连接</button>
              <button type="button" aria-pressed={settingsWindow === "appearance"} onClick={() => setSettingsWindow("appearance")}>主题与外观</button>
              <button type="button" aria-pressed={settingsWindow === "models"} onClick={() => setSettingsWindow("models")}>模型中心</button>
              <button type="button" onClick={() => {
                playExperienceSound(preferences.soundMode, "confirm");
                setSettingsWindow(null);
                setSettingsVisible(false);
                setLearningAdminVisible(false);
              }}>返回关系</button>
            </div>
          </header>

          {settingsWindow ? (
            <div className="yance-settings-workspace yance-settings-workspace--child">
              <nav className="yance-settings-workspace__nav" aria-label="设置子面板">
                <button type="button" onClick={() => setSettingsWindow(null)}>
                  <strong>返回设置首页</strong>
                  <span>回到分类设置</span>
                </button>
              </nav>
              <div className="yance-settings-workspace__content" tabIndex={-1}>
                <div className="yance-settings-workspace__panel">
                  {settingsWindow === "accounts" ? (
                    <section className="yance-settings-desktop-section" aria-label="账号与连接">
                      <header><span className="yance-eyebrow">Accounts</span><h3>账号与连接</h3><p>只展示成熟平台 owner 的真实授权与连接状态。</p></header>
                      <PlatformAccountsSurface />
                    </section>
                  ) : null}
                  {settingsWindow === "appearance" ? (
                    <section className="yance-settings-desktop-section" aria-label="主题与外观">
                      <header><span className="yance-eyebrow">Appearance</span><h3>主题与外观</h3><p>主题、字体、动效与背景效果在独立面板管理。</p></header>
                      <ProductSystemSettingsSurface category="appearance" openUserSettings={openUserSettings} requestLogout={requestLogout} />
                    </section>
                  ) : null}
                  {settingsWindow === "models" ? (
                    <section className="yance-settings-desktop-section" aria-label="模型中心">
                      <ProductModelRuntimeSupportSurface />
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="yance-settings-workspace">
              <nav className="yance-settings-workspace__nav" aria-label="设置分类">
                {([
                  ["security", "安全与设备", "账号安全、设备与会话"],
                  ["desktop", "桌面行为", "启动、托盘与桌面运行"],
                  ["notifications", "通知与声音", "通知、隐私与声音"],
                  ["data", "数据保护", "备份、恢复与数据保护"],
                  ["learning", "学习与成长", "学习记录、回顾与成长建议"],
                  ["about", "关于", "版本、更新与许可信息"],
                ] as const).map(([id, label, hint]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={settingsSection === id ? "page" : undefined}
                    onClick={() => {
                      playExperienceSound(preferences.soundMode, "open");
                      setSettingsSection(id);
                      if (id !== "learning") setLearningAdminVisible(false);
                    }}
                  >
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </button>
                ))}
              </nav>

              <div className="yance-settings-workspace__content" tabIndex={-1}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={settingsSection}
                    className="yance-settings-workspace__panel"
                    initial={preferences.reducedMotion ? false : { opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={preferences.reducedMotion ? undefined : { opacity: 0, x: -6 }}
                    transition={{ duration: preferences.reducedMotion ? 0 : 0.15 }}
                  >
                    {settingsSection === "learning" ? (
                      <section className="yance-learning-disclosure yance-settings-desktop-section" aria-label="学习与成长">
                        <header>
                          <div><span className="yance-eyebrow">Learning</span><h3>学习与成长</h3><p>仅在需要复盘学习记录与反馈时打开，不占据日常设置空间。</p></div>
                        </header>
                        <button type="button" aria-expanded={learningAdminVisible} onClick={() => setLearningAdminVisible((value) => !value)}>
                          {learningAdminVisible ? "收起学习与成长" : "打开学习与成长"}
                        </button>
                        {learningAdminVisible ? <LearningWorkspace /> : null}
                      </section>
                    ) : (
                      <section className="yance-settings-desktop-section" aria-label="系统设置">
                        <ProductSystemSettingsSurface
                          category={settingsSection}
                          openUserSettings={openUserSettings}
                          requestLogout={requestLogout}
                        />
                      </section>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <RelationshipOverlayHost readRoomStateEvents={readRoomStateEvents} />
    </main>
  );
}
