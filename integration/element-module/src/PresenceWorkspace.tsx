import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RelationshipToolRouteBinding } from "./product-experience/RelationshipOverlayHost";
import {
  connectPresenceLiveKit,
  disconnectPresenceLiveKit,
  getPresenceLiveKitSnapshot,
  mountPresenceRemoteMedia,
  setPresenceCameraEnabled,
  setPresenceMicrophoneEnabled,
  startPresenceAudioPlayback,
  subscribePresenceLiveKit,
  type PresenceLiveKitSnapshot,
} from "./presenceLiveKit";

type PresenceSession = Readonly<{ sessionId: string; livekitUrl: string; livekitToken: string }>;
type PresenceCharacter = Readonly<{ id: string; name: string }>;
type PresenceHealth = Readonly<{
  available?: boolean;
  degraded?: boolean;
  reasonCode?: string;
  endpoint?: string;
  characterCatalogAvailable?: boolean;
  characters?: readonly PresenceCharacter[];
}>;
type DesktopPresenceApi = {
  getPresenceHealth: () => Promise<PresenceHealth>;
  createPresenceSession: (input?: Record<string, unknown>) => Promise<PresenceSession>;
  closePresenceSession: (input: { sessionId: string }) => Promise<unknown>;
  pushPresenceVoiceAudioChunk: (input: Record<string, unknown>) => Promise<unknown>;
};

function desktopApi(): DesktopPresenceApi | null {
  const api = (window as unknown as { yanceDesktop?: Partial<DesktopPresenceApi> }).yanceDesktop;
  return api && typeof api.createPresenceSession === "function" ? api as DesktopPresenceApi : null;
}

function connectionStateLabel(state: PresenceLiveKitSnapshot["state"]): string {
  if (state === "connected") return "已连接";
  if (state === "connecting") return "连接中";
  if (state === "reconnecting") return "断线恢复";
  return "未连接";
}

