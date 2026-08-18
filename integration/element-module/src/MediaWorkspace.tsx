import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RelationshipToolRouteBinding } from "./product-experience/RelationshipOverlayHost";
import "./MediaWorkspace.css";

type BinaryResult = { bytes?: Uint8Array | ArrayBuffer; mimeType?: string; assetId?: string };
type MediaAsset = { id?: string; originalFileName?: string; fileName?: string; type?: string; thumbhash?: string };
type HealthState = {
  available?: boolean;
  degraded?: boolean;
  reasonCode?: string;
  immich?: { available?: boolean; reasonCode?: string };
  comfyui?: { available?: boolean; missingModel?: boolean; checkpoints?: string[]; reasonCode?: string };
};
type WorkflowResult = BinaryResult & {
  promptId?: string;
  ready?: boolean;
  selectable?: boolean;
  reasonCode?: string;
  outputReasonCode?: string;
  descriptor?: { filename?: string };
};
type DesktopMediaApi = {
  getMediaBrainHealth: () => Promise<HealthState>;
  importMediaAsset: (input: Record<string, unknown>) => Promise<{ asset?: MediaAsset; selectable?: boolean }>;
  searchMediaAssets: (input: Record<string, unknown>) => Promise<unknown>;
  listMediaPeople: (input?: Record<string, unknown>) => Promise<unknown>;
  listMediaAlbums: (input?: Record<string, unknown>) => Promise<unknown>;
  getMediaAssetPreview: (input: Record<string, unknown>) => Promise<BinaryResult>;
  queueMediaWorkflow: (input: Record<string, unknown>) => Promise<{ promptId?: string; selectable?: boolean; reasonCode?: string }>;
  getMediaWorkflowResult: (input: Record<string, unknown>) => Promise<WorkflowResult>;
  saveMediaWorkflowOutput: (input: Record<string, unknown>) => Promise<{ asset?: MediaAsset; selectable?: boolean }>;
  sendMediaAsset: (input: Record<string, unknown>) => Promise<unknown>;
  saveMediaBrainSettings: (input: Record<string, unknown>) => Promise<unknown>;
};

type ExternalPolicyIntent = "preserve" | "allow" | "loopback";

function desktopApi(): DesktopMediaApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<DesktopMediaApi> }).yanceDesktop;
  if (!api || typeof api.getMediaBrainHealth !== "function") return null;
  return api as DesktopMediaApi;
}

function assetRows(payload: unknown): MediaAsset[] {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const candidates = [root.items, root.assets, (root.assets as Record<string, unknown> | undefined)?.items, root.results];
  const rows = candidates.find(Array.isArray) as unknown[] | undefined;
  return (rows || []).filter((row): row is MediaAsset => Boolean(row && typeof row === "object" && String((row as MediaAsset).id || "").trim()));
}

function listRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  }
  return [];
}

function displayName(asset: MediaAsset): string {
  return String(asset.originalFileName || asset.fileName || asset.id || "媒体资源");
}

function assetMediaKind(asset: MediaAsset | null): "image" | "video" {
  return String(asset?.type || "").trim().toUpperCase() === "VIDEO" ? "video" : "image";
}

function bytesToObjectUrl(result: BinaryResult | null): string {
  if (!result?.bytes) return "";
  const bytes = result.bytes instanceof ArrayBuffer ? new Uint8Array(result.bytes) : new Uint8Array(result.bytes as Uint8Array);
  return URL.createObjectURL(new Blob([bytes], { type: result.mimeType || "image/jpeg" }));
}

