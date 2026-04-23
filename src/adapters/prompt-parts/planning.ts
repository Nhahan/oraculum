import type {
  AgentPlanConsensusDraftRequest,
  AgentPlanConsensusReviewRequest,
  AgentPlanConsensusRevisionRequest,
  AgentPlanningContinuationRequest,
  AgentPlanningDepthRequest,
  AgentPlanningQuestionRequest,
  AgentPlanningScoreRequest,
  AgentPlanningSpecRequest,
} from "../types.js";

export function buildPlanningDepthPrompt(request: AgentPlanningDepthRequest): string {
  return [
    "You are selecting the planning depth for an explicit Oraculum `orc plan` request.",
    "Do not solve the task. Decide whether the plan can proceed, needs interview, or is blocked.",
    "Return JSON only matching the provided schema.",
    "",
    `Max interview rounds: ${request.maxInterviewRounds}`,
    `Max consensus revisions: ${request.maxConsensusRevisions}`,
    formatTask(request.taskPacket),
    "",
    "Rules:",
    "- Choose skip-interview only when goal, scope, success criteria, and judging basis are clear enough.",
    "- Choose interview when one or more operator answers would materially improve the plan.",
    "- Choose deep-interview for broad, risky, multi-artifact, rollback-sensitive, or unclear-success work.",
    "- Deterministic caps are safety boundaries only; make the semantic depth decision yourself.",
  ].join("\n");
}

export function buildPlanningContinuationPrompt(request: AgentPlanningContinuationRequest): string {
  return [
    "You are deciding whether the new `orc plan` input answers the latest active planning interview.",
    "Return JSON only matching the provided schema.",
    "",
    "Active interview:",
    JSON.stringify(request.activeInterview, null, 2),
    "",
    "New input:",
    formatTask(request.taskPacket),
    "",
    "Rules:",
    "- Use continuation only when the new input is best read as an answer or refinement for the active interview.",
    "- Use new-task when it starts an unrelated plan or materially changes the intended task.",
  ].join("\n");
}

export function buildPlanningInterviewQuestionPrompt(
  request: AgentPlanningQuestionRequest,
): string {
  return [
    "You are asking the next planning interview question for Oraculum.",
    "Ask exactly one concise, high-leverage question. Return JSON only.",
    "",
    "Depth decision:",
    JSON.stringify(request.depth, null, 2),
    "",
    request.interview ? "Existing interview:" : "Existing interview: none",
    request.interview ? JSON.stringify(request.interview, null, 2) : "",
    "",
    formatTask(request.taskPacket),
    "",
    "Question rules:",
    "- Target the weakest missing contract dimension: goal, scope, non-goal, acceptance criteria, risk, or judging basis.",
    "- Do not ask for command flags or runtime knobs.",
    "- Prefer one answerable product/engineering decision over a broad questionnaire.",
  ].join("\n");
}

export function buildPlanningInterviewScorePrompt(request: AgentPlanningScoreRequest): string {
  return [
    "You are scoring whether the latest planning interview answer makes the task ready for a plan spec.",
    "Return JSON only matching the provided schema.",
    "",
    "Interview so far:",
    JSON.stringify(request.interview, null, 2),
    "",
    "Latest answer:",
    request.answer,
    "",
    formatTask(request.taskPacket),
    "",
    "Scoring rules:",
    "- readyForSpec means a consultation plan can be created without inventing product intent.",
    "- Clarity score should reflect task goal, scope, success criteria, risk, and judging basis.",
    "- Capture assumptions explicitly instead of treating them as facts.",
  ].join("\n");
}

export function buildPlanningSpecPrompt(request: AgentPlanningSpecRequest): string {
  return [
    "You are crystallizing an explicit Oraculum planning interview into a planning spec.",
    "Return JSON only matching the provided schema.",
    "",
    "Depth:",
    JSON.stringify(request.depth, null, 2),
    "",
    request.interview ? "Interview:" : "Interview: none",
    request.interview ? JSON.stringify(request.interview, null, 2) : "",
    "",
    formatTask(request.taskPacket),
    "",
    "Spec rules:",
    "- Preserve user intent. Do not add implementation choices unless the task or repo evidence requires them.",
    "- Separate constraints, non-goals, acceptance criteria, assumptions, and risks.",
    "- Repo evidence may cite observed task/context facts, but do not invent files or commands.",
  ].join("\n");
}

