import { isAbsolute, relative } from "node:path";

import type { ProfileSkippedCommandCandidate } from "../../domain/profile.js";

import { resolveConsultationArtifacts } from "../consultation-artifacts.js";

export type ConsultationSurface = "chat-native";

export function toDisplayPath(projectRoot: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) {
    return targetPath.replaceAll("\\", "/");
  }

  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  if (display.length === 0) {
    return ".";
  }

  if (display === ".." || display.startsWith("../") || isAbsolute(display)) {
    return targetPath.replaceAll("\\", "/");
  }

  return display;
}

export function getSurfaceCommand(command: "consult" | "verdict" | "crown"): string {
  return `orc ${command}`;
}

export async function readSkippedProfileCommands(
  projectRoot: string,
  runId: string,
): Promise<ProfileSkippedCommandCandidate[]> {
  const artifacts = await resolveConsultationArtifacts(projectRoot, runId);
  return artifacts.profileSelection?.signals.skippedCommandCandidates ?? [];
}
