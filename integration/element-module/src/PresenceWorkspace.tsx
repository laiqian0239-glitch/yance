import React, { useEffect, useMemo, useRef, useState } from "react";
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

export function PresenceWorkspace(): React.JSX.Element {
  const api = useMemo(() => desktopApi(), []);
  const [health, setHealth] = useState<PresenceHealth>({ degraded: true, reasonCode: "unavailable" });
  const [characters, setCharacters] = useState<readonly PresenceCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [session, setSession] = useState<PresenceSession | null>(null);
  const sessionRef = useRef<PresenceSession | null>(null);
  const aliveRef = useRef(true);
  const [liveKit, setLiveKit] = useState<PresenceLiveKitSnapshot>(getPresenceLiveKitSnapshot());
  const [status, setStatus] = useState("Presence unavailable");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribePresenceLiveKit(setLiveKit), []);
  useEffect(() => {
    if (!api) return;
    api.getPresenceHealth().then((next) => {
      if (!aliveRef.current) return;
      const nextCharacters = Array.isArray(next.characters) ? next.characters : [];
      setHealth(next);
      setCharacters(nextCharacters);
      setCharacterId((current) => current && nextCharacters.some((row) => row.id === current) ? current : nextCharacters[0]?.id || "");
      if (!next.available) setStatus(`Degraded · ${next.reasonCode || "unavailable"}`);
      else if (!next.characterCatalogAvailable) setStatus("Degraded · CyberVerse Character catalog unavailable");
      else if (!nextCharacters.length) setStatus("CyberVerse ready · create a Character with an avatar image before connecting");
      else setStatus("CyberVerse ready · LiveKit disconnected");
    }).catch((error) => {
      if (aliveRef.current) setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "unavailable")}`);
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
      await connectPresenceLiveKit({ livekitUrl: created.livekitUrl, livekitToken: created.livekitToken });
      if (!aliveRef.current) {
        await disconnectPresenceLiveKit().catch(() => undefined);
        return;
      }
      setStatus("Connected · CyberVerse avatar is streaming through LiveKit");
    } catch (error) {
      const closing = sessionRef.current || created;
      sessionRef.current = null;
      if (aliveRef.current) setSession(null);
      await disconnectPresenceLiveKit().catch(() => undefined);
      if (closing?.sessionId) await api.closePresenceSession({ sessionId: closing.sessionId }).catch(() => undefined);
      if (aliveRef.current) setStatus(`Degraded · ${String((error as { reasonCode?: string })?.reasonCode || "connection unavailable")}`);
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
      setStatus("Disconnected");
    } catch (error) {
      setStatus(`Degraded · ${String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || "disconnect unavailable")}`);
    } finally { setBusy(false); }
  };

  const ready = health.available === true && health.characterCatalogAvailable === true && characters.length > 0;
  return (
    <aside className="yance-presence-workspace" aria-label="Presence Workspace">
      <header>
        <div><strong>Presence</strong><span>CyberVerse Character · SoulX FlashHead backend · LiveKit realtime media</span></div>
        <span className={ready ? "presence-health ready" : "presence-health degraded"}>{ready ? "Ready" : "Degraded"}</span>
      </header>
      <p className="presence-status" aria-live="polite">{status}</p>
      <label>CyberVerse Character
        <select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || Boolean(session) || !characters.length}>
          {characters.length
            ? characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)
            : <option value="">No configured Characters</option>}
        </select>
      </label>
      <div className="presence-actions">
        <button type="button" onClick={() => void connect()} disabled={busy || Boolean(session) || !ready || !characterId}>Connect</button>
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
