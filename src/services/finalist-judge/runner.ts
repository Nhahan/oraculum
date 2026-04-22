import { mkdir } from "node:fs/promises";

import type { AgentAdapter, AgentJudgeRequest, AgentJudgeResult } from "../../adapters/types.js";
import { agentJudgeResultSchema } from "../../adapters/types.js";
import type { ConsultationProfileSelection } from "../../domain/profile.js";
import type { ConsultationPlanArtifact } from "../../domain/run.js";
import { materializedTaskPacketSchema } from "../../domain/task.js";
import { writeTextFileAtomically } from "../project.js";

import type { JudgableFinalists } from "./scorecards.js";

export async function runFinalistJudge(options: {
  adapter: AgentAdapter;
  consultationPlan?: ConsultationPlanArtifact;
  consultationProfile?: ConsultationProfileSelection;
  finalists: JudgableFinalists;
  logDir: string;
  projectRoot: string;
  runId: string;
  taskPacket: unknown;
}): Promise<AgentJudgeResult> {
  await mkdir(options.logDir, { recursive: true });
  return agentJudgeResultSchema.parse(
    await options.adapter.recommendWinner(
      buildJudgeRequest({
        finalists: options.finalists,
        logDir: options.logDir,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
        ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
        ...(options.consultationProfile
          ? { consultationProfile: options.consultationProfile }
          : {}),
      }),
    ),
  );
}

export async function writeJudgeWarning(resultPath: string, message: string): Promise<void> {
  await writeTextFileAtomically(`${resultPath}.warning.txt`, `${message}\n`);
}

export function canonicalizeSecondOpinionJudgeResult(
  result: AgentJudgeResult | undefined,
): AgentJudgeResult | undefined {
  if (!result || result.status === "completed") {
    return result;
  }

  const { recommendation: _ignoredRecommendation, ...rest } = result;
  return agentJudgeResultSchema.parse(rest);
}

function buildJudgeRequest(options: {
  consultationPlan?: ConsultationPlanArtifact;
  consultationProfile?: ConsultationProfileSelection;
  finalists: JudgableFinalists;
  logDir: string;
  projectRoot: string;
  runId: string;
  taskPacket: unknown;
}): AgentJudgeRequest {
  const taskPacket = materializedTaskPacketSchema.parse(options.taskPacket);
  return {
    runId: options.runId,
    projectRoot: options.projectRoot,
    logDir: options.logDir,
    taskPacket,
    finalists: options.finalists,
    ...(options.consultationPlan
      ? {
          plannedJudgingPreset: {
            decisionDrivers: options.consultationPlan.decisionDrivers,
            plannedJudgingCriteria: options.consultationPlan.plannedJudgingCriteria,
            crownGates: options.consultationPlan.crownGates,
          },
        }
      : {}),
    ...(options.consultationProfile
      ? {
          consultationProfile: {
            confidence: options.consultationProfile.confidence,
            validationProfileId: options.consultationProfile.validationProfileId,
            validationSummary: options.consultationProfile.validationSummary,
            validationSignals: options.consultationProfile.validationSignals,
            validationGaps: options.consultationProfile.validationGaps,
          },
        }
      : {}),
  };
}
