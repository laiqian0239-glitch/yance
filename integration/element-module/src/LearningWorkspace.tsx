import React, { useEffect, useMemo, useState } from "react";
import "./LearningWorkspace.css";
import { learningAssistantRuntime, type LearningCoachAction, type LearningProposalResult } from "./learningAssistantRuntime";
import { LearningCoachQuestion, LearningProposalApproval, LearningRunProgress } from "./LearningToolUiAdapter";

const SURFACES = [
  { id: "Overview", label: "概览" },
  { id: "Daily Review", label: "每日回顾" },
  { id: "Learning Coach", label: "学习教练" },
  { id: "Evidence", label: "证据" },
  { id: "Proposals", label: "提案" },
  { id: "Experiments", label: "实验" },
  { id: "Rollout", label: "灰度发布" },
  { id: "Promotion", label: "晋级" },
  { id: "Rollback", label: "回滚" },
  { id: "Privacy", label: "隐私" },
  { id: "Consent", label: "同意" }
] as const;

type Surface = (typeof SURFACES)[number]["id"];

const COACH_ACTIONS: Array<{ action: LearningCoachAction; label: string; description: string }> = [
  { action: "propose_persona_change", label: "人物画像提案", description: "基于证据提出需要人工审核的人物画像调整。" },
  { action: "propose_relationship_policy_change", label: "关系策略提案", description: "提出需要人工审核的关系互动策略调整。" },
  { action: "propose_regression_case", label: "回归案例", description: "把一次成功或失败转成可复用的评估案例。" },
  { action: "propose_prompt_program_change", label: "回复策略提案", description: "提出先经过回归与影子评估的候选调整。" },
  { action: "propose_tomorrow_journey", label: "明日关系计划", description: "提出需要人工审核的下一步关系目标调整。" }
];

function resultTitle(result: LearningProposalResult | null): string {
  if (!result) return "提案尚未生成";
  const proposal = result.proposal || {};
  return String(proposal.title || "学习提案已生成，等待审核");
}

export function LearningWorkspace(): React.JSX.Element {
  const [surface, setSurface] = useState<Surface>("Overview");
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({ available: false });
  const [selectedAction, setSelectedAction] = useState<LearningCoachAction>("propose_regression_case");
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [status, setStatus] = useState("正在加载学习能力");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LearningProposalResult | null>(null);
  const [doNotLearn, setDoNotLearn] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void learningAssistantRuntime.snapshot().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setStatus(next.available === false ? "学习能力暂不可用" : "学习能力已就绪");
    }).catch(() => {
      if (!cancelled) setStatus("学习能力暂不可用");
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => COACH_ACTIONS.find((item) => item.action === selectedAction) || COACH_ACTIONS[0], [selectedAction]);
  const selectedSurface = useMemo(() => SURFACES.find((item) => item.id === surface) || SURFACES[0], [surface]);

  const invoke = async (): Promise<void> => {
    if (busy || !title.trim() || !hypothesis.trim()) return;
    setBusy(true);
    setProposal(null);
    try {
      const result = await learningAssistantRuntime.invoke({
        action: selectedAction,
        title: title.trim(),
        hypothesis: hypothesis.trim(),
        candidate: { doNotLearn, consent },
        evidence: { source: "Learning Workspace", summary: hypothesis.trim() }
      });
      setProposal(result);
      setStatus(result.approvalRequired === false ? "提案返回，但缺少预期的审核边界" : "提案已生成，等待明确审核");
    } catch {
      setStatus("学习教练暂不可用");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-learning-workspace" aria-label="学习控制">
      <header>
        <div><strong>学习控制</strong><span>证据 → 候选 → 回归 → 影子评估 → 审核后发布</span></div>
        <span className="learning-status" aria-live="polite">{status}</span>
      </header>

      <nav aria-label="学习控制页面">
        {SURFACES.map((item) => (
          <button key={item.id} type="button" title={item.id} aria-pressed={surface === item.id} onClick={() => setSurface(item.id)}>{item.label}</button>
        ))}
      </nav>

      <section aria-label={selectedSurface.label}>
        <h3>{selectedSurface.label}</h3>
        {surface === "Overview" ? (
          <dl className="learning-grid">
            <div><dt>证据</dt><dd>最小化记录、评分与实验证据</dd></div>
            <div><dt>优化</dt><dd>从证据生成可审核候选</dd></div>
            <div><dt>评估</dt><dd>冻结回归集与预计算结果</dd></div>
            <div><dt>灰度发布</dt><dd>分阶段、可离线回退的发布决策</dd></div>
            <div><dt>学习教练</dt><dd>只创建可审核提案，不直接修改权威数据</dd></div>
            <div><dt>运行状态</dt><dd>{snapshot.available === false ? "暂不可用" : "已就绪"}</dd></div>
          </dl>
        ) : null}

        {surface === "Daily Review" ? (
          <LearningRunProgress id="learning-daily-review" steps={[
            { id: "evidence", label: "收集最小化证据", status: "completed" },
            { id: "evaluate", label: "执行回归评估", status: "in-progress" },
            { id: "review", label: "晋级前人工审核", status: "pending" }
          ]} />
        ) : null}

        {surface === "Learning Coach" ? (
          <div className="learning-coach">
            <LearningCoachQuestion
              id="learning-coach-action"
              title="希望学习教练提出什么？"
              description="学习教练只能创建待审核提案，不能直接修改产品权威数据。"
              options={COACH_ACTIONS.map((item) => ({ id: item.action, label: item.label, description: item.description }))}
              onSelect={(ids) => { const next = ids[0] as LearningCoachAction | undefined; if (next) setSelectedAction(next); }}
            />
            <label>提案标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></label>
            <label>证据 / 假设<textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={5} maxLength={4000} /></label>
            <button type="button" disabled={busy || !title.trim() || !hypothesis.trim()} onClick={() => void invoke()}>{busy ? "正在创建提案…" : `创建${selected.label}`}</button>
            {proposal ? <LearningProposalApproval id="learning-proposal-review" title={resultTitle(proposal)} description="任何权威数据发生变化前都必须明确审核。" /> : null}
          </div>
        ) : null}

        {surface === "Evidence" ? <p>这里展示经过最小化处理的追踪、评分、数据集、实验与版本证据。</p> : null}
        {surface === "Proposals" ? <p>证据支持的提案会保持待审核状态；创建提案不会直接修改人物画像、关系目标、关系图谱或模型权威。</p> : null}
        {surface === "Experiments" ? <p>候选调整必须先通过冻结回归数据评估，再进入影子使用。</p> : null}
        {surface === "Rollout" ? <p>灰度发布由现有特性开关权威分阶段执行，并保留离线回退能力。</p> : null}
        {surface === "Promotion" ? <p>晋级必须同时具备证据、回归通过、影子证据和明确批准。</p> : null}
        {surface === "Rollback" ? <p>回滚恢复到最后一个已批准配置，不重写历史学习证据。</p> : null}
        {surface === "Privacy" ? (
          <label className="learning-toggle"><input type="checkbox" checked={doNotLearn} onChange={(event) => setDoNotLearn(event.target.checked)} />不要从这段关系 / 会话中学习</label>
        ) : null}
        {surface === "Consent" ? (
          <label className="learning-toggle"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />同意将最小化证据用于本地学习评估</label>
        ) : null}
      </section>
    </aside>
  );
}
