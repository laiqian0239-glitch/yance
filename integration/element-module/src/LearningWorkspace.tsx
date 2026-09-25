import React, { useEffect, useMemo, useState } from "react";
import { learningAssistantRuntime, type LearningCoachAction, type LearningProposalResult } from "./learningAssistantRuntime";
import { LearningCoachQuestion } from "./LearningToolUiAdapter";

const SURFACES = [
  { id: "Overview", label: "学习与证据" },
  { id: "Daily Review", label: "学习状态" },
  { id: "Learning Coach", label: "学习教练" },
  { id: "Privacy", label: "隐私边界" },
] as const;

type Surface = (typeof SURFACES)[number]["id"];

const COACH_ACTIONS: Array<{ action: LearningCoachAction; label: string; description: string }> = [
  { action: "propose_persona_change", label: "人物理解建议", description: "根据最近的互动，整理你可能需要更新的人物理解。" },
  { action: "propose_relationship_policy_change", label: "关系互动建议", description: "结合关系变化，给出更合适的互动方式建议。" },
  { action: "propose_regression_case", label: "一次经历复盘", description: "复盘一次顺利或不顺利的互动，提炼以后可参考的经验。" },
  { action: "propose_prompt_program_change", label: "回复方式建议", description: "根据你的目标，给出更合适的回复方式建议。" },
  { action: "propose_tomorrow_journey", label: "明日关系计划", description: "整理明天最值得做的一两件关系行动。" },
];

const LEARNING_MODES = [
  { id: "send_and_learn", label: "发送并学习", tone: "learn", send: "真实发送", evidence: "成功后激活", longTerm: "重复证据后可进入长期偏好候选", exception: "否" },
  { id: "send_only", label: "仅发送，不学习", tone: "send", send: "真实发送", evidence: "不激活", longTerm: "不进入", exception: "否" },
  { id: "exception", label: "本次例外", tone: "exception", send: "真实发送", evidence: "不激活", longTerm: "不进入", exception: "仅当前轮" },
  { id: "do_not_learn", label: "本次不学习", tone: "block", send: "真实发送", evidence: "阻止学习", longTerm: "不进入", exception: "治理级禁学" },
] as const;

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectRecord) : [];
}

function resultTitle(result: LearningProposalResult | null): string {
  if (!result) return "学习建议尚未生成";
  const proposal = objectRecord(result.proposal);
  return String(proposal.title || "学习建议已生成");
}

