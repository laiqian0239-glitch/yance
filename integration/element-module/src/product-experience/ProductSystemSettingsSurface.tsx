import React, { useCallback, useEffect, useMemo, useState } from "react";

type JsonRecord = Record<string, unknown>;
type UserSettingsDestination = "account" | "security" | "sessions";
type DesktopApi = {
  getSettings?: () => Promise<unknown>; updateSettings?: (patch: JsonRecord) => Promise<unknown>;
  storeSnapshot?: (input: { domains: string[] }) => Promise<unknown>; getThemeCatalog?: () => Promise<unknown>;
  updateThemePreferences?: (input: JsonRecord) => Promise<unknown>;
  storePreviewTheme?: (input: { themeId: string }) => Promise<unknown>; storeCancelThemePreview?: () => Promise<unknown>;
  storeApplyTheme?: (input: { themeId: string }) => Promise<unknown>;
  storeSetMotionLevel?: (input: { motionLevel: string }) => Promise<unknown>;
  storeSetBackgroundEffect?: (input: { backgroundEffect: string }) => Promise<unknown>;
  getNotificationSettings?: () => Promise<unknown>; updateNotificationSettings?: (input: JsonRecord) => Promise<unknown>;
  createNotificationSound?: (input: { bytes: Uint8Array; fileName: string; mimeType: string; label: string }) => Promise<unknown>;
  deleteNotificationSound?: (input: { id: string }) => Promise<unknown>;
  playSound?: (input: { volume: number; pattern: string; force: boolean }) => Promise<unknown>;
  getProductDataProtectionState?: () => Promise<unknown>; mutateProductDataProtection?: (input: JsonRecord) => Promise<unknown>;
  selectPortableBackup?: () => Promise<unknown>; savePortableBackup?: (name: string) => Promise<unknown>;
  restartBackend?: () => Promise<unknown>; restartApp?: () => Promise<unknown>;
  getRuntimeProjection?: () => Promise<unknown>;
  prepareProductSafeModeExit?: (input: { reason?: string }) => Promise<unknown>;
  setOperatingMode?: (
    operatingMode: "normal" | "safeMode",
    reason?: string,
    authorization?: { exitAuthorizationId: string; exitAuthorizationToken: string },
  ) => Promise<unknown>;
  getUpdateState?: () => Promise<unknown>; checkForUpdates?: () => Promise<unknown>;
  downloadUpdate?: () => Promise<unknown>; installUpdate?: () => Promise<unknown>; getState?: () => Promise<unknown>;
};
function desktopApi(): DesktopApi | null {
  return (window as unknown as { yanceDesktop?: DesktopApi }).yanceDesktop || null;
}
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(record) : []; }
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function itemName(row: JsonRecord): string {
  return text(row.name || row.backupName || row.targetName || row.id) || "未命名备份";
}
function jsonSummary(value: unknown): string {
  if (value == null) return "无";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  const row = record(value);
  for (const key of ["state", "status", "reasonCode", "name", "id", "policy"]) {
    const candidate = text(row[key]);
    if (candidate) return candidate;
  }
  return Object.keys(row).length ? "已读取" : "无";
}

const DESKTOP_TOGGLES = [
  ["autoLaunch", "开机启动"], ["closeToTray", "关闭按钮收起到托盘"], ["startMinimized", "启动后保持最小化"],
  ["gifAutoplay", "自动播放 GIF"], ["stickerAutoplay", "自动播放贴纸"],
  ["pauseAnimationWhenHidden", "窗口不可见时暂停动画"], ["autoCheckUpdates", "自动检查更新"],
  ["autoDownloadUpdates", "自动下载更新"],
] as const;
const MOTION_LEVELS = [["off","关闭"],["subtle","轻微"],["balanced","均衡"],["enhanced","增强"]] as const;
const BACKGROUND_EFFECTS = [["none","无"],["ambient","氛围"],["grid","网格"],["aurora","流光"]] as const;
const FONT_PROFILES = [["theme","跟随主题"],["sans","无衬线"],["humanist","人文"],["serif","衬线"],["mono","等宽"]] as const;
const SPACING_PROFILES = [["theme","跟随主题"],["compact","紧凑"],["comfortable","舒适"],["spacious","宽松"]] as const;

