import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, normalize, resolve as resolvePath } from "node:path";

import {
  type ConsultationPlanArtifact,
  type ConsultationResearchBrief,
  consultationPlanArtifactSchema,
  consultationResearchBriefSchema,
} from "../domain/run.js";
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
      return canonicalizeMaterializedTaskPacketSource(taskPath, withSource.data);
    }

    const consultationPlan = consultationPlanArtifactSchema.safeParse(parsed);
    if (consultationPlan.success) {
      return materializeConsultationPlanTaskPacket(taskPath, consultationPlan.data);
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

export async function readConsultationPlanArtifact(
  taskPath: string,
): Promise<ConsultationPlanArtifact | undefined> {
  if (extname(taskPath).toLowerCase() !== ".json") {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(taskPath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  const consultationPlan = consultationPlanArtifactSchema.safeParse(parsed);
  return consultationPlan.success ? consultationPlan.data : undefined;
}

function materializeResearchBriefTaskPacket(
  taskPath: string,
  researchBrief: ConsultationResearchBrief,
): MaterializedTaskPacket {
  const normalizedSourcePath = resolveTaskPacketSourcePath(taskPath, researchBrief.task.sourcePath);
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

function materializeConsultationPlanTaskPacket(
  taskPath: string,
  consultationPlan: ConsultationPlanArtifact,
): MaterializedTaskPacket {
  const originSourceKind =
    consultationPlan.task.source.originKind ?? consultationPlan.task.source.kind;
  const originSourcePath = resolveTaskPacketSourcePath(
    taskPath,
    consultationPlan.task.source.originPath ?? consultationPlan.task.source.path,
  );
  const planningContext = [
    "Continue the original task using the persisted consultation plan.",
    `Planned from consultation: ${consultationPlan.runId}`,
    `Plan readiness: ${consultationPlan.readyForConsult ? "ready for consult" : "address open questions before consult"}`,
    `Intended result: ${consultationPlan.intendedResult}`,
  ];

  if (consultationPlan.mode !== "standard") {
    planningContext.push(`Plan mode: ${consultationPlan.mode}`);
  }

  if (consultationPlan.preflight) {
    planningContext.push(
      `Preflight decision: ${consultationPlan.preflight.decision}`,
      `Preflight summary: ${consultationPlan.preflight.summary}`,
    );
    if (consultationPlan.preflight.clarificationQuestion) {
      planningContext.push(
        `Clarification question: ${consultationPlan.preflight.clarificationQuestion}`,
      );
    }
    if (consultationPlan.preflight.researchQuestion) {
      planningContext.push(`Research question: ${consultationPlan.preflight.researchQuestion}`);
    }
  }

  if (consultationPlan.decisionDrivers.length > 0) {
    planningContext.push(
      "Decision drivers:",
      ...consultationPlan.decisionDrivers.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.plannedStrategies.length > 0) {
    planningContext.push(
      "Planned strategies:",
      ...consultationPlan.plannedStrategies.map(
        (strategy) => `- ${strategy.label} (${strategy.id})`,
      ),
    );
  }

  if (consultationPlan.oracleIds.length > 0) {
    planningContext.push(
      "Planned oracles:",
      ...consultationPlan.oracleIds.map((oracleId) => `- ${oracleId}`),
    );
  }

  if (consultationPlan.requiredChangedPaths.length > 0) {
    planningContext.push(
      "Required changed paths:",
      ...consultationPlan.requiredChangedPaths.map((targetPath) => `- ${targetPath}`),
    );
  }

  if (consultationPlan.protectedPaths.length > 0) {
    planningContext.push(
      "Protected paths:",
      ...consultationPlan.protectedPaths.map((targetPath) => `- ${targetPath}`),
    );
  }

  if (consultationPlan.openQuestions.length > 0) {
    planningContext.push(
      "Open questions:",
      ...consultationPlan.openQuestions.map((item) => `- ${item}`),
    );
  }

  appendConsultationPlanExecutionGraphContext(planningContext, consultationPlan);

  planningContext.push(`Recommended next action: ${consultationPlan.recommendedNextAction}`);

  return materializedTaskPacketSchema.parse({
    ...consultationPlan.task,
    intent: `${consultationPlan.task.intent}\n\nConsultation plan context:\n${planningContext.join("\n")}`,
    nonGoals: dedupeStrings([
      ...consultationPlan.task.nonGoals,
      ...consultationPlan.protectedPaths.map((targetPath) => `Do not modify ${targetPath}.`),
    ]),
    acceptanceCriteria: dedupeStrings([
      ...consultationPlan.task.acceptanceCriteria,
      ...consultationPlan.requiredChangedPaths.map((targetPath) => `Must change ${targetPath}.`),
    ]),
    oracleHints: dedupeStrings([
      ...consultationPlan.task.oracleHints,
      ...consultationPlan.oracleIds.map((oracleId) => `Planned oracle: ${oracleId}`),
    ]),
    strategyHints: dedupeStrings([
      ...consultationPlan.task.strategyHints,
      ...consultationPlan.plannedStrategies.map(
        (strategy) => `Planned strategy: ${strategy.label} (${strategy.id})`,
      ),
    ]),
    contextFiles: dedupeStrings([...consultationPlan.task.contextFiles, originSourcePath]),
    source: {
      kind: "consultation-plan",
      path: taskPath,
      originKind: originSourceKind,
      originPath: originSourcePath,
    },
  });
}

function canonicalizeMaterializedTaskPacketSource(
  taskPath: string,
  taskPacket: MaterializedTaskPacket,
): MaterializedTaskPacket {
  const normalizedSourcePath = resolveTaskPacketSourcePath(taskPath, taskPacket.source.path);
  const normalizedOriginPath = taskPacket.source.originPath
    ? resolveTaskPacketSourcePath(taskPath, taskPacket.source.originPath)
    : undefined;

  return materializedTaskPacketSchema.parse({
    ...taskPacket,
    source: {
      ...taskPacket.source,
      path: normalizedSourcePath,
      ...(normalizedOriginPath ? { originPath: normalizedOriginPath } : {}),
    },
  });
}

function resolveTaskPacketSourcePath(taskPath: string, sourcePath: string): string {
  if (isAbsolute(sourcePath)) {
    return normalize(sourcePath);
  }

  return normalize(resolvePath(dirname(taskPath), sourcePath));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function appendConsultationPlanExecutionGraphContext(
  planningContext: string[],
  consultationPlan: ConsultationPlanArtifact,
): void {
  if (consultationPlan.mode === "standard") {
    return;
  }

  if (consultationPlan.workstreams.length > 0) {
    planningContext.push(
      "Planned workstreams:",
      ...consultationPlan.workstreams.flatMap((workstream) => {
        const lines = [`- ${workstream.label} (${workstream.id}): ${workstream.goal}`];
        if (workstream.targetArtifacts.length > 0) {
          lines.push(`  target artifacts: ${workstream.targetArtifacts.join(", ")}`);
        }
        if (workstream.requiredChangedPaths.length > 0) {
          lines.push(`  required paths: ${workstream.requiredChangedPaths.join(", ")}`);
        }
        if (workstream.protectedPaths.length > 0) {
          lines.push(`  protected paths: ${workstream.protectedPaths.join(", ")}`);
        }
        if (workstream.oracleIds.length > 0) {
          lines.push(`  oracle ids: ${workstream.oracleIds.join(", ")}`);
        }
        if (workstream.dependencies.length > 0) {
          lines.push(`  depends on: ${workstream.dependencies.join(", ")}`);
        }
        if (workstream.disqualifiers.length > 0) {
          lines.push(`  disqualifiers: ${workstream.disqualifiers.join(" | ")}`);
        }
        return lines;
      }),
    );
  }

  if (consultationPlan.stagePlan.length > 0) {
    planningContext.push(
      "Planned stage order:",
      ...consultationPlan.stagePlan.flatMap((stage) => {
        const lines = [`- ${stage.label} (${stage.id})`];
        if (stage.workstreamIds.length > 0) {
          lines.push(`  workstreams: ${stage.workstreamIds.join(", ")}`);
        }
        if (stage.roundIds.length > 0) {
          lines.push(`  rounds: ${stage.roundIds.join(", ")}`);
        }
        if (stage.entryCriteria.length > 0) {
          lines.push(`  entry criteria: ${stage.entryCriteria.join(" | ")}`);
        }
        if (stage.exitCriteria.length > 0) {
          lines.push(`  exit criteria: ${stage.exitCriteria.join(" | ")}`);
        }
        return lines;
      }),
    );
  }

  if (
    consultationPlan.scorecardDefinition.dimensions.length > 0 ||
    consultationPlan.scorecardDefinition.abstentionTriggers.length > 0
  ) {
    planningContext.push(
      "Planned scorecard:",
      ...(consultationPlan.scorecardDefinition.dimensions.length > 0
        ? consultationPlan.scorecardDefinition.dimensions.map(
            (dimension) => `- dimension: ${dimension}`,
          )
        : []),
      ...(consultationPlan.scorecardDefinition.abstentionTriggers.length > 0
        ? consultationPlan.scorecardDefinition.abstentionTriggers.map(
            (trigger) => `- abstain on: ${trigger}`,
          )
        : []),
    );
  }

  if (
    consultationPlan.repairPolicy.maxAttemptsPerStage > 0 ||
    consultationPlan.repairPolicy.immediateElimination.length > 0 ||
    consultationPlan.repairPolicy.repairable.length > 0 ||
    consultationPlan.repairPolicy.preferAbstainOverRetry.length > 0
  ) {
    planningContext.push(
      "Planned repair policy:",
      `- max attempts per stage: ${consultationPlan.repairPolicy.maxAttemptsPerStage}`,
      ...(consultationPlan.repairPolicy.immediateElimination.length > 0
        ? consultationPlan.repairPolicy.immediateElimination.map(
            (item) => `- immediate elimination: ${item}`,
          )
        : []),
      ...(consultationPlan.repairPolicy.repairable.length > 0
        ? consultationPlan.repairPolicy.repairable.map((item) => `- repairable: ${item}`)
        : []),
      ...(consultationPlan.repairPolicy.preferAbstainOverRetry.length > 0
        ? consultationPlan.repairPolicy.preferAbstainOverRetry.map(
            (item) => `- prefer abstain over retry: ${item}`,
          )
        : []),
    );
  }
}
