import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  previewPersonaCharacterCard,
  type PersonaCharacterCardPreview,
} from "./experienceProjection";

type JsonRecord = Record<string, unknown>;

type UserSettingsDestination =
  | "account"
  | "security"
  | "sessions";

type DesktopApi = {
  getSettings: () => Promise<JsonRecord>;
  updateSettings: (patch: JsonRecord) => Promise<JsonRecord>;

  getProductDataProtectionState: () => Promise<JsonRecord>;
  mutateProductDataProtection: (
    input: JsonRecord,
  ) => Promise<JsonRecord>;

  restartApp: () => Promise<unknown>;

  getUpdateState: () => Promise<JsonRecord>;
  checkForUpdates: () => Promise<JsonRecord>;
  downloadUpdate: () => Promise<JsonRecord>;
  installUpdate: () => Promise<JsonRecord>;
};

function api(): DesktopApi | null {
  const value = (
    window as unknown as {
      yanceDesktop?: Partial<DesktopApi>;
    }
  ).yanceDesktop;

  if (
    !value
    || typeof value.getSettings !== "function"
    || typeof value.updateSettings !== "function"
    || typeof value.getProductDataProtectionState !== "function"
    || typeof value.mutateProductDataProtection !== "function"
    || typeof value.restartApp !== "function"
    || typeof value.getUpdateState !== "function"
  ) {
    return null;
  }

  return value as DesktopApi;
}

function record(value: unknown): JsonRecord {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(
            item
            && typeof item === "object"
            && !Array.isArray(item),
          ),
      )
    : [];
}

function text(
  value: unknown,
  fallback = "",
): string {
  if (
    typeof value === "string"
    || typeof value === "number"
  ) {
    return String(value).trim() || fallback;
  }

  return fallback;
}

