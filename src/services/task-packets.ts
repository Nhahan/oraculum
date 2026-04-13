import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { type ConsultationResearchBrief, consultationResearchBriefSchema } from "../domain/run.js";
import {
  deriveTaskPacketId,
  extractTaskTitle,
  type MaterializedTaskPacket,
  materializedTaskPacketSchema,
  taskPacketSchema,
} from "../domain/task.js";

export async function loadTaskPacket(taskPath: string): Promise<MaterializedTaskPacket> {
  const content = await readFile(taskPath, "utf8");
  const extension = extname(taskPath).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(content) as unknown;
    const withSource = materializedTaskPacketSchema.safeParse(parsed);
    if (withSource.success) {
      return withSource.data;
    }

    const researchBrief = consultationResearchBriefSchema.safeParse(parsed);
    if (researchBrief.success) {
      return materializeResearchBriefTaskPacket(taskPath, researchBrief.data);
    }

    const taskPacket = taskPacketSchema.parse(parsed);
    return materializedTaskPacketSchema.parse({
      ...taskPacket,
      source: {
        kind: "task-packet",
        path: taskPath,
      },
    });
  }

  return materializedTaskPacketSchema.parse({
    id: deriveTaskPacketId(taskPath),
    title: extractTaskTitle(taskPath, content),
    intent: content.trim(),
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [],
    source: {
      kind: "task-note",
      path: taskPath,
    },
  });
}

function materializeResearchBriefTaskPacket(
  taskPath: string,
  researchBrief: ConsultationResearchBrief,
): MaterializedTaskPacket {
  const contextLines = [
    `Continue the original task using the required research context.`,
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
    },
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [researchBrief.task.sourcePath],
    source: {
      kind: "research-brief",
      path: taskPath,
      originKind: researchBrief.task.sourceKind,
      originPath: researchBrief.task.sourcePath,
    },
  });
}