function evidenceTitle(row: Record<string, unknown>, index: number): string {
  return String(row.title || row.summary || row.signalType || row.type || `学习证据 ${index + 1}`);
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
      setStatus(next.available === false ? "学习服务暂不可用" : "学习治理状态已同步");
    }).catch(() => {
      if (!cancelled) setStatus("学习服务暂不可用");
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(
    () => COACH_ACTIONS.find((item) => item.action === selectedAction) || COACH_ACTIONS[0],
    [selectedAction],
  );
  const selectedSurface = useMemo(
    () => SURFACES.find((item) => item.id === surface) || SURFACES[0],
    [surface],
  );
  const activePolicy = objectRecord(snapshot.activePolicy);
  const privacy = objectRecord(snapshot.privacy);
  const recentEvidence = objectArray(snapshot.recentEvidence || snapshot.learningSignals || snapshot.evidence);
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
        evidence: { source: "Learning Workspace", summary: hypothesis.trim() },
      });
      setProposal(result);
      setStatus(result.mutationApplied === true
        ? "系统已阻止未经确认的直接修改"
        : "学习建议已生成；重要资料不会自动修改");
    } catch {
      setStatus("学习教练暂不可用");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-learning-workspace yance-learning-workspace--v4" aria-label="数据、隐私与学习">
      <header>
        <div>
          <span className="learning-kicker">数据 · 隐私 · 学习</span>
          <strong>学习与证据</strong>
          <span>言策可以越来越懂你，但只有经过真实发送与重复证据验证的偏好，才进入长期人格候选。</span>
        </div>
        <span className="learning-status" aria-live="polite">{status}</span>
      </header>

      <div className="learning-privacy-banner" role="note">
        <strong>隐私原则</strong>
        <span>间歇大脑对话原文不需要长期保存；长期保留的是结构化、有治理、可撤销的学习信号。</span>
        <em>{privacy.rawPrivateChatTraining === true ? "需要检查隐私策略" : "✓ 学习边界有效"}</em>
      </div>

      <nav aria-label="学习与成长页面">
        {SURFACES.map((item) => (
          <button key={item.id} type="button" title={item.label} aria-pressed={surface === item.id} onClick={() => setSurface(item.id)}>{item.label}</button>
        ))}
      </nav>

      <section aria-label={selectedSurface.label}>
        {surface === "Overview" ? (
          <>
            <div className="learning-section-heading">
              <div><span>发送语义</span><h3>四种学习模式</h3></div>
              <p>模式在真实对话的发送链里选择；这里仅解释真实发送后已经生效的学习语义，不创建第二套发送状态。</p>
            </div>
            <div className="learning-mode-grid" role="list" aria-label="学习模式语义">
              {LEARNING_MODES.map((mode) => (
                <article key={mode.id} role="listitem" data-tone={mode.tone}>
                  <header><strong>{mode.label}</strong></header>
                  <dl>
                    <div><dt>发送</dt><dd>{mode.send}</dd></div>
                    <div><dt>学习证据</dt><dd>{mode.evidence}</dd></div>
                    <div><dt>长期偏好</dt><dd>{mode.longTerm}</dd></div>
                    <div><dt>例外语义</dt><dd>{mode.exception}</dd></div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="learning-section-heading">
              <div><span>证据流程</span><h3>学习生命周期</h3></div>
              <p>发送前只形成临时证据；只有真实发送成功后，才允许进入可复核学习链。</p>
            </div>
            <ol className="learning-lifecycle" aria-label="学习生命周期">
              <li><strong>① 本轮反馈</strong><span>只影响当前这一轮，不直接改长期人格。</span></li>
              <li><strong>② 临时证据</strong><span>发送前保持临时状态，不形成长期偏好。</span></li>
              <li><strong>③ 真实发送成功</strong><span>只有“发送并学习”才允许激活学习信号。</span></li>
              <li><strong>④ 重复证据</strong><span>多次一致后，才可进入长期偏好候选。</span></li>
              <li><strong>⑤ 人工确认</strong><span>稳定人格与关系事实仍需明确治理确认；不会自动修改。</span></li>
            </ol>

            <div className="learning-evidence-panel">
              <header>
                <div><span>最近学习证据</span><strong>可追溯 · 有治理</strong></div>
                <small>只有系统提供撤销入口时才显示可撤销操作，本页不会伪造删除按钮。</small>
              </header>
              {recentEvidence.length ? (
                <div className="learning-evidence-list">
                  {recentEvidence.slice(0, 8).map((row, index) => (
                    <article key={String(row.id || row.signalId || index)}>
                      <strong>{evidenceTitle(row, index)}</strong>
                      <span>{String(row.status || (row.learningEligible === false ? "已治理" : "已记录"))}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="learning-evidence-empty">
                  <strong>当前快照没有可展示的学习证据</strong>
                  <span>这不是空白占位：只有返回真实证据时这里才会出现记录。</span>
                </div>
              )}
            </div>
          </>
        ) : null}

        {surface === "Daily Review" ? (
          <>
            <div className="learning-section-heading">
              <div><span>策略状态</span><h3>治理状态</h3></div>
              <p>读取当前学习策略的真实状态，这里不维护第二份策略状态。</p>
            </div>
            <dl className="learning-grid">
              <div><dt>学习状态</dt><dd>{snapshot.available === false ? "暂不可用" : "已就绪"}</dd></div>
              <div><dt>当前方式</dt><dd>{policyMode === "promoted" ? "增强策略已启用" : "基础治理"}</dd></div>
              <div><dt>学习版本</dt><dd>{policyVersion || "默认"}</dd></div>
              <div><dt>持久化</dt><dd>{snapshot.durable === true ? "已持久化" : "等待状态确认"}</dd></div>
              <div><dt>重启恢复</dt><dd>{snapshot.restartRecoverable === true ? "可恢复" : "等待状态确认"}</dd></div>
              <div><dt>服务状态</dt><dd>{snapshot.available === false ? "暂不可用" : reasonCode ? "部分能力受限" : "运行正常"}</dd></div>
            </dl>
            {reasonCode ? <div className="learning-reason"><strong>状态提示</strong><span>当前学习服务有部分能力受限；稍后刷新即可重新检查。</span></div> : null}
          </>
        ) : null}

        {surface === "Learning Coach" ? (
          <div className="learning-coach">
            <div className="learning-section-heading">
              <div><span>学习建议</span><h3>学习教练</h3></div>
              <p>只生成建议与候选，不越权修改人物资料、关系事实或发送路径。</p>
            </div>
            <LearningCoachQuestion
              id="learning-coach-action"
              title="这次希望言策重点帮你学习什么？"
              description="言策会根据当前对话和你提供的说明生成建议。重要资料不会被自动修改，你可以先查看再决定是否采用。"
              options={COACH_ACTIONS.map((item) => ({ id: item.action, label: item.label, description: item.description }))}
              onSelect={(ids) => {
                const next = ids[0] as LearningCoachAction | undefined;
                if (next) setSelectedAction(next);
              }}
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
            <div className="learning-section-heading">
              <div><span>隐私边界</span><h3>隐私与记忆边界</h3></div>
              <p>学习能成长，但不能越过证据和隐私边界。</p>
            </div>
            <div className="learning-privacy-grid">
              <article><strong>现在可能有用</strong><span>按当前 Goal 与证据召回最相关内容；仍然受证据治理。</span></article>
              <article><strong>还没聊完的事</strong><span>开放话题、未完成事项与最近上下文。</span></article>
              <article><strong>他说过的重要事</strong><span>只使用已经确认的人物事实，不把推测写成事实。</span></article>
              <article><strong>承诺</strong><span>明确约定与承诺属于受治理证据。</span></article>
              <article><strong>边界</strong><span>敏感边界优先保护，不因学习自动放宽。</span></article>
              <article><strong>冲突 / 过期</strong><span>冲突、过期或已被更新替代的信息不得偷偷进入回复。</span></article>
            </div>
            <div className="learning-privacy-note">
              <strong>不会自动修改</strong>
              <p>学习教练只生成可查看的建议。人物资料、关系状态、回复方式与长期偏好仍需明确治理动作决定。</p>
              <p>“仅发送，不学习”“本次例外”“本次不学习”都会阻止对应学习；“本次不学习”还会阻止学习数据持久化。</p>
            </div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
