export type LearningCoachAction =
  | "propose_persona_change"
  | "propose_relationship_policy_change"
  | "propose_regression_case"
  | "propose_prompt_program_change"
  | "propose_tomorrow_journey";

export type LearningActionInput = {
  action: LearningCoachAction;
  title: string;
  hypothesis: string;
  candidate?: Record<string, unknown>;
  evidence?: {
    source?: string;
    evidenceId?: string;
    summary?: string;
    confidence?: number;
  };
};

export type LearningProposalResult = {
  proposal?: Record<string, unknown>;
  approvalRequired?: boolean;
  mutationApplied?: boolean;
  reasonCode?: string;
};

type LearningDesktopApi = {
  invokeLearningCoachAction?: (input: LearningActionInput) => Promise<LearningProposalResult>;
  getLearningWorkspaceSnapshot?: () => Promise<Record<string, unknown>>;
};

function desktopApi(): LearningDesktopApi | null {
  const api = (window as unknown as { yanceDesktop?: LearningDesktopApi }).yanceDesktop;
  return api || null;
}

function unavailable(reasonCode: string): Error & { reasonCode: string } {
  return Object.assign(new Error("Learning Coach desktop bridge is unavailable."), { reasonCode });
}

export const learningAssistantRuntime = Object.freeze({
  async invoke(input: LearningActionInput): Promise<LearningProposalResult> {
    const api = desktopApi();
    if (!api || typeof api.invokeLearningCoachAction !== "function") {
      throw unavailable("LEARNING_COACH_BRIDGE_UNAVAILABLE");
    }
    return api.invokeLearningCoachAction(input);
  },

  async snapshot(): Promise<Record<string, unknown>> {
    const api = desktopApi();
    if (!api || typeof api.getLearningWorkspaceSnapshot !== "function") {
      return Object.freeze({ available: false, reasonCode: "LEARNING_WORKSPACE_BRIDGE_UNAVAILABLE" });
    }
    const snapshot = await api.getLearningWorkspaceSnapshot();
    return snapshot && typeof snapshot === "object" ? snapshot : Object.freeze({ available: false, reasonCode: "LEARNING_WORKSPACE_SNAPSHOT_INVALID" });
  }
});