export function ProductSystemSettingsSurface({
  openUserSettings,
}: {
  openUserSettings?: (
    destination: UserSettingsDestination,
  ) => void;
}): React.JSX.Element {
  const desktop = useMemo(api, []);

  const [settings, setSettings] =
    useState<JsonRecord>({});

  const [protection, setProtection] =
    useState<JsonRecord>({});

  const [update, setUpdate] =
    useState<JsonRecord>({});

  const [selectedBackup, setSelectedBackup] =
    useState("");

  const [verifiedBackup, setVerifiedBackup] =
    useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] =
    useState("正在读取设置");

  const [characterCard, setCharacterCard] =
    useState<PersonaCharacterCardPreview | null>(null);

  const characterCardInputRef =
    useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!desktop) {
      setStatus("系统设置桥接暂不可用");
      return;
    }

    setBusy(true);

    try {
      const [
        desktopSettings,
        dataProtection,
        updateState,
      ] = await Promise.all([
        desktop.getSettings(),
        desktop.getProductDataProtectionState(),
        desktop.getUpdateState(),
      ]);

      setSettings(record(desktopSettings));
      setProtection(record(dataProtection));
      setUpdate(record(updateState));
      setStatus("设置已刷新");
    } catch {
      setStatus("设置读取失败；没有创建替代状态");
    } finally {
      setBusy(false);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveDesktop = async (
    patch: JsonRecord,
  ): Promise<void> => {
    if (!desktop || busy) return;

    setBusy(true);

    try {
      setSettings(
        record(await desktop.updateSettings(patch)),
      );
      setStatus("桌面设置已保存");
    } catch {
      setStatus("桌面设置保存失败");
    } finally {
      setBusy(false);
    }
  };

  const mutateProtection = async (
    input: JsonRecord,
    success: string,
  ): Promise<boolean> => {
    if (!desktop || busy) return false;

    setBusy(true);

    try {
      await desktop.mutateProductDataProtection(input);

      setProtection(
        record(
          await desktop.getProductDataProtectionState(),
        ),
      );

      setStatus(success);
      return true;
    } catch {
      setStatus("数据保护操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const previewCard = async (file: File): Promise<void> => {
    setBusy(true);
    setStatus("正在解析人设卡");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setCharacterCard(await previewPersonaCharacterCard(bytes));
      setStatus("人设卡预览完成");
    } catch {
      setCharacterCard({
        available: false,
        ok: false,
        name: "",
        description: "",
        reasonCode: "PERSONA_PREVIEW_READ_FAILED",
      });
      setStatus("人设卡读取失败");
    } finally {
      setBusy(false);
    }
  };

  const backupRoot = record(protection.backups);
  const backups = rows(backupRoot.backups);

  const pendingRestore =
    record(backupRoot.pendingRestore);

  const pendingRestoreName =
    text(
      pendingRestore.name
      || pendingRestore.backupName,
    );

  const updatePhase =
    text(update.phase, "idle");

  return (
    <section
      className="yance-product-system-settings"
      aria-label="系统设置"
    >
      <header>
        <div>
          <span className="yance-eyebrow">设置</span>
          <h3>系统与账户</h3>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新
        </button>
      </header>

      <p role="status" aria-live="polite">
        {status}
      </p>

      <section>
        <h4>账户与安全</h4>

        <button
          type="button"
          onClick={() => openUserSettings?.("account")}
        >
          账户与个人资料
        </button>

        <button
          type="button"
          onClick={() => openUserSettings?.("security")}
        >
          安全设置
        </button>

        <button
          type="button"
          onClick={() => openUserSettings?.("sessions")}
        >
          已登录设备
        </button>
      </section>

      <section>
        <h4>桌面行为</h4>

        <label>
          <input
            type="checkbox"
            checked={settings.autoLaunch === true}
            disabled={busy}
            onChange={(event) =>
              void saveDesktop({
                autoLaunch: event.target.checked,
              })}
          />
          开机自动启动
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.closeToTray !== false}
            disabled={busy}
            onChange={(event) =>
              void saveDesktop({
                closeToTray: event.target.checked,
              })}
          />
          关闭窗口时保留在托盘
        </label>

        <label>
          <span>声音</span>
          <select
            disabled={busy}
            value={text(
              settings.productSoundMode,
              "Essential only",
            )}
            onChange={(event) =>
              void saveDesktop({
                productSoundMode: event.target.value,
              })}
          >
            <option value="Off">关闭</option>
            <option value="Essential only">
              仅必要提示
            </option>
            <option value="Immersive">
              沉浸
            </option>
          </select>
        </label>
      </section>

      <section>
        <h4>数据保护与恢复</h4>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void mutateProtection(
              {
                action: "create-backup",
                label: "手动备份",
              },
              "备份已创建",
            )}
        >
          创建备份
        </button>

        <label>
          <span>已有备份</span>

          <select
            value={selectedBackup}
            disabled={busy}
            onChange={(event) => {
              setSelectedBackup(event.target.value);
              setVerifiedBackup("");
            }}
          >
            <option value="">请选择备份</option>

            {backups.map((row) => {
              const name = text(
                row.name
                || row.backupName
                || row.id,
                "未命名备份",
              );

              return (
                <option
                  key={name}
                  value={name}
                >
                  {name}
                </option>
              );
            })}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || !selectedBackup}
          onClick={() => {
            void mutateProtection(
              {
                action: "verify-backup",
                name: selectedBackup,
              },
              "备份验证完成",
            ).then((ok) => {
              if (ok) {
                setVerifiedBackup(selectedBackup);
              }
            });
          }}
        >
          验证备份
        </button>

        <button
          type="button"
          disabled={
            busy
            || !selectedBackup
            || verifiedBackup !== selectedBackup
          }
          onClick={() =>
            void mutateProtection(
              {
                action: "stage-restore",
                name: selectedBackup,
              },
              "恢复已暂存；重启前仍可取消",
            )}
        >
          验证后暂存恢复
        </button>

        {pendingRestoreName ? (
          <div role="status">
            <strong>
              已暂存恢复：{pendingRestoreName}
            </strong>

            <p>
              重启会执行现有恢复流程。
              在重启前仍可取消。
            </p>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void mutateProtection(
                  { action: "cancel-restore" },
                  "已取消暂存恢复",
                )}
            >
              取消恢复
            </button>

            <button
              type="button"
              disabled={busy || !desktop}
              onClick={() => {
                if (
                  desktop
                  && window.confirm(
                    "确认重启并执行已验证的恢复？",
                  )
                ) {
                  void desktop.restartApp();
                }
              }}
            >
              重启并执行恢复
            </button>
          </div>
        ) : null}
      </section>

      <section>
        <h4>人设（Character Card）预览</h4>

        <p>
          选择 PNG 或 JSON 人设卡；仅发送原始字节到本机解析，
          不读取文件系统路径。
        </p>

        <input
          ref={characterCardInputRef}
          type="file"
          accept=".png,.json,.webp,image/png,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void previewCard(file);
          }}
        />

        {characterCard ? (
          <div role="status">
            {characterCard.ok ? (
              <>
                <strong>
                  {characterCard.name || "未命名人设"}
                </strong>
                <p>{characterCard.description}</p>
              </>
            ) : (
              <p role="alert">
                {characterCard.reasonCode || "人设卡预览失败"}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section>
        <h4>版本与更新</h4>

        <p>
          当前版本：
          {text(
            update.currentPublicVersion
            || update.currentVersion,
            "当前版本",
          )}
        </p>

        <p>
          更新状态：{updatePhase}
        </p>

        {text(update.error) ? (
          <p role="alert">
            {text(update.error)}
          </p>
        ) : null}

        <label>
          <input
            type="checkbox"
            checked={
              settings.autoCheckUpdates !== false
            }
            disabled={busy}
            onChange={(event) =>
              void saveDesktop({
                autoCheckUpdates:
                  event.target.checked,
              })}
          />
          自动检查更新
        </label>

        <button
          type="button"
          disabled={busy || !desktop}
          onClick={() => {
            if (!desktop) return;

            setBusy(true);

            void desktop.checkForUpdates()
              .then((next) => {
                setUpdate(record(next));
                setStatus("更新检查完成");
              })
              .catch(() => {
                setStatus("更新检查失败");
              })
              .finally(() => setBusy(false));
          }}
        >
          检查更新
        </button>

        <button
          type="button"
          disabled={
            busy
            || !desktop
            || updatePhase !== "available"
          }
          onClick={() => {
            if (!desktop) return;

            setBusy(true);

            void desktop.downloadUpdate()
              .then((next) => {
                setUpdate(record(next));
                setStatus("更新下载状态已刷新");
              })
              .catch(() => {
                setStatus("更新下载失败");
              })
              .finally(() => setBusy(false));
          }}
        >
          下载更新
        </button>

        <button
          type="button"
          disabled={
            busy
            || !desktop
            || updatePhase !== "ready"
          }
          onClick={() => {
            if (!desktop) return;

            setBusy(true);

            void desktop.installUpdate()
              .then((next) => {
                setUpdate(record(next));
                setStatus("更新安装预检已执行");
              })
              .catch((error) => {
                setStatus(
                  error instanceof Error
                    ? error.message
                    : "当前工作状态阻止安装更新",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          安装已验证更新
        </button>
      </section>
    </section>
  );
}