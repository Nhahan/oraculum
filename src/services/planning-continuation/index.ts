import { readdir, readFile } from "node:fs/promises";

import type { AgentAdapter } from "../../adapters/types.js";
import { getRunsDir } from "../../core/paths.js";
import {
  consultationPlanArtifactSchema,
  type PlanConsensusArtifact,
  type PlanningDepthArtifact,
  type PlanningInterviewArtifact,
  type PlanningSpecArtifact,
  planConsensusArtifactSchema,
  planningDepthArtifactSchema,
  planningInterviewArtifactSchema,
  planningSpecArtifactSchema,
  runManifestSchema,
} from "../../domain/run.js";
import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";
import {
  type PlanConsensusBlockerSummary,
  summarizePlanConsensusBlocker,
} from "../plan-consensus/index.js";
import { pathExists } from "../project.js";
import { RunStore } from "../run-store.js";
import { loadTaskPacket } from "../task-packets.js";

export type ActivePlanningContinuationTarget =
  | {
      kind: "augury-interview";
      runId: string;
      interview: PlanningInterviewArtifact;
    }
  | {
      kind: "plan-conclave";
      runId: string;
      taskPath: string;
      taskPacket: MaterializedTaskPacket;
      planningDepth: PlanningDepthArtifact;
      planningSpec: PlanningSpecArtifact;
      consensus: PlanConsensusArtifact;
      blocker: PlanConsensusBlockerSummary;
    };

export async function findActivePlanningContinuationTarget(
  projectRoot: string,
): Promise<ActivePlanningContinuationTarget | undefined> {
  const runsDir = getRunsDir(projectRoot);
  if (!(await pathExists(runsDir))) {
    return undefined;
  }

  const store = new RunStore(projectRoot);
  const runIds = await listRunIdsByRecency(projectRoot);
  for (const runId of runIds) {
    const paths = store.getRunPaths(runId);
    const consensus = await readOptionalArtifact(
      paths.planConsensusPath,
      planConsensusArtifactSchema,
    );
    if (consensus?.runId === runId && !consensus.approved) {
      const blocker = summarizePlanConsensusBlocker(consensus);
      if (blocker.blockerKind === "runtime-unavailable") {
        return undefined;
      }

      const manifest = await readOptionalArtifact(paths.manifestPath, runManifestSchema);
      const planningDepth = await readOptionalArtifact(
        paths.planningDepthPath,
        planningDepthArtifactSchema,
      );
      const planningSpec = await readOptionalArtifact(
        paths.planningSpecPath,
        planningSpecArtifactSchema,
      );
      if (
        !manifest ||
        manifest.id !== runId ||
        !planningDepth ||
        planningDepth.runId !== runId ||
        !planningSpec ||
        planningSpec.runId !== runId
      ) {
        return undefined;
      }

      const sourceTaskPacket = await loadContinuationSourceTaskPacket({
        consultationPlanPath: paths.consultationPlanPath,
        fallbackTaskPath: manifest.taskPath,
        runId: manifest.id,
      });
      if (!sourceTaskPacket) {
        return undefined;
      }

      return {
        kind: "plan-conclave",
        runId,
        taskPath: manifest.taskPath,
        taskPacket: sourceTaskPacket,
        planningDepth,
        planningSpec,
        consensus,
        blocker,
      };
    }

    const interview = await readOptionalArtifact(
      paths.planningInterviewPath,
      planningInterviewArtifactSchema,
    );
    if (interview?.runId === runId && interview.status === "needs-clarification") {
      return {
        kind: "augury-interview",
        runId,
        interview,
      };
    }
  }

  return undefined;
}

async function loadContinuationSourceTaskPacket(options: {
  consultationPlanPath: string;
  fallbackTaskPath: string;
  runId: string;
}): Promise<MaterializedTaskPacket | undefined> {
  const consultationPlan = await readOptionalArtifact(
    options.consultationPlanPath,
    consultationPlanArtifactSchema,
  );
  if (consultationPlan?.runId === options.runId) {
    return consultationPlan.task;
  }

  try {
    return await loadTaskPacket(options.fallbackTaskPath);
  } catch {
    return undefined;
  }
}

