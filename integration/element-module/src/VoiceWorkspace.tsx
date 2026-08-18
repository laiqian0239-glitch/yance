import React, { useEffect, useMemo, useState } from "react";
import type { RelationshipToolRouteBinding } from "./product-experience/RelationshipOverlayHost";
import "./VoiceWorkspace.css";

type VoiceHealth = {
  available?: boolean;
  degraded?: boolean;
  localPrivateProfiles?: boolean;
  reasonCode?: string;
  authorities?: { asr?: string; tts?: string };
};

type VoiceProfile = {
  voiceProfileId: string;
  label?: string;
  sampleLanguage?: string;
  local?: boolean;
  private?: boolean;
  cancelled?: boolean;
};

type VoiceOutput = {
  audioArtifact: string;
  mimeType: string;
  duration: number;
  sampleRate: number;
  language: string;
  voiceProfileId: string;
  provenance: { authority?: string; mode?: string };
  previewDataUrl?: string;
};

type VoiceDesktopApi = {
  getVoiceBrainHealth: () => Promise<VoiceHealth>;
  transcribeVoiceAudio: (input?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  enrollVoiceProfile: (input?: Record<string, unknown>) => Promise<VoiceProfile>;
  deleteVoiceProfile: (input: { voiceProfileId: string }) => Promise<{ deleted?: boolean }>;
  generateVoiceSpeech: (input: { voiceProfileId: string; text: string; language: string }) => Promise<VoiceOutput>;
  sendVoiceArtifact: (input: {
    platform: string;
    accountId: string;
    chatJid: string;
    sessionKey?: string;
    audioArtifact: string;
    filename?: string;
    caption?: string;
  }) => Promise<Record<string, unknown>>;
};

function voiceApi(): VoiceDesktopApi | null {
  const desktop = (window as unknown as { yanceDesktop?: Partial<VoiceDesktopApi> }).yanceDesktop;
  if (!desktop
    || typeof desktop.getVoiceBrainHealth !== "function"
    || typeof desktop.enrollVoiceProfile !== "function"
    || typeof desktop.deleteVoiceProfile !== "function"
    || typeof desktop.generateVoiceSpeech !== "function"
    || typeof desktop.sendVoiceArtifact !== "function") return null;
  return desktop as VoiceDesktopApi;
}

const LANGUAGES = [
  ["auto", "Auto"],
  ["zh", "Chinese"],
  ["en", "English"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["yue", "Cantonese"]
] as const;

export function VoiceWorkspace({
  routeBinding,
}: { routeBinding?: RelationshipToolRouteBinding }): React.JSX.Element {
  const [health, setHealth] = useState<VoiceHealth>({ available: false, degraded: true });
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [language, setLanguage] = useState("auto");
  const [replyText, setReplyText] = useState("");
  const [output, setOutput] = useState<VoiceOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Checking local Voice runtime");
  const [platform, setPlatform] = useState("whatsapp");
  const [accountId, setAccountId] = useState("");
  const [chatJid, setChatJid] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const productRouteResolved = routeBinding?.status === "resolved";
  const standaloneMode = routeBinding === undefined;
  const resolvedRoute = productRouteResolved ? routeBinding.route : null;

  const api = useMemo(() => voiceApi(), []);

  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setStatus("Voice runtime unavailable: desktop bridge missing");
      return () => { cancelled = true; };
    }
    void api.getVoiceBrainHealth().then((next) => {
      if (cancelled) return;
      setHealth(next || { available: false, degraded: true });
      setStatus(next?.available ? "Ready · local/private voice profile" : `Degraded · ${next?.reasonCode || "Voice runtime/model missing"}`);
    }).catch((error) => {
      if (!cancelled) setStatus(`Unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "VOICE_RUNTIME_UNAVAILABLE")}`);
    });
    return () => { cancelled = true; };
  }, [api]);

  const enroll = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const next = await api.enrollVoiceProfile({ label: "My voice", language });
      if (next?.cancelled) {
        setStatus("Enroll cancelled");
        return;
      }
      setProfile(next);
      setOutput(null);
      setStatus(`Enrolled · ${next.local && next.private ? "local/private" : "local profile"}`);
    } catch (error) {
      setStatus(`Enroll unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "VOICE_ENROLL_FAILED")}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteProfile = async (): Promise<void> => {
    if (!api || !profile?.voiceProfileId || busy) return;
    setBusy(true);
    try {
      await api.deleteVoiceProfile({ voiceProfileId: profile.voiceProfileId });
      setProfile(null);
      setOutput(null);
      setStatus("Delete complete · local/private sample removed");
    } catch (error) {
      setStatus(`Delete failed · ${String((error as { reasonCode?: string })?.reasonCode || "VOICE_DELETE_FAILED")}`);
    } finally {
      setBusy(false);
    }
  };

  const generate = async (mode: "generate" | "regenerate" | "test"): Promise<void> => {
    const text = mode === "test" ? (replyText.trim() || "This is a local Yance voice test.") : replyText.trim();
    if (!api || !profile?.voiceProfileId || !text || busy) return;
    setBusy(true);
    setStatus(mode === "regenerate" ? "Regenerating with CosyVoice" : mode === "test" ? "Testing voice with CosyVoice" : "Generating with CosyVoice");
    try {
      const next = await api.generateVoiceSpeech({
        voiceProfileId: profile.voiceProfileId,
        text,
        language
      });
      setOutput(next);
      setStatus(`Preview ready · ${next.provenance?.authority || "CosyVoice"} · ${next.language || language}`);
    } catch (error) {
      setOutput(null);
      setStatus(`Generation unavailable · ${String((error as { reasonCode?: string })?.reasonCode || "COSYVOICE_RUNTIME_MISSING")}`);
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    if (!api || !output?.audioArtifact || busy) return;
    if (routeBinding && routeBinding.status !== "resolved") {
      setStatus(`Send failed · ${routeBinding.reason || "current relationship route unresolved"}`);
      return;
    }
    const sendPlatform = resolvedRoute?.platform || platform;
    const sendAccountId = resolvedRoute?.accountId || accountId.trim();
    const sendChatJid = resolvedRoute?.chatJid || chatJid.trim();
    const sendSessionKey = resolvedRoute?.sessionKey || sessionKey.trim();
    if (!sendAccountId || !sendChatJid) return;
    setBusy(true);
    setStatus("Sending through existing media authority");
    try {
      await api.sendVoiceArtifact({
        platform: sendPlatform,
        accountId: sendAccountId,
        chatJid: sendChatJid,
        sessionKey: sendSessionKey,
        audioArtifact: output.audioArtifact,
        filename: "yance-voice-reply.wav"
      });
      setStatus("Send accepted by existing send-media-stream authority");
    } catch (error) {
      setStatus(`Send failed · ${String((error as { reasonCode?: string })?.reasonCode || "VOICE_SEND_FAILED")}`);
    } finally {
      setBusy(false);
    }
  };

  const routeReady = standaloneMode ? Boolean(accountId.trim() && chatJid.trim()) : productRouteResolved;

  return (
    <section className="yance-voice-workspace" aria-label="Voice">
      <header>
        <div>
          <strong>Voice</strong>
          <p>SenseVoice ASR · CosyVoice cloned speech · local/private profile</p>
        </div>
        <output aria-live="polite" data-degraded={health.degraded === true}>{status}</output>
      </header>

      <div className="yance-voice-grid">
        <fieldset>
          <legend>My voice</legend>
          <label>
            Language
            <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="yance-voice-actions">
            <button type="button" onClick={() => { void enroll(); }} disabled={busy}>Enroll</button>
            <button type="button" onClick={() => { void deleteProfile(); }} disabled={busy || !profile}>Delete</button>
          </div>
          <dl>
            <dt>Profile</dt><dd>{profile?.voiceProfileId || "Not enrolled"}</dd>
            <dt>Privacy</dt><dd>{profile ? "Local/private" : "No sample stored"}</dd>
            <dt>ASR</dt><dd>{health.authorities?.asr || "SenseVoice"}</dd>
            <dt>TTS</dt><dd>{health.authorities?.tts || "CosyVoice"}</dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>AI reply → cloned voice</legend>
          <label>
            Reply text
            <textarea
              value={replyText}
              maxLength={20000}
              rows={5}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder="Paste or compose the AI reply to speak in your cloned voice."
            />
          </label>
          <div className="yance-voice-actions">
            <button type="button" onClick={() => { void generate("generate"); }} disabled={busy || !profile || !replyText.trim()}>Generate</button>
            <button type="button" onClick={() => { void generate("test"); }} disabled={busy || !profile}>Test voice</button>
            <button type="button" onClick={() => { void generate("regenerate"); }} disabled={busy || !profile || !replyText.trim()}>Regenerate</button>
          </div>
          <div>
            <strong>Preview</strong>
            {output?.previewDataUrl ? <audio controls preload="metadata" src={output.previewDataUrl} /> : <p>No generated preview yet.</p>}
          </div>
        </fieldset>

        <fieldset>
          <legend>Send</legend>
          {standaloneMode ? (
            <>
              <label>Platform
                <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="facebook">Facebook</option>
                </select>
              </label>
              <label>Account ID<input value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
              <label>Chat JID<input value={chatJid} onChange={(event) => setChatJid(event.target.value)} /></label>
              <label>Session key<input value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} /></label>
            </>
          ) : (
            <p role="status" aria-live="polite">
              {productRouteResolved ? "已绑定当前关系会话" : routeBinding?.reason || "当前关系会话路由不可用"}
            </p>
          )}
          <button type="button" onClick={() => { void send(); }} disabled={busy || !output || !routeReady}>Send</button>
        </fieldset>
      </div>
    </section>
  );
}
