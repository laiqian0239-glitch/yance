import React, { useEffect, useMemo, useState } from "react";
import "./LearningWorkspace.css";
import { learningAssistantRuntime, type LearningCoachAction, type LearningProposalResult } from "./learningAssistantRuntime";
import { LearningCoachQuestion } from "./LearningToolUiAdapter";

const SURFACES = [
  { id: "Overview", label: "概览" },
  { id: "Daily Review", label: "每日回顾" },
  { id: "Learning Coach", label: "学习教练" },
  { id: "Evidence", label: "证据边界" },
  { id: "Proposals", label: "提案边界" },
  { id: "Experiments", label: "实验边界" },
  { id: "Rollout", label: "灰度发布" },
  { id: "Promotion", label: "晋级状态" },
  { id: "Rollback", label: "回滚边界" },
  { id: "Privacy", label: "隐私" },
  { id: "Consent", label: "同意" }
] as const;

type Surface = (typeof SURFACES)[number]["id"];

const COACH_ACTIONS: Array<{ action: LearningCoachAction; label: string; description: string }> = [
  { action: "propose_persona_change", label: "人物画像提案", description: "基于证据生成需要人工审核的人物画像调整草案。" },
  { action: "propose_relationship_policy_change", label: "关系策略提案", description: "生成需要人工审核的关系互动策略草案。" },
  { action: "propose_regression_case", label: "回归案例", description: "把一次成功或失败整理成待审核的评估案例草案。" },
  { action: "propose_prompt_program_change", label: "回复策略提案", description: "生成先经过回归与影子评估的候选草案。" },
  { action: "propose_tomorrow_journey", label: "明日关系计划", description: "生成需要人工审核的下一步关系目标草案。" }
];

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resultTitle(result: LearningProposalResult | null): string {
  if (!result) return "提案草案尚未生成";
  const proposal = objectRecord(result.proposal);
  return String(proposal.title || "学习提案草案已生成");
}

