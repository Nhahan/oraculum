import { deriveResearchSignalFingerprint, type MaterializedTaskPacket } from "../../domain/task.js";
import { collectProfileRepoSignals } from "../consultation-profile.js";
import type { ProjectConfigLayers } from "../project.js";

import type { PreflightSignalContext } from "./types.js";

export async function collectPreflightSignalContext(
  projectRoot: string,
  configLayers: ProjectConfigLayers,
  taskPacket: MaterializedTaskPacket,
): Promise<PreflightSignalContext> {
  const signals = await collectProfileRepoSignals(projectRoot, {
    rules: configLayers.config.managedTree,
  });
  const signalSummary = signals.capabilities.map(
    (capability) => `${capability.kind}:${capability.value}`,
  );
  const signalFingerprint =
    signalSummary.length > 0 ? deriveResearchSignalFingerprint(signalSummary) : undefined;
  const researchBasisDrift =
    taskPacket.researchContext?.signalFingerprint && signalFingerprint
      ? signalFingerprint !== taskPacket.researchContext.signalFingerprint
      : taskPacket.researchContext?.signalFingerprint
        ? true
        : undefined;

  return {
    ...(researchBasisDrift !== undefined ? { researchBasisDrift } : {}),
    ...(signalFingerprint ? { signalFingerprint } : {}),
    signalSummary,
    signals,
  };
}
