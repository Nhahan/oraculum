import type {
  AgentPlanConsensusContinuationRequest,
  AgentPlanConsensusDraftRequest,
  AgentPlanConsensusRemediationContext,
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
    "Do not solve the task. Decide whether the plan can proceed, needs Augury Interview clarification, or is blocked.",
    "Return JSON only matching the provided schema.",
    "",
    `Max interview rounds: ${request.maxInterviewRounds}`,
    `Operator max Plan Conclave revision cap: ${request.operatorMaxConsensusLoopRevisions}`,
    formatTask(request.taskPacket),
    "",
    "Rules:",
    "- Return interviewDepth as one of: skip-interview, interview, deep-interview.",
    "- Return readiness as one of: ready, needs-interview, blocked.",
    "- Return consensusReviewIntensity as one of: standard, elevated, high.",
    "- Return confidence, summary, reasons, and estimatedInterviewRounds; reasons and estimatedInterviewRounds are required schema fields.",
    "- Augury Interview is Oraculum's pre-spec clarification loop; interviewDepth controls how much clarification is needed before writing the planning spec, not general risk.",
    "- Choose interviewDepth=skip-interview only when goal, scope, success criteria, and judging basis are clear enough.",
    "- Choose interviewDepth=interview when one or more operator answers would materially improve the plan.",
    "- Choose interviewDepth=deep-interview for broad, multi-artifact, rollback-sensitive, or unclear-success work that needs multiple operator answers before planning.",
    "- Plan Conclave is Oraculum's post-spec architect/critic review loop; consensusReviewIntensity controls how aggressively it challenges the finished consultation-plan draft.",
    "- consensusReviewIntensity is separate from interviewDepth.",
    "- Choose consensusReviewIntensity=high only for security, data loss, release/rollback, billing, permissions, compatibility, or high-blast-radius work even when no operator interview is needed.",
    "- Choose consensusReviewIntensity=elevated for multi-artifact, regression, compatibility, or non-trivial review risk that is not high-blast-radius.",
    "- Choose consensusReviewIntensity=standard when ordinary architect/critic review is enough for the plan draft.",
    "- Deterministic caps are safety boundaries only; make the semantic depth decision yourself.",
  ].join("\n");
}

export function buildPlanningContinuationPrompt(request: AgentPlanningContinuationRequest): string {
  return [
    "You are deciding whether the new `orc plan` input answers the latest active Augury Interview.",
    "Return JSON only matching the provided schema.",
    "",
    "Active interview:",
    JSON.stringify(request.activeInterview, null, 2),
    "",
    "New input:",
    formatTask(request.taskPacket),
    "",
    "Rules:",
    "- Return classification as one of: continuation, new-task.",
    "- Return confidence and summary; both are required schema fields.",
    "- Use continuation only when the new input is best read as an answer or refinement for the active interview.",
    "- Use new-task when it starts an unrelated plan or materially changes the intended task.",
    "- Treat changes to result contract, scope boundary, or judging basis as new-task instead of continuation.",
  ].join("\n");
}

export function buildPlanConsensusContinuationPrompt(
  request: AgentPlanConsensusContinuationRequest,
): string {
  return [
    "You are deciding whether the new `orc plan` input is a remediation answer for a blocked Oraculum Plan Conclave or a new planning task.",
    "Return JSON only matching the provided schema.",
    "",
    "Blocked Plan Conclave consensus:",
    JSON.stringify(request.activeConsensus, null, 2),
    "",
    "Planning spec for the blocked run:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Blocker:",
    JSON.stringify(request.blocker, null, 2),
    "",
    "New input:",
    formatTask(request.taskPacket),
    "",
    "Rules:",
    "- Return classification as one of: consensus-remediation, new-task.",
    "- Return confidence and summary; both are required schema fields.",
    "- Use consensus-remediation only when the input directly answers the blocker or requiredChanges without changing the task goal, scope boundary, or judging basis.",
    "- Use new-task when the input starts an unrelated plan, changes the intended result, broadens or narrows scope, or replaces the judging basis.",
    "- Do not treat runtime-unavailable blockers as answerable remediation; those require rerunning when the review runtime can execute.",
  ].join("\n");
}

export function buildPlanningInterviewQuestionPrompt(
  request: AgentPlanningQuestionRequest,
): string {
  return [
    "You are asking the next Augury Interview question for Oraculum.",
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
    "- Return question, perspective, and expectedAnswerShape; all three fields are required.",
    "- Target the weakest missing contract dimension: goal, scope, non-goal, acceptance criteria, risk, or judging basis.",
    "- Seek witnessable candidate evidence: the answer should clarify a future acceptance signal, disqualifier, protected scope, risk, or crown gate.",
    "- Ask about a single concrete decision the operator can answer from intent, not an implementation fact.",
    "- Do not ask the operator for repo inspection, command flags, or implementation details.",
    "- expectedAnswerShape is required. State the artifact, oracle signal, acceptance signal, or disqualifier that the answer would make usable as future candidate evidence.",
    "- Do not ask for command flags or runtime knobs.",
    "- Prefer one answerable product/engineering decision over a broad questionnaire.",
  ].join("\n");
}

export function buildPlanningInterviewScorePrompt(request: AgentPlanningScoreRequest): string {
  return [
    "You are scoring whether the latest Augury Interview answer makes the task ready for a plan spec.",
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
    "- ontologySnapshot is the canonical Augury signs bundle for the latest answer.",
    "- Fill ontologySnapshot.goals, constraints, nonGoals, acceptanceCriteria, and risks only from evidence in the latest answer plus the existing task contract.",
    "- Return empty arrays for ontologySnapshot fields when there is no evidence; do not invent signs.",
    "- readyForSpec=true only when a consultation plan can be created without inventing product intent and at least one witnessable acceptance signal or judging basis is visible enough for future candidate evidence.",
    "- Clarity score should reflect task goal, scope, success criteria, risk, and judging basis.",
    "- Prefer answers that create witnessable candidate evidence: acceptance signals, disqualifiers, protected scope, risks, or crown gates.",
    "- Capture assumptions explicitly instead of treating them as facts.",
  ].join("\n");
}

