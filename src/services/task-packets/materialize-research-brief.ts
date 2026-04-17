import type { ConsultationResearchBrief } from "../../domain/run.js";
import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";

import { resolveTaskPacketSourcePath } from "./source-paths.js";

export function materializeResearchBriefTaskPacket(
  taskPath: string,
  researchBrief: ConsultationResearchBrief,
): MaterializedTaskPacket {
  const normalizedSourcePath = resolveTaskPacketSourcePath(taskPath, researchBrief.task.sourcePath);
  const contextLines = [
    "Continue the original task using the required research context.",
    `Original task: ${researchBrief.task.title}`,
    `Research question: ${researchBrief.question}`,
    `Research summary: ${researchBrief.summary}`,
  ];

  if (researchBrief.signalSummary.length > 0) {
    contextLines.push("Repo signals:", ...researchBrief.signalSummary.map((line) => `- ${line}`));
  }

  if (researchBrief.sources.length > 0) {
    contextLines.push(
      "Research sources:",
      ...researchBrief.sources.map(
        (source) => `- [${source.kind}] ${source.title} — ${source.locator}`,
      ),
    );
  }

  if (researchBrief.claims.length > 0) {
    contextLines.push(
      "Research claims:",
      ...researchBrief.claims.map((claim) =>
        claim.sourceLocators.length > 0
          ? `- ${claim.statement} (sources: ${claim.sourceLocators.join(", ")})`
          : `- ${claim.statement}`,
      ),
    );
  }

  if (researchBrief.versionNotes.length > 0) {
    contextLines.push("Version notes:", ...researchBrief.versionNotes.map((note) => `- ${note}`));
  }

  if (researchBrief.unresolvedConflicts.length > 0) {
    contextLines.push(
      "Unresolved conflicts:",
      ...researchBrief.unresolvedConflicts.map((conflict) => `- ${conflict}`),
    );
  }

  if (researchBrief.notes.length > 0) {
    contextLines.push("Research notes:", ...researchBrief.notes.map((line) => `- ${line}`));
  }

  return materializedTaskPacketSchema.parse({
    id: researchBrief.task.id,
    title: researchBrief.task.title,
    intent: contextLines.join("\n"),
    ...(researchBrief.task.artifactKind ? { artifactKind: researchBrief.task.artifactKind } : {}),
    ...(researchBrief.task.targetArtifactPath
      ? { targetArtifactPath: researchBrief.task.targetArtifactPath }
      : {}),
    researchContext: {
      question: researchBrief.question,
      summary: researchBrief.summary,
      ...(researchBrief.confidence ? { confidence: researchBrief.confidence } : {}),
      signalSummary: researchBrief.signalSummary,
      ...(researchBrief.signalFingerprint
        ? { signalFingerprint: researchBrief.signalFingerprint }
        : {}),
      sources: researchBrief.sources,
      claims: researchBrief.claims,
      versionNotes: researchBrief.versionNotes,
      unresolvedConflicts: researchBrief.unresolvedConflicts,
      conflictHandling: researchBrief.conflictHandling,
    },
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [normalizedSourcePath],
    source: {
      kind: "research-brief",
      path: taskPath,
      originKind: researchBrief.task.sourceKind,
      originPath: normalizedSourcePath,
    },
  });
}
