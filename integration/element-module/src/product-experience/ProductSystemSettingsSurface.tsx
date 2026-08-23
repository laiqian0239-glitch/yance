import React, { useCallback, useEffect, useMemo, useState } from "react";

type JsonRecord = Record<string, unknown>;

type ProductSystemDesktopApi = {
  getProductDataProtectionState: () => Promise<unknown>;
  mutateProductDataProtection: (input: Record<string, unknown>) => Promise<unknown>;
  getProductModelRuntimeState: () => Promise<unknown>;
  mutateProductModelRuntime: (input: Record<string, unknown>) => Promise<unknown>;
  selectPortableBackup: () => Promise<unknown>;
  savePortableBackup: (name: string) => Promise<unknown>;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is JsonRecord => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function numberValue(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function itemName(row: JsonRecord): string {
  return text(row.name || row.backupName || row.targetName || row.id, "未命名项目");
}

function desktopApi(): ProductSystemDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<ProductSystemDesktopApi> }).yanceDesktop;
  if (!api
    || typeof api.getProductDataProtectionState !== "function"
    || typeof api.mutateProductDataProtection !== "function"
    || typeof api.getProductModelRuntimeState !== "function"
    || typeof api.mutateProductModelRuntime !== "function"
    || typeof api.selectPortableBackup !== "function"
    || typeof api.savePortableBackup !== "function") return null;
  return api as ProductSystemDesktopApi;
}

