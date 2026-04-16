import type { ProfileCommandCandidate } from "../../domain/profile.js";
import {
  deriveResearchSignalFingerprint,
  describeRecommendedTaskResultLabel,
  type MaterializedTaskPacket,
} from "../../domain/task.js";

export function formatProfileCommandCandidate(candidate: ProfileCommandCandidate): string[] {
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

export function appendTaskSourceContext(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
): void {
  if (taskPacket.source.originKind && taskPacket.source.originPath) {
    sections.push(
      "",
      "Task origin:",
      `- ${taskPacket.source.originKind} (${taskPacket.source.originPath})`,
    );
  }

  if (taskPacket.source.kind !== "research-brief") {
    if (taskPacket.source.kind !== "consultation-plan") {
      return;
    }

    sections.push(
      "",
      "Consultation plan provenance:",
      "- This task was resumed from a persisted consultation plan.",
      `- Consultation plan path: ${taskPacket.source.path}`,
      "- Treat the consultation plan context in the task intent as structured execution guidance.",
    );
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

export function appendResultIntentContext(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
): void {
  sections.push(
    `Target result: ${describeRecommendedTaskResultLabel({
      ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
      ...(taskPacket.targetArtifactPath
        ? { targetArtifactPath: taskPacket.targetArtifactPath }
        : {}),
    })}`,
  );
}

export function appendArtifactIntentContext(
  sections: string[],
  taskPacket: MaterializedTaskPacket,
): void {
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

export function appendResearchBriefDecisionRules(
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

export function appendStructuredResearchContext(
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

export function appendResearchSignalDriftContext(
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
