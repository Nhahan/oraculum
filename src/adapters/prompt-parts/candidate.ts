import type { AgentRunRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
} from "./shared.js";

export function buildCandidatePrompt(request: AgentRunRequest): string {
  const sections: string[] = [
    "You are generating one Oraculum candidate result.",
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

  if (request.selectedSpec) {
    sections.push(
      "",
      "Selected implementation spec:",
      `- Summary: ${request.selectedSpec.summary}`,
      `- Approach: ${request.selectedSpec.approach}`,
      "- Key changes:",
      ...request.selectedSpec.keyChanges.map((item) => `  - ${item}`),
    );
    if (request.selectedSpec.expectedChangedPaths.length > 0) {
      sections.push(
        "- Expected changed paths:",
        ...request.selectedSpec.expectedChangedPaths.map((item) => `  - ${item}`),
      );
    }
    if (request.selectedSpec.acceptanceCriteria.length > 0) {
      sections.push(
        "- Spec acceptance criteria:",
        ...request.selectedSpec.acceptanceCriteria.map((item) => `  - ${item}`),
      );
    }
    if (request.selectedSpec.validationPlan.length > 0) {
      sections.push(
        "- Spec validation plan:",
        ...request.selectedSpec.validationPlan.map((item) => `  - ${item}`),
      );
    }
    if (request.selectedSpec.riskNotes.length > 0) {
      sections.push(
        "- Spec risk notes:",
        ...request.selectedSpec.riskNotes.map((item) => `  - ${item}`),
      );
    }
    sections.push(
      "- Treat this as the implementation contract for this candidate unless the repository state proves a narrower safe adjustment is required.",
    );
  }

  if (request.repairContext) {
    sections.push(
      "",
      "Repair context:",
      `Round: ${request.repairContext.roundId}`,
      `Attempt: ${request.repairContext.attempt}`,
      "Repairable findings:",
      ...request.repairContext.verdicts.map(
        (verdict) =>
          `- ${verdict.oracleId}: ${verdict.status}/${verdict.severity} - ${verdict.summary}${verdict.repairHint ? ` (hint: ${verdict.repairHint})` : ""}`,
      ),
    );

    if (request.repairContext.keyWitnesses.length > 0) {
      sections.push(
        "",
        "Key witnesses:",
        ...request.repairContext.keyWitnesses.map(
          (witness) => `- ${witness.title}: ${witness.detail}`,
        ),
      );
    }
  }

  sections.push(
    "",
    "Instructions:",
    "- Work only inside the provided workspace.",
    "- Materialize the required result by editing files in the workspace. Do not only describe the intended changes.",
    "- Leave the workspace with the real edited files on disk before you finish.",
    "- Candidates without a materialized result will be eliminated.",
    "- Produce the strongest result you can for this strategy.",
    "- Keep the final response concise and focused on the materialized result.",
  );

  return `${sections.join("\n")}\n`;
}
