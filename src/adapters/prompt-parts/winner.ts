import type { AgentJudgeRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
} from "./shared.js";

export function buildWinnerSelectionPrompt(request: AgentJudgeRequest): string {
  const plannedDecisionDrivers = request.plannedJudgingPreset?.decisionDrivers ?? [];
  const plannedJudgingCriteria = request.plannedJudgingPreset?.plannedJudgingCriteria ?? [];
  const plannedCrownGates = request.plannedJudgingPreset?.crownGates ?? [];
  const hasExplicitArtifactIntent = Boolean(
    request.taskPacket.artifactKind || request.taskPacket.targetArtifactPath,
  );
  const hasPlannedJudgingPreset = plannedJudgingCriteria.length > 0 || plannedCrownGates.length > 0;
  const shouldReturnJudgingCriteria = hasExplicitArtifactIntent || hasPlannedJudgingPreset;
  const sections: string[] = [
    "You are selecting the best Oraculum finalist.",
    "Either select the single safest finalist as the recommended result or abstain if no finalist is safe enough.",
    "Prefer the candidate that best satisfies the task while preserving repo rules and leaving the strongest reviewable evidence.",
    `Return JSON only in one of these shapes: {"decision":"select","candidateId":"cand-01","confidence":"high","summary":"short rationale"${shouldReturnJudgingCriteria ? ',"judgingCriteria":["criterion"]' : ""}} or {"decision":"abstain","confidence":"low","summary":"why no finalist is safe to recommend"${shouldReturnJudgingCriteria ? ',"judgingCriteria":["criterion"]' : ""}}`,
    "",
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

  if (hasExplicitArtifactIntent) {
    sections.push(
      "",
      "Artifact-aware judging checklist:",
      "- Derive 2-5 concrete judging criteria from the explicit target result before comparing finalists.",
      '- Return those criteria in JSON as "judgingCriteria".',
      "- Reuse the same criteria whether you select a finalist or abstain.",
    );
  }

  if (plannedDecisionDrivers.length > 0) {
    sections.push(
      "",
      "Planned decision drivers:",
      ...plannedDecisionDrivers.map((item) => `- ${item}`),
    );
  }

  if (plannedJudgingCriteria.length > 0) {
    sections.push(
      "",
      "Planned judging criteria:",
      ...plannedJudgingCriteria.map((item) => `- ${item}`),
      '- Reuse these plan-derived criteria in JSON as "judgingCriteria" unless a finalist-specific reason requires narrowing them.',
    );
  }

  if (plannedCrownGates.length > 0) {
    sections.push(
      "",
      "Planned crown gates:",
      ...plannedCrownGates.map((item) => `- ${item}`),
      "- If no finalist clearly satisfies these gates, abstain instead of forcing a recommendation.",
    );
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

  const hasPlannedScorecards = request.finalists.some((finalist) => finalist.plannedScorecard);
  if (hasPlannedScorecards) {
    sections.push(
      "",
      "Planned scorecard rules:",
      "- Prefer finalists with broader workstream coverage and cleaner staged execution.",
      "- Fewer scorecard violations and unresolved risks are stronger deterministic evidence.",
      "- If no finalist clearly clears the staged contract, abstain instead of forcing a recommendation.",
    );
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

    if (finalist.plannedScorecard) {
      sections.push(
        "  Planned scorecard:",
        `    - Mode: ${finalist.plannedScorecard.mode}`,
        `    - Artifact coherence: ${finalist.plannedScorecard.artifactCoherence}`,
        `    - Reversibility: ${finalist.plannedScorecard.reversibility}`,
      );
      if (finalist.plannedScorecard.stageResults.length > 0) {
        sections.push("    - Stage results:");
        for (const stageResult of finalist.plannedScorecard.stageResults) {
          const coveredCount = Object.values(stageResult.workstreamCoverage).filter(
            (status) => status === "covered",
          ).length;
          const missingCount = Object.values(stageResult.workstreamCoverage).filter(
            (status) => status === "missing",
          ).length;
          const blockedCount = Object.values(stageResult.workstreamCoverage).filter(
            (status) => status === "blocked",
          ).length;
          sections.push(
            `      - ${stageResult.stageId}: ${stageResult.status} (covered=${coveredCount}, missing=${missingCount}, blocked=${blockedCount})`,
          );
        }
      }
      if (finalist.plannedScorecard.violations.length > 0) {
        sections.push(
          "    - Violations:",
          ...finalist.plannedScorecard.violations.map((item) => `      - ${item}`),
        );
      }
      if (finalist.plannedScorecard.unresolvedRisks.length > 0) {
        sections.push(
          "    - Unresolved risks:",
          ...finalist.plannedScorecard.unresolvedRisks.map((item) => `      - ${item}`),
        );
      }
    }
  }

  sections.push(
    "",
    "Rules:",
    "- If one finalist is safe and clearly best, return decision=select with one listed candidate ID.",
    "- If finalists are too weak, too close, or missing critical evidence, return decision=abstain.",
    "- Missing deep validation or profile gaps are valid reasons to abstain when the remaining evidence is not strong enough.",
    "- Do not invent a candidate ID.",
    ...(shouldReturnJudgingCriteria
      ? ["- Keep judgingCriteria concrete and tied to the planned result contract."]
      : []),
    ...(hasPlannedJudgingPreset
      ? ["- Respect the planned crown gates; abstain if no finalist clearly satisfies them."]
      : []),
    "- Keep the summary concise and concrete.",
    "- Return JSON only.",
  );

  return `${sections.join("\n")}\n`;
}
