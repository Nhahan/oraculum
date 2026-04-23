import type { AgentCandidateSpecRequest, AgentCandidateSpecSelectionRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
} from "./shared.js";

export function buildCandidateSpecPrompt(request: AgentCandidateSpecRequest): string {
  const sections: string[] = [
    "You are proposing one Oraculum implementation spec.",
    "Do not edit files. Do not describe completed work. Return JSON only.",
    `Candidate ID: ${request.candidateId}`,
    `Strategy: ${request.strategyLabel} (${request.strategyId})`,
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    `Task Source: ${request.taskPacket.source.kind} (${request.taskPacket.source.path})`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

  appendResultIntentContext(sections, request.taskPacket);
  appendArtifactIntentContext(sections, request.taskPacket);
  appendTaskSourceContext(sections, request.taskPacket);
  appendStructuredResearchContext(sections, request.taskPacket);
  appendTaskContract(sections, request);
  appendConsultationPlanContract(sections, request.consultationPlan);

  sections.push(
    "",
    "Spec requirements:",
    "- Propose a concrete implementation path for this candidate strategy.",
    "- Keep the spec narrow enough to implement directly in one candidate workspace.",
    "- Include project-relative expected changed paths only when grounded by the task, plan, or observed repo evidence.",
    "- Include validation steps tied to repo-local or planned oracles when available.",
    "- State what evidence would show this candidate satisfies the contract and what failure would eliminate it.",
    "- Call out material risks or uncertainty instead of hiding them.",
    "- Return JSON with summary, approach, keyChanges, expectedChangedPaths, acceptanceCriteria, validationPlan, and riskNotes.",
  );

  return `${sections.join("\n")}\n`;
}

export function buildSpecSelectionPrompt(request: AgentCandidateSpecSelectionRequest): string {
  const sections: string[] = [
    "You are selecting Oraculum implementation specs before any patch is produced.",
    "Rank the specs by likely final crownable patch quality, not by prose polish.",
    "Return JSON only.",
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    `Task Source: ${request.taskPacket.source.kind} (${request.taskPacket.source.path})`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

  appendResultIntentContext(sections, request.taskPacket);
  appendArtifactIntentContext(sections, request.taskPacket);
  appendTaskSourceContext(sections, request.taskPacket);
  appendStructuredResearchContext(sections, request.taskPacket);
  appendTaskContract(sections, request);
  appendConsultationPlanContract(sections, request.consultationPlan);

  if (request.consultationProfile) {
    sections.push(
      "",
      `Consultation validation posture: ${request.consultationProfile.validationProfileId} (${request.consultationProfile.confidence})`,
      request.consultationProfile.validationSummary,
    );
    if (request.consultationProfile.validationSignals.length > 0) {
      sections.push(
        "Validation evidence:",
        ...request.consultationProfile.validationSignals.map((item) => `- ${item}`),
      );
    }
    if (request.consultationProfile.validationGaps.length > 0) {
      sections.push(
        "Validation gaps from the selected posture:",
        ...request.consultationProfile.validationGaps.map((item) => `- ${item}`),
      );
    }
  }

  sections.push("", "Candidate specs:");
  for (const spec of request.specs) {
    sections.push(
      `- ${spec.candidateId}`,
      `  Strategy: ${spec.strategyLabel} (${spec.strategyId})`,
      `  Summary: ${spec.summary}`,
      `  Approach: ${spec.approach}`,
      `  Key changes: ${spec.keyChanges.join("; ")}`,
      `  Expected paths: ${spec.expectedChangedPaths.join(", ") || "not specified"}`,
      `  Acceptance: ${spec.acceptanceCriteria.join("; ") || "not specified"}`,
      `  Validation: ${spec.validationPlan.join("; ") || "not specified"}`,
      `  Risks: ${spec.riskNotes.join("; ") || "none stated"}`,
    );
  }

  sections.push(
    "",
    "Selection rules:",
    "- rankedCandidateIds must list every provided candidate id exactly once, strongest first.",
    "- selectedCandidateIds should usually contain only the top-ranked candidate.",
    "- Use implementationVarianceRisk=high when plausible specs make materially different code changes, when the task has hidden-risk signals, or when planned/profiler validation has gaps.",
    "- Select only the top candidate by default.",
    "- Select the top two candidates only when implementationVarianceRisk=high or validationGaps materially justify extra exploration.",
    "- Crownable spec quality means the spec is falsifiable by repository evidence and likely to produce a reviewable patch, not just plausible prose.",
    "- Include one reason per candidate with its rank and whether it is selected.",
    "- Do not invent candidate ids.",
  );

  return `${sections.join("\n")}\n`;
}

function appendTaskContract(
  sections: string[],
  request: Pick<AgentCandidateSpecRequest, "taskPacket">,
): void {
  if (request.taskPacket.nonGoals.length > 0) {
    sections.push("", "Non-goals:", ...request.taskPacket.nonGoals.map((item) => `- ${item}`));
  }

  if (request.taskPacket.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "Acceptance criteria:",
      ...request.taskPacket.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  if (request.taskPacket.risks.length > 0) {
    sections.push("", "Known risks:", ...request.taskPacket.risks.map((item) => `- ${item}`));
  }

  if (request.taskPacket.oracleHints.length > 0) {
    sections.push(
      "",
      "Oracle hints:",
      ...request.taskPacket.oracleHints.map((item) => `- ${item}`),
    );
  }

  if (request.taskPacket.contextFiles.length > 0) {
    sections.push(
      "",
      "Context files:",
      ...request.taskPacket.contextFiles.map((item) => `- ${item}`),
    );
  }
}

function appendConsultationPlanContract(
  sections: string[],
  consultationPlan: AgentCandidateSpecRequest["consultationPlan"],
): void {
  if (!consultationPlan) {
    return;
  }

  sections.push(
    "",
    "Consultation plan contract:",
    `- Intended result: ${consultationPlan.intendedResult}`,
    `- Mode: ${consultationPlan.mode}`,
  );
  if (consultationPlan.requiredChangedPaths.length > 0) {
    sections.push(
      "- Required changed paths:",
      ...consultationPlan.requiredChangedPaths.map((item) => `  - ${item}`),
    );
  }
  if (consultationPlan.protectedPaths.length > 0) {
    sections.push(
      "- Protected paths:",
      ...consultationPlan.protectedPaths.map((item) => `  - ${item}`),
    );
  }
  if (consultationPlan.crownGates.length > 0) {
    sections.push("- Crown gates:", ...consultationPlan.crownGates.map((item) => `  - ${item}`));
  }
  if (consultationPlan.plannedJudgingCriteria.length > 0) {
    sections.push(
      "- Planned judging criteria:",
      ...consultationPlan.plannedJudgingCriteria.map((item) => `  - ${item}`),
    );
  }
  if (consultationPlan.workstreams.length > 0) {
    sections.push("- Workstreams:");
    for (const workstream of consultationPlan.workstreams) {
      sections.push(
        `  - ${workstream.label} (${workstream.id}): ${workstream.goal}`,
        `    targetArtifacts=${workstream.targetArtifacts.join(", ") || "none"}`,
        `    requiredChangedPaths=${workstream.requiredChangedPaths.join(", ") || "none"}`,
        `    protectedPaths=${workstream.protectedPaths.join(", ") || "none"}`,
        `    oracleIds=${workstream.oracleIds.join(", ") || "none"}`,
      );
      if (workstream.disqualifiers.length > 0) {
        sections.push(`    disqualifiers=${workstream.disqualifiers.join("; ")}`);
      }
    }
  }
}
