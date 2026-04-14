import type { ProfileCommandCandidate } from "../domain/profile.js";
import { profileStrategyIds } from "../domain/profile.js";
import {
  deriveResearchSignalFingerprint,
  describeRecommendedTaskResultLabel,
  type MaterializedTaskPacket,
} from "../domain/task.js";
import type {
  AgentJudgeRequest,
  AgentPreflightRequest,
  AgentProfileRequest,
  AgentRunRequest,
} from "./types.js";

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

export function buildWinnerSelectionPrompt(request: AgentJudgeRequest): string {
  const hasExplicitArtifactIntent = Boolean(
    request.taskPacket.artifactKind || request.taskPacket.targetArtifactPath,
  );
  const sections: string[] = [
    "You are selecting the best Oraculum finalist.",
    "Either select the single safest finalist as the recommended result or abstain if no finalist is safe enough.",
    "Prefer the candidate that best satisfies the task while preserving repo rules and leaving the strongest reviewable evidence.",
    `Return JSON only in one of these shapes: {"decision":"select","candidateId":"cand-01","confidence":"high","summary":"short rationale"${hasExplicitArtifactIntent ? ',"judgingCriteria":["criterion"]' : ""}} or {"decision":"abstain","confidence":"low","summary":"why no finalist is safe to recommend"${hasExplicitArtifactIntent ? ',"judgingCriteria":["criterion"]' : ""}}`,
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
    "- If one finalist is safe and clearly best, return decision=select with one listed candidate ID.",
    "- If finalists are too weak, too close, or missing critical evidence, return decision=abstain.",
    "- Missing deep validation or profile gaps are valid reasons to abstain when the remaining evidence is not strong enough.",
    "- Do not invent a candidate ID.",
    ...(hasExplicitArtifactIntent
      ? [
          "- Keep judgingCriteria concrete, target-specific, and limited to the explicit result contract.",
        ]
      : []),
    "- Keep the summary concise and concrete.",
    "- Return JSON only.",
  );

  return `${sections.join("\n")}\n`;
}

