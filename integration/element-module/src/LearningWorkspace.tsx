import React, { useEffect, useMemo, useState } from "react";
import { learningAssistantRuntime, type LearningCoachAction, type LearningProposalResult } from "./learningAssistantRuntime";
import { LearningCoachQuestion } from "./LearningToolUiAdapter";

const SURFACES = [
  { id: "Overview", label: "概览" },
  { id: "Daily Review", label: "每日回顾" },
  { id: "Learning Coach", label: "学习教练" },
  { id: "Privacy", label: "隐私与数据" }
] as const;

type Surface = (typeof SURFACES)[number]["id"];

const COACH_ACTIONS: Array<{ action: LearningCoachAction; label: string; description: string }> = [
  { action: "propose_persona_change", label: "人物理解建议", description: "根据最近的互动，整理你可能需要更新的人物理解。" },
  { action: "propose_relationship_policy_change", label: "关系互动建议", description: "结合关系变化，给出更合适的互动方式建议。" },
  { action: "propose_regression_case", label: "一次经历复盘", description: "复盘一次顺利或不顺利的互动，提炼以后可参考的经验。" },
  { action: "propose_prompt_program_change", label: "回复方式建议", description: "根据你的目标，给出更合适的回复方式建议。" },
  { action: "propose_tomorrow_journey", label: "明日关系计划", description: "整理明天最值得做的一两件关系行动。" }
];

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resultTitle(result: LearningProposalResult | null): string {
  if (!result) return "学习建议尚未生成";
  const proposal = objectRecord(result.proposal);
  return String(proposal.title || "学习建议已生成");
}

export function LearningWorkspace(): React.JSX.Element {
  const [surface, setSurface] = useState<Surface>("Overview");
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({ available: false });
  const [selectedAction, setSelectedAction] = useState<LearningCoachAction>("propose_regression_case");
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [status, setStatus] = useState("正在同步学习状态");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LearningProposalResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void learningAssistantRuntime.snapshot().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setStatus(next.available === false ? "学习服务暂不可用" : "学习状态已同步");
    }).catch(() => {
      if (!cancelled) setStatus("学习服务暂不可用");
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => COACH_ACTIONS.find((item) => item.action === selectedAction) || COACH_ACTIONS[0], [selectedAction]);
  const selectedSurface = useMemo(() => SURFACES.find((item) => item.id === surface) || SURFACES[0], [surface]);
  const activePolicy = objectRecord(snapshot.activePolicy);
  const policyMode = String(snapshot.mode || "baseline");
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
        ? "本次建议无法安全生成"
        : "学习建议已生成；重要资料不会被自动修改");
    } catch {
      setStatus("学习教练暂不可用");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-learning-workspace" aria-label="学习与成长">
      <header>
        <div><strong>学习与成长</strong><span>回顾关系变化，获得下一步建议，并由你决定哪些内容值得采用。</span></div>
        <span className="learning-status" aria-live="polite">{status}</span>
      </header>

      <nav aria-label="学习与成长页面">
        {SURFACES.map((item) => (
          <button key={item.id} type="button" title={item.label} aria-pressed={surface === item.id} onClick={() => setSurface(item.id)}>{item.label}</button>
        ))}
      </nav>

      <section aria-label={selectedSurface.label}>
        <h3>{selectedSurface.label}</h3>
        {surface === "Overview" ? (
          <dl className="learning-grid">
            <div><dt>学习状态</dt><dd>{snapshot.available === false ? "暂不可用" : "已就绪"}</dd></div>
            <div><dt>当前方式</dt><dd>{policyMode === "promoted" ? "个性化学习" : "基础学习"}</dd></div>
            <div><dt>下次启动</dt><dd>{snapshot.restartRecoverable === true ? "会继续保留当前学习状态" : "等待状态确认"}</dd></div>
            <div><dt>学习版本</dt><dd>{policyVersion || "默认"}</dd></div>
            <div><dt>学习教练</dt><dd>根据对话和关系变化生成建议，由你决定是否采用</dd></div>
            <div><dt>服务状态</dt><dd>{snapshot.available === false ? "暂不可用" : reasonCode ? "部分能力暂时受限" : "运行正常"}</dd></div>
          </dl>
        ) : null}

        {surface === "Daily Review" ? (
          <dl className="learning-grid">
            <div><dt>今日学习方式</dt><dd>{policyMode === "promoted" ? "个性化学习" : "基础学习"}</dd></div>
            <div><dt>当前学习版本</dt><dd>{policyVersion || "默认"}</dd></div>
            <div><dt>保存状态</dt><dd>{snapshot.durable === true ? "已保存" : "等待确认"}</dd></div>
            <div><dt>下次启动</dt><dd>{snapshot.restartRecoverable === true ? "会继续当前学习状态" : "等待状态确认"}</dd></div>
            <div><dt>学习建议</dt><dd>需要时可以进入学习教练，生成下一步建议</dd></div>
            <div><dt>运行情况</dt><dd>{reasonCode ? "部分能力暂时受限" : "正常"}</dd></div>
          </dl>
        ) : null}

        {surface === "Learning Coach" ? (
          <div className="learning-coach">
            <LearningCoachQuestion
              id="learning-coach-action"
              title="这次希望言策重点帮你学习什么？"
              description="言策会根据当前对话和你提供的说明生成建议。重要资料不会被自动修改，你可以先查看再决定是否采用。"
              options={COACH_ACTIONS.map((item) => ({ id: item.action, label: item.label, description: item.description }))}
              onSelect={(ids) => { const next = ids[0] as LearningCoachAction | undefined; if (next) setSelectedAction(next); }}
            />
            <label>这次学习的主题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="例如：最近和某位重要联系人的沟通变化" /></label>
            <label>补充说明<textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={5} maxLength={4000} placeholder="告诉言策你观察到的变化、担心的问题或希望改善的方向" /></label>
            <button type="button" disabled={busy || !title.trim() || !hypothesis.trim()} onClick={() => void invoke()}>{busy ? "正在生成建议…" : `生成${selected.label}`}</button>
            {proposal ? (
              <div role="status" aria-live="polite">
                <strong>{resultTitle(proposal)}</strong>
                <p>这是一条建议，不会自动修改人物资料、关系状态或回复方式。你可以先查看，再决定是否采用。</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {surface === "Privacy" ? (
          <div className="learning-privacy">
            <strong>你的重要资料不会被学习建议自动修改</strong>
            <p>学习教练只生成可查看的建议。人物资料、关系状态和回复方式仍由你明确操作后才会发生变化。</p>
            <p>当前版本还没有一个能够长期保存的“关闭学习”开关，因此这里不会显示重启后会失效的假设置。</p>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
