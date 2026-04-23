import { basename } from "node:path";

import type { AgentProfileRecommendation } from "../../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

import type { FallbackDetectedProfileId } from "../shared.js";

export function buildFallbackSummary(
  validationProfileId: FallbackDetectedProfileId,
  confidence: AgentProfileRecommendation["confidence"],
  taskPacket: MaterializedTaskPacket,
): string {
  const rationale =
    validationProfileId === "generic"
      ? "defaulted to the generic validation posture because runtime semantic posture selection was unavailable"
      : `used ${validationProfileId} validation posture from runtime semantic selection`;
  return `Fallback detection ${rationale}; confidence=${confidence} for task "${basename(taskPacket.source.path)}".`;
}