export function buildPreflightPrompt(request: AgentPreflightRequest): string {
  const sections: string[] = [
    "You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.",
    "Do not solve the task and do not propose implementations. Only decide readiness.",
    'Return JSON only in this shape: {"decision":"proceed","confidence":"medium","summary":"short rationale","researchPosture":"repo-only"}',
    'If the task is ambiguous, return {"decision":"needs-clarification",...,"clarificationQuestion":"one short question"} instead of guessing.',
    'If safe execution depends on external official documentation or version-specific facts that are not present in the repository, return {"decision":"external-research-required",...,"researchQuestion":"one short research question","researchPosture":"external-research-required"} instead of guessing.',
    'Use {"decision":"abstain",...} only when the consultation should not proceed even after clarification.',
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
  appendResearchSignalDriftContext(
    sections,
    request.taskPacket,
    request.signals.capabilities.map((capability) => `${capability.kind}:${capability.value}`),
  );

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

  sections.push(
    "",
    `Detected package manager: ${request.signals.packageManager}`,
    `Detected scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `Detected notable files: ${request.signals.files.join(", ") || "none"}`,
    `Detected workspace roots: ${request.signals.workspaceRoots.join(", ") || "none"}`,
    `Detected dependencies: ${request.signals.dependencies.slice(0, 20).join(", ") || "none"}`,
  );

  if (request.signals.capabilities.length > 0) {
    sections.push(
      "",
      "Detected capabilities:",
      ...request.signals.capabilities.map((capability) =>
        [
          `- ${capability.kind}:${capability.value}`,
          `source=${capability.source}`,
          `confidence=${capability.confidence}`,
          ...(capability.path ? [`path=${capability.path}`] : []),
          ...(capability.detail ? [`detail=${capability.detail}`] : []),
        ].join(" "),
      ),
    );
  }

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push(
    "",
    "Rules:",
    "- Prefer proceed when the repository and task already provide enough grounding for a safe tournament run.",
    "- Prefer needs-clarification when one short missing answer would unlock safe execution.",
    "- Prefer external-research-required when correctness depends on official external docs or version facts that are not already grounded in the repository.",
    "- Do not invent repository facts, target files, commands, or external citations.",
    "- Keep the summary and any question concise and concrete.",
    "- Return JSON only.",
  );

  appendResearchBriefDecisionRules(sections, request.taskPacket);

  return `${sections.join("\n")}\n`;
}

export function buildProfileSelectionPrompt(request: AgentProfileRequest): string {
  const strategyList = profileStrategyIds.join(", ");
  const sections: string[] = [
    "You are selecting the best Oraculum consultation validation posture for the current repository.",
    "Choose exactly one currently supported validation posture option and synthesize the strongest default tournament settings for this consultation.",
    "Only choose command ids from the provided command catalog. Do not invent commands or command ids.",
    `Choose strategy IDs only from: ${strategyList}.`,
    "Treat validationProfileId as the canonical validation posture field for default tournament settings, not as a claim about the whole repository.",
    "Legacy aliases profileId, summary, and missingCapabilities are accepted for compatibility, but prefer validationProfileId, validationSummary, and validationGaps.",
    "Treat the supported validation posture options below as a compatibility layer for current default bundles, not as a complete repository taxonomy.",
    'Use validationProfileId "generic" when the repository has no strong command-grounded or repo-local profile evidence.',
    'Return JSON only in this shape: {"validationProfileId":"generic","confidence":"low","validationSummary":"short rationale","candidateCount":3,"strategyIds":["minimal-change","safety-first"],"selectedCommandIds":[],"validationGaps":["none or short notes"]}',
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
  appendResearchSignalDriftContext(
    sections,
    request.taskPacket,
    request.signals.capabilities.map((capability) => `${capability.kind}:${capability.value}`),
  );

  if (request.taskPacket.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "Acceptance criteria:",
      ...request.taskPacket.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  sections.push(
    "",
    "Supported validation posture options:",
    ...request.validationPostureOptions.map((option) => `- ${option.id}: ${option.description}`),
    "",
    `Detected package manager: ${request.signals.packageManager}`,
    `Detected scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `Detected notable files: ${request.signals.files.join(", ") || "none"}`,
    `Detected workspace roots: ${request.signals.workspaceRoots.join(", ") || "none"}`,
    `Detected workspace metadata: ${request.signals.workspaceMetadata.map((workspace) => `${workspace.label} (${workspace.root})`).join(", ") || "none"}`,
    `Detected dependencies: ${request.signals.dependencies.slice(0, 20).join(", ") || "none"}`,
  );

  if (request.signals.capabilities.length > 0) {
    sections.push(
      "",
      "Detected capabilities:",
      ...request.signals.capabilities.map((capability) =>
        [
          `- ${capability.kind}:${capability.value}`,
          `source=${capability.source}`,
          `confidence=${capability.confidence}`,
          ...(capability.path ? [`path=${capability.path}`] : []),
          ...(capability.detail ? [`detail=${capability.detail}`] : []),
        ].join(" "),
      ),
    );
  }

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push("", "Command catalog:");
  for (const candidate of request.signals.commandCatalog) {
    sections.push(...formatProfileCommandCandidate(candidate));
  }

  if (request.signals.skippedCommandCandidates.length > 0) {
    sections.push("", "Skipped command candidates:");
    for (const candidate of request.signals.skippedCommandCandidates) {
      sections.push(
        `- ${candidate.id}`,
        `  Label: ${candidate.label}`,
        `  Capability: ${candidate.capability}`,
        `  Reason: ${candidate.reason}`,
        `  Detail: ${candidate.detail}`,
      );
    }
  }

  sections.push(
    "",
    "Rules:",
    "- Candidate count should usually be 3 or 4 unless the repository signals strongly suggest otherwise.",
    "- Strategy ids must be chosen from this set: minimal-change, safety-first, test-amplified, structural-refactor.",
    "- Selected command ids must come only from the catalog above.",
    "- Only mention validationGaps for checks that are grounded by the repository: a command in the catalog, a skipped command candidate, or an explicit repo capability signal.",
    "- Do not list theoretical profile-default checks when the repository provides no evidence for them.",
    "- If an expected grounded check is missing, explain that in validationGaps instead of inventing a command.",
    "- Return JSON only.",
  );

  appendResearchBriefDecisionRules(sections, request.taskPacket);

  return `${sections.join("\n")}\n`;
}

function formatProfileCommandCandidate(candidate: ProfileCommandCandidate): string[] {
  return [
    `- ${candidate.id}`,
    `  Round: ${candidate.roundId}`,
    `  Label: ${candidate.label}`,
    `  Command: ${[candidate.command, ...candidate.args].join(" ")}`,
    ...(candidate.relativeCwd ? [`  Relative cwd: ${candidate.relativeCwd}`] : []),
    ...(candidate.source ? [`  Source: ${candidate.source}`] : []),
    ...(candidate.capability ? [`  Capability: ${candidate.capability}`] : []),
    ...(candidate.provenance ? [formatProfileCommandProvenance(candidate.provenance)] : []),
    ...(candidate.dedupeKey ? [`  Dedupe key: ${candidate.dedupeKey}`] : []),
    ...(candidate.pathPolicy ? [`  Path policy: ${candidate.pathPolicy}`] : []),
    ...(candidate.safety ? [`  Safety: ${candidate.safety}`] : []),
    ...(candidate.safetyRationale ? [`  Safety rationale: ${candidate.safetyRationale}`] : []),
    `  Invariant: ${candidate.invariant}`,
  ];
}

function appendTaskSourceContext(sections: string[], taskPacket: MaterializedTaskPacket): void {
  if (taskPacket.source.originKind && taskPacket.source.originPath) {
    sections.push(
      "",
      "Task origin:",
      `- ${taskPacket.source.originKind} (${taskPacket.source.originPath})`,
    );
  }

  if (taskPacket.source.kind !== "research-brief") {
    return;
  }

  sections.push(
    "",
    "Research brief provenance:",
    "- This task was resumed from a persisted external research brief.",
    `- Research brief path: ${taskPacket.source.path}`,
    "- Treat the research summary in the task intent as prior investigation context.",
  );
}

function appendResultIntentContext(sections: string[], taskPacket: MaterializedTaskPacket): void {
  sections.push(
    `Target result: ${describeRecommendedTaskResultLabel({
      ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
      ...(taskPacket.targetArtifactPath
        ? { targetArtifactPath: taskPacket.targetArtifactPath }
        : {}),
    })}`,
  );
}

function appendArtifactIntentContext(sections: string[], taskPacket: MaterializedTaskPacket): void {
  if (!taskPacket.artifactKind && !taskPacket.targetArtifactPath) {
    return;
  }

  sections.push("", "Artifact intent:");
  if (taskPacket.artifactKind) {
    sections.push(`- Kind: ${taskPacket.artifactKind}`);
  }
  if (taskPacket.targetArtifactPath) {
    sections.push(`- Target artifact: ${taskPacket.targetArtifactPath}`);
  }
}

function appendResearchBriefDecisionRules(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
): void {
  if (taskPacket.source.kind !== "research-brief") {
    return;
  }

  sections.push(
    "",
    "Research brief rules:",
    "- Treat the research summary as prior external context, not as a repository fact.",
    "- Do not ask for the same external research again unless the current repository state still leaves a concrete unresolved external dependency.",
    "- Base command selection and validation on repository evidence and the command catalog, not on the research brief alone.",
  );
}

function appendStructuredResearchContext(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
): void {
  if (!taskPacket.researchContext) {
    return;
  }

  sections.push(
    "",
    "Accepted research context:",
    `- Question: ${taskPacket.researchContext.question}`,
    `- Summary: ${taskPacket.researchContext.summary}`,
  );

  if (taskPacket.researchContext.confidence) {
    sections.push(`- Confidence: ${taskPacket.researchContext.confidence}`);
  }
  sections.push(`- Conflict handling: ${taskPacket.researchContext.conflictHandling}`);

  if (taskPacket.researchContext.signalSummary.length > 0) {
    sections.push(
      "Research signal basis:",
      ...taskPacket.researchContext.signalSummary.map((signal) => `- ${signal}`),
    );
  }

  const acceptedSignalFingerprint =
    taskPacket.researchContext.signalFingerprint ??
    (taskPacket.researchContext.signalSummary.length > 0
      ? deriveResearchSignalFingerprint(taskPacket.researchContext.signalSummary)
      : undefined);
  if (acceptedSignalFingerprint) {
    sections.push(`- Signal fingerprint: ${acceptedSignalFingerprint}`);
  }

  if (taskPacket.researchContext.sources.length > 0) {
    sections.push(
      "Research sources:",
      ...taskPacket.researchContext.sources.map(
        (source) => `- [${source.kind}] ${source.title} — ${source.locator}`,
      ),
    );
  }

  if (taskPacket.researchContext.claims.length > 0) {
    sections.push(
      "Research claims:",
      ...taskPacket.researchContext.claims.map((claim) =>
        claim.sourceLocators.length > 0
          ? `- ${claim.statement} (sources: ${claim.sourceLocators.join(", ")})`
          : `- ${claim.statement}`,
      ),
    );
  }

  if (taskPacket.researchContext.versionNotes.length > 0) {
    sections.push(
      "Version notes:",
      ...taskPacket.researchContext.versionNotes.map((note) => `- ${note}`),
    );
  }

  if (taskPacket.researchContext.unresolvedConflicts.length > 0) {
    sections.push(
      "Unresolved conflicts:",
      ...taskPacket.researchContext.unresolvedConflicts.map((conflict) => `- ${conflict}`),
    );
    sections.push(
      "Research conflict rule:",
      "- Treat unresolved conflicts as a reason to stay conservative, abstain, or require further clarification/research instead of guessing.",
    );
  }
}

function appendResearchSignalDriftContext(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
  currentSignalSummary: string[],
): void {
  if (!taskPacket.researchContext || taskPacket.researchContext.signalSummary.length === 0) {
    return;
  }

  const acceptedSignalFingerprint =
    taskPacket.researchContext.signalFingerprint ??
    deriveResearchSignalFingerprint(taskPacket.researchContext.signalSummary);
  const currentSignalFingerprint =
    currentSignalSummary.length > 0
      ? deriveResearchSignalFingerprint(currentSignalSummary)
      : undefined;
  const driftDetected =
    Boolean(currentSignalFingerprint) && currentSignalFingerprint !== acceptedSignalFingerprint;

  sections.push(
    "",
    "Research basis comparison:",
    `- Accepted signal fingerprint: ${acceptedSignalFingerprint}`,
    `- Current signal fingerprint: ${currentSignalFingerprint ?? "none"}`,
    `- Drift detected: ${driftDetected ? "yes" : "no"}`,
  );

  if (currentSignalSummary.length > 0) {
    sections.push(
      "Current repo signal basis:",
      ...currentSignalSummary.map((signal) => `- ${signal}`),
    );
  }

  sections.push(
    "Research staleness rule:",
    driftDetected
      ? "- The repository signal basis has changed since this research was captured. Reuse only the research still consistent with current repository evidence, and require fresh external research when the old basis may now be stale."
      : "- The repository signal basis still matches the accepted research snapshot. Reuse that research conservatively, but continue treating repository evidence as the source of truth for execution and validation.",
  );
}

function formatProfileCommandProvenance(
  provenance: NonNullable<ProfileCommandCandidate["provenance"]>,
): string {
  const tokens = [
    `signal=${provenance.signal}`,
    `source=${provenance.source}`,
    ...(provenance.path ? [`path=${provenance.path}`] : []),
    ...(provenance.detail ? [`detail=${provenance.detail}`] : []),
  ];
  return `  Provenance: ${tokens.join(" ")}`;
}
