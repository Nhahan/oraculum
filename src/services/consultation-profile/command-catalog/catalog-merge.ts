import type {
  ProfileCapabilitySignal,
  ProfileCommandCandidate,
  ProfileRepoSignals,
  ProfileSkippedCommandCandidate,
} from "../../../domain/profile.js";
import type { WorkspacePackageJsonManifest } from "../repo-facts.js";
import { appendPackageExportSmokeChecks } from "./package-export-smoke.js";
import { collectPackageExportTargets } from "./package-targets.js";
import type { ProfileCommandCatalogResult } from "./types.js";

export function buildCommandCatalog(options: {
  capabilities: ProfileCapabilitySignal[];
  explicitCommandCatalog: ProfileCommandCandidate[];
  explicitSkippedCommandCandidates: ProfileSkippedCommandCandidate[];
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined;
  packageManager: ProfileRepoSignals["packageManager"];
  workspacePackageJsons: WorkspacePackageJsonManifest[];
}): ProfileCommandCatalogResult {
  const commandCatalog = [...options.explicitCommandCatalog];
  const skippedCommandCandidates = [...options.explicitSkippedCommandCandidates];
  const packageExportTargets = collectPackageExportTargets(
    options.packageJson,
    options.workspacePackageJsons,
  );

  appendPackageExportSmokeChecks({
    commandCatalog,
    packageExportTargets,
    packageManager: options.packageManager,
    skippedCommandCandidates,
  });

  return { commandCatalog, skippedCommandCandidates };
}

export function hasCapabilityCommand(
  commandCatalog: ProfileCommandCandidate[],
  capability: string,
  roundIds?: ProfileCommandCandidate["roundId"][],
): boolean {
  return commandCatalog.some(
    (command) =>
      command.capability === capability &&
      (roundIds === undefined || roundIds.includes(command.roundId)),
  );
}
