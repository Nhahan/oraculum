import { basename } from "node:path";

import type { AgentProfileRecommendation, ProfileRepoSignals } from "../../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

import type { FallbackAnchoredProfileId, FallbackDetectedProfileId } from "../shared.js";

export function buildFallbackSummary(
  profileId: FallbackDetectedProfileId,
  confidence: AgentProfileRecommendation["confidence"],
  anchoredProfiles: FallbackAnchoredProfileId[],
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): string {
  const topCommandIds =
    signals.commandCatalog
      .filter((command) => command.source === "repo-local-script")
      .map((command) => command.id)
      .slice(0, 4)
      .join(", ") || "no executable command evidence";
  const rationale =
    profileId !== "generic"
      ? `detected a unique ${profileId} validation posture anchor from executable command evidence (${topCommandIds})`
      : anchoredProfiles.length > 1
        ? `defaulted to the generic validation posture because posture-specific validation anchors conflicted (${anchoredProfiles.join(", ")})`
        : "defaulted to the generic validation posture because no executable posture-specific validation anchor was detected";
  return `Fallback detection ${rationale}; confidence=${confidence} for task "${basename(taskPacket.source.path)}".`;
}
