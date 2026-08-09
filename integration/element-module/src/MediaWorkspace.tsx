import React, { useEffect, useMemo, useRef, useState } from "react";
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
  saveCredential: (ref: string, value: Record<string, unknown>) => Promise<unknown>;
};

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
  return String(asset.originalFileName || asset.fileName || asset.id || "Immich asset");
}

function assetMediaKind(asset: MediaAsset | null): "image" | "video" {
  return String(asset?.type || "").trim().toUpperCase() === "VIDEO" ? "video" : "image";
}

function bytesToObjectUrl(result: BinaryResult | null): string {
  if (!result?.bytes) return "";
  const bytes = result.bytes instanceof ArrayBuffer ? new Uint8Array(result.bytes) : new Uint8Array(result.bytes as Uint8Array);
  return URL.createObjectURL(new Blob([bytes], { type: result.mimeType || "image/jpeg" }));
}

export function MediaWorkspace(): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [health, setHealth] = useState<HealthState>({ degraded: true, reasonCode: "unavailable" });
  const [status, setStatus] = useState("Media runtime unavailable");
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
  const [immichEndpoint, setImmichEndpoint] = useState("http://127.0.0.1:2283");
  const [immichApiKey, setImmichApiKey] = useState("");
  const [immichExternal, setImmichExternal] = useState(false);
  const [comfyEndpoint, setComfyEndpoint] = useState("http://127.0.0.1:8188");
  const [comfyExternal, setComfyExternal] = useState(false);
  const [platform, setPlatform] = useState("whatsapp");
  const [accountId, setAccountId] = useState("");
  const [chatJid, setChatJid] = useState("");
  const [caption, setCaption] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);

  const refreshHealth = async (): Promise<void> => {
    if (!api) { setStatus("Media runtime unavailable"); return; }
    try {
      const next = await api.getMediaBrainHealth();
      setHealth(next);
      setStatus(next.degraded ? `Degraded · ${next.reasonCode || "missing model or upstream unavailable"}` : "Immich + ComfyUI ready");
    } catch (error) {
      setHealth({ degraded: true, reasonCode: String((error as { reasonCode?: string })?.reasonCode || "unavailable") });
      setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "unavailable")}`);
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
      await api.saveCredential("media:immich:default", { endpoint: immichEndpoint.trim(), apiKey: immichApiKey.trim(), allowExternalEndpoint: immichExternal });
      await api.saveCredential("media:comfyui:default", { endpoint: comfyEndpoint.trim(), allowExternalEndpoint: comfyExternal });
      setStatus("Media endpoints saved in existing Yance credential custody");
      await refreshHealth();
    } catch (error) {
      setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "settings unavailable")}`);
    } finally { setBusy(false); }
  };

  const importFile = async (file: File): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.importMediaAsset({ bytes: await file.arrayBuffer(), filename: file.name, mimeType: file.type || "application/octet-stream", createdAt: new Date(file.lastModified || Date.now()).toISOString(), modifiedAt: new Date(file.lastModified || Date.now()).toISOString() });
      const asset = result.asset || null;
      if (asset?.id) { setSelectedAsset(asset); setAssets((rows) => [asset, ...rows.filter((row) => row.id !== asset.id)]); }
      setStatus("Import complete · Immich owns the asset");
    } catch (error) { setStatus(`Import unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
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
      setStatus(`Search · ${rows.length} Immich assets`);
    } catch (error) { setStatus(`Search unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
    finally { setBusy(false); }
  };

  const loadPeople = async (): Promise<void> => {
    if (!api) return;
    try { const rows = listRows(await api.listMediaPeople({})); setPeople(rows); setStatus(`People · ${rows.length} from Immich`); }
    catch (error) { setStatus(`People unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
  };
  const loadAlbums = async (): Promise<void> => {
    if (!api) return;
    try { const rows = listRows(await api.listMediaAlbums({})); setAlbums(rows); setStatus(`Albums · ${rows.length} from Immich`); }
    catch (error) { setStatus(`Albums unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
  };

  const previewAsset = async (asset = selectedAsset): Promise<void> => {
    if (!api || !asset?.id) return;
    setBusy(true);
    try { setPreview(await api.getMediaAssetPreview({ assetId: asset.id, size: "preview" })); setWorkflowOutput(null); setStatus(`Preview · ${displayName(asset)}`); }
    catch (error) { setStatus(`Preview unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
    finally { setBusy(false); }
  };

  const queueWorkflow = async (): Promise<void> => {
    if (!api || busy || !prompt.trim()) return;
    setBusy(true);
    try {
      if (workflowKind === "edit" && !selectedAsset?.id) {
        throw Object.assign(new Error("Select an Immich asset first"), { reasonCode: "IMMICH_ASSET_REQUIRED" });
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
      setStatus(`${workflowKind === "edit" ? "Edit" : "Generate"} queued in ComfyUI · Save back required`);
    } catch (error) { setStatus(`${workflowKind === "edit" ? "Edit" : "Generate"} unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
    finally { setBusy(false); }
  };

  const previewWorkflow = async (): Promise<void> => {
    if (!api || !workflowPromptId || busy) return;
    setBusy(true);
    try {
      const output = await api.getMediaWorkflowResult({ promptId: workflowPromptId });
      setWorkflowOutput(output);
      setPreview(null);
      setStatus(output.ready ? "Preview · ComfyUI output is ready, Save back required" : "ComfyUI workflow still running or output unavailable");
    } catch (error) { setStatus(`Preview unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
    finally { setBusy(false); }
  };

  const saveBack = async (): Promise<void> => {
    if (!api || !workflowPromptId || busy) return;
    setBusy(true);
    try {
      const result = await api.saveMediaWorkflowOutput({ promptId: workflowPromptId, filename: workflowOutput?.descriptor?.filename || `yance-${workflowPromptId}.png` });
      const asset = result.asset || null;
      if (asset?.id) { setSelectedAsset(asset); setAssets((rows) => [asset, ...rows.filter((row) => row.id !== asset.id)]); }
      setStatus("Save back complete · output is now an Immich asset and selectable");
      setWorkflowOutput(null);
    } catch (error) { setStatus(`Save back unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "COMFYUI_OUTPUT_NOT_IMPORTED")}`); }
    finally { setBusy(false); }
  };

  const send = async (): Promise<void> => {
    if (!api || !selectedAsset?.id || busy) return;
    setBusy(true);
    try {
      await api.sendMediaAsset({ platform, accountId: accountId.trim(), chatJid: chatJid.trim(), assetId: selectedAsset.id, filename: displayName(selectedAsset), caption });
      setStatus("Send delegated to existing Yance send-media-stream authority");
    } catch (error) { setStatus(`Send unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`); }
    finally { setBusy(false); }
  };

  const checkpoint = health.comfyui?.checkpoints?.[0] || "";
  const selectedIsVideo = assetMediaKind(selectedAsset) === "video";
  const degraded = health.degraded !== false;

  return (
    <aside className="yance-media-workspace" aria-label="Media Workspace">
      <header>
        <div><strong>Media</strong><span>Immich assets · ComfyUI workflows</span></div>
        <button type="button" onClick={() => void refreshHealth()} disabled={busy}>Health</button>
      </header>
      <p className={degraded ? "media-status degraded" : "media-status"} aria-live="polite">{status}{health.comfyui?.missingModel ? " · missing model" : ""}</p>

      <details>
        <summary>Upstream settings</summary>
        <div className="media-grid">
          <label>Immich endpoint<input value={immichEndpoint} onChange={(event) => setImmichEndpoint(event.target.value)} /></label>
          <label>Immich API key<input type="password" value={immichApiKey} onChange={(event) => setImmichApiKey(event.target.value)} autoComplete="off" /></label>
          <label className="media-check"><input type="checkbox" checked={immichExternal} onChange={(event) => setImmichExternal(event.target.checked)} /> Explicit external Immich endpoint</label>
          <label>ComfyUI endpoint<input value={comfyEndpoint} onChange={(event) => setComfyEndpoint(event.target.value)} /></label>
          <label className="media-check"><input type="checkbox" checked={comfyExternal} onChange={(event) => setComfyExternal(event.target.checked)} /> Explicit external ComfyUI endpoint</label>
          <button type="button" onClick={() => void saveSettings()} disabled={busy}>Save settings</button>
        </div>
      </details>

      <section>
        <h3>Library</h3>
        <div className="media-actions">
          <label className="media-file">Import<input ref={importRef} type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label>
          <input aria-label="Search media" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Immich" />
          <button type="button" onClick={() => void search()} disabled={busy}>Search</button>
          <button type="button" onClick={() => void loadPeople()}>People</button>
          <button type="button" onClick={() => void loadAlbums()}>Albums</button>
        </div>
        <div className="media-summary">People {people.length} · Albums {albums.length}</div>
        {people.length ? <div className="media-assets" aria-label="Immich people">
          {people.map((person) => { const id = String(person.id || ""); const name = String(person.name || person.id || "Person"); return <button key={id} type="button" onClick={() => { if (!api || !id) return; setBusy(true); void api.searchMediaAssets({ query: "", personIds: [id], size: 40 }).then((result) => { const rows = assetRows(result); setAssets(rows); setSelectedAsset(null); setStatus(`People · ${name} · ${rows.length} assets`); }).catch((error) => setStatus(`People unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`)).finally(() => setBusy(false)); }}>{name}</button>; })}
        </div> : null}
        {albums.length ? <div className="media-assets" aria-label="Immich albums">
          {albums.map((album) => { const id = String(album.id || ""); const name = String(album.albumName || album.name || album.id || "Album"); return <button key={id} type="button" onClick={() => { if (!api || !id) return; setBusy(true); void api.searchMediaAssets({ query: "", albumIds: [id], size: 40 }).then((result) => { const rows = assetRows(result); setAssets(rows); setSelectedAsset(null); setStatus(`Albums · ${name} · ${rows.length} assets`); }).catch((error) => setStatus(`Albums unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "unknown")}`)).finally(() => setBusy(false)); }}>{name}</button>; })}
        </div> : null}
        <div className="media-assets">
          {assets.map((asset) => <button key={asset.id} type="button" className={selectedAsset?.id === asset.id ? "selected" : ""} onClick={() => setSelectedAsset(asset)}>{displayName(asset)}</button>)}
        </div>
      </section>

      <section>
        <h3>Generate / Edit</h3>
        <div className="media-actions">
          <button type="button" aria-pressed={workflowKind === "generate"} onClick={() => setWorkflowKind("generate")}>Generate</button>
          <button type="button" aria-pressed={workflowKind === "edit"} onClick={() => setWorkflowKind("edit")}>Edit</button>
          <span>{checkpoint ? `Model: ${checkpoint}` : "missing model"}{workflowKind === "edit" && selectedIsVideo ? " · Edit requires an image asset" : ""}</span>
        </div>
        <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the image or edit" />
        <div className="media-actions">
          <button type="button" onClick={() => void queueWorkflow()} disabled={busy || !prompt.trim() || !checkpoint || workflowKind === "edit" && (!selectedAsset || selectedIsVideo)}>Queue workflow</button>
          <button type="button" onClick={() => void previewWorkflow()} disabled={!workflowPromptId || busy}>Preview</button>
          <button type="button" onClick={() => void saveBack()} disabled={!workflowPromptId || busy}>Save back</button>
        </div>
      </section>

      <section>
        <h3>Preview / Select / Send</h3>
        <div className="media-actions"><button type="button" onClick={() => void previewAsset()} disabled={!selectedAsset || busy}>Preview</button><span>{selectedAsset ? displayName(selectedAsset) : "No Immich asset selected"}</span></div>
        {previewUrl ? <img className="media-preview" src={previewUrl} alt="Selected media preview" /> : null}
        <div className="media-grid">
          <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="facebook">Facebook</option></select></label>
          <label>Account ID<input value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
          <label>Chat JID<input value={chatJid} onChange={(event) => setChatJid(event.target.value)} /></label>
          <label>Caption<input value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
          <button type="button" onClick={() => void send()} disabled={!selectedAsset || !accountId.trim() || !chatJid.trim() || busy}>Send</button>
        </div>
      </section>
    </aside>
  );
}
