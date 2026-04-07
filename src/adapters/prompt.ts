import type { AgentJudgeRequest, AgentProfileRequest, AgentRunRequest } from "./types.js";

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
    "- Materialize the patch by editing files in the workspace. Do not only describe the intended diff.",
    "- Leave the workspace with the real edited files on disk before you finish.",
    "- Candidates without a materialized patch will be eliminated.",
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
      `  Changed paths: ${finalist.changedPaths.slice(0, 8).join(", ") || "none"}`,
      `  Change summary: mode=${finalist.changeSummary.mode}, changed=${finalist.changeSummary.changedPathCount}, created=${finalist.changeSummary.createdPathCount}, removed=${finalist.changeSummary.removedPathCount}, modified=${finalist.changeSummary.modifiedPathCount}${finalist.changeSummary.addedLineCount !== undefined ? `, +${finalist.changeSummary.addedLineCount}` : ""}${finalist.changeSummary.deletedLineCount !== undefined ? `, -${finalist.changeSummary.deletedLineCount}` : ""}`,
      `  Repair summary: attempts=${finalist.repairSummary.attemptCount}, rounds=${finalist.repairSummary.repairedRounds.join(", ") || "none"}`,
    );

    if (finalist.witnessRollup.riskSummaries.length > 0) {
      sections.push("  Risk snapshot:");
      for (const risk of finalist.witnessRollup.riskSummaries.slice(0, 5)) {
        sections.push(`    - ${risk}`);
      }
    }

    if (finalist.witnessRollup.repairHints.length > 0) {
      sections.push("  Repair hints:");
      for (const hint of finalist.witnessRollup.repairHints) {
        sections.push(`    - ${hint}`);
      }
    }

    if (finalist.witnessRollup.keyWitnesses.length > 0) {
      sections.push("  Key witnesses:");
      for (const witness of finalist.witnessRollup.keyWitnesses) {
        sections.push(
          `    - [${witness.roundId}] ${witness.oracleId}: ${witness.title} - ${witness.detail}`,
        );
      }
    }

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

export function buildProfileSelectionPrompt(request: AgentProfileRequest): string {
  const sections: string[] = [
    "You are selecting the best Oraculum consultation profile for the current repository.",
    "Choose exactly one profile option and synthesize the strongest default tournament settings for this consultation.",
    "Only choose command ids from the provided command catalog. Do not invent commands or command ids.",
    'Return JSON only in this shape: {"profileId":"library","confidence":"high","summary":"short rationale","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast"],"missingCapabilities":["none or short notes"]}',
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

  sections.push(
    "",
    "Profile options:",
    ...request.profileOptions.map((option) => `- ${option.id}: ${option.description}`),
    "",
    `Detected package manager: ${request.signals.packageManager}`,
    `Detected scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `Detected tags: ${request.signals.tags.join(", ") || "none"}`,
    `Detected notable files: ${request.signals.files.join(", ") || "none"}`,
    `Detected dependencies: ${request.signals.dependencies.slice(0, 20).join(", ") || "none"}`,
  );

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push("", "Command catalog:");
  for (const candidate of request.signals.commandCatalog) {
    sections.push(
      `- ${candidate.id}`,
      `  Round: ${candidate.roundId}`,
      `  Label: ${candidate.label}`,
      `  Command: ${[candidate.command, ...candidate.args].join(" ")}`,
      `  Invariant: ${candidate.invariant}`,
    );
  }

  sections.push(
    "",
    "Rules:",
    "- Candidate count should usually be 3 or 4 unless the repository signals strongly suggest otherwise.",
    "- Strategy ids must be chosen from this set: minimal-change, safety-first, test-amplified, structural-refactor.",
    "- Selected command ids must come only from the catalog above.",
    "- If an expected check is missing, explain that in missingCapabilities instead of inventing a command.",
    "- Return JSON only.",
  );

  return `${sections.join("\n")}\n`;
}
