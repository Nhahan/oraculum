import type { AgentJudgeRequest, AgentRunRequest } from "./types.js";

export function buildCandidatePrompt(request: AgentRunRequest): string {
  const sections: string[] = [
    "You are generating one Oraculum patch candidate.",
    `Candidate ID: ${request.candidateId}`,
    `Strategy: ${request.strategyLabel} (${request.strategyId})`,
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

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

  sections.push(
    "",
    "Instructions:",
    "- Work only inside the provided workspace.",
    "- Produce the strongest patch you can for this strategy.",
    "- Keep the final response concise and focused on the patch outcome.",
  );

  return `${sections.join("\n")}\n`;
}

export function buildWinnerSelectionPrompt(request: AgentJudgeRequest): string {
  const sections: string[] = [
    "You are selecting the best Oraculum finalist.",
    "Choose exactly one candidate from the provided finalists.",
    "Prefer the candidate that best satisfies the task while preserving repo rules and leaving the strongest reviewable evidence.",
    'Return JSON only in this shape: {"candidateId":"cand-01","confidence":"high","summary":"short rationale"}',
    "",
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

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

  sections.push("", "Finalists:");

  for (const finalist of request.finalists) {
    sections.push(
      `- ${finalist.candidateId}`,
      `  Strategy: ${finalist.strategyLabel}`,
      `  Agent summary: ${finalist.summary}`,
      `  Artifacts: ${finalist.artifactKinds.join(", ") || "none"}`,
    );

    if (finalist.verdicts.length > 0) {
      sections.push("  Verdicts:");
      for (const verdict of finalist.verdicts) {
        sections.push(
          `    - [${verdict.roundId}] ${verdict.oracleId}: ${verdict.status}/${verdict.severity} - ${verdict.summary}`,
        );
      }
    }
  }

  sections.push(
    "",
    "Rules:",
    "- Choose only one of the listed candidate IDs.",
    "- Do not invent a candidate ID.",
    "- Keep the summary concise and concrete.",
    "- Return JSON only.",
  );

  return `${sections.join("\n")}\n`;
}
