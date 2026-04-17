import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  type ConsultationPlanArtifact,
  consultationPlanArtifactSchema,
  consultationResearchBriefSchema,
} from "../../domain/run.js";
import {
  deriveTaskPacketId,
  extractTaskTitle,
  type MaterializedTaskPacket,
  materializedTaskPacketSchema,
  taskPacketSchema,
} from "../../domain/task.js";

import { materializeConsultationPlanTaskPacket } from "./materialize-consultation-plan.js";
import { materializeResearchBriefTaskPacket } from "./materialize-research-brief.js";
import { canonicalizeMaterializedTaskPacketSource } from "./source-paths.js";

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