function formatBytes(value: unknown): string {
  const bytes = numberValue(value);
  if (bytes <= 0) return "未知";
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

function plannerCandidates(catalog: JsonRecord): JsonRecord[] {
  return rows(catalog.models).flatMap((model) => {
    const runtimeCandidates = Array.isArray(model.runtimeCandidates) ? model.runtimeCandidates : [];
    return runtimeCandidates.map((runtimeId) => ({
      model: {
        id: text(model.id),
        parameterCountB: numberValue(model.parameterCountB),
        quantizedBytes: numberValue(model.quantizedBytes),
      },
      runtime: { id: text(runtimeId) },
      benchmark: {},
    }));
  });
}

function jsonSummary(value: unknown): string {
  if (value == null) return "无";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  const row = record(value);
  for (const key of ["state", "status", "health", "reasonCode", "name", "id"]) {
    const candidate = text(row[key]);
    if (candidate) return candidate;
  }
  return "已读取";
}

export function ProductSystemSettingsSurface(): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [dataProtection, setDataProtection] = useState<JsonRecord>({});
  const [modelRuntime, setModelRuntime] = useState<JsonRecord>({});
  const [feedback, setFeedback] = useState("正在读取系统设置");
  const [busy, setBusy] = useState(false);

  const [backupName, setBackupName] = useState("");
  const [verifiedBackupName, setVerifiedBackupName] = useState("");
  const [portableName, setPortableName] = useState("");
  const [portablePassphrase, setPortablePassphrase] = useState("");
  const [backupLabel, setBackupLabel] = useState("手动备份");

  const [runtimeTargetName, setRuntimeTargetName] = useState("");
  const [localAssetPath, setLocalAssetPath] = useState("");
  const [expectedSha256, setExpectedSha256] = useState("");
  const [requiredBytes, setRequiredBytes] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://127.0.0.1:11434");
  const [ollamaRequestId, setOllamaRequestId] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) {
      setFeedback("系统设置桥接暂不可用；不会创建本地替代状态。");
      return;
    }
    setBusy(true);
    try {
      const [dataState, modelState] = await Promise.all([
        api.getProductDataProtectionState(),
        api.getProductModelRuntimeState(),
      ]);
      setDataProtection(record(dataState));
      setModelRuntime(record(modelState));
      setFeedback("系统设置已从现有权威刷新");
    } catch {
      setFeedback("系统设置读取失败；保留现有权威，不启用静默降级。");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutateData = useCallback(async (
    input: Record<string, unknown>,
    successMessage: string,
    clearPassphrase = false,
  ): Promise<unknown> => {
    if (!api || busy) return null;
    setBusy(true);
    try {
      const result = await api.mutateProductDataProtection(input);
      if (clearPassphrase) setPortablePassphrase("");
      setFeedback(successMessage);
      const next = await api.getProductDataProtectionState();
      setDataProtection(record(next));
      return result;
    } catch {
      setFeedback("数据保护操作失败；请根据当前恢复状态检查输入后重试。");
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  const mutateModel = useCallback(async (
    input: Record<string, unknown>,
    successMessage: string,
  ): Promise<unknown> => {
    if (!api || busy) return null;
    setBusy(true);
    try {
      const result = await api.mutateProductModelRuntime(input);
      setFeedback(successMessage);
      const next = await api.getProductModelRuntimeState();
      setModelRuntime(record(next));
      return result;
    } catch {
      setFeedback("模型运行态操作失败；正式回复仍由 LiteLLM Model Brain 处理，不做本地静默回退。");
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, busy]);

  const backupsState = record(dataProtection.backups);
  const portableState = record(dataProtection.portableBackups);
  const backupRows = rows(backupsState.backups);
  const portableRows = rows(portableState.packages);
  const restoreHistory = rows(backupsState.restoreHistory);
  const pendingRestore = record(backupsState.pendingRestore);
  const retention = record(backupsState.retention);

  const brainState = record(modelRuntime.modelBrain);
  const brain = record(brainState.modelBrain);
  const brainRuntime = record(brainState.runtime);
  const catalog = record(modelRuntime.catalog);
  const hardwareRoot = record(modelRuntime.hardware);
  const hardware = record(hardwareRoot.hardware);
  const adaptiveLocal = record(modelRuntime.adaptiveLocal);
  const catalogRows = rows(catalog.models);
  const materializations = rows(adaptiveLocal.materializations);
  const pulls = rows(adaptiveLocal.pulls);

  const brainHealth = text(
    brain.health || brain.state || brainRuntime.health || brainRuntime.state || brainState.status,
    brainState.ok === false ? "不可用" : "状态已读取",
  );
  const brainAuthority = text(brain.authority || brain.litellm || brainRuntime.authority, "LiteLLM");

  const importPortable = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const imported = record(await api.selectPortableBackup());
      const name = text(imported.name);
      if (imported.imported === true && name) {
        setPortableName(name);
        setFeedback("可迁移备份已导入到言策受控目录；请先验证备份，再执行恢复。");
        setDataProtection(record(await api.getProductDataProtectionState()));
      } else {
        setFeedback("未导入新的可迁移备份。");
      }
    } catch {
      setFeedback("可迁移备份导入失败；未改变恢复权威状态。");
    } finally {
      setBusy(false);
    }
  };

  const exportPortable = async (): Promise<void> => {
    if (!api || busy || !portableName) return;
    setBusy(true);
    try {
      const result = record(await api.savePortableBackup(portableName));
      setFeedback(result.saved === true ? "可迁移备份已导出。" : "未导出可迁移备份。");
    } catch {
      setFeedback("可迁移备份导出失败。");
    } finally {
      setBusy(false);
    }
  };

  const planAdaptiveLocal = async (): Promise<void> => {
    const candidates = plannerCandidates(catalog);
    if (!candidates.length) {
      setFeedback("当前自适应本地模型目录没有可规划候选。");
      return;
    }
    const result = record(await mutateModel(
      { action: "plan-adaptive-local", candidates },
      "自适应本地规划已完成；结果来自现有 planner authority。",
    ));
    const best = record(result.best);
    if (Object.keys(best).length) {
      setFeedback(`规划结果：${text(best.modelId, "模型")} / ${text(best.runtimeId, "运行时")} · ${text(best.capabilityClass, "未知能力级别")}`);
    }
  };

  const pullOllama = async (): Promise<void> => {
    if (!ollamaModel.trim()) {
      setFeedback("请输入要下载的 Ollama 模型名称。");
      return;
    }
    const requestId = ollamaRequestId.trim() || globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`;
    setOllamaRequestId(requestId);
    await mutateModel(
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
    <section aria-label="系统设置与数据保护">
      <header>
        <h3>系统设置</h3>
        <p>这里仅投影现有恢复与模型权威；不会创建第二套备份引擎、模型路由器或本地静默回退。</p>
        <button type="button" onClick={() => void refresh()} disabled={busy}>刷新系统状态</button>
      </header>

      <p role="status" aria-live="polite">{feedback}</p>

      <details>
        <summary>数据保护与恢复</summary>
        <div className="yance-settings-grid">
          <section>
            <h4>普通备份</h4>
            <p>备份：{backupRows.length} 个 · 保留策略：{jsonSummary(retention)}</p>
            <label>
              <span>备份标签</span>
              <input value={backupLabel} onChange={(event) => setBackupLabel(event.target.value)} maxLength={120} />
            </label>
            <label>
              <span>选择备份</span>
              <select value={backupName} onChange={(event) => { setBackupName(event.target.value); setVerifiedBackupName(""); }}>
                <option value="">请选择</option>
                {backupRows.map((row) => {
                  const name = itemName(row);
                  return <option key={name} value={name}>{name}</option>;
                })}
              </select>
            </label>
            <div className="yance-learning-settings-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void mutateData({ action: "create-backup", label: backupLabel.trim() || "手动备份" }, "备份已创建。")}
              >
                创建备份
              </button>
              <button
                type="button"
                disabled={busy || !backupName}
                onClick={() => {
                  void mutateData({ action: "verify-backup", name: backupName }, "验证备份完成。")
                    .then((result) => { if (result) setVerifiedBackupName(backupName); });
                }}
              >
                验证备份
              </button>
              <button
                type="button"
                disabled={busy || !backupName || verifiedBackupName !== backupName}
                onClick={() => void mutateData({ action: "stage-restore", name: backupName }, "恢复已进入 staged 状态；重启前仍可取消。")}
              >
                验证后暂存恢复
              </button>
            </div>
          </section>

          <section>
            <h4>可迁移备份</h4>
            <p>可迁移备份：{portableRows.length} 个。导入/导出继续由 Electron 文件托管，不把文件系统权限交给 renderer。</p>
            <label>
              <span>备份密码（仅本次操作）</span>
              <input
                type="password"
                autoComplete="off"
                value={portablePassphrase}
                onChange={(event) => setPortablePassphrase(event.target.value)}
                placeholder="至少 10 个字符"
              />
            </label>
            <label>
              <span>选择可迁移备份</span>
              <select value={portableName} onChange={(event) => setPortableName(event.target.value)}>
                <option value="">请选择</option>
                {portableRows.map((row) => {
                  const name = itemName(row);
                  return <option key={name} value={name}>{name}</option>;
                })}
              </select>
            </label>
            <div className="yance-learning-settings-actions">
              <button type="button" disabled={busy} onClick={() => void importPortable()}>导入可迁移备份</button>
              <button
                type="button"
                disabled={busy || portablePassphrase.length < 10}
                onClick={() => void mutateData(
                  { action: "create-portable-backup", passphrase: portablePassphrase, profile: "data-only", label: backupLabel },
                  "可迁移备份已创建；可选择后导出。",
                  true,
                )}
              >
                创建可迁移备份
              </button>
              <button
                type="button"
                disabled={busy || !portableName || portablePassphrase.length < 10}
                onClick={() => void mutateData(
                  { action: "verify-portable-backup", name: portableName, passphrase: portablePassphrase },
                  "可迁移备份验证通过；恢复仍未执行。",
                  true,
                )}
              >
                验证可迁移备份
              </button>
              <button
                type="button"
                disabled={busy || !portableName || portablePassphrase.length < 10}
                onClick={() => void mutateData(
                  { action: "stage-portable-restore", name: portableName, passphrase: portablePassphrase },
                  "可迁移备份已验证并暂存为恢复计划；重启前仍可取消。",
                  true,
                )}
              >
                验证并暂存恢复
              </button>
              <button type="button" disabled={busy || !portableName} onClick={() => void exportPortable()}>导出可迁移备份</button>
              <button
                type="button"
                disabled={busy || !portableName}
                onClick={() => void mutateData({ action: "delete-portable-backup", name: portableName }, "可迁移备份已从受控目录删除。")}
              >
                删除可迁移备份
              </button>
            </div>
          </section>

          <section>
            <h4>恢复历史</h4>
            <p>
              当前待恢复：{Object.keys(pendingRestore).length ? `${itemName(pendingRestore)} · ${jsonSummary(pendingRestore)}` : "无"}
              {" · "}
              恢复历史：{restoreHistory.length} 条
            </p>
            <button
              type="button"
              disabled={busy || Object.keys(pendingRestore).length === 0}
              onClick={() => void mutateData({ action: "cancel-restore" }, "已取消待执行恢复。")}
            >
              取消恢复
            </button>
            <ul>
              {restoreHistory.slice(0, 8).map((row, index) => (
                <li key={`${itemName(row)}-${index}`}>{itemName(row)} · {jsonSummary(row)}</li>
              ))}
            </ul>
          </section>
        </div>
      </details>

      <details>
        <summary>自适应本地模型与 Model Brain</summary>
        <div className="yance-settings-grid">
          <section>
            <h4>Model Brain</h4>
            <p>Model Brain 运行状态：{brainHealth}</p>
            <p>正式路由权威：{brainAuthority.includes("LiteLLM") ? brainAuthority : `LiteLLM · ${brainAuthority}`}</p>
            <p>LiteLLM 继续负责 quick_reply / deep_reply / director；本地模型不会静默替代正式回复。</p>
          </section>

          <section>
            <h4>自适应本地运行态</h4>
            <p>
              目录：{catalogRows.length} 个模型 · 已 materialize：{materializations.length} 项 · 下载任务：{pulls.length} 项
            </p>
            <p>
              硬件：RAM 可用 {formatBytes(hardware.memoryFreeBytes || hardware.freeMemoryBytes)}
              {" · "}
              GPU VRAM {formatBytes(hardware.gpuVramBytes || hardware.vramBytes)}
            </p>
            <button type="button" disabled={busy || catalogRows.length === 0} onClick={() => void planAdaptiveLocal()}>
              规划自适应本地运行时
            </button>
            <ul>
              {catalogRows.slice(0, 8).map((row) => (
                <li key={text(row.id, itemName(row))}>
                  {text(row.displayName, itemName(row))}
                  {" · "}
                  {Array.isArray(row.runtimeCandidates) ? row.runtimeCandidates.map((value) => text(value)).filter(Boolean).join(" / ") : "运行时待定"}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4>安装 / 移除本地运行时</h4>
            <label>
              <span>目标名称</span>
              <input value={runtimeTargetName} onChange={(event) => setRuntimeTargetName(event.target.value)} placeholder="例如 llama-runtime.zip" />
            </label>
            <label>
              <span>本机已验证资产路径</span>
              <input value={localAssetPath} onChange={(event) => setLocalAssetPath(event.target.value)} placeholder="本机路径" />
            </label>
            <label>
              <span>SHA-256</span>
              <input value={expectedSha256} onChange={(event) => setExpectedSha256(event.target.value)} placeholder="预期 SHA-256" />
            </label>
            <label>
              <span>所需字节数</span>
              <input inputMode="numeric" value={requiredBytes} onChange={(event) => setRequiredBytes(event.target.value)} />
            </label>
            <div className="yance-learning-settings-actions">
              <button
                type="button"
                disabled={busy || !runtimeTargetName || !localAssetPath || !expectedSha256}
                onClick={() => void mutateModel(
                  {
                    action: "materialize-adaptive-runtime",
                    consent: true,
                    targetName: runtimeTargetName,
                    localAssetPath,
                    expectedSha256,
                    requiredBytes: numberValue(requiredBytes),
                  },
                  "本地运行时安装 / materialize 完成；状态已刷新。",
                )}
              >
                安装本地运行时
              </button>
              <button
                type="button"
                disabled={busy || !runtimeTargetName}
                onClick={() => void mutateModel(
                  { action: "remove-adaptive-runtime", targetName: runtimeTargetName },
                  "本地运行时已移除；状态已刷新。",
                )}
              >
                移除本地运行时
              </button>
            </div>
          </section>

          <section>
            <h4>Ollama 模型下载</h4>
            <label>
              <span>模型</span>
              <input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} placeholder="例如 qwen3:8b" />
            </label>
            <label>
              <span>Ollama 地址</span>
              <input value={ollamaEndpoint} onChange={(event) => setOllamaEndpoint(event.target.value)} />
            </label>
            <div className="yance-learning-settings-actions">
              <button type="button" disabled={busy || !ollamaModel.trim()} onClick={() => void pullOllama()}>
                下载 Ollama 模型
              </button>
              <button
                type="button"
                disabled={busy || !ollamaRequestId}
                onClick={() => void mutateModel(
                  { action: "cancel-ollama-pull", requestId: ollamaRequestId },
                  "已请求取消 Ollama 下载。",
                )}
              >
                取消 Ollama 下载
              </button>
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}