export function LearningWorkspace(): React.JSX.Element {
  const [surface, setSurface] = useState<Surface>("Overview");
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({ available: false });
  const [selectedAction, setSelectedAction] = useState<LearningCoachAction>("propose_regression_case");
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [status, setStatus] = useState("正在读取学习策略状态");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LearningProposalResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void learningAssistantRuntime.snapshot().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setStatus(next.available === false ? "学习策略状态暂不可用" : "学习策略状态已从持久权威读取");
    }).catch(() => {
      if (!cancelled) setStatus("学习策略状态暂不可用");
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => COACH_ACTIONS.find((item) => item.action === selectedAction) || COACH_ACTIONS[0], [selectedAction]);
  const selectedSurface = useMemo(() => SURFACES.find((item) => item.id === surface) || SURFACES[0], [surface]);
  const activePolicy = objectRecord(snapshot.activePolicy);
  const policyMode = String(snapshot.mode || "baseline");
  const policyArtifactId = String(activePolicy.policyArtifactId || "");
  const policyVersion = String(activePolicy.policyVersion || "");
  const reasonCode = String(snapshot.reasonCode || objectRecord(activePolicy.degradation).reasonCode || "");

  const invoke = async (): Promise<void> => {
    if (busy || !title.trim() || !hypothesis.trim()) return;
    setBusy(true);
    setProposal(null);
    try {
      const result = await learningAssistantRuntime.invoke({
        action: selectedAction,
        title: title.trim(),
        hypothesis: hypothesis.trim(),
        candidate: {},
        evidence: { source: "Learning Workspace", summary: hypothesis.trim() }
      });
      setProposal(result);
      setStatus(result.mutationApplied === true
        ? "提案返回了不允许的直接修改状态"
        : "提案草案已生成；当前会话内可查看，未修改任何权威数据");
    } catch {
      setStatus("学习教练暂不可用");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-learning-workspace" aria-label="学习控制">
      <header>
        <div><strong>学习控制</strong><span>持久策略状态 → 可审核草案 → 正式权威另行批准</span></div>
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
            <div><dt>状态来源</dt><dd>{String(snapshot.authority || "LearningPolicyRuntimeAdapter")}</dd></div>
            <div><dt>当前模式</dt><dd>{policyMode === "promoted" ? "已晋级策略" : "基线策略"}</dd></div>
            <div><dt>重启恢复</dt><dd>{snapshot.restartRecoverable === true ? "由现有持久策略权威恢复" : "状态不可确认"}</dd></div>
            <div><dt>策略版本</dt><dd>{policyVersion || "基线"}</dd></div>
            <div><dt>学习教练</dt><dd>只生成当前会话的待审核草案，不直接修改权威数据</dd></div>
            <div><dt>运行状态</dt><dd>{snapshot.available === false ? "暂不可用" : reasonCode ? `已降级 · ${reasonCode}` : "已就绪"}</dd></div>
          </dl>
        ) : null}

        {surface === "Daily Review" ? (
          <dl className="learning-grid">
            <div><dt>策略模式</dt><dd>{policyMode === "promoted" ? "已晋级策略" : "基线策略"}</dd></div>
            <div><dt>策略标识</dt><dd>{policyArtifactId || "当前没有已晋级策略"}</dd></div>
            <div><dt>策略版本</dt><dd>{policyVersion || "基线"}</dd></div>
            <div><dt>持久化</dt><dd>{snapshot.durable === true ? "现有 Learning authority 持久化" : "不可确认"}</dd></div>
            <div><dt>恢复能力</dt><dd>{snapshot.restartRecoverable === true ? "重启后重新解析 active policy" : "不可确认"}</dd></div>
            <div><dt>降级原因</dt><dd>{reasonCode || "无"}</dd></div>
          </dl>
        ) : null}

        {surface === "Learning Coach" ? (
          <div className="learning-coach">
            <LearningCoachQuestion
              id="learning-coach-action"
              title="希望学习教练生成什么草案？"
              description="学习教练只生成当前会话的待审核草案；这里没有伪装成可执行的批准按钮，也不会直接修改产品权威数据。"
              options={COACH_ACTIONS.map((item) => ({ id: item.action, label: item.label, description: item.description }))}
              onSelect={(ids) => { const next = ids[0] as LearningCoachAction | undefined; if (next) setSelectedAction(next); }}
            />
            <label>草案标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></label>
            <label>证据 / 假设<textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={5} maxLength={4000} /></label>
            <button type="button" disabled={busy || !title.trim() || !hypothesis.trim()} onClick={() => void invoke()}>{busy ? "正在生成草案…" : `生成${selected.label}草案`}</button>
            {proposal ? (
              <div role="status" aria-live="polite">
                <strong>{resultTitle(proposal)}</strong>
                <p>此草案只保留在当前工作区会话中；当前没有持久审批队列，因此不会显示可误导用户的“批准 / 拒绝”操作。</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {surface === "Evidence" ? <p>当前 Product 不提供伪造的证据浏览器。证据仍由既有 Learning 证据与评估权威保存；未接真实投影前这里只说明边界。</p> : null}
        {surface === "Proposals" ? <p>当前 Product 只生成当前会话草案；仓库尚无正式持久审批队列，因此不会把草案伪装成已持久化提案。</p> : null}
        {surface === "Experiments" ? <p>实验、冻结回归与影子评估继续由既有 Learning pipeline 执行；当前 Product 没有独立实验控制权威。</p> : null}
        {surface === "Rollout" ? <p>{policyMode === "promoted" ? `当前持久 active policy：${policyArtifactId || policyVersion || "已晋级"}` : "当前没有已晋级 active policy，运行在基线策略。"}</p> : null}
        {surface === "Promotion" ? <p>{policyMode === "promoted" ? "当前已有经过既有权威晋级的策略；本界面只读显示，不提供伪造的晋级按钮。" : "当前没有已晋级策略；晋级仍由既有治理/评估流程负责。"}</p> : null}
        {surface === "Rollback" ? <p>回滚由现有 OpenFeature/flagd rollout history 与已批准 artifact 负责；Product 只读投影，不另建回滚状态。</p> : null}
        {surface === "Privacy" ? <p>当前没有会话级持久化“不要学习”设置 authority，因此本界面不展示会在重启后丢失的假开关。</p> : null}
        {surface === "Consent" ? <p>当前没有会话级持久化 Learning consent authority，因此本界面不展示只存在于 React state 的假同意开关。</p> : null}
      </section>
    </aside>
  );
}
