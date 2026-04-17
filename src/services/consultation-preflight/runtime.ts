import type { AgentAdapter } from "../../adapters/types.js";
import { consultationPreflightSchema } from "../../domain/run.js";

import { writePreflightArtifacts } from "./artifacts.js";
import { maybeWriteClarifyFollowUp } from "./clarify.js";
import { buildFallbackPreflight, isClarifyBlockedPreflight } from "./fallback.js";
import { collectPreflightSignalContext } from "./signals.js";
import type {
  RecommendConsultationPreflightOptions,
  RecommendedConsultationPreflight,
} from "./types.js";

export async function recommendConsultationPreflight(
  options: RecommendConsultationPreflightOptions,
): Promise<RecommendedConsultationPreflight> {
  const signalContext = await collectPreflightSignalContext(
    options.projectRoot,
    options.configLayers,
    options.taskPacket,
  );
  const allowRuntime = options.allowRuntime ?? true;
  let llmResult: Awaited<ReturnType<AgentAdapter["recommendPreflight"]>> | undefined;
  let llmFailure: string | undefined;

  if (allowRuntime) {
    try {
      llmResult = await options.adapter.recommendPreflight({
        runId: options.runId,
        projectRoot: options.projectRoot,
        logDir: options.reportsDir,
        taskPacket: options.taskPacket,
        signals: signalContext.signals,
      });
    } catch (error) {
      llmFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const preflight =
    llmResult?.status === "completed" && llmResult.recommendation
      ? llmResult.recommendation
      : buildFallbackPreflight({
          runtimeAttempted: allowRuntime,
          taskPacket: options.taskPacket,
          ...(llmFailure ? { llmFailure } : {}),
        });
  const clarifyFollowUp = isClarifyBlockedPreflight(preflight)
    ? await maybeWriteClarifyFollowUp({
        adapter: options.adapter,
        preflight,
        projectRoot: options.projectRoot,
        runId: options.runId,
        signals: signalContext.signals,
        taskPacket: options.taskPacket,
      })
    : undefined;
  const recommendedPreflight = await writePreflightArtifacts({
    allowRuntime,
    ...(clarifyFollowUp ? { clarifyFollowUp } : {}),
    ...(llmFailure ? { llmFailure } : {}),
    ...(llmResult ? { llmResult } : {}),
    preflight,
    projectRoot: options.projectRoot,
    runId: options.runId,
    signalContext,
    taskPacket: options.taskPacket,
  });

  return {
    ...(clarifyFollowUp ? { clarifyFollowUp } : {}),
    preflight: consultationPreflightSchema.parse(recommendedPreflight),
    signals: signalContext.signals,
  };
}
