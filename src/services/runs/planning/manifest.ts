import type { ProjectConfig } from "../../../domain/config.js";
import type { CandidateManifest, RunManifest, RunRound } from "../../../domain/run.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

export function buildManifestTaskPacket(
  taskPacket: MaterializedTaskPacket,
): RunManifest["taskPacket"] {
  return {
    id: taskPacket.id,
    title: taskPacket.title,
    sourceKind: taskPacket.source.kind,
    sourcePath: taskPacket.source.path,
    ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
    ...(taskPacket.targetArtifactPath ? { targetArtifactPath: taskPacket.targetArtifactPath } : {}),
    ...(taskPacket.researchContext ? { researchContext: taskPacket.researchContext } : {}),
    ...(taskPacket.source.originKind && taskPacket.source.originPath
      ? {
          originKind: taskPacket.source.originKind,
          originPath: taskPacket.source.originPath,
        }
      : {}),
  };
}

export function buildPendingRounds(config: ProjectConfig): RunRound[] {
  return config.rounds.map<RunRound>((round) => ({
    id: round.id,
    label: round.label,
    status: "pending",
    verdictCount: 0,
    survivorCount: 0,
    eliminatedCount: 0,
  }));
}

export function createPlannedCandidate(options: {
  candidateId: string;
  createdAt: string;
  strategy: ProjectConfig["strategies"][number];
  taskPacketPath: string;
  workspaceDir: string;
}): CandidateManifest {
  return {
    id: options.candidateId,
    strategyId: options.strategy.id,
    strategyLabel: options.strategy.label,
    status: "planned",
    workspaceDir: options.workspaceDir,
    taskPacketPath: options.taskPacketPath,
    repairCount: 0,
    repairedRounds: [],
    createdAt: options.createdAt,
  };
}
