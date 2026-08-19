import React, { useEffect, useMemo, useRef, useState } from "react";
import "./PresenceWorkspace.css";
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
  return "未连接";
}

export function PresenceWorkspace(): React.JSX.Element {
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
    if (!api || busy || !characterId) return;
    setBusy(true);
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
      setStatus(next.audioPlaybackEnabled ? "声音已开启" : "浏览器仍阻止声音播放，请再次点击开启声音");
    } catch {
      setStatus("声音播放暂不可用");
    }
  };

  const ready = health.available === true && health.characterCatalogAvailable === true && characters.length > 0;
  return (
    <aside className="yance-presence-workspace" aria-label="实时陪伴">
      <header>
        <div><strong>实时陪伴</strong><span>实时形象 · 语音 · 摄像头</span></div>
        <span className={ready ? "presence-health ready" : "presence-health degraded"}>{ready ? "已就绪" : "暂不可用"}</span>
      </header>
      <div ref={mediaHostRef} className="presence-media" aria-label="实时形象画面" />
      {liveKit.state !== "connected" ? <p className="presence-media-placeholder">连接后，实时形象会显示在这里。</p> : null}
      <p className="presence-status" aria-live="polite">{status}</p>
      <label title="Avatar">形象
        <select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || Boolean(session) || !characters.length}>
          {characters.length
            ? characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)
            : <option value="">暂无已配置形象</option>}
        </select>
      </label>
      <div className="presence-actions">
        <button type="button" title="Connect" onClick={() => void connect()} disabled={busy || Boolean(session) || !ready || !characterId}>连接</button>
        <button type="button" title="Disconnect" onClick={() => void disconnect()} disabled={busy || !session}>断开</button>
        {liveKit.state === "connected" && !liveKit.audioPlaybackEnabled ? <button type="button" onClick={() => void enableAudio()}>开启声音</button> : null}
        <button type="button" title="Microphone" onClick={() => void setPresenceMicrophoneEnabled(!liveKit.microphoneEnabled)} disabled={liveKit.state !== "connected"}>麦克风 · {liveKit.microphoneEnabled ? "开" : "关"}</button>
        <button type="button" title="Camera" onClick={() => void setPresenceCameraEnabled(!liveKit.cameraEnabled)} disabled={liveKit.state !== "connected"}>摄像头 · {liveKit.cameraEnabled ? "开" : "关"}</button>
      </div>
      <dl>
        <div><dt>实时连接</dt><dd>{connectionStateLabel(liveKit.state)}</dd></div>
        <div><dt>参与人数</dt><dd>{liveKit.participants}</dd></div>
        <div><dt>会话</dt><dd>{session?.sessionId ? "已创建" : "未连接"}</dd></div>
      </dl>
    </aside>
  );
}
