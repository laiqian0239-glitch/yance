import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearPersonaScope,
  diffPersonaVersions,
  initializeDefaultPersona,
  listPersonaProfiles,
  listPersonaScopes,
  listPersonaVersions,
  loadPersonaCurrent,
  previewPersonaCharacterCard,
  rollbackPersona,
  setPersonaScope,
  updatePersonaAuthoritative,
} from "./experienceProjection";
import type { PersonaProfileProjection, RelationshipProjection } from "./experienceTypes";

type Row = Record<string, unknown>;
type VersionRow = { version: number; operation: string; createdAt: string; contentSha256: string };
type Props = { relationships: readonly RelationshipProjection[] };

const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(asRow) : [];
function activeVersionOf(value: unknown): number {
  const root = asRow(value), profile = asRow(root.profile), version = asRow(root.version);
  const raw = profile.activeVersion ?? version.version;
  return Number.isInteger(Number(raw)) ? Number(raw) : 0;
}
function normalizeVersions(value: readonly Record<string, unknown>[]): VersionRow[] {
  return value.map((row) => ({
    version: Number(row.version || 0),
    operation: text(row.operation) || "version",
    createdAt: text(row.createdAt),
    contentSha256: text(row.contentSha256),
  })).filter((row) => row.version > 0);
}
function scopeLabel(row: Row): string {
  const type = text(row.scopeType);
  if (type === "global") return "全局默认人格";
  if (type === "contact") return "联系人绑定";
  if (type === "conversation") return "本次对话覆盖";
  return type || "范围";
}
function operationLabel(value: string): string {
  if (value === "create") return "创建";
  if (value === "update") return "更新";
  if (value === "replace-authoritative") return "更新确认内容";
  if (value === "learn") return "学习更新";
  if (value === "rollback") return "回滚";
  if (value === "migrate") return "迁移";
  if (value === "import") return "导入";
  return "版本更新";
}
function versionLabel(row: VersionRow): string {
  return `v${row.version} · ${operationLabel(row.operation)}${row.createdAt ? ` · ${row.createdAt.slice(0, 10)}` : ""}`;
}
export function PersonaManagement({ relationships }: Props): React.JSX.Element {
  const [profiles, setProfiles] = useState<readonly PersonaProfileProjection[]>([]);
  const [profileId, setProfileId] = useState("");
  const [current, setCurrent] = useState<Row>({});
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [bindings, setBindings] = useState<Row[]>([]);
  const [newId, setNewId] = useState("");
  const [contactId, setContactId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [fromVersion, setFromVersion] = useState(0);
  const [toVersion, setToVersion] = useState(0);
  const [diff, setDiff] = useState<Row>({});
  const [preview, setPreview] = useState<Row>({});
  const [cardBytes, setCardBytes] = useState<ArrayBuffer | null>(null);
  const [rollbackArmed, setRollbackArmed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在读取人格资料…");
  const activeVersion = activeVersionOf(current);
  const conversations = useMemo(() => relationships.find((row) => row.id === contactId)?.conversations || [], [relationships, contactId]);
  const refresh = useCallback(async (prefer = profileId): Promise<void> => {
    const nextProfiles = await listPersonaProfiles();
    const selected = nextProfiles.find((row) => row.id === prefer)?.id || nextProfiles[0]?.id || "";
    setProfiles(nextProfiles); setProfileId(selected);
    const nextBindings = rows(await listPersonaScopes({ limit: 200 }));
    setBindings(nextBindings);
    if (!selected) {
      setCurrent({}); setVersions([]); setStatus("还没有人格；可以新建一个默认人格。");
      return;
    }
    const [nextCurrent, nextVersions] = await Promise.all([loadPersonaCurrent(selected), listPersonaVersions(selected)]);
    const normalized = normalizeVersions(nextVersions);
    setCurrent(nextCurrent); setVersions(normalized);
    if (!fromVersion && normalized[1]) setFromVersion(normalized[1].version);
    if (!toVersion && normalized[0]) setToVersion(normalized[0].version);
    setStatus("人格状态已同步");
  }, [fromVersion, profileId, toVersion]);

  useEffect(() => {
    let active = true;
    refresh("").catch((error) => active && setStatus(error instanceof Error ? error.message : "人格服务暂不可用"));
    return () => { active = false; };
  }, []);
  const run = async (work: () => Promise<void>, pending: string, done: string): Promise<void> => {
    if (busy) return;
    setBusy(true); setStatus(pending);
    try { await work(); setStatus(done); }
    catch (error) { setStatus(error instanceof Error ? error.message : "人格操作失败"); }
    finally { setBusy(false); }
  };

  const createProfile = (): void => {
    const id = newId.trim().replace(/\s+/gu, "-");
    if (!id) { setStatus("请输入新人格 ID。"); return; }
    void run(async () => {
      await initializeDefaultPersona(id);
      setNewId(""); await refresh(id);
    }, "正在创建人格…", "新人格已创建");
  };
  const bind = (scopeType: "global" | "contact" | "conversation", scopeId: string): void => {
    if (!profileId || !scopeId) return;
    void run(async () => { await setPersonaScope(scopeType, scopeId, profileId); await refresh(profileId); },
      "正在更新人格范围…", "人格范围已更新");
  };
  const clear = (scopeType: "global" | "contact" | "conversation", scopeId: string): void => {
    if (!scopeId) return;
    void run(async () => { await clearPersonaScope(scopeType, scopeId); await refresh(profileId); },
      "正在清除覆盖…", "覆盖已清除");
  };
  const chooseCard = async (file: File | null): Promise<void> => {
    setPreview({}); setCardBytes(null);
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const next = await previewPersonaCharacterCard(bytes);
      setCardBytes(bytes); setPreview(next as unknown as Row);
      setStatus(next.ok ? "Character Card 预览已通过校验" : "Character Card 校验未通过");
    } catch { setStatus("Character Card 读取失败"); }
  };
  const applyCard = (): void => {
    const card = asRow(preview.characterCard);
    if (!profileId || !cardBytes || !Object.keys(card).length) return;
    const postHistoryInstructions = text(card.postHistoryInstructions);
    const characterCard = {
      ...card,
      characterNote: { content: postHistoryInstructions, depth: 4, role: "system" },
    };
    void run(async () => {
      await updatePersonaAuthoritative(profileId, { personaProfile: { characterCard } }, activeVersion || undefined);
      await refresh(profileId);
    }, "正在应用 Character Card…", "Character Card 已写入当前人格新版本");
  };
  const compare = (): void => {
    if (!profileId || !fromVersion || !toVersion || fromVersion === toVersion) return;
    void run(async () => { setDiff(await diffPersonaVersions(profileId, fromVersion, toVersion)); },
      "正在比较版本…", "人格对比已完成");
  };
  const rollback = (target: number): void => {
    if (!profileId || !target) return;
    if (rollbackArmed !== target) {
      setRollbackArmed(target); setStatus(`再次点击回滚确认恢复到 v${target}；当前版本不会被静默覆盖。`); return;
    }
    void run(async () => {
      await rollbackPersona(profileId, target, activeVersion || undefined);
      setRollbackArmed(0); await refresh(profileId);
    }, `正在回滚到 v${target}…`, `已回滚到 v${target}，并生成新的审计版本`);
  };
  const diffPayload = asRow(diff.diff);
  const changedPaths = Array.isArray(diffPayload.changedPaths) ? diffPayload.changedPaths.map(text).filter(Boolean) : [];

  return <section className="yance-persona-v4" aria-label="人格管理">
    <header className="yance-persona-v4__hero">
      <div><span className="yance-eyebrow">人格</span><h3>人格管理</h3>
        <p>全局默认、联系人绑定和本次对话覆盖都使用现有人格系统；这里不建立第二套人格状态。</p></div>
      <span className="yance-persona-v4__status" role="status">{status}</span>
    </header>
    <div className="yance-persona-v4__grid">
      <aside className="yance-persona-v4__profiles">
        <header><strong>人格库</strong><span>{profiles.length} 个</span></header>
        <div>{profiles.map((profile) => <button type="button" key={profile.id}
          aria-current={profile.id === profileId ? "page" : undefined}
          onClick={() => void refresh(profile.id)}><strong>{profile.name || profile.id}</strong><small>{profile.id}</small></button>)}</div>
        <section className="yance-persona-v4__create"><strong>新建人格</strong>
          <input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="例如 warm-mature" />
          <button type="button" disabled={busy || !newId.trim()} onClick={createProfile}>创建默认人格</button>
        </section>
      </aside>

      <main className="yance-persona-v4__main">
        <section className="yance-persona-v4__scope">
          <header><strong>作用范围</strong><span>当前人格：{profileId || "未选择"}</span></header>
          <article><div><strong>全局默认人格</strong><small>没有局部覆盖时使用</small></div>
            <div><button type="button" disabled={busy || !profileId} onClick={() => bind("global", "default")}>设为全局默认</button>
            <button type="button" disabled={busy} onClick={() => clear("global", "default")}>清除覆盖</button></div></article>
          <article><div><strong>联系人绑定</strong><small>只影响选中的真实联系人</small></div>
            <select value={contactId} onChange={(event) => { setContactId(event.target.value); setConversationId(""); }}>
              <option value="">选择联系人</option>{relationships.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select><div><button type="button" disabled={busy || !contactId || !profileId} onClick={() => bind("contact", contactId)}>绑定当前人格</button>
            <button type="button" disabled={busy || !contactId} onClick={() => clear("contact", contactId)}>清除覆盖</button></div></article>
          <article><div><strong>本次对话覆盖</strong><small>只覆盖当前真实会话</small></div>
            <select value={conversationId} disabled={!contactId} onChange={(event) => setConversationId(event.target.value)}>
              <option value="">选择真实对话</option>{conversations.map((row) => <option key={row.id} value={row.id}>{row.title || row.platform || row.id}</option>)}
            </select><div><button type="button" disabled={busy || !conversationId || !profileId} onClick={() => bind("conversation", conversationId)}>应用临时覆盖</button>
            <button type="button" disabled={busy || !conversationId} onClick={() => clear("conversation", conversationId)}>清除覆盖</button></div></article>
          <div className="yance-persona-v4__bindings">{bindings.slice(0, 12).map((row, index) =>
            <span key={text(row.scopeType)+text(row.scopeId)+index}>{scopeLabel(row)} · {text(row.scopeId)} → {text(row.profileId)}</span>)}</div>
        </section>
        <section className="yance-persona-v4__card">
          <header><div><strong>Character Card</strong><small>PNG / JSON 会先完成安全校验，再写入人格版本。</small></div></header>
          <input type="file" accept="image/png,.png,application/json,.json" onChange={(event) => void chooseCard(event.currentTarget.files?.[0] || null)} />
          {Object.keys(preview).length ? <div className="yance-persona-v4__preview">
            <strong>{text(preview.name) || "未命名 Character Card"}</strong><p>{text(preview.description) || "没有描述"}</p>
            <span>{preview.ok === true ? "预览通过" : "预览未通过"}</span>
            <button type="button" disabled={busy || preview.ok !== true || !profileId} onClick={applyCard}>应用到当前人格</button>
          </div> : null}
        </section>

        <section className="yance-persona-v4__truth">
          <strong>事实边界</strong>
          <p>人格只影响表达，不会改写人物事实。Character Card、风格与情境提示不能成为联系人事实来源。</p>
          <p>单次反馈不会永久修改人格；稳定偏好必须经过现有学习证据与版本治理。</p>
        </section>
      </main>
      <aside className="yance-persona-v4__versions">
        <header><strong>版本历史</strong><span>当前 v{activeVersion || "—"}</span></header>
        <section className="yance-persona-v4__compare"><strong>人格对比</strong>
          <select value={fromVersion || ""} onChange={(event) => setFromVersion(Number(event.target.value))}><option value="">来源版本</option>{versions.map((row) => <option key={row.version} value={row.version}>{versionLabel(row)}</option>)}</select>
          <select value={toVersion || ""} onChange={(event) => setToVersion(Number(event.target.value))}><option value="">目标版本</option>{versions.map((row) => <option key={row.version} value={row.version}>{versionLabel(row)}</option>)}</select>
          <button type="button" disabled={busy || !fromVersion || !toVersion || fromVersion === toVersion} onClick={compare}>比较版本</button>
          {changedPaths.length ? <div className="yance-persona-v4__diff"><strong>变化路径</strong>{changedPaths.slice(0, 20).map((path) => <span key={path}>{path}</span>)}</div> : null}
        </section>
        <div className="yance-persona-v4__version-list">{versions.map((row) => <article key={row.version}>
          <div><strong>v{row.version}</strong><small>{operationLabel(row.operation)}</small></div>
          <button type="button" disabled={busy || row.version === activeVersion}
            data-armed={rollbackArmed === row.version || undefined} onClick={() => rollback(row.version)}>
            {rollbackArmed === row.version ? "确认回滚" : "回滚"}
          </button>
        </article>)}</div>
      </aside>
    </div>
  </section>;
}