export function buildPlanConsensusDraftPrompt(request: AgentPlanConsensusDraftRequest): string {
  return [
    "You are drafting a consensus-reviewed Oraculum consultation plan contract.",
    "Return JSON only matching the provided schema.",
    "",
    "Planning spec:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Base consultation plan:",
    JSON.stringify(request.consultationPlan, null, 2),
    "",
    "Draft rules:",
    "- Optimize for falsification and patch selection, not open-ended autonomy.",
    "- Use workstreams, stages, crown gates, repair policy, scorecard dimensions, and test plan to make execution inspectable.",
    "- Keep paths project-relative and safe. Do not invent required paths unless the task contract supports them.",
  ].join("\n");
}

export function buildPlanArchitectureReviewPrompt(
  request: AgentPlanConsensusReviewRequest,
): string {
  return buildConsensusReviewPrompt(
    "architect",
    "Review structure, sequencing, invariants, protected paths, and tradeoffs.",
    request,
  );
}

export function buildPlanCriticReviewPrompt(request: AgentPlanConsensusReviewRequest): string {
  return buildConsensusReviewPrompt(
    "critic",
    "Pressure-test ambiguity, missing acceptance criteria, crown gates, and failure modes.",
    request,
  );
}

export function buildPlanConsensusRevisionPrompt(
  request: AgentPlanConsensusRevisionRequest,
): string {
  return [
    "You are revising a consensus consultation plan draft after architect and critic review.",
    "Return the revised draft as JSON only matching the provided schema.",
    "",
    `Revision: ${request.revision}`,
    "Planning spec:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Current draft:",
    JSON.stringify(request.draft, null, 2),
    "",
    "Architect review:",
    JSON.stringify(request.architectReview ?? null, null, 2),
    "",
    "Critic review:",
    JSON.stringify(request.criticReview ?? null, null, 2),
    "",
    "Revision rules:",
    "- Address requiredChanges directly.",
    "- Preserve useful tradeoffs and premortem risks.",
    "- Do not broaden the plan beyond the planning spec.",
  ].join("\n");
}

function buildConsensusReviewPrompt(
  reviewer: "architect" | "critic",
  focus: string,
  request: AgentPlanConsensusReviewRequest,
): string {
  return [
    `You are the ${reviewer} reviewer for an Oraculum consultation plan.`,
    focus,
    "Return JSON only matching the provided schema.",
    "",
    "Planning spec:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Draft:",
    JSON.stringify(request.draft, null, 2),
    "",
    "Verdict rules:",
    "- approve only when the draft is ready for candidate generation.",
    "- revise when concrete changes can make it ready within the revision cap.",
    "- reject when the task contract is still too unclear or unsafe to plan.",
  ].join("\n");
}

function formatTask(taskPacket: AgentPlanningDepthRequest["taskPacket"]): string {
  return [
    "",
    `Task ID: ${taskPacket.id}`,
    `Task Title: ${taskPacket.title}`,
    `Task Source: ${taskPacket.source.kind} (${taskPacket.source.path})`,
    `Intent: ${taskPacket.intent}`,
    taskPacket.artifactKind ? `Artifact kind: ${taskPacket.artifactKind}` : undefined,
    taskPacket.targetArtifactPath
      ? `Target artifact path: ${taskPacket.targetArtifactPath}`
      : undefined,
    taskPacket.nonGoals.length > 0 ? `Non-goals: ${taskPacket.nonGoals.join(" | ")}` : undefined,
    taskPacket.acceptanceCriteria.length > 0
      ? `Acceptance criteria: ${taskPacket.acceptanceCriteria.join(" | ")}`
      : undefined,
    taskPacket.risks.length > 0 ? `Risks: ${taskPacket.risks.join(" | ")}` : undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}
