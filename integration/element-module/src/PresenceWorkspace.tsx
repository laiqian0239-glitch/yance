import React, { useEffect, useMemo, useState } from "react";
import "./PresenceWorkspace.css";
import {
  connectPresenceLiveKit,
  disconnectPresenceLiveKit,
  getPresenceLiveKitSnapshot,
  setPresenceCameraEnabled,
  setPresenceMicrophoneEnabled,
  subscribePresenceLiveKit,
  type PresenceLiveKitSnapshot,
} from "./presenceLiveKit";

type PresenceSession = Readonly<{ sessionId: string; livekitUrl: string; livekitToken: string }>;
type PresenceHealth = Readonly<{ available?: boolean; degraded?: boolean; reasonCode?: string; endpoint?: string }>;
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

export function PresenceWorkspace(): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [health, setHealth] = useState<PresenceHealth>({ degraded: true, reasonCode: "unavailable" });
  const [session, setSession] = useState<PresenceSession | null>(null);
  const [liveKit, setLiveKit] = useState<PresenceLiveKitSnapshot>(getPresenceLiveKitSnapshot());
  const [avatarId, setAvatarId] = useState("flash-head");
  const [status, setStatus] = useState("Presence unavailable");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePresenceLiveKit(setLiveKit), []);
  useEffect(() => {
    if (!api) return;
    api.getPresenceHealth().then((next) => {
      setHealth(next);
      setStatus(next.available ? "CyberVerse ready · LiveKit disconnected" : `Degraded · ${next.reasonCode || "unavailable"}`);
    }).catch((error) => setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "unavailable")}`));
  }, [api]);
  useEffect(() => () => { void disconnectPresenceLiveKit(); }, []);

  const connect = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const next = await api.createPresenceSession({ avatarId });
      setSession(next);
      await connectPresenceLiveKit({ livekitUrl: next.livekitUrl, livekitToken: next.livekitToken });
      setStatus("Connected · CyberVerse avatar is streaming through LiveKit");
    } catch (error) {
      setSession(null);
      await disconnectPresenceLiveKit().catch(() => undefined);
      setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "connection unavailable")}`);
    } finally { setBusy(false); }
  };

  const disconnect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const closing = session;
    setSession(null);
    try {
      await disconnectPresenceLiveKit();
      if (api && closing?.sessionId) await api.closePresenceSession({ sessionId: closing.sessionId });
      setStatus("Disconnected");
    } catch (error) {
      setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "disconnect unavailable")}`);
    } finally { setBusy(false); }
  };

  return (
    <aside className="yance-presence-workspace" aria-label="Presence Workspace">
      <header>
        <div><strong>Presence</strong><span>CyberVerse avatar · LiveKit realtime media</span></div>
        <span className={health.available ? "presence-health ready" : "presence-health degraded"}>{health.available ? "Ready" : "Degraded"}</span>
      </header>
      <p className="presence-status" aria-live="polite">{status}</p>
      <label>Avatar
        <select value={avatarId} onChange={(event) => setAvatarId(event.target.value)} disabled={busy || Boolean(session)}>
          <option value="flash-head">SoulX FlashHead</option>
        </select>
      </label>
      <div className="presence-actions">
        <button type="button" onClick={() => void connect()} disabled={busy || Boolean(session)}>Connect</button>
        <button type="button" onClick={() => void disconnect()} disabled={busy || !session}>Disconnect</button>
        <button type="button" onClick={() => void setPresenceMicrophoneEnabled(!liveKit.microphoneEnabled)} disabled={liveKit.state !== "connected"}>Microphone · {liveKit.microphoneEnabled ? "On" : "Off"}</button>
        <button type="button" onClick={() => void setPresenceCameraEnabled(!liveKit.cameraEnabled)} disabled={liveKit.state !== "connected"}>Camera · {liveKit.cameraEnabled ? "On" : "Off"}</button>
      </div>
      <dl>
        <div><dt>LiveKit</dt><dd>{liveKit.state}</dd></div>
        <div><dt>Participants</dt><dd>{liveKit.participants}</dd></div>
        <div><dt>Session</dt><dd>{session?.sessionId || "disconnected"}</dd></div>
      </dl>
    </aside>
  );
}
