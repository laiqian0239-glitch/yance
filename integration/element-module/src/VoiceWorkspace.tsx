import React, { useEffect, useMemo, useState } from "react";
import type { RelationshipToolRouteBinding } from "./product-experience/RelationshipOverlayHost";
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
  createdAt?: string;
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
  listVoiceProfiles: () => Promise<VoiceProfile[]>;
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
    || typeof desktop.transcribeVoiceAudio !== "function"
    || typeof desktop.enrollVoiceProfile !== "function"
    || typeof desktop.listVoiceProfiles !== "function"
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
  managementOnly = false,
}: { routeBinding?: RelationshipToolRouteBinding; managementOnly?: boolean }): React.JSX.Element {
  const [health, setHealth] = useState<VoiceHealth>({ available: false, degraded: true });
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
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
  const standaloneMode = !managementOnly && routeBinding === undefined;
  const resolvedRoute = productRouteResolved ? routeBinding.route : null;

  const api = useMemo(() => voiceApi(), []);

  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setStatus("本地语音能力暂不可用");
      return () => { cancelled = true; };
    }
    void Promise.allSettled([api.getVoiceBrainHealth(), api.listVoiceProfiles()]).then(([healthResult, profileResult]) => {
      if (cancelled) return;
      const nextHealth = healthResult.status === "fulfilled" ? healthResult.value : { available: false, degraded: true };
      const savedProfiles = profileResult.status === "fulfilled" && Array.isArray(profileResult.value) ? profileResult.value : [];
      setHealth(nextHealth || { available: false, degraded: true });
      setProfiles(savedProfiles);
      setProfile(savedProfiles[0] || null);
      if (!nextHealth?.available) {
        setStatus("本地语音能力暂不可用，请检查运行环境");
      } else if (savedProfiles.length) {
        setStatus(`本地语音能力已就绪，已恢复 ${savedProfiles.length} 个声音档案`);
      } else {
        setStatus("本地语音能力已就绪，尚未录入声音档案");
      }
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
      setProfiles((current) => [next, ...current.filter((item) => item.voiceProfileId !== next.voiceProfileId)]);
      setProfile(next);
      setOutput(null);
      setStatus("声音录入完成，档案已持久保存在本机");
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
      const remaining = profiles.filter((item) => item.voiceProfileId !== profile.voiceProfileId);
      setProfiles(remaining);
      setProfile(remaining[0] || null);
      setOutput(null);
      setStatus("声音样本已从本机删除");
    } catch {
      setStatus("删除声音样本失败");
    } finally {
      setBusy(false);
    }
  };

  const transcribe = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    setStatus("请选择要转写的语音文件");
    try {
      const result = await api.transcribeVoiceAudio({ language, translateToChinese: false });
      if (result.cancelled === true) {
        setStatus("已取消语音转写");
        return;
      }
      const transcript = String(result.transcript || result.text || "").trim();
      if (!transcript) {
        setStatus("没有识别到可用文字");
        return;
      }
      setReplyText(transcript);
      setStatus("语音已转写到回复内容");
    } catch {
      setStatus("语音转写暂不可用");
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
    if (managementOnly) { setStatus("设置页只管理声音；请从真实对话进入后发送。"); return; }
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

  const routeReady = managementOnly ? false : standaloneMode ? Boolean(accountId.trim() && chatJid.trim()) : productRouteResolved;
  const routeBoundMiniFlow = !managementOnly && routeBinding !== undefined;
  const voicePhase = status === "声音已交给现有发送通道"
    ? "sent"
    : busy && status.includes("重新生成")
      ? "regenerating"
      : busy && (status.includes("生成声音") || status.includes("测试声音"))
        ? "generating"
        : output
          ? "preview"
          : "select";
  const voicePhaseLabel = voicePhase === "sent"
    ? "真实会话发送"
    : voicePhase === "regenerating"
      ? "重新生成"
      : voicePhase === "generating"
        ? "生成中"
        : voicePhase === "preview"
          ? "试听 / 可发送"
          : "选择我的声音";

  if (routeBoundMiniFlow) {
    return (
      <section
        className="yance-voice-workspace yance-voice-workspace--m02"
        aria-label="我的声音"
        data-voice-phase={voicePhase}
        data-yance-route-bound={productRouteResolved || undefined}
      >
        <header className="yance-voice-mini-header">
          <div>
            <strong>我的声音</strong>
            <p>当前文字 → 选择声音 → 生成 → 试听 → 真实会话发送</p>
          </div>
          <span className="yance-voice-mini-phase">{voicePhaseLabel}</span>
        </header>

        <div className="yance-voice-mini-flow">
          <label className="yance-voice-current-text">
            <span>当前文字</span>
            <textarea
              value={replyText}
              maxLength={20000}
              rows={2}
              onChange={(event) => {
                setReplyText(event.target.value);
                setOutput(null);
              }}
              placeholder="输入要转换成声音的当前文字；真实输入框保持不变。"
              disabled={busy}
            />
          </label>

          <div className="yance-voice-mini-controls">
            <label>声音档案
              <select
                value={profile?.voiceProfileId || ""}
                onChange={(event) => {
                  const next = profiles.find((item) => item.voiceProfileId === event.target.value) || null;
                  setProfile(next);
                  setOutput(null);
                }}
                disabled={busy || profiles.length === 0}
              >
                {profiles.length === 0 ? <option value="">尚未录入</option> : null}
                {profiles.map((item) => <option key={item.voiceProfileId} value={item.voiceProfileId}>{item.label || item.voiceProfileId}</option>)}
              </select>
            </label>
            <label>语言
              <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
                {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          {voicePhase === "generating" || voicePhase === "regenerating" ? (
            <div className="yance-voice-generating" role="status">
              <progress aria-label={voicePhaseLabel} />
              <span>{voicePhase === "regenerating" ? "正在重新生成声音…" : "正在生成声音…"}</span>
            </div>
          ) : null}

          {output ? (
            <div className="yance-voice-preview" aria-label="声音预览">
              <div><strong>试听</strong><span>已生成 · {output.language || language}</span></div>
              {output.previewDataUrl ? <audio controls preload="metadata" src={output.previewDataUrl} /> : <p>声音已生成；当前运行时未提供内联试听地址。</p>}
            </div>
          ) : null}

          <div className="yance-voice-mini-actions">
            {!output ? (
              <button type="button" className="yance-voice-primary" onClick={() => { void generate("generate"); }} disabled={busy || !profile || !replyText.trim() || !health.available}>
                生成我的声音
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { void generate("regenerate"); }} disabled={busy || !profile || !replyText.trim()}>重新生成</button>
                <button type="button" className="yance-voice-primary" title="真实会话发送" onClick={() => { void send(); }} disabled={busy || !routeReady}>发送</button>
              </>
            )}
          </div>

          <footer className="yance-voice-mini-footer">
            <span aria-live="polite">{status}</span>
            <span>{productRouteResolved ? "已绑定当前关系会话" : routeBinding?.reason || "当前关系会话路由不可用"}</span>
          </footer>
        </div>
      </section>
    );
  }

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
          <label title="语言">
            语言
            <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            已保存声音档案
            <select
              value={profile?.voiceProfileId || ""}
              onChange={(event) => {
                const next = profiles.find((item) => item.voiceProfileId === event.target.value) || null;
                setProfile(next);
                setOutput(null);
              }}
              disabled={busy || profiles.length === 0}
            >
              {profiles.length === 0 ? <option value="">尚未录入</option> : null}
              {profiles.map((item) => <option key={item.voiceProfileId} value={item.voiceProfileId}>{item.label || item.voiceProfileId}</option>)}
            </select>
          </label>
          <div className="yance-voice-actions">
            <button type="button" title="录入声音" onClick={() => { void enroll(); }} disabled={busy}>录入声音</button>
            <button type="button" title="删除声音档案" onClick={() => { void deleteProfile(); }} disabled={busy || !profile}>删除</button>
          </div>
          <dl>
            <dt>声音档案</dt><dd>{profile?.label || profile?.voiceProfileId || "尚未录入"}</dd>
            <dt>隐私</dt><dd>{profile ? "仅本机持久保存" : "没有保存声音样本"}</dd>
            <dt>语音识别</dt><dd>{health.available ? "本地引擎" : "暂不可用"}</dd>
            <dt>语音合成</dt><dd>{health.available ? "本地引擎" : "暂不可用"}</dd>
          </dl>
        </fieldset>

        <fieldset>
          <legend>语音识别与智能回复转声音</legend>
          <div className="yance-voice-actions">
            <button type="button" onClick={() => { void transcribe(); }} disabled={busy || !health.available}>转写语音文件</button>
          </div>
          <label>
            回复内容
            <textarea
              value={replyText}
              maxLength={20000}
              rows={5}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder="输入、粘贴，或先转写语音文件，再用你的声音生成回复。"
            />
          </label>
          <div className="yance-voice-actions">
            <button type="button" title="生成声音" onClick={() => { void generate("generate"); }} disabled={busy || !profile || !replyText.trim()}>生成</button>
            <button type="button" title="测试声音" onClick={() => { void generate("test"); }} disabled={busy || !profile}>测试声音</button>
            <button type="button" title="重新生成声音" onClick={() => { void generate("regenerate"); }} disabled={busy || !profile || !replyText.trim()}>重新生成</button>
          </div>
          <div title="声音预览">
            <strong>预览</strong>
            {output?.previewDataUrl ? <audio controls preload="metadata" src={output.previewDataUrl} /> : <p>还没有可预览的声音。</p>}
          </div>
        </fieldset>

        {managementOnly ? (
          <aside className="yance-voice-management-boundary">
            <strong>管理模式</strong>
            <p>这里仅管理声音档案、转写、生成与预览。真实发送只能从已绑定对话进入。</p>
          </aside>
        ) : (
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
              <p role="status" aria-live="polite">{productRouteResolved ? "已绑定当前关系会话" : routeBinding?.reason || "当前关系会话路由不可用"}</p>
            )}
            <button type="button" title="发送声音" onClick={() => { void send(); }} disabled={busy || !output || !routeReady}>发送</button>
          </fieldset>
        )}
      </div>
    </section>
  );
}