export function PresenceWorkspace({
  routeBinding,
}: { routeBinding?: RelationshipToolRouteBinding }): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const mediaHostRef = useRef<HTMLDivElement | null>(null);
  const [health, setHealth] = useState<PresenceHealth>({ degraded: true, reasonCode: "unavailable" });
  const [characters, setCharacters] = useState<readonly PresenceCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [session, setSession] = useState<PresenceSession | null>(null);
  const sessionRef = useRef<PresenceSession | null>(null);
  const aliveRef = useRef(true);
  const [liveKit, setLiveKit] = useState<PresenceLiveKitSnapshot>(getPresenceLiveKitSnapshot());
  const [status, setStatus] = useState("实时陪伴暂不可用");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePresenceLiveKit(setLiveKit), []);
  useEffect(() => {
    const host = mediaHostRef.current;
    return host ? mountPresenceRemoteMedia(host) : undefined;
  }, []);
  useEffect(() => {
    if (!api) return;
    api.getPresenceHealth().then((next) => {
      if (!aliveRef.current) return;
      const nextCharacters = Array.isArray(next.characters) ? next.characters : [];
      setHealth(next);
      setCharacters(nextCharacters);
      setCharacterId((current) => current && nextCharacters.some((row) => row.id === current) ? current : nextCharacters[0]?.id || "");
      if (!next.available) setStatus("实时陪伴能力暂不可用");
      else if (!next.characterCatalogAvailable) setStatus("形象列表暂不可用");
      else if (!nextCharacters.length) setStatus("实时陪伴已就绪，请先创建一个可用形象");
      else setStatus("实时陪伴已就绪，等待连接");
    }).catch(() => {
      if (aliveRef.current) setStatus("实时陪伴能力暂不可用");
    });
  }, [api]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const closing = sessionRef.current;
      sessionRef.current = null;
      void disconnectPresenceLiveKit()
        .catch(() => undefined)
        .then(() => closing?.sessionId && api ? api.closePresenceSession({ sessionId: closing.sessionId }).catch(() => undefined) : undefined);
    };
  }, [api]);

  const connect = async (): Promise<void> => {
    if (routeBinding && routeBinding.status !== "resolved") {
      setStatus(routeBinding.reason || "当前关系会话尚未完成唯一绑定");
      return;
    }
    if (!api || busy || !characterId) return;
    setBusy(true);
    setStatus("正在准备 Live…");
    let created: PresenceSession | null = null;
    try {
      created = await api.createPresenceSession({ characterId });
      if (!aliveRef.current) {
        await api.closePresenceSession({ sessionId: created.sessionId }).catch(() => undefined);
        return;
      }
      sessionRef.current = created;
      setSession(created);
      const connected = await connectPresenceLiveKit({ livekitUrl: created.livekitUrl, livekitToken: created.livekitToken });
      if (!aliveRef.current) {
        await disconnectPresenceLiveKit().catch(() => undefined);
        return;
      }
      setStatus(connected.audioPlaybackEnabled
        ? "已连接，实时形象正在陪伴"
        : "已连接，点击“开启声音”即可听到实时声音");
    } catch {
      const closing = sessionRef.current || created;
      sessionRef.current = null;
      if (aliveRef.current) setSession(null);
      await disconnectPresenceLiveKit().catch(() => undefined);
      if (closing?.sessionId) await api.closePresenceSession({ sessionId: closing.sessionId }).catch(() => undefined);
      if (aliveRef.current) setStatus("连接失败，请检查实时陪伴运行环境");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus("正在结束 Live…");
    const closing = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    try {
      await disconnectPresenceLiveKit();
      if (api && closing?.sessionId) await api.closePresenceSession({ sessionId: closing.sessionId });
      setStatus("已断开实时陪伴");
    } catch {
      setStatus("断开失败，请稍后重试");
    } finally { setBusy(false); }
  };

  const enableAudio = async (): Promise<void> => {
    try {
      const next = await startPresenceAudioPlayback();
      setStatus(next.audioPlaybackEnabled ? "声音已开启" : "系统仍阻止声音播放，请再次点击开启声音");
    } catch {
      setStatus("声音播放暂不可用");
    }
  };

  const routeReady = routeBinding === undefined || routeBinding.status === "resolved";
  const ready = health.available === true
    && health.characterCatalogAvailable === true
    && characters.length > 0
    && routeReady;
  const livePhase = liveKit.state === "reconnecting"
    ? "reconnecting"
    : liveKit.state === "connected"
      ? "live"
      : liveKit.state === "connecting" || status === "正在准备 Live…"
        ? "connecting"
        : liveKit.state === "disconnected" && !session && status === "已断开实时陪伴"
          ? "ended"
          : "ready";
  const livePhaseLabel = livePhase === "reconnecting"
    ? "断线恢复"
    : livePhase === "live"
      ? "Live 中"
      : livePhase === "connecting"
        ? "连接中"
        : livePhase === "ended"
          ? "已结束"
          : "准备开始";
  const livePhaseDetail = livePhase === "reconnecting"
    ? "连接正在自动恢复，请保持窗口开启。"
    : livePhase === "live"
      ? "实时形象、声音与当前关系会话保持绑定。"
      : livePhase === "connecting"
        ? "正在建立实时会话并连接互动空间。"
        : livePhase === "ended"
          ? "Live 已结束；聊天时间线与输入草稿保持原样。"
          : "选择形象后开始当前关系的 Live。";
  return (
    <aside
      className="yance-presence-workspace yance-presence-workspace--m01"
      aria-label="Live 实时互动"
      data-live-phase={livePhase}
      data-yance-route-bound={routeReady || undefined}
      data-yance-no-character-fail-closed={characters.length === 0 || undefined}
    >
      <header className="presence-live-header">
        <div><strong>Live</strong><span>当前关系 · 实时互动</span></div>
        <span className={ready ? "presence-health ready" : "presence-health degraded"}>{ready ? "能力已就绪" : "能力暂不可用"}</span>
      </header>

      <section className="presence-live-state" aria-label={livePhaseLabel}>
        <div className="presence-live-stage">
          <div ref={mediaHostRef} className="presence-media" aria-label="实时形象画面" />
          {liveKit.state !== "connected" && liveKit.state !== "reconnecting" ? (
            <div className="presence-live-placeholder" aria-hidden="true">
              <span>{characters.find((row) => row.id === characterId)?.name?.slice(0, 1) || "Y"}</span>
            </div>
          ) : null}
          {livePhase === "reconnecting" ? (
            <div className="presence-live-recovery" role="status"><strong>断线恢复</strong><span>正在恢复实时连接…</span></div>
          ) : null}
        </div>

        <div className="presence-live-copy">
          <span className="presence-live-phase">{livePhaseLabel}</span>
          <h3>{livePhase === "live" ? "Live 正在进行" : livePhase === "ended" ? "Live 已结束" : livePhase === "reconnecting" ? "正在恢复 Live" : livePhase === "connecting" ? "正在进入 Live" : "准备开始 Live"}</h3>
          <p>{livePhaseDetail}</p>
          <p className="presence-status" aria-live="polite">{status}</p>
        </div>

        {(livePhase === "ready" || livePhase === "ended") ? (
          <label className="presence-character" title="形象">形象
            <select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || Boolean(session) || !characters.length}>
              {characters.length
                ? characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)
                : <option value="">暂无已配置形象</option>}
            </select>
          </label>
        ) : null}

        <div className="presence-actions" aria-label="Live 控制">
          {(livePhase === "ready" || livePhase === "ended") ? (
            <button type="button" className="presence-primary" title="连接" onClick={() => void connect()} disabled={busy || Boolean(session) || !ready || !characterId}>
              {livePhase === "ended" ? "再次开始" : "开始 Live"}
            </button>
          ) : null}
          {liveKit.state === "connected" && !liveKit.audioPlaybackEnabled ? <button type="button" onClick={() => void enableAudio()}>开启声音</button> : null}
          <button type="button" title="麦克风" onClick={() => void setPresenceMicrophoneEnabled(!liveKit.microphoneEnabled)} disabled={liveKit.state !== "connected"}>麦克风 · {liveKit.microphoneEnabled ? "开" : "关"}</button>
          <button type="button" title="摄像头" onClick={() => void setPresenceCameraEnabled(!liveKit.cameraEnabled)} disabled={liveKit.state !== "connected"}>摄像头 · {liveKit.cameraEnabled ? "开" : "关"}</button>
          {(livePhase === "live" || livePhase === "reconnecting" || livePhase === "connecting") ? (
            <button type="button" className="presence-danger" title="断开" onClick={() => void disconnect()} disabled={busy || !session}>结束 Live</button>
          ) : null}
        </div>
      </section>

      <dl className="presence-live-meta">
        <div><dt>实时连接</dt><dd>{connectionStateLabel(liveKit.state)}</dd></div>
        <div><dt>参与人数</dt><dd>{liveKit.participants}</dd></div>
        <div><dt>会话</dt><dd>{session?.sessionId ? "已创建" : livePhase === "ended" ? "已结束" : "未连接"}</dd></div>
      </dl>
    </aside>
  );
}
