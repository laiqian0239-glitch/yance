import React, { useEffect, useMemo, useState } from "react";
import {
  createAiWorkspaceTask,
  getProductModelRuntimeState,
  loadAiWorkspace,
  runAiWorkspaceTask,
  updateAiWorkspaceTask,
} from "./experienceProjection";
import type { RelationshipProjection } from "./experienceTypes";

type Row = Record<string, unknown>;
type AiTask = {
  id: string; title: string; prompt: string; contactIds: string[];
  timeRangeDays: number; resultLimit: number; modelId: string;
  reasoningStrength: string; includeRealConversation: boolean;
  includeSharedMoments: boolean; includeMemoryOpenLoops: boolean;
  includeGoals: boolean; citeSources: boolean; distinguishFacts: boolean;
  saved: boolean; lastRunStatus: string; lastResult?: AiResult;
};
type AiRanked = { contactId: string; name: string; reason: string; signals: string[]; evidenceRefs: string[]; conversationId: string };
type AiResult = { summary: string; ranked: AiRanked[]; modelId: string; model: string; completedAt: string };
type Props = {
  relationships: readonly RelationshipProjection[];
  onClose: () => void;
  onOpenRelationship: (contactId: string) => void;
  onOpenConversation: (contactId: string, conversationId: string) => void;
};

const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(asRow) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const bool = (value: unknown, fallback = true): boolean => typeof value === "boolean" ? value : fallback;
const num = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeResult(value: unknown): AiResult | undefined {
  const row = asRow(value);
  if (!Object.keys(row).length) return undefined;
  return {
    summary: text(row.summary),
    ranked: rows(row.ranked).map((item) => ({
      contactId: text(item.contactId), name: text(item.name), reason: text(item.reason),
      signals: strings(item.signals), evidenceRefs: strings(item.evidenceRefs),
      conversationId: text(item.conversationId),
    })).filter((item) => item.contactId),
    modelId: text(row.modelId), model: text(row.model), completedAt: text(row.completedAt),
  };
}

function normalizeTask(value: unknown): AiTask {
  const row = asRow(value);
  return {
    id: text(row.id), title: text(row.title) || "新的 AI 任务", prompt: text(row.prompt),
    contactIds: strings(row.contactIds), timeRangeDays: num(row.timeRangeDays, 7),
    resultLimit: num(row.resultLimit, 5), modelId: text(row.modelId),
    reasoningStrength: text(row.reasoningStrength) || "medium",
    includeRealConversation: bool(row.includeRealConversation),
    includeSharedMoments: bool(row.includeSharedMoments),
    includeMemoryOpenLoops: bool(row.includeMemoryOpenLoops),
    includeGoals: bool(row.includeGoals), citeSources: bool(row.citeSources),
    distinguishFacts: bool(row.distinguishFacts), saved: row.saved === true,
    lastRunStatus: text(row.lastRunStatus), lastResult: normalizeResult(row.lastResult),
  };
}
function modelRows(value: unknown): Row[] {
  const root = asRow(value);
  const brain = asRow(root.modelBrain);
  const candidates = [root.catalog, brain.catalog, asRow(root.projection).catalog]
    .flatMap((value) => rows(value));
  const seen = new Set<string>();
  return candidates.filter((row) => {
    const modelId = text(row.id || row.modelId);
    if (!modelId || seen.has(modelId)) return false;
    if (row.enabled === false || row.verified === false) return false;
    seen.add(modelId);
    return true;
  });
}

function emptyDraft(): AiTask {
  return {
    id: "", title: "新的 AI 任务", prompt: "", contactIds: [], timeRangeDays: 7,
    resultLimit: 5, modelId: "", reasoningStrength: "medium",
    includeRealConversation: true, includeSharedMoments: true,
    includeMemoryOpenLoops: true, includeGoals: true, citeSources: true,
    distinguishFacts: true, saved: false, lastRunStatus: "",
  };
}

