import type {
  ProfileCapabilitySignal,
  ProfileCommandCandidate,
  ProfileRepoSignals,
  ProfileSignalProvenance,
  ProfileSkippedCommandCandidate,
} from "../domain/profile.js";
import type { WorkspacePackageJsonManifest } from "./profile-repo-facts.js";

export interface ProfileCommandCatalogResult {
  commandCatalog: ProfileCommandCandidate[];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}

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

  const addSkipped = (candidate: ProfileSkippedCommandCandidate) => {
    const key = [
      candidate.id,
      candidate.reason,
      candidate.capability,
      candidate.provenance?.signal ?? "",
      candidate.provenance?.path ?? "",
    ].join("\0");
    const alreadyRecorded = skippedCommandCandidates.some(
      (existing) =>
        [
          existing.id,
          existing.reason,
          existing.capability,
          existing.provenance?.signal ?? "",
          existing.provenance?.path ?? "",
        ].join("\0") === key,
    );
    if (!alreadyRecorded) {
      skippedCommandCandidates.push(candidate);
    }
  };

  if (packageExportTargets.length === 1 && options.packageManager === "npm") {
    const [target] = packageExportTargets;
    if (!target) {
      return { commandCatalog, skippedCommandCandidates };
    }
    commandCatalog.push({
      id: "package-smoke-deep",
      roundId: "deep",
      label: "Package tarball smoke",
      command: "node",
      args: [
        "-e",
        [
          "const { mkdtempSync, readdirSync, rmSync } = require('node:fs');",
          "const { spawnSync } = require('node:child_process');",
          "const { join } = require('node:path');",
          "const { tmpdir } = require('node:os');",
          "const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';",
          "const tempDir = mkdtempSync(join(tmpdir(), 'oraculum-pack-smoke-'));",
          "let exitCode = 0;",
          "try {",
          "  const result = spawnSync(npmBinary, ['pack', '--pack-destination', tempDir], { encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' });",
          "  process.stdout.write(result.stdout || '');",
          "  process.stderr.write(result.stderr || '');",
          "  if ((result.status ?? 1) !== 0) {",
          "    exitCode = result.status ?? 1;",
          "  } else {",
          "    const tarballs = readdirSync(tempDir).filter((name) => name.endsWith('.tgz'));",
          "    if (tarballs.length === 0) { console.error('npm pack did not produce a tarball.'); exitCode = 1; }",
          "  }",
          "} finally {",
          "  rmSync(tempDir, { recursive: true, force: true });",
          "}",
          "if (exitCode !== 0) process.exit(exitCode);",
        ].join(" "),
      ],
      invariant: "The package should produce a real tarball before crowning.",
      pathPolicy: "inherit",
      source: "product-owned",
      capability: "package-export-smoke",
      ...(target.relativeCwd ? { relativeCwd: target.relativeCwd } : {}),
      safety: "product-owned-temporary",
      requiresExplicitOptIn: false,
      provenance: packageMetadataProvenance(target),
      safetyRationale: target.relativeCwd
        ? "Uses npm only when packageManager is explicitly npm and runs inside the selected workspace package before cleaning up the temporary tarball directory."
        : "Uses npm only when packageManager is explicitly npm and writes the tarball into a temporary directory that is removed before exit.",
    });
    commandCatalog.push({
      id: "pack-impact",
      roundId: "impact",
      label: "Package export check",
      command: "npm",
      args: ["pack", "--dry-run"],
      invariant: "The package should be packable for downstream consumers.",
      pathPolicy: "inherit",
      source: "product-owned",
      capability: "package-export-smoke",
      ...(target.relativeCwd ? { relativeCwd: target.relativeCwd } : {}),
      safety: "product-owned-read-only",
      requiresExplicitOptIn: false,
      provenance: packageMetadataProvenance(target),
      safetyRationale: target.relativeCwd
        ? "Uses npm pack --dry-run only when packageManager is explicitly npm and package export metadata exists in the selected workspace package."
        : "Uses npm pack --dry-run only when packageManager is explicitly npm and package export metadata exists.",
    });
  } else if (packageExportTargets.length === 1) {
    const [target] = packageExportTargets;
    if (!target) {
      return { commandCatalog, skippedCommandCandidates };
    }
    const reason =
      options.packageManager === "unknown"
        ? "ambiguous-package-manager"
        : "unsupported-package-manager";
    const detail =
      options.packageManager === "unknown"
        ? `${target.label} declares package export metadata, but no package manager was detected; Oraculum will not guess npm.`
        : `${target.label} declares package export metadata, but built-in package smoke checks are limited to explicit npm projects; detected ${options.packageManager}.`;
    for (const id of ["pack-impact", "package-smoke-deep"]) {
      addSkipped({
        id,
        label: id === "pack-impact" ? "Package export check" : "Package tarball smoke",
        capability: "package-export-smoke",
        reason,
        detail,
        provenance: packageMetadataProvenance(target),
      });
    }
  } else if (packageExportTargets.length > 1) {
    const detail = `Package export metadata was detected in multiple package manifests (${packageExportTargets.map((target) => target.path).join(", ")}); Oraculum will not guess which package to pack.`;
    for (const id of ["pack-impact", "package-smoke-deep"]) {
      addSkipped({
        id,
        label: id === "pack-impact" ? "Package export check" : "Package tarball smoke",
        capability: "package-export-smoke",
        reason: "ambiguous-workspace-command",
        detail,
        provenance: {
          signal: "build-system:package-export-metadata",
          source: packageExportTargets.some((target) => target.source === "workspace-config")
            ? "workspace-config"
            : "root-config",
          detail: "Multiple package manifests declare export metadata.",
        },
      });
    }
  }

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

function packageMetadataProvenance(target: {
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

function collectPackageExportTargets(
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined,
  workspacePackageJsons: WorkspacePackageJsonManifest[],
): Array<{
  label: string;
  path: string;
  relativeCwd?: string;
  source: ProfileSignalProvenance["source"];
}> {
  const targets: Array<{
    label: string;
    path: string;
    relativeCwd?: string;
    source: ProfileSignalProvenance["source"];
  }> = [];
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

function hasPackageExportMetadata(
  manifest:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined,
): boolean {
  return (
    manifest?.exports !== undefined || !!manifest?.main || !!manifest?.module || !!manifest?.types
  );
}
