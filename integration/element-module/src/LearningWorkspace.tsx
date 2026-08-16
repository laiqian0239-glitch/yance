import React, { useEffect, useMemo, useState } from "react";
import "./LearningWorkspace.css";
import { learningAssistantRuntime, type LearningCoachAction, type LearningProposalResult } from "./learningAssistantRuntime";
import { LearningCoachQuestion, LearningProposalApproval, LearningRunProgress } from "./LearningToolUiAdapter";

const SURFACES = [
  "Overview",
  "Daily Review",
  "Learning Coach",
  "Evidence",
  "Proposals",
  "Experiments",
  "Rollout",
  "Promotion",
  "Rollback",
  "Privacy",
  "Consent"
] as const;

type Surface = (typeof SURFACES)[number];

const COACH_ACTIONS: Array<{ action: LearningCoachAction; label: string; description: string }> = [
  { action: "propose_persona_change", label: "Persona proposal", description: "Suggest a reviewed Persona-authority change from evidence." },
  { action: "propose_relationship_policy_change", label: "Relationship policy proposal", description: "Suggest a reviewed relationship-policy adjustment." },
  { action: "propose_regression_case", label: "Regression case", description: "Turn a failure or success into a reusable evaluation case." },
  { action: "propose_prompt_program_change", label: "Prompt/program proposal", description: "Suggest a candidate for regression and shadow evaluation." },
  { action: "propose_tomorrow_journey", label: "Tomorrow Journey", description: "Suggest a reviewed Parlant Journey/Goal adjustment." }
];

function resultTitle(result: LearningProposalResult | null): string {
  if (!result) return "Proposal pending";
  const proposal = result.proposal || {};
  return String(proposal.title || "Learning proposal ready for review");
}

export function LearningWorkspace(): React.JSX.Element {
  const [surface, setSurface] = useState<Surface>("Overview");
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({ available: false });
  const [selectedAction, setSelectedAction] = useState<LearningCoachAction>("propose_regression_case");
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [status, setStatus] = useState("Learning runtime is loading");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LearningProposalResult | null>(null);
  const [doNotLearn, setDoNotLearn] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void learningAssistantRuntime.snapshot().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setStatus(next.available === false ? String(next.reasonCode || "Learning runtime unavailable") : "Learning runtime ready");
    }).catch((error) => {
      if (!cancelled) setStatus(String((error as { reasonCode?: string })?.reasonCode || "Learning runtime unavailable"));
    });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => COACH_ACTIONS.find((item) => item.action === selectedAction) || COACH_ACTIONS[0], [selectedAction]);

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
      setStatus(result.approvalRequired === false ? "Proposal returned without approval boundary" : "Proposal ready for explicit review");
    } catch (error) {
      setStatus(String((error as { reasonCode?: string })?.reasonCode || "Learning Coach unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="yance-learning-workspace" aria-label="Learning Workspace">
      <header>
        <div><strong>Learning</strong><span>Evidence → candidate → regression → shadow → reviewed rollout</span></div>
        <span className="learning-status" aria-live="polite">{status}</span>
      </header>

      <nav aria-label="Learning surfaces">
        {SURFACES.map((label) => (
          <button key={label} type="button" aria-pressed={surface === label} onClick={() => setSurface(label)}>{label}</button>
        ))}
      </nav>

      <section aria-label={surface}>
        <h3>{surface}</h3>
        {surface === "Overview" ? (
          <dl className="learning-grid">
            <div><dt>Evidence</dt><dd>Langfuse + OpenTelemetry</dd></div>
            <div><dt>Optimization</dt><dd>DSPy + GEPA</dd></div>
            <div><dt>Evaluation</dt><dd>Promptfoo precomputed regression</dd></div>
            <div><dt>Rollout</dt><dd>OpenFeature + flagd</dd></div>
            <div><dt>Coach</dt><dd>Existing Letta runtime</dd></div>
            <div><dt>Runtime</dt><dd>{String(snapshot.available === false ? snapshot.reasonCode || "Unavailable" : "Ready")}</dd></div>
          </dl>
        ) : null}

        {surface === "Daily Review" ? (
          <LearningRunProgress id="learning-daily-review" steps={[
            { id: "evidence", label: "Collect minimized evidence", status: "completed" },
            { id: "evaluate", label: "Run regression evaluation", status: "in-progress" },
            { id: "review", label: "Human review before promotion", status: "pending" }
          ]} />
        ) : null}

        {surface === "Learning Coach" ? (
          <div className="learning-coach">
            <LearningCoachQuestion
              id="learning-coach-action"
              title="What should the Learning Coach propose?"
              description="The Coach can only create reviewable proposals; it cannot mutate product authority directly."
              options={COACH_ACTIONS.map((item) => ({ id: item.action, label: item.label, description: item.description }))}
              onSelect={(ids) => { const next = ids[0] as LearningCoachAction | undefined; if (next) setSelectedAction(next); }}
            />
            <label>Proposal title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></label>
            <label>Evidence / hypothesis<textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={5} maxLength={4000} /></label>
            <button type="button" disabled={busy || !title.trim() || !hypothesis.trim()} onClick={() => void invoke()}>{busy ? "Creating proposal…" : `Create ${selected.label}`}</button>
            {proposal ? <LearningProposalApproval id="learning-proposal-review" title={resultTitle(proposal)} description="Approval is required before any canonical authority may change." /> : null}
          </div>
        ) : null}

        {surface === "Evidence" ? <p>Langfuse traces, scores, datasets, experiments and prompt-version evidence are projected here after Presidio minimization.</p> : null}
        {surface === "Proposals" ? <p>Evidence-backed proposals remain pending until explicit review; proposal creation never mutates Persona, Parlant, Graphiti, or model authority.</p> : null}
        {surface === "Experiments" ? <p>DSPy + GEPA candidates are evaluated against frozen regression data before shadow use.</p> : null}
        {surface === "Rollout" ? <p>OpenFeature + flagd own staged, offline-capable rollout decisions.</p> : null}
        {surface === "Promotion" ? <p>Promotion requires evidence, regression success, shadow evidence, and explicit approval.</p> : null}
        {surface === "Rollback" ? <p>Rollback returns to the last approved configuration without rewriting Learning evidence.</p> : null}
        {surface === "Privacy" ? (
          <label className="learning-toggle"><input type="checkbox" checked={doNotLearn} onChange={(event) => setDoNotLearn(event.target.checked)} />Do not learn from this relationship / conversation</label>
        ) : null}
        {surface === "Consent" ? (
          <label className="learning-toggle"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Consent to use minimized evidence for local Learning evaluation</label>
        ) : null}
      </section>
    </aside>
  );
}