export function AIWorkspace({ relationships, onClose, onOpenRelationship, onOpenConversation }: Props): React.JSX.Element {
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AiTask>(emptyDraft);
  const [runtime, setRuntime] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在读取 AI 工作台…");
  const models = useMemo(() => modelRows(runtime), [runtime]);
  const result = draft.lastResult;

  const reload = async (preferId = ""): Promise<void> => {
    const [workspace, modelState] = await Promise.all([loadAiWorkspace(), getProductModelRuntimeState()]);
    const nextTasks = rows(workspace.tasks).map(normalizeTask);
    setTasks(nextTasks); setRuntime(modelState);
    const selected = nextTasks.find((task) => task.id === (preferId || selectedId)) || nextTasks[0] || null;
    if (selected) { setSelectedId(selected.id); setDraft(selected); }
    else { setSelectedId(""); setDraft(emptyDraft()); }
    setStatus(nextTasks.length ? "任务已同步" : "还没有保存的 AI 任务");
  };

  useEffect(() => {
    let active = true;
    Promise.all([loadAiWorkspace(), getProductModelRuntimeState()]).then(([workspace, modelState]) => {
      if (!active) return;
      const nextTasks = rows(workspace.tasks).map(normalizeTask);
      setTasks(nextTasks); setRuntime(modelState);
      if (nextTasks[0]) { setSelectedId(nextTasks[0].id); setDraft(nextTasks[0]); }
      setStatus(nextTasks.length ? "任务已同步" : "新建一个任务开始分析");
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "AI 工作台暂不可用"));
    return () => { active = false; };
  }, []);

  const selectTask = (task: AiTask): void => { setSelectedId(task.id); setDraft(task); };
  const setField = <K extends keyof AiTask>(key: K, value: AiTask[K]): void => setDraft((current) => ({ ...current, [key]: value }));
  const toggleContact = (id: string): void => setField("contactIds", draft.contactIds.includes(id)
    ? draft.contactIds.filter((value) => value !== id) : [...draft.contactIds, id]);

  const save = async (): Promise<string> => {
    setBusy(true); setStatus("正在保存任务…");
    try {
      const payload = { ...draft, lastResult: undefined, lastRunStatus: undefined };
      const response = draft.id ? await updateAiWorkspaceTask(draft.id, payload) : await createAiWorkspaceTask(payload);
      const task = normalizeTask(asRow(response).task);
      await reload(task.id);
      setStatus("任务已保存");
      return task.id;
    } finally { setBusy(false); }
  };

  const run = async (): Promise<void> => {
    setBusy(true); setStatus("正在使用真实关系上下文运行…");
    try {
      let id = draft.id;
      if (!id) {
        const response = await createAiWorkspaceTask({ ...draft, saved: true });
        id = normalizeTask(asRow(response).task).id;
      } else {
        await updateAiWorkspaceTask(id, { ...draft, saved: true, lastResult: undefined });
      }
      const response = await runAiWorkspaceTask(id);
      const nextResult = normalizeResult(asRow(response).result);
      await reload(id);
      if (nextResult) setDraft((current) => ({ ...current, id, lastResult: nextResult, lastRunStatus: "completed" }));
      setStatus("分析完成；结果只作为分析，不会自动升级为事实");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 分析失败");
    } finally { setBusy(false); }
  };

  return <section className="yance-ai-workspace-v4" aria-label="AI 工作台">
    <aside className="yance-ai-workspace-v4__tasks">
      <header><div><span className="yance-eyebrow">AI Workspace</span><h2>AI 工作台</h2></div><button type="button" onClick={onClose}>关闭</button></header>
      <button type="button" className="yance-button-primary" onClick={() => { setSelectedId(""); setDraft(emptyDraft()); }}>＋ 新建 AI 任务</button>
      <div className="yance-ai-workspace-v4__task-list">
        {tasks.map((task) => <button key={task.id} type="button" aria-current={task.id === selectedId ? "page" : undefined} onClick={() => selectTask(task)}>
          <strong>{task.title}</strong><span>{task.lastRunStatus || "未运行"} · {task.reasoningStrength}</span>
        </button>)}
      </div>
    </aside>

    <main className="yance-ai-workspace-v4__main">
      <header><div><span className="yance-eyebrow">跨关系分析</span><h2>{draft.title || "新的 AI 任务"}</h2>
        <p>从真实联系人、真实对话与现有关系洞察读取证据。</p></div>
        <div><button type="button" disabled={busy} onClick={() => void save()}>保存任务</button>
        <button type="button" className="yance-button-primary" disabled={busy || !draft.prompt.trim()} onClick={() => void run()}>{result ? "重新运行" : "运行任务"}</button></div>
      </header>
      <label>任务名称<input value={draft.title} onChange={(event) => setField("title", event.target.value)} /></label>
      <label>分析目标<textarea rows={4} value={draft.prompt} onChange={(event) => setField("prompt", event.target.value)} placeholder="例如：最近 7 天哪些关系值得继续投入？为什么？" /></label>
      <section className="yance-ai-workspace-v4__result" aria-live="polite">
        <header><h3>分析结果</h3><span>{status}</span></header>
        {result ? <>
          <p>{result.summary || "模型返回了可信联系人结果。"}</p>
          <div className="yance-ai-workspace-v4__ranked">
            {result.ranked.map((item) => <article key={item.contactId}>
              <header><strong>{item.name || relationships.find((row) => row.id === item.contactId)?.name || item.contactId}</strong><span>{item.signals.join(" · ")}</span></header>
              <p>{item.reason}</p>
              {item.evidenceRefs.length ? <small>证据：{item.evidenceRefs.join(" · ")}</small> : <small>没有可引用的消息证据</small>}
              <div><button type="button" onClick={() => onOpenRelationship(item.contactId)}>打开关系世界</button>
              {item.conversationId ? <button type="button" onClick={() => onOpenConversation(item.contactId, item.conversationId)}>打开真实对话</button> : null}</div>
            </article>)}
          </div>
        </> : <div className="yance-v4-empty"><strong>等待运行</strong><span>结果会映射回真实联系人，并过滤无法验证的联系人与证据。</span></div>}
      </section>
      <footer className="yance-ai-workspace-v4__boundary">
        <strong>安全边界</strong><span>不会直接发送消息</span><span>不会把分析自动升级为事实</span>
      </footer>
    </main>

    <aside className="yance-ai-workspace-v4__settings">
      <header><span className="yance-eyebrow">Context</span><h3>任务上下文</h3></header>
      <fieldset><legend>联系人范围</legend>
        <label><input type="checkbox" checked={!draft.contactIds.length} onChange={() => setField("contactIds", [])} />全部真实联系人</label>
        <div className="yance-ai-workspace-v4__contacts">{relationships.map((relationship) => <label key={relationship.id}>
          <input type="checkbox" checked={draft.contactIds.includes(relationship.id)} onChange={() => toggleContact(relationship.id)} />{relationship.name}
        </label>)}</div>
      </fieldset>
      <label>时间范围<select value={draft.timeRangeDays} onChange={(event) => setField("timeRangeDays", Number(event.target.value))}>
        <option value={1}>最近 1 天</option><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option>
      </select></label>
      <label>结果数量<input type="number" min={1} max={10} value={draft.resultLimit} onChange={(event) => setField("resultLimit", Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
      <label>模型<select value={draft.modelId} onChange={(event) => setField("modelId", event.target.value)}>
        <option value="">使用当前真实路由</option>{models.map((model) => { const modelId = text(model.id || model.modelId); return <option key={modelId} value={modelId}>{text(model.name || model.label || modelId)} · verified</option>; })}
      </select></label>
      <label>推理强度<select value={draft.reasoningStrength} onChange={(event) => setField("reasoningStrength", event.target.value)}>
        <option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="very_high">很高</option>
      </select></label>
      {([
        ["includeRealConversation", "真实对话"],
        ["includeSharedMoments", "共享时刻"],
        ["includeMemoryOpenLoops", "确认记忆与未完成事项"],
        ["includeGoals", "关系目标"],
        ["citeSources", "引用来源"],
        ["distinguishFacts", "区分事实与趋势"],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={(event) => setField(key, event.target.checked)} />{label}</label>)}
      <small>模型列表来自当前已验证配置；模型与推理强度会随任务保存。</small>
    </aside>
  </section>;
}
