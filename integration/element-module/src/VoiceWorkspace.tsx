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
  ["auto", "自动识别"],
  ["zh", "中文"],
  ["en", "英语"],
  ["de", "德语"],
  ["fr", "法语"],
  ["es", "西班牙语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["yue", "粤语"]
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
  const [status, setStatus] = useState("正在检查本地语音能力");
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
      setStatus("本地语音能力暂不可用");
      return () => { cancelled = true; };
    }
    void api.getVoiceBrainHealth().then((next) => {
      if (cancelled) return;
      setHealth(next || { available: false, degraded: true });
      setStatus(next?.available ? "本地语音能力已就绪，声音样本仅保存在本机" : "本地语音能力暂不可用，请检查运行环境");
    }).catch(() => {
      if (!cancelled) setStatus("本地语音能力暂不可用");
    });
    return () => { cancelled = true; };
  }, [api]);

  const enroll = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const next = await api.enrollVoiceProfile({ label: "我的声音", language });
      if (next?.cancelled) {
        setStatus("已取消声音录入");
        return;
      }
      setProfile(next);
      setOutput(null);
      setStatus("声音录入完成，样本仅保存在本机");
    } catch {
      setStatus("声音录入暂不可用");
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
      setStatus("声音样本已从本机删除");
    } catch {
      setStatus("删除声音样本失败");
    } finally {
      setBusy(false);
    }
  };

  const generate = async (mode: "generate" | "regenerate" | "test"): Promise<void> => {
    const text = mode === "test" ? (replyText.trim() || "这是一次本地声音测试。") : replyText.trim();
    if (!api || !profile?.voiceProfileId || !text || busy) return;
    setBusy(true);
    setStatus(mode === "regenerate" ? "正在重新生成声音" : mode === "test" ? "正在测试声音" : "正在生成声音");
    try {
      const next = await api.generateVoiceSpeech({
        voiceProfileId: profile.voiceProfileId,
        text,
        language
      });
      setOutput(next);
      setStatus("声音预览已就绪");
    } catch {
      setOutput(null);
      setStatus("声音生成暂不可用");
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    if (!api || !output?.audioArtifact || busy) return;
    if (routeBinding && routeBinding.status !== "resolved") {
      setStatus(routeBinding.reason || "当前关系会话路由不可用，暂时无法发送");
      return;
    }
    const sendPlatform = resolvedRoute?.platform || platform;
    const sendAccountId = resolvedRoute?.accountId || accountId.trim();
    const sendChatJid = resolvedRoute?.chatJid || chatJid.trim();
    const sendSessionKey = resolvedRoute?.sessionKey || sessionKey.trim();
    if (!sendAccountId || !sendChatJid) return;
    setBusy(true);
    setStatus("正在发送声音");
    try {
      await api.sendVoiceArtifact({
        platform: sendPlatform,
        accountId: sendAccountId,
        chatJid: sendChatJid,
        sessionKey: sendSessionKey,
        audioArtifact: output.audioArtifact,
        filename: "yance-voice-reply.wav"
      });
      setStatus("声音已交给现有发送通道");
    } catch {
      setStatus("声音发送失败");
    } finally {
      setBusy(false);
    }
  };

  const routeReady = standaloneMode ? Boolean(accountId.trim() && chatJid.trim()) : productRouteResolved;

  return (
    <section className="yance-voice-workspace" aria-label="声音">
      <header>
        <div>
          <strong>声音</strong>
          <p>本地语音识别与克隆语音 · 声音样本仅保存在本机</p>
        </div>
        <output aria-live="polite" data-degraded={health.degraded === true}>{status}</output>
      </header>

      <div className="yance-voice-grid">
        <fieldset>
          <legend>我的声音</legend>
          <label title="Language">
            语言
            <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="yance-voice-actions">
            <button type="button" title="Enroll" onClick={() => { void enroll(); }} disabled={busy}>录入声音</button>
            <button type="button" title="Delete" onClick={() => { void deleteProfile(); }} disabled={busy || !profile}>删除</button>
          </div>
          <dl>
            <dt>声音档案</dt><dd>{profile?.voiceProfileId || "尚未录入"}</dd>
            <dt>隐私</dt><dd>{profile ? "仅本机保存" : "没有保存声音样本"}</dd>
            <dt>语音识别</dt><dd>{health.available ? "本地引擎" : "暂不可用"}</dd>
            <dt>语音合成</dt><dd>{health.available ? "本地引擎" : "暂不可用"}</dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>智能回复转为你的声音</legend>
          <label>
            回复内容
            <textarea
              value={replyText}
              maxLength={20000}
              rows={5}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder="输入或粘贴要用你的声音说出的回复。"
            />
          </label>
          <div className="yance-voice-actions">
            <button type="button" title="Generate" onClick={() => { void generate("generate"); }} disabled={busy || !profile || !replyText.trim()}>生成</button>
            <button type="button" title="Test voice" onClick={() => { void generate("test"); }} disabled={busy || !profile}>测试声音</button>
            <button type="button" title="Regenerate" onClick={() => { void generate("regenerate"); }} disabled={busy || !profile || !replyText.trim()}>重新生成</button>
          </div>
          <div title="Preview">
            <strong>预览</strong>
            {output?.previewDataUrl ? <audio controls preload="metadata" src={output.previewDataUrl} /> : <p>还没有可预览的声音。</p>}
          </div>
        </fieldset>

        <fieldset>
          <legend>发送</legend>
          {standaloneMode ? (
            <>
              <label>平台
                <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="facebook">Facebook</option>
                </select>
              </label>
              <label>账号 ID<input value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
              <label>会话 JID<input value={chatJid} onChange={(event) => setChatJid(event.target.value)} /></label>
              <label>会话键<input value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} /></label>
            </>
          ) : (
            <p role="status" aria-live="polite">
              {productRouteResolved ? "已绑定当前关系会话" : routeBinding?.reason || "当前关系会话路由不可用"}
            </p>
          )}
          <button type="button" title="Send" onClick={() => { void send(); }} disabled={busy || !output || !routeReady}>发送</button>
        </fieldset>
      </div>
    </section>
  );
}
