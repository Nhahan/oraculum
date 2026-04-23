import type {
  ProfileCommandCandidate,
  ProfileRepoSignals,
  ProfileSkippedCommandCandidate,
} from "../../../domain/profile.js";
import { appendSkippedCommandCandidate } from "./capability-skips.js";
import { type PackageExportTarget, packageMetadataProvenance } from "./package-targets.js";

export function appendPackageExportSmokeChecks(options: {
  commandCatalog: ProfileCommandCandidate[];
  packageExportTargets: PackageExportTarget[];
  packageManager: ProfileRepoSignals["packageManager"];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}): void {
  if (options.packageExportTargets.length === 1 && options.packageManager === "npm") {
    const [target] = options.packageExportTargets;
    if (!target) {
      return;
    }
    options.commandCatalog.push({
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
    options.commandCatalog.push({
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
    return;
  }

  if (options.packageExportTargets.length === 1) {
    appendSinglePackageExportSkip(options);
    return;
  }

  if (options.packageExportTargets.length > 1) {
    appendAmbiguousPackageExportSkip(options);
  }
}

function appendSinglePackageExportSkip(options: {
  packageExportTargets: PackageExportTarget[];
  packageManager: ProfileRepoSignals["packageManager"];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}): void {
  const [target] = options.packageExportTargets;
  if (!target) {
    return;
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
    appendSkippedCommandCandidate(options.skippedCommandCandidates, {
      id,
      label: id === "pack-impact" ? "Package export check" : "Package tarball smoke",
      capability: "package-export-smoke",
      reason,
      detail,
      provenance: packageMetadataProvenance(target),
    });
  }
}

function appendAmbiguousPackageExportSkip(options: {
  packageExportTargets: PackageExportTarget[];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}): void {
  const detail = `Package export metadata was detected in multiple package manifests (${options.packageExportTargets.map((target) => target.path).join(", ")}); Oraculum will not guess which package to pack.`;
  for (const id of ["pack-impact", "package-smoke-deep"]) {
    appendSkippedCommandCandidate(options.skippedCommandCandidates, {
      id,
      label: id === "pack-impact" ? "Package export check" : "Package tarball smoke",
      capability: "package-export-smoke",
      reason: "ambiguous-workspace-command",
      detail,
      provenance: {
        signal: "build-system:package-export-metadata",
        source: options.packageExportTargets.some((target) => target.source === "workspace-config")
          ? "workspace-config"
          : "root-config",
        detail: "Multiple package manifests declare export metadata.",
      },
    });
  }
}
