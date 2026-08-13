import React from "react";
import { ApprovalCard } from "../../../vendor/assistant-ui-tool-ui/v2026.2.13/approval-card/index";
import { QuestionFlow } from "../../../vendor/assistant-ui-tool-ui/v2026.2.13/question-flow/index";
import { ProgressTracker } from "../../../vendor/assistant-ui-tool-ui/v2026.2.13/progress-tracker/index";

export type LearningToolUiProposal = {
  id: string;
  title: string;
  description?: string;
  onApprove?: () => void | Promise<void>;
  onDeny?: () => void | Promise<void>;
};

export function LearningProposalApproval(props: LearningToolUiProposal): React.JSX.Element {
  return (
    <ApprovalCard
      id={props.id}
      role="decision"
      title={props.title}
      description={props.description}
      confirmLabel="Approve proposal"
      cancelLabel="Keep current behavior"
      onConfirm={props.onApprove}
      onCancel={props.onDeny}
    />
  );
}

export function LearningCoachQuestion(props: {
  id: string;
  title: string;
  description?: string;
  options: Array<{ id: string; label: string; description?: string }>;
  onSelect?: (ids: string[]) => void | Promise<void>;
}): React.JSX.Element {
  return (
    <QuestionFlow
      id={props.id}
      role="decision"
      step={1}
      title={props.title}
      description={props.description}
      options={props.options}
      selectionMode="single"
      onSelect={props.onSelect}
    />
  );
}

export function LearningRunProgress(props: {
  id: string;
  steps: Array<{ id: string; label: string; description?: string; status: "pending" | "in-progress" | "completed" | "failed" }>;
  elapsedTime?: number;
}): React.JSX.Element {
  return <ProgressTracker id={props.id} role="state" steps={props.steps} elapsedTime={props.elapsedTime} />;
}

export const LEARNING_TOOL_UI_AUTHORITY = Object.freeze({
  approval: "assistant-ui/tool-ui approval-card/ApprovalCard",
  question: "assistant-ui/tool-ui question-flow/QuestionFlow",
  progress: "assistant-ui/tool-ui progress-tracker/ProgressTracker"
});