export function ProductSystemSettingsSurface({
  openUserSettings, requestLogout,
}: {
  openUserSettings?: (destination: UserSettingsDestination) => void; requestLogout?: () => void;
}): React.JSX.Element {
  const api = useMemo(desktopApi, []);
  const [settings, setSettings] = useState<JsonRecord>({});
  const [ui, setUi] = useState<JsonRecord>({});
  const [catalog, setCatalog] = useState<JsonRecord>({});
  const [notifications, setNotifications] = useState<JsonRecord>({});
  const [soundCatalog, setSoundCatalog] = useState<JsonRecord>({});
  const [protection, setProtection] = useState<JsonRecord>({});
  const [update, setUpdate] = useState<JsonRecord>({});
  const [appState, setAppState] = useState<JsonRecord>({});
  const [runtimeProjection, setRuntimeProjection] = useState<JsonRecord>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在读取设置");
  const [backupName, setBackupName] = useState("");
  const [verifiedBackupName, setVerifiedBackupName] = useState("");
  const [portableName, setPortableName] = useState("");
  const [portablePassphrase, setPortablePassphrase] = useState("");
  const [backupLabel, setBackupLabel] = useState("手动备份");

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) { setStatus("系统设置暂不可用"); return; }
    setBusy(true);
    try {
      const [desktopSettings, storePayload, themePayload, notificationPayload, protectionPayload, updatePayload, statePayload, runtimePayload] =
        await Promise.all([
          api.getSettings?.() ?? {}, api.storeSnapshot?.({ domains: ["ui"] }) ?? {}, api.getThemeCatalog?.() ?? {},
          api.getNotificationSettings?.() ?? {}, api.getProductDataProtectionState?.() ?? {},
          api.getUpdateState?.() ?? {}, api.getState?.() ?? {},
          api.getRuntimeProjection?.().catch(() => ({})) ?? {},
        ]);
      const snapshotRoot = record(storePayload), snapshot = record(snapshotRoot.snapshot || snapshotRoot);
      const notificationRoot = record(notificationPayload);
      setSettings(record(desktopSettings)); setUi(record(snapshot.ui)); setCatalog(record(themePayload));
      setNotifications(record(notificationRoot.settings)); setSoundCatalog(record(notificationRoot.soundCatalog));
      setProtection(record(protectionPayload)); setUpdate(record(updatePayload)); setAppState(record(statePayload));
      setRuntimeProjection(record(runtimePayload));
      setStatus("设置已刷新");
    } catch { setStatus("设置读取失败；没有创建替代状态"); } finally { setBusy(false); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const saveDesktop = async (patch: JsonRecord): Promise<void> => {
    if (!api?.updateSettings || busy) return; setBusy(true);
    try { setSettings(record(await api.updateSettings(patch))); setStatus("桌面设置已保存"); }
    catch { setStatus("桌面设置保存失败"); } finally { setBusy(false); }
  };
  const saveThemePreferences = async (patch: JsonRecord): Promise<void> => {
    if (!api?.updateThemePreferences || busy) return; setBusy(true);
    try { await api.updateThemePreferences(patch); setStatus("外观设置已保存"); await refresh(); }
    catch { setStatus("外观设置保存失败"); } finally { setBusy(false); }
  };
  const saveNotifications = async (patch: JsonRecord): Promise<void> => {
    if (!api?.updateNotificationSettings || busy) return; setBusy(true);
    try {
      const payload = record(await api.updateNotificationSettings(patch));
      setNotifications(record(payload.settings || payload));
      if (payload.soundCatalog) setSoundCatalog(record(payload.soundCatalog));
      setStatus("通知设置已保存");
    } catch { setStatus("通知设置保存失败"); } finally { setBusy(false); }
  };

  const previewNotificationSound = async (pattern: string, label: string): Promise<void> => {
    if (!api?.playSound || !pattern || busy) return;
    setBusy(true);
    try {
      const result = record(await api.playSound({
        volume: Number(notifications.soundVolume ?? 0.68),
        pattern,
        force: true,
      }));
      setStatus(result.played === false ? `${label}试听失败` : `${label}试听完成`);
    } catch { setStatus(`${label}试听失败`); } finally { setBusy(false); }
  };

  const mutateProtection = async (
    input: JsonRecord,
    successStatus: string,
    clearPassphrase = false,
  ): Promise<unknown> => {
    if (!api?.mutateProductDataProtection || busy) return null;
    setBusy(true);
    try {
      const result = await api.mutateProductDataProtection(input);
      if (clearPassphrase) setPortablePassphrase("");
      setStatus(successStatus);
      setBusy(false);
      await refresh();
      return result;
    } catch {
      if (clearPassphrase) setPortablePassphrase("");
      setStatus("数据保护操作失败；现有恢复状态保持不变");
      setBusy(false);
      return null;
    }
  };

  const importPortable = async (): Promise<void> => {
    if (!api?.selectPortableBackup || busy) return;
    setBusy(true);
    try {
      const imported = record(await api.selectPortableBackup());
      const name = text(imported.name);
      if (imported.imported === true && name) {
        setPortableName(name);
        setStatus("可迁移备份已导入到言策受控目录；请先验证，再暂存恢复");
        setBusy(false);
        await refresh();
      } else {
        setStatus("未导入新的可迁移备份");
        setBusy(false);
      }
    } catch {
      setStatus("可迁移备份导入失败；恢复状态未改变");
      setBusy(false);
    }
  };

  const exportPortable = async (): Promise<void> => {
    if (!api?.savePortableBackup || !portableName || busy) return;
    setBusy(true);
    try {
      const result = record(await api.savePortableBackup(portableName));
      setStatus(result.saved === true ? "可迁移备份已导出" : "未导出可迁移备份");
    } catch {
      setStatus("可迁移备份导出失败");
    } finally {
      setBusy(false);
    }
  };

  const restartForPendingRestore = async (): Promise<void> => {
    if (!api?.restartApp || busy) return;
    if (!window.confirm("重启后将执行已暂存的恢复，并在恢复前创建保护备份。是否继续？")) return;
    setBusy(true);
    setStatus("正在重启并执行已暂存恢复");
    try {
      await api.restartApp();
    } catch {
      setStatus("应用重启失败；已暂存恢复仍保持待执行状态");
      setBusy(false);
    }
  };

  const runAndRefresh = async (
    operation: (() => Promise<unknown>) | undefined,
    failureStatus: string,
  ): Promise<void> => {
    if (!operation || busy) {
      if (!operation) setStatus("当前操作暂不可用");
      return;
    }
    setBusy(true);
    try {
      await operation();
      setBusy(false);
      await refresh();
    } catch {
      setStatus(failureStatus);
      setBusy(false);
    }
  };

  const enterSafeMode = async (): Promise<void> => {
    if (!api?.setOperatingMode || busy) {
      if (!api?.setOperatingMode) setStatus("运行模式控制暂不可用");
      return;
    }
    setBusy(true);
    try {
      await api.setOperatingMode("safeMode", "product-system-settings");
      setStatus("已进入安全模式");
      setBusy(false);
      await refresh();
    } catch {
      setStatus("进入安全模式失败；当前运行模式保持不变");
      setBusy(false);
    }
  };

  const exitSafeMode = async (): Promise<void> => {
    if (!api?.prepareProductSafeModeExit || !api?.setOperatingMode || busy) {
      if (!api?.prepareProductSafeModeExit || !api?.setOperatingMode) setStatus("安全模式退出授权暂不可用");
      return;
    }
    setBusy(true);
    try {
      const receipt = record(await api.prepareProductSafeModeExit({ reason: "product-system-settings" }));
      const exitAuthorizationId = text(receipt.exitAuthorizationId);
      const exitAuthorizationToken = text(receipt.exitAuthorizationToken);
      if (!exitAuthorizationId || !exitAuthorizationToken) {
        setStatus("安全模式退出授权无效；未切换运行模式");
        setBusy(false);
        return;
      }
      await api.setOperatingMode("normal", "product-system-settings", {
        exitAuthorizationId,
        exitAuthorizationToken,
      });
      setStatus("已退出安全模式");
      setBusy(false);
      await refresh();
    } catch {
      setStatus("退出安全模式失败；当前运行模式保持不变");
      setBusy(false);
    }
  };

  const themeRows = rows(catalog.themes), favoriteThemeIds = strings(ui.favoriteThemeIds), recentThemeIds = strings(ui.recentThemeIds);
  const typography = record(ui.typography), tuning = record(ui.themeTuning);
  const soundEvents = rows(soundCatalog.events), soundPatterns = rows(soundCatalog.patterns), soundUpload = record(soundCatalog.upload);
  const soundPatternOptions = soundPatterns.filter((row) => Boolean(text(row.id)));
  const soundEnableEvents = soundEvents.filter((row, index) => {
    const enabledKey = text(row.enabledKey);
    return Boolean(enabledKey) && soundEvents.findIndex((candidate) => text(candidate.enabledKey) === enabledKey) === index;
  });
  const acceptedSoundExtensions = strings(soundUpload.acceptedExtensions).map((item) => item.toLowerCase());
  const maxSoundBytes = Number(soundUpload.maxBytes || 0);
  const backupsState = record(protection.backups);
  const portableState = record(protection.portableBackups);
  const backups = rows(backupsState.backups);
  const portableBackups = rows(portableState.packages);
  const restoreHistory = rows(backupsState.restoreHistory);
  const pendingRestore = record(backupsState.pendingRestore);
  const retention = record(backupsState.retention);
  const currentVersion = text(update.currentPublicVersion || update.currentVersion || appState.publicVersion || appState.version) || "当前版本";
  const runtime = record(runtimeProjection.runtime);
  const runtimeOperatingMode = text(runtime.operatingMode) || "未知";
  const runtimeLifecycleState = text(runtime.lifecycleState) || "未知";
  const runtimeLocalReady = runtime.localReady === true;
  const selectedThemeId = text(ui.previewThemeId || ui.themeId || catalog.defaultThemeId);

  return <section className="yance-product-system-settings" aria-label="系统设置">
    <header><div><span className="yance-eyebrow">设置</span><h3>系统与账户</h3></div>
      <button type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></header>
    <p role="status" aria-live="polite">{status}</p>

    <section aria-label="账户与安全"><h4>账户与安全</h4>
      <button type="button" onClick={() => openUserSettings?.("account")}>个人资料</button>
      <button type="button" onClick={() => openUserSettings?.("security")}>安全</button>
      <button type="button" onClick={() => openUserSettings?.("sessions")}>已登录设备</button>
      <button type="button" onClick={() => { if (window.confirm("确认退出言策登录？")) requestLogout?.(); }}>退出登录</button>
    </section>

    <section aria-label="运行安全与恢复"><h4>运行安全与恢复</h4>
      <p>运行模式：{runtimeOperatingMode} · 生命周期：{runtimeLifecycleState} · 本地就绪：{runtimeLocalReady ? "是" : "否"}</p>
      <button type="button" disabled={busy || !api?.restartBackend}
        onClick={() => void runAndRefresh(api?.restartBackend ? () => api.restartBackend!() : undefined, "后台服务重启失败")}>重启后台服务</button>
      <button type="button" disabled={busy || !api?.restartApp}
        onClick={() => void runAndRefresh(api?.restartApp ? () => api.restartApp!() : undefined, "言策重启失败")}>重启言策</button>
      <button type="button" disabled={busy || runtimeOperatingMode === "safeMode" || !api?.setOperatingMode}
        onClick={() => void enterSafeMode()}>进入安全模式</button>
      <button type="button" disabled={busy || runtimeOperatingMode !== "safeMode" || !api?.prepareProductSafeModeExit || !api?.setOperatingMode}
        onClick={() => void exitSafeMode()}>退出安全模式</button>
    </section>

    <section aria-label="桌面行为"><h4>桌面行为</h4>
      {DESKTOP_TOGGLES.map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key] === true}
        disabled={busy} onChange={(e) => void saveDesktop({ [key]: e.target.checked })} />{label}</label>)}
      <label><span>声音模式</span><select value={text(settings.productSoundMode) || "Essential only"} disabled={busy}
        onChange={(e) => void saveDesktop({ productSoundMode: e.target.value })}>
        <option value="Off">关闭</option><option value="Essential only">仅必要提示</option><option value="Immersive">沉浸</option>
      </select></label>
    </section>

    <section aria-label="外观主题"><h4>外观主题</h4><p>可用主题：{themeRows.length}</p>
      <label><span>主题</span><select value={selectedThemeId} disabled={busy || !themeRows.length}
        onChange={(e) => void runAndRefresh(api?.storePreviewTheme ? () => api!.storePreviewTheme!({ themeId: e.target.value }) : undefined, "主题预览失败")}>
        {themeRows.map((theme) => <option key={text(theme.id)} value={text(theme.id)}>{text(theme.name) || text(theme.id)}</option>)}
      </select></label>
      <button type="button" disabled={!selectedThemeId || busy}
        onClick={() => void runAndRefresh(api?.storeApplyTheme ? () => api!.storeApplyTheme!({ themeId: selectedThemeId }) : undefined, "主题应用失败")}>应用主题</button>
      <button type="button" disabled={busy} onClick={() => void runAndRefresh(api?.storeCancelThemePreview ? () => api!.storeCancelThemePreview!() : undefined, "取消主题预览失败")}>取消预览</button>
      <button type="button" disabled={!selectedThemeId || busy} onClick={() => {
        const next = favoriteThemeIds.includes(selectedThemeId)
          ? favoriteThemeIds.filter((id) => id !== selectedThemeId) : [...favoriteThemeIds, selectedThemeId];
        void saveThemePreferences({ favoriteThemeIds: next });
      }}>{favoriteThemeIds.includes(selectedThemeId) ? "取消收藏主题" : "收藏主题"}</button>
      {recentThemeIds.length ? <p>最近使用：{recentThemeIds.length} 个主题</p> : null}

      <label><span>主题模式</span><select value={text(ui.themeMode) || "manual"}
        onChange={(e) => void saveThemePreferences({ themeMode: e.target.value })}>
        <option value="manual">手动</option><option value="system">跟随系统</option><option value="schedule">按时间</option>
      </select></label>
      <label><span>浅色主题</span><select value={text(ui.lightThemeId)}
        onChange={(e) => void saveThemePreferences({ lightThemeId: e.target.value })}>
        {themeRows.filter((theme) => text(theme.brightness) === "浅色").map((theme) =>
          <option key={text(theme.id)} value={text(theme.id)}>{text(theme.name)}</option>)}</select></label>
      <label><span>深色主题</span><select value={text(ui.darkThemeId)}
        onChange={(e) => void saveThemePreferences({ darkThemeId: e.target.value })}>
        {themeRows.filter((theme) => text(theme.brightness) === "深色").map((theme) =>
          <option key={text(theme.id)} value={text(theme.id)}>{text(theme.name)}</option>)}</select></label>
      <label><span>白天开始</span><input type="time" value={text(ui.scheduleDayStart)}
        onChange={(e) => void saveThemePreferences({ scheduleDayStart: e.target.value })} /></label>
      <label><span>夜间开始</span><input type="time" value={text(ui.scheduleNightStart)}
        onChange={(e) => void saveThemePreferences({ scheduleNightStart: e.target.value })} /></label>

      <label><span>字体</span><select value={text(typography.fontProfile) || "theme"}
        onChange={(e) => void saveThemePreferences({ typography: { ...typography, fontProfile: e.target.value } })}>
        {FONT_PROFILES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>字号 {Number(typography.fontScale || 100)}%</span><input type="range" min="85" max="150"
        value={Number(typography.fontScale || 100)}
        onChange={(e) => void saveThemePreferences({ typography: { ...typography, fontScale: Number(e.target.value) } })} /></label>
      <label><span>行高</span><input type="range" min="130" max="190" value={Number(typography.lineHeight || 155)}
        onChange={(e) => void saveThemePreferences({ typography: { ...typography, lineHeight: Number(e.target.value) } })} /></label>
      <label><span>间距</span><select value={text(typography.spacing) || "theme"}
        onChange={(e) => void saveThemePreferences({ typography: { ...typography, spacing: e.target.value } })}>
        {SPACING_PROFILES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>

      {([["backgroundDepth","背景层次",0,100],["glowIntensity","光晕强度",0,100],
         ["glassOpacity","玻璃透明度",20,100],["accentSaturation","强调色饱和度",50,150]] as const).map(([key,label,min,max]) =>
        <label key={key}><span>{label}</span><input type="range" min={min} max={max}
          value={Number(tuning[key] || (key === "glassOpacity" ? 72 : key === "accentSaturation" ? 100 : 50))}
          onChange={(e) => void saveThemePreferences({ themeTuning: { ...tuning, [key]: Number(e.target.value) } })} /></label>)}

      <label><span>动效</span><select value={text(ui.motionLevel) || "balanced"}
        onChange={(e) => void runAndRefresh(api?.storeSetMotionLevel ? () => api!.storeSetMotionLevel!({ motionLevel: e.target.value }) : undefined, "动效设置失败")}>
        {MOTION_LEVELS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>背景效果</span><select value={text(ui.backgroundEffect) || "ambient"}
        onChange={(e) => void runAndRefresh(api?.storeSetBackgroundEffect ? () => api!.storeSetBackgroundEffect!({ backgroundEffect: e.target.value }) : undefined, "背景效果设置失败")}>
        {BACKGROUND_EFFECTS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </section>

    <section aria-label="通知与声音"><h4>通知与声音</h4>
      <label><input type="checkbox" checked={notifications.enabled !== false}
        onChange={(e) => void saveNotifications({ enabled: e.target.checked })} />启用通知</label>
      <label><input type="checkbox" checked={notifications.soundEnabled !== false}
        onChange={(e) => void saveNotifications({ soundEnabled: e.target.checked })} />启用声音</label>
      <label><span>音量</span><input type="range" min="0" max="1" step="0.05"
        value={Number(notifications.soundVolume ?? 0.68)}
        onChange={(e) => void saveNotifications({ soundVolume: Number(e.target.value) })} /></label>
      <label><span>隐私</span><select value={text(notifications.privacy) || "preview"}
        onChange={(e) => void saveNotifications({ privacy: e.target.value })}>
        <option value="preview">显示预览</option><option value="sender-only">只显示发送者</option><option value="hidden">隐藏内容</option>
      </select></label>
      <label><input type="checkbox" checked={record(notifications.dnd).enabled === true}
        onChange={(e) => void saveNotifications({ dnd: { ...record(notifications.dnd), enabled: e.target.checked } })} />勿扰模式</label>
      {soundEnableEvents.map((row) => {
        const enabledKey = text(row.enabledKey);
        const label = enabledKey === "presenceSoundEnabled"
          ? "联系人状态声音" : text(row.label || row.name).replace(/提示音$/u, "声音");
        return <label key={enabledKey}><input type="checkbox" checked={notifications[enabledKey] !== false}
          disabled={busy} onChange={(e) => void saveNotifications({ [enabledKey]: e.target.checked })} />{label}</label>;
      })}
      {soundEvents.map((row) => {
        const eventId = text(row.id);
        const settingKey = text(row.settingKey);
        const selectedPattern = text(notifications[settingKey]) || text(row.defaultPattern);
        const label = text(row.label || row.name) || eventId;
        return <div key={eventId || settingKey} className="yance-product-system-settings__sound-event">
          <label><span>{label}</span><select value={selectedPattern} disabled={busy || !settingKey || !soundPatternOptions.length}
            onChange={(e) => void saveNotifications({ [settingKey]: e.target.value })}>
            {soundPatternOptions.map((pattern) =>
              <option key={text(pattern.id)} value={text(pattern.id)}>{text(pattern.label || pattern.name) || text(pattern.id)}</option>)}
          </select></label>
          <button type="button" disabled={busy || !selectedPattern || !api?.playSound}
            onClick={() => void previewNotificationSound(selectedPattern, label)}>试听</button>
          {text(row.description) ? <small>{text(row.description)}</small> : null}
        </div>;
      })}
      <label><span>添加自定义声音</span><input type="file" accept={acceptedSoundExtensions.map((ext) => `.${ext}`).join(",")}
        onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
          if (!file || !api?.createNotificationSound) return;
          const ext = file.name.toLowerCase().split(".").pop() || "";
          if (!acceptedSoundExtensions.length || !acceptedSoundExtensions.includes(ext)) { setStatus("该声音格式不受当前声音库支持"); return; }
          if (!maxSoundBytes || file.size > maxSoundBytes) { setStatus("声音文件超过当前声音库允许大小"); return; }
          void (async () => {
            try {
              const buffer = await file.arrayBuffer();
              await api!.createNotificationSound!({
                bytes: new Uint8Array(buffer), fileName: file.name, mimeType: file.type,
                label: file.name.replace(/\.[^.]+$/u, ""),
              });
              await refresh();
            } catch { setStatus("自定义声音添加失败"); }
          })();
        }} /></label>
      {soundPatterns.filter((row) => row.custom === true).map((row) => {
        const patternId = text(row.id);
        const label = text(row.label || row.name) || patternId;
        return <div key={patternId}>
          <button type="button" disabled={busy || !patternId || !api?.playSound}
            onClick={() => void previewNotificationSound(patternId, label)}>试听 {label}</button>
          <button type="button" disabled={busy || !patternId}
            onClick={() => void runAndRefresh(api?.deleteNotificationSound ? () => api!.deleteNotificationSound!({ id: patternId }) : undefined, "删除自定义声音失败")}>删除 {label}</button>
        </div>;
      })}
    </section>

    <section aria-label="数据保护"><h4>数据保护</h4>
      <p>已有备份：{backups.length} · 可迁移备份：{portableBackups.length} · 保留策略：{jsonSummary(retention)}</p>

      <section aria-label="普通备份与恢复">
        <h5>普通备份与恢复</h5>
        <label><span>备份标签</span><input value={backupLabel} maxLength={120}
          onChange={(event) => setBackupLabel(event.target.value)} /></label>
        <label><span>选择备份</span><select value={backupName}
          onChange={(event) => { setBackupName(event.target.value); setVerifiedBackupName(""); }}>
          <option value="">请选择</option>
          {backups.map((row) => { const name = itemName(row); return <option key={name} value={name}>{name}</option>; })}
        </select></label>
        <button type="button" disabled={!api?.mutateProductDataProtection || busy}
          onClick={() => void mutateProtection({ action: "create-backup", label: backupLabel.trim() || "手动备份" }, "备份已创建")}>创建备份</button>
        <button type="button" disabled={!backupName || busy}
          onClick={() => void mutateProtection({ action: "verify-backup", name: backupName }, "备份验证完成")
            .then((result) => { if (result) setVerifiedBackupName(backupName); })}>验证备份</button>
        <button type="button" disabled={!backupName || verifiedBackupName !== backupName || busy}
          onClick={() => void mutateProtection({ action: "stage-restore", name: backupName }, "恢复已暂存；重启前仍可取消")}>验证后暂存恢复</button>
      </section>

      <section aria-label="可迁移备份">
        <h5>可迁移备份</h5>
        <p>导入和导出由桌面文件托管；备份密码仅用于本次操作。</p>
        <label><span>备份密码</span><input type="password" autoComplete="off"
          value={portablePassphrase} onChange={(event) => setPortablePassphrase(event.target.value)}
          placeholder="至少 10 个字符" /></label>
        <label><span>选择可迁移备份</span><select value={portableName} onChange={(event) => setPortableName(event.target.value)}>
          <option value="">请选择</option>
          {portableBackups.map((row) => { const name = itemName(row); return <option key={name} value={name}>{name}</option>; })}
        </select></label>
        <button type="button" disabled={!api?.selectPortableBackup || busy} onClick={() => void importPortable()}>导入可迁移备份</button>
        <button type="button" disabled={portablePassphrase.length < 10 || busy}
          onClick={() => void mutateProtection({
            action: "create-portable-backup", passphrase: portablePassphrase, profile: "data-only", label: backupLabel.trim() || "手动备份",
          }, "可迁移备份已创建", true)}>创建可迁移备份</button>
        <button type="button" disabled={!portableName || portablePassphrase.length < 10 || busy}
          onClick={() => void mutateProtection({
            action: "verify-portable-backup", name: portableName, passphrase: portablePassphrase,
          }, "可迁移备份验证完成", true)}>验证可迁移备份</button>
        <button type="button" disabled={!portableName || portablePassphrase.length < 10 || busy}
          onClick={() => void mutateProtection({
            action: "stage-portable-restore", name: portableName, passphrase: portablePassphrase,
          }, "可迁移备份已验证并暂存恢复；重启前仍可取消", true)}>验证并暂存恢复</button>
        <button type="button" disabled={!portableName || !api?.savePortableBackup || busy}
          onClick={() => void exportPortable()}>导出可迁移备份</button>
        <button type="button" disabled={!portableName || busy}
          onClick={() => void mutateProtection({ action: "delete-portable-backup", name: portableName }, "可迁移备份已删除")}>删除可迁移备份</button>
      </section>

      <section aria-label="待执行恢复">
        <h5>待执行恢复</h5>
        <p>当前待恢复：{Object.keys(pendingRestore).length ? `${itemName(pendingRestore)} · ${jsonSummary(pendingRestore)}` : "无"}</p>
        <button type="button" disabled={!Object.keys(pendingRestore).length || busy}
          onClick={() => void mutateProtection({ action: "cancel-restore" }, "已取消待执行恢复")}>取消恢复</button>
        <button type="button" disabled={!Object.keys(pendingRestore).length || !api?.restartApp || busy}
          onClick={() => void restartForPendingRestore()}>重启并执行恢复</button>
        <p>恢复历史：{restoreHistory.length} 条</p>
        <ul>{restoreHistory.slice(0, 8).map((row, index) =>
          <li key={`${itemName(row)}-${index}`}>{itemName(row)} · {jsonSummary(row)}</li>)}</ul>
      </section>
    </section>
    <section aria-label="关于言策"><h4>关于言策</h4><p>版本：{currentVersion}</p>
      <p>更新状态：{text(update.phase || update.status) || "已就绪"}</p>
      <button type="button" disabled={busy} onClick={() => void runAndRefresh(api?.checkForUpdates ? () => api!.checkForUpdates!() : undefined, "检查更新失败")}>检查更新</button>
      <button type="button" disabled={busy || text(update.phase) !== "available"}
        onClick={() => void runAndRefresh(api?.downloadUpdate ? () => api!.downloadUpdate!() : undefined, "下载更新失败")}>下载更新</button>
      <button type="button" disabled={busy || text(update.phase) !== "ready"}
        onClick={() => void runAndRefresh(api?.installUpdate ? () => api!.installUpdate!() : undefined, "安装更新失败")}>安装更新</button>
      <p>帮助与许可信息随言策版本提供。</p>
    </section>
  </section>;
}