export async function classifyPlanConsensusContinuation(options: {
  adapter: AgentAdapter | undefined;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  target: Extract<ActivePlanningContinuationTarget, { kind: "plan-conclave" }> | undefined;
  taskPacket: MaterializedTaskPacket;
}): Promise<Extract<ActivePlanningContinuationTarget, { kind: "plan-conclave" }> | undefined> {
  if (!options.target || !options.adapter?.classifyPlanConsensusContinuation) {
    return undefined;
  }

  try {
    const result = await options.adapter.classifyPlanConsensusContinuation({
      activeConsensus: options.target.consensus,
      blocker: {
        blockerKind: options.target.blocker.blockerKind,
        summary: options.target.blocker.summary,
        requiredChanges: options.target.blocker.requiredChanges,
      },
      logDir: options.reportsDir,
      planningSpec: options.target.planningSpec,
      projectRoot: options.projectRoot,
      runId: options.runId,
      taskPacket: options.taskPacket,
    });
    return result.status === "completed" &&
      result.recommendation?.classification === "consensus-remediation"
      ? options.target
      : undefined;
  } catch {
    return undefined;
  }
}

export function applyPlanConclaveRemediationAnswer(options: {
  answer: string;
  createdAt: string;
  planningDepth: PlanningDepthArtifact;
  planningSpec: PlanningSpecArtifact;
  runId: string;
  sourceRunId: string;
  sourceTaskPacket: MaterializedTaskPacket;
  blocker: PlanConsensusBlockerSummary;
}): {
  planningDepth: PlanningDepthArtifact;
  planningSpec: PlanningSpecArtifact;
  taskPacket: MaterializedTaskPacket;
} {
  const answerLine = `Plan Conclave remediation answer: ${options.answer}`;
  const requiredChangeLines = options.blocker.requiredChanges.map(
    (change) => `Plan Conclave required change: ${change}`,
  );

  return {
    planningDepth: planningDepthArtifactSchema.parse({
      ...options.planningDepth,
      runId: options.runId,
      createdAt: options.createdAt,
    }),
    planningSpec: planningSpecArtifactSchema.parse({
      ...options.planningSpec,
      runId: options.runId,
      createdAt: options.createdAt,
      assumptionsResolved: [...options.planningSpec.assumptionsResolved, answerLine],
      repoEvidence: [
        ...options.planningSpec.repoEvidence,
        `Plan Conclave continuation source run: ${options.sourceRunId}`,
        `Plan Conclave blocker: ${options.blocker.summary}`,
        ...requiredChangeLines,
      ],
    }),
    taskPacket: materializedTaskPacketSchema.parse({
      ...options.sourceTaskPacket,
      intent: `${options.sourceTaskPacket.intent.trim()}\n\n${answerLine}`,
    }),
  };
}

async function listRunIdsByRecency(projectRoot: string): Promise<string[]> {
  const entries = await readdir(getRunsDir(projectRoot), { withFileTypes: true });
  const store = new RunStore(projectRoot);
  const runSnapshots = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifest = await readOptionalArtifact(
          store.getRunPaths(entry.name).manifestPath,
          runManifestSchema,
        );
        return {
          runId: entry.name,
          timestamp: manifest?.updatedAt ?? manifest?.createdAt ?? "",
        };
      }),
  );

  return runSnapshots
    .sort((left, right) => {
      const byTimestamp = right.timestamp.localeCompare(left.timestamp);
      return byTimestamp !== 0 ? byTimestamp : right.runId.localeCompare(left.runId);
    })
    .map((snapshot) => snapshot.runId);
}

async function readOptionalArtifact<T>(
  path: string,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }

  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