export function MediaWorkspace({
  routeBinding,
}: { routeBinding?: RelationshipToolRouteBinding }): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [health, setHealth] = useState<HealthState>({ degraded: true, reasonCode: "unavailable" });
  const [status, setStatus] = useState("正在检查媒体能力");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [people, setPeople] = useState<Array<Record<string, unknown>>>([]);
  const [albums, setAlbums] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<BinaryResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workflowKind, setWorkflowKind] = useState<"generate" | "edit">("generate");
  const [workflowPromptId, setWorkflowPromptId] = useState("");
  const [workflowOutput, setWorkflowOutput] = useState<WorkflowResult | null>(null);
  const [immichEndpoint, setImmichEndpoint] = useState("");
  const [immichApiKey, setImmichApiKey] = useState("");
  const [immichExternalIntent, setImmichExternalIntent] = useState<ExternalPolicyIntent>("preserve");
  const [clearImmichApiKey, setClearImmichApiKey] = useState(false);
  const [comfyEndpoint, setComfyEndpoint] = useState("");
  const [comfyExternalIntent, setComfyExternalIntent] = useState<ExternalPolicyIntent>("preserve");
  const [platform, setPlatform] = useState("whatsapp");
  const [accountId, setAccountId] = useState("");
  const [chatJid, setChatJid] = useState("");
  const [caption, setCaption] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);
  const productRouteResolved = routeBinding?.status === "resolved";
  const standaloneMode = routeBinding === undefined;
  const resolvedRoute = productRouteResolved ? routeBinding.route : null;

  const refreshHealth = async (): Promise<void> => {
    if (!api) { setStatus("媒体能力暂不可用"); return; }
    try {
      const next = await api.getMediaBrainHealth();
      setHealth(next);
      setStatus(next.degraded ? "部分媒体能力暂不可用，请检查本地运行环境" : "媒体库与智能生成能力已就绪");
    } catch {
      setHealth({ degraded: true, reasonCode: "unavailable" });
      setStatus("媒体能力暂不可用");
    }
  };

  useEffect(() => { void refreshHealth(); }, []);
  useEffect(() => {
    const nextUrl = bytesToObjectUrl(preview || workflowOutput);
    setPreviewUrl(nextUrl);
    return () => { if (nextUrl) URL.revokeObjectURL(nextUrl); };
  }, [preview, workflowOutput]);

  const saveSettings = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const nextSettings: Record<string, unknown> = {
        ...(immichEndpoint.trim() ? { immichEndpoint: immichEndpoint.trim() } : {}),
        ...(immichApiKey.trim() ? { immichApiKey: immichApiKey.trim() } : {}),
        ...(clearImmichApiKey ? { clearImmichApiKey: true } : {}),
        ...(immichExternalIntent !== "preserve" ? { immichAllowExternalEndpoint: immichExternalIntent === "allow" } : {}),
        ...(comfyEndpoint.trim() ? { comfyuiEndpoint: comfyEndpoint.trim() } : {}),
        ...(comfyExternalIntent !== "preserve" ? { comfyuiAllowExternalEndpoint: comfyExternalIntent === "allow" } : {})
      };
      await api.saveMediaBrainSettings(nextSettings);
      setImmichEndpoint("");
      setImmichApiKey("");
      setImmichExternalIntent("preserve");
      setClearImmichApiKey(false);
      setComfyEndpoint("");
      setComfyExternalIntent("preserve");
      setStatus("媒体设置已保存，凭据继续由现有安全存储托管");
      await refreshHealth();
    } catch {
      setStatus("媒体设置保存失败");
    } finally { setBusy(false); }
  };

  const importFile = async (file: File): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.importMediaAsset({ bytes: await file.arrayBuffer(), filename: file.name, mimeType: file.type || "application/octet-stream", createdAt: new Date(file.lastModified || Date.now()).toISOString(), modifiedAt: new Date(file.lastModified || Date.now()).toISOString() });
      const asset = result.asset || null;
      if (asset?.id) { setSelectedAsset(asset); setAssets((rows) => [asset, ...rows.filter((row) => row.id !== asset.id)]); }
      setStatus("导入完成，媒体已进入现有媒体库");
    } catch { setStatus("导入暂不可用"); }
    finally { setBusy(false); if (importRef.current) importRef.current.value = ""; }
  };

  const search = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.searchMediaAssets({ query: query.trim(), size: 40 });
      const rows = assetRows(result);
      setAssets(rows);
      if (selectedAsset && !rows.some((row) => row.id === selectedAsset.id)) setSelectedAsset(null);
      setStatus(`搜索完成 · ${rows.length} 个媒体资源`);
    } catch { setStatus("搜索暂不可用"); }
    finally { setBusy(false); }
  };

  const loadPeople = async (): Promise<void> => {
    if (!api) return;
    try { const rows = listRows(await api.listMediaPeople({})); setPeople(rows); setStatus(`人物 · ${rows.length} 项`); }
    catch { setStatus("人物索引暂不可用"); }
  };
  const loadAlbums = async (): Promise<void> => {
    if (!api) return;
    try { const rows = listRows(await api.listMediaAlbums({})); setAlbums(rows); setStatus(`相册 · ${rows.length} 个`); }
    catch { setStatus("相册索引暂不可用"); }
  };

  const previewAsset = async (asset = selectedAsset): Promise<void> => {
    if (!api || !asset?.id) return;
    setBusy(true);
    try { setPreview(await api.getMediaAssetPreview({ assetId: asset.id, size: "preview" })); setWorkflowOutput(null); setStatus(`预览 · ${displayName(asset)}`); }
    catch { setStatus("预览暂不可用"); }
    finally { setBusy(false); }
  };

  const queueWorkflow = async (): Promise<void> => {
    if (!api || busy || !prompt.trim()) return;
    setBusy(true);
    try {
      if (workflowKind === "edit" && !selectedAsset?.id) {
        throw Object.assign(new Error("请先选择一个图片资源"), { reasonCode: "IMMICH_ASSET_REQUIRED" });
      }
      const queueInput: Record<string, unknown> = { kind: workflowKind, prompt: prompt.trim() };
      if (workflowKind === "edit") {
        queueInput.assetId = selectedAsset?.id;
        queueInput.filename = String(selectedAsset?.originalFileName || selectedAsset?.fileName || "");
      }
      const queued = await api.queueMediaWorkflow(queueInput);
      setWorkflowPromptId(String(queued.promptId || ""));
      setWorkflowOutput(null);
      setPreview(null);
      setStatus(`${workflowKind === "edit" ? "编辑" : "生成"}任务已提交 · 完成后需要保存到媒体库`);
    } catch { setStatus(`${workflowKind === "edit" ? "编辑" : "生成"}暂不可用`); }
    finally { setBusy(false); }
  };

  const previewWorkflow = async (): Promise<void> => {
    if (!api || !workflowPromptId || busy) return;
    setBusy(true);
    try {
      const output = await api.getMediaWorkflowResult({ promptId: workflowPromptId });
      setWorkflowOutput(output);
      setPreview(null);
      setStatus(output.ready ? "生成结果已就绪 · 请预览后保存到媒体库" : "任务仍在运行，暂时没有可用结果");
    } catch { setStatus("生成结果预览暂不可用"); }
    finally { setBusy(false); }
  };

  const saveBack = async (): Promise<void> => {
    if (!api || !workflowPromptId || busy) return;
    setBusy(true);
    try {
      const result = await api.saveMediaWorkflowOutput({ promptId: workflowPromptId, filename: workflowOutput?.descriptor?.filename || `yance-${workflowPromptId}.png` });
      const asset = result.asset || null;
      if (asset?.id) { setSelectedAsset(asset); setAssets((rows) => [asset, ...rows.filter((row) => row.id !== asset.id)]); }
      setStatus("保存完成，生成结果已进入现有媒体库并可选择");
      setWorkflowOutput(null);
    } catch { setStatus("保存生成结果失败"); }
    finally { setBusy(false); }
  };

  const send = async (): Promise<void> => {
    if (!api || !selectedAsset?.id || busy) return;
    if (routeBinding && routeBinding.status !== "resolved") {
      setStatus(routeBinding.reason || "当前关系会话路由不可用，暂时无法发送");
      return;
    }
    const sendPlatform = resolvedRoute?.platform || platform;
    const sendAccountId = resolvedRoute?.accountId || accountId.trim();
    const sendChatJid = resolvedRoute?.chatJid || chatJid.trim();
    if (!sendAccountId || !sendChatJid) return;
    setBusy(true);
    try {
      await api.sendMediaAsset({ platform: sendPlatform, accountId: sendAccountId, chatJid: sendChatJid, assetId: selectedAsset.id, filename: displayName(selectedAsset), caption });
      setStatus("媒体已交给现有发送通道");
    } catch { setStatus("媒体发送失败"); }
    finally { setBusy(false); }
  };

  const checkpoint = health.comfyui?.checkpoints?.[0] || "";
  const selectedIsVideo = assetMediaKind(selectedAsset) === "video";
  const degraded = health.degraded !== false;
  const routeReady = standaloneMode ? Boolean(accountId.trim() && chatJid.trim()) : productRouteResolved;

  return (
    <aside className="yance-media-workspace" aria-label="媒体">
      <header>
        <div><strong>媒体</strong><span>照片与视频 · 智能生成与编辑</span></div>
        <button type="button" title="Health" onClick={() => void refreshHealth()} disabled={busy}>运行状态</button>
      </header>
      <p className={degraded ? "media-status degraded" : "media-status"} aria-live="polite">{status}{health.comfyui?.missingModel ? " · 生成模型缺失" : ""}</p>

      <details>
        <summary>高级媒体设置</summary>
        <div className="media-grid">
          <label>媒体库地址<input value={immichEndpoint} onChange={(event) => setImmichEndpoint(event.target.value)} placeholder="留空则保持当前地址" /></label>
          <label>媒体库 API 密钥<input type="password" value={immichApiKey} onChange={(event) => setImmichApiKey(event.target.value)} autoComplete="off" placeholder="留空则保留已保存密钥" /></label>
          <label>媒体库外部连接策略<select value={immichExternalIntent} onChange={(event) => setImmichExternalIntent(event.target.value as ExternalPolicyIntent)}><option value="preserve">保持当前策略</option><option value="allow">允许外部 HTTPS</option><option value="loopback">仅本机</option></select></label>
          <label className="media-check"><input type="checkbox" checked={clearImmichApiKey} onChange={(event) => setClearImmichApiKey(event.target.checked)} /> 清除已保存的媒体库 API 密钥</label>
          <label>生成引擎地址<input value={comfyEndpoint} onChange={(event) => setComfyEndpoint(event.target.value)} placeholder="留空则保持当前地址" /></label>
          <label>生成引擎外部连接策略<select value={comfyExternalIntent} onChange={(event) => setComfyExternalIntent(event.target.value as ExternalPolicyIntent)}><option value="preserve">保持当前策略</option><option value="allow">允许外部地址</option><option value="loopback">仅本机</option></select></label>
          <button type="button" onClick={() => void saveSettings()} disabled={busy}>保存设置</button>
        </div>
      </details>

      <section>
        <h3>媒体库</h3>
        <div className="media-actions">
          <label className="media-file" title="Import">导入<input ref={importRef} type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label>
          <input aria-label="搜索媒体" title="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索照片或视频" />
          <button type="button" title="Search" onClick={() => void search()} disabled={busy}>搜索</button>
          <button type="button" title="People" onClick={() => void loadPeople()}>人物</button>
          <button type="button" title="Albums" onClick={() => void loadAlbums()}>相册</button>
        </div>
        <div className="media-summary">人物 {people.length} · 相册 {albums.length}</div>
        {people.length ? <div className="media-assets" aria-label="人物">
          {people.map((person) => { const id = String(person.id || ""); const name = String(person.name || person.id || "人物"); return <button key={id} type="button" onClick={() => { if (!api || !id) return; setBusy(true); void api.searchMediaAssets({ query: "", personIds: [id], size: 40 }).then((result) => { const rows = assetRows(result); setAssets(rows); setSelectedAsset(null); setStatus(`人物 · ${name} · ${rows.length} 个媒体资源`); }).catch(() => setStatus("人物媒体加载失败")).finally(() => setBusy(false)); }}>{name}</button>; })}
        </div> : null}
        {albums.length ? <div className="media-assets" aria-label="相册">
          {albums.map((album) => { const id = String(album.id || ""); const name = String(album.albumName || album.name || album.id || "相册"); return <button key={id} type="button" onClick={() => { if (!api || !id) return; setBusy(true); void api.searchMediaAssets({ query: "", albumIds: [id], size: 40 }).then((result) => { const rows = assetRows(result); setAssets(rows); setSelectedAsset(null); setStatus(`相册 · ${name} · ${rows.length} 个媒体资源`); }).catch(() => setStatus("相册媒体加载失败")).finally(() => setBusy(false)); }}>{name}</button>; })}
        </div> : null}
        <div className="media-assets">
          {assets.map((asset) => <button key={asset.id} type="button" className={selectedAsset?.id === asset.id ? "selected" : ""} onClick={() => setSelectedAsset(asset)}>{displayName(asset)}</button>)}
        </div>
      </section>

      <section>
        <h3>生成 / 编辑</h3>
        <div className="media-actions">
          <button type="button" title="Generate" aria-pressed={workflowKind === "generate"} onClick={() => setWorkflowKind("generate")}>生成</button>
          <button type="button" title="Edit" aria-pressed={workflowKind === "edit"} onClick={() => setWorkflowKind("edit")}>编辑</button>
          <span>{checkpoint ? "生成模型已就绪" : "生成模型缺失"}{workflowKind === "edit" && selectedIsVideo ? " · 编辑需要先选择图片资源" : ""}</span>
        </div>
        <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你希望生成的图片或编辑效果" />
        <div className="media-actions">
          <button type="button" onClick={() => void queueWorkflow()} disabled={busy || !prompt.trim() || !checkpoint || workflowKind === "edit" && (!selectedAsset || selectedIsVideo)}>提交任务</button>
          <button type="button" title="Preview" onClick={() => void previewWorkflow()} disabled={!workflowPromptId || busy}>预览</button>
          <button type="button" title="Save back" onClick={() => void saveBack()} disabled={!workflowPromptId || busy}>保存</button>
        </div>
      </section>

      <section>
        <h3>预览 / 选择 / 发送</h3>
        <div className="media-actions"><button type="button" title="Preview" onClick={() => void previewAsset()} disabled={!selectedAsset || busy}>预览</button><span>{selectedAsset ? displayName(selectedAsset) : "尚未选择媒体资源"}</span></div>
        {previewUrl ? <img className="media-preview" src={previewUrl} alt="媒体预览" /> : null}
        <div className="media-grid">
          {standaloneMode ? (
            <>
              <label>平台<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="facebook">Facebook</option></select></label>
              <label>账号 ID<input value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
              <label>会话 JID<input value={chatJid} onChange={(event) => setChatJid(event.target.value)} /></label>
            </>
          ) : (
            <div role="status" aria-live="polite">
              {productRouteResolved ? "已绑定当前关系会话" : routeBinding?.reason || "当前关系会话路由不可用"}
            </div>
          )}
          <label>附言<input value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
          <button type="button" title="Send" onClick={() => void send()} disabled={!selectedAsset || !routeReady || busy}>发送</button>
        </div>
      </section>
    </aside>
  );
}
