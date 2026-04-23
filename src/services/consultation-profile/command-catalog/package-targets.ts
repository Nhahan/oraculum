import type { ProfileSignalProvenance } from "../../../domain/profile.js";
import type { WorkspacePackageJsonManifest } from "../repo-facts.js";

interface PackageExportMetadata {
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
}

export interface PackageExportTarget {
  label: string;
  path: string;
  relativeCwd?: string;
  source: ProfileSignalProvenance["source"];
}

export function collectPackageExportTargets(
  packageJson: PackageExportMetadata | undefined,
  workspacePackageJsons: WorkspacePackageJsonManifest[],
): PackageExportTarget[] {
  const targets: PackageExportTarget[] = [];
  if (hasPackageExportMetadata(packageJson)) {
    targets.push({
      label: "The root package",
      path: "package.json",
      source: "root-config",
    });
  }
  for (const workspaceManifest of workspacePackageJsons) {
    if (!hasPackageExportMetadata(workspaceManifest.packageJson)) {
      continue;
    }
    targets.push({
      label: `Workspace package ${workspaceManifest.root}`,
      path: workspaceManifest.manifestPath,
      relativeCwd: workspaceManifest.root,
      source: "workspace-config",
    });
  }
  return targets;
}

export function packageMetadataProvenance(target: {
  path: string;
  source: ProfileSignalProvenance["source"];
}): ProfileSignalProvenance {
  return {
    signal: "build-system:package-export-metadata",
    source: target.source,
    path: target.path,
    detail:
      target.source === "workspace-config"
        ? "Workspace package export metadata."
        : "Package export metadata.",
  };
}

function hasPackageExportMetadata(manifest: PackageExportMetadata | undefined): boolean {
  return (
    manifest?.exports !== undefined || !!manifest?.main || !!manifest?.module || !!manifest?.types
  );
}