export function buildPlanningSpecPrompt(request: AgentPlanningSpecRequest): string {
  return [
    "You are crystallizing an explicit Oraculum Augury Interview into a planning spec.",
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
    "- When Augury Interview rounds include ontologySnapshot values, use the latest snapshot as the primary source: acceptance signs go to acceptanceCriteria, protected-scope exclusions and disqualifiers go to nonGoals, and risk signs go to openRisks.",
    "- Preserve unresolved Augury assumptions in assumptionLedger; do not treat them as facts.",
    "- Put explicit operator answers into assumptionsResolved when they settle a previous question.",
    "- Put observable task or repository facts into repoEvidence; do not put guesses there.",
    "- If the latest Augury signs conflict with the task packet, record the conflict in assumptionLedger or openRisks instead of resolving it by guesswork.",
    "- Separate constraints, non-goals, acceptance criteria, assumptions, and risks.",
    "- Repo evidence may cite observed task/context facts, but do not invent files or commands.",
  ].join("\n");
}

export function buildPlanConsensusDraftPrompt(request: AgentPlanConsensusDraftRequest): string {
  return [
    "You are drafting a Plan Conclave-reviewed Oraculum consultation plan contract.",
    "Return JSON only matching the provided schema.",
    "",
    "Planning spec:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Base consultation plan:",
    JSON.stringify(request.consultationPlan, null, 2),
    "",
    ...formatPlanConsensusRemediationSection(request.planConsensusRemediation),
    "",
    "Draft rules:",
    "- Optimize for falsification and patch selection, not open-ended autonomy.",
    "- Carry Augury-derived acceptance, non-goal, and risk signs into plannedJudgingCriteria, crownGates, premortem, scorecardDefinition, and repairPolicy when they affect candidate selection.",
    "- Map acceptance signs to plannedJudgingCriteria.",
    "- Map non-goals and disqualifiers to crownGates or repairPolicy.immediateElimination.",
    "- Map risks to premortem, scorecardDefinition.abstentionTriggers, or repairPolicy.preferAbstainOverRetry.",
    "- Map fixable uncertainty to repairPolicy.repairable.",
    "- Use scorecardDefinition to define comparison dimensions and abstention triggers from the sign bundle.",
    "- Use repairPolicy to distinguish immediate elimination, repairable failures, and prefer-abstain-over-retry cases.",
    "- Use workstreams, stages, crown gates, repair policy, scorecard dimensions, and expandedTestPlan to make execution inspectable.",
    "- Return viableOptions, selectedOption, rejectedAlternatives, assumptionLedger, premortem, and expandedTestPlan; all are required schema fields.",
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
    "You are revising a Plan Conclave consultation plan draft after architect and critic review.",
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
    ...formatPlanConsensusRemediationSection(request.planConsensusRemediation),
    "",
    "Revision rules:",
    "- Address requiredChanges directly.",
    "- Treat required changes to crownGates, repairPolicy, or scorecardDefinition as highest priority.",
    "- Do not soften witness gaps, crown-gate gaps, or repair-policy gaps into vague tradeoffs.",
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
    `You are the ${reviewer} reviewer for an Oraculum Plan Conclave.`,
    focus,
    "Return JSON only matching the provided schema.",
    "",
    "Planning spec:",
    JSON.stringify(request.planningSpec, null, 2),
    "",
    "Draft:",
    JSON.stringify(request.draft, null, 2),
    "",
    ...formatPlanConsensusRemediationSection(request.planConsensusRemediation),
    "",
    "Verdict rules:",
    "- approve only when the draft is ready for candidate generation.",
    "- revise when concrete requiredChanges could make it safe within the revision cap.",
    "- reject only when no bounded revision can make the plan safe because the task contract itself is too unclear or unsafe.",
    "- Return requiredChanges, tradeoffs, and risks as arrays; use empty arrays when none apply.",
    "- requiredChanges should name concrete witness gaps, crown-gate gaps, or repair/eliminate policy gaps.",
  ].join("\n");
}

function formatPlanConsensusRemediationSection(
  remediation: AgentPlanConsensusRemediationContext | undefined,
): string[] {
  if (!remediation) {
    return [];
  }

  return [
    "Plan Conclave remediation answer:",
    remediation.continuation.answer,
    "",
    "Source Plan Conclave blocker:",
    JSON.stringify(
      {
        sourceRunId: remediation.continuation.sourceRunId,
        sourceConsensusRunId: remediation.continuation.sourceConsensusRunId,
        blockerKind: remediation.continuation.blockerKind,
        blockerSummary: remediation.continuation.blockerSummary,
        requiredChanges: remediation.continuation.requiredChanges,
      },
      null,
      2,
    ),
    "",
    "Source Plan Conclave final draft:",
    JSON.stringify(remediation.sourceFinalDraft, null, 2),
    "",
    "Source Plan Conclave revision history:",
    JSON.stringify(remediation.sourceRevisionHistory, null, 2),
    "",
    "Remediation rules:",
    "- Treat the answer as operator remediation for the source Plan Conclave blocker.",
    "- Preserve the original planning spec unless the answer directly resolves a requiredChange.",
    "- Address source requiredChanges explicitly in draft, review, and revision reasoning.",
    "- Do not broaden the plan beyond the source task contract.",
  ];
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
