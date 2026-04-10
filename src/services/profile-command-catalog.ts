import type {
  ProfileCapabilitySignal,
  ProfileCommandCandidate,
  ProfileRepoSignals,
  ProfileSignalProvenance,
  ProfileSkippedCommandCandidate,
} from "../domain/profile.js";

const DEDUPED_PACKAGE_SCRIPT_CAPABILITIES = new Set([
  "build",
  "changed-area-test",
  "e2e-or-visual",
  "full-suite-test",
  "migration-dry-run",
  "rollback-simulation",
  "unit-test",
]);

export interface ProfileCommandCatalogResult {
  commandCatalog: ProfileCommandCandidate[];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}

export function buildCommandCatalog(options: {
  capabilities: ProfileCapabilitySignal[];
  packageJson:
    | {
        scripts?: Record<string, string>;
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined;
  packageManager: ProfileRepoSignals["packageManager"];
  scripts: string[];
}): ProfileCommandCatalogResult {
  const scripts = new Set(options.scripts);
  const commandCatalog: ProfileCommandCandidate[] = [];
  const skippedCommandCandidates: ProfileSkippedCommandCandidate[] = [];
  const hasPackageExport =
    options.packageJson?.exports !== undefined ||
    options.packageJson?.main ||
    options.packageJson?.module ||
    options.packageJson?.types;

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

  const addScriptCommand = (
    id: string,
    roundId: ProfileCommandCandidate["roundId"],
    label: string,
    script: string,
    capability: string,
    invariant: string,
  ): boolean => {
    if (!scripts.has(script)) {
      return false;
    }
    const provenance = packageScriptProvenance(script);
    const scriptBody = options.packageJson?.scripts?.[script];
    const command = buildScriptCommand(options.packageManager, script);
    if (!command) {
      addSkipped({
        id,
        label,
        capability,
        reason: "ambiguous-package-manager",
        detail: `package.json script "${script}" exists, but no package manager was detected; Oraculum will not guess npm.`,
        provenance,
      });
      return true;
    }
    commandCatalog.push({
      id,
      roundId,
      label,
      command: command.command,
      args: command.args,
      invariant,
      ...(scriptBody && DEDUPED_PACKAGE_SCRIPT_CAPABILITIES.has(capability)
        ? { dedupeKey: `package-script:${normalizeScriptBody(scriptBody)}` }
        : {}),
      pathPolicy: "inherit",
      source: "repo-local-script",
      capability,
      safety: "repo-local-declared",
      requiresExplicitOptIn: false,
      provenance,
      safetyRationale:
        "Uses a repo-local package.json script selected by command id; Oraculum does not infer a tool-specific command.",
    });
    return true;
  };

  addScriptCommand(
    "lint-fast",
    "fast",
    "Lint",
    "lint",
    "lint",
    "The codebase should satisfy lint checks.",
  );
  for (const script of ["typecheck", "check-types", "tsc"]) {
    if (
      addScriptCommand(
        "typecheck-fast",
        "fast",
        "Typecheck",
        script,
        "typecheck",
        "The codebase should satisfy type checking.",
      )
    ) {
      break;
    }
  }
  for (const script of ["schema:check", "check:schema", "db:schema", "prisma:validate"]) {
    if (
      addScriptCommand(
        "schema-fast",
        "fast",
        "Schema validation",
        script,
        "schema-validation",
        "Schema definitions should validate cleanly.",
      )
    ) {
      break;
    }
  }
  for (const script of ["test:unit", "unit"]) {
    if (
      addScriptCommand(
        "unit-impact",
        "impact",
        "Unit tests",
        script,
        "unit-test",
        "Impacted unit tests should pass.",
      )
    ) {
      break;
    }
  }
  for (const script of ["test:changed", "test:affected", "affected:test"]) {
    if (
      addScriptCommand(
        "changed-tests-impact",
        "impact",
        "Changed-area tests",
        script,
        "changed-area-test",
        "Changed-area tests should pass.",
      )
    ) {
      break;
    }
  }
  addScriptCommand(
    "build-impact",
    "impact",
    "Build",
    "build",
    "build",
    "The project should build successfully after the patch.",
  );
  for (const script of [
    "migration:dry-run",
    "migrate:dry-run",
    "db:dry-run",
    "migration:status",
    "migrate:status",
    "prisma:migrate:status",
  ]) {
    if (
      addScriptCommand(
        "migration-impact",
        "impact",
        "Migration dry-run",
        script,
        "migration-dry-run",
        "Migration planning or dry-run should succeed.",
      )
    ) {
      break;
    }
  }
  for (const script of [
    "e2e",
    "test:e2e",
    "playwright",
    "cypress",
    "visual",
    "test:visual",
    "test:smoke",
    "smoke",
  ]) {
    if (
      addScriptCommand(
        "e2e-deep",
        "deep",
        "End-to-end or visual checks",
        script,
        "e2e-or-visual",
        "Deep end-to-end or visual validation should pass.",
      )
    ) {
      break;
    }
  }
  for (const script of ["test", "test:full", "test:ci", "ci:test", "verify", "check"]) {
    if (
      addScriptCommand(
        "full-suite-deep",
        "deep",
        "Full test suite",
        script,
        "full-suite-test",
        "The full test suite should pass before crowning.",
      )
    ) {
      break;
    }
  }
  if (hasPackageExport && options.packageManager === "npm") {
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
      safety: "product-owned-temporary",
      requiresExplicitOptIn: false,
      provenance: packageMetadataProvenance("package-export"),
      safetyRationale:
        "Uses npm only when packageManager is explicitly npm and writes the tarball into a temporary directory that is removed before exit.",
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
      safety: "product-owned-read-only",
      requiresExplicitOptIn: false,
      provenance: packageMetadataProvenance("package-export"),
      safetyRationale:
        "Uses npm pack --dry-run only when packageManager is explicitly npm and package export metadata exists.",
    });
  } else if (hasPackageExport) {
    const reason =
      options.packageManager === "unknown"
        ? "ambiguous-package-manager"
        : "unsupported-package-manager";
    const detail =
      options.packageManager === "unknown"
        ? "Package export metadata exists, but no package manager was detected; Oraculum will not guess npm."
        : `Package export metadata exists, but built-in package smoke checks are limited to explicit npm projects; detected ${options.packageManager}.`;
    for (const id of ["pack-impact", "package-smoke-deep"]) {
      addSkipped({
        id,
        label: id === "pack-impact" ? "Package export check" : "Package tarball smoke",
        capability: "package-export-smoke",
        reason,
        detail,
        provenance: packageMetadataProvenance("package-export"),
      });
    }
  }
  for (const script of [
    "migration:rollback",
    "rollback:simulate",
    "rollback:simulation",
    "db:rollback:dry-run",
  ]) {
    if (
      addScriptCommand(
        "rollback-deep",
        "deep",
        "Rollback simulation",
        script,
        "rollback-simulation",
        "Rollback simulation should succeed.",
      )
    ) {
      break;
    }
  }

  recordCapabilitySkips({
    commandCatalog,
    capabilities: options.capabilities,
    addSkipped,
  });

  return { commandCatalog, skippedCommandCandidates };
}

function recordCapabilitySkips(options: {
  commandCatalog: ProfileCommandCandidate[];
  capabilities: ProfileCapabilitySignal[];
  addSkipped: (candidate: ProfileSkippedCommandCandidate) => void;
}): void {
  const commandIds = new Set(options.commandCatalog.map((command) => command.id));
  const e2eCapability = options.capabilities.find(
    (capability) =>
      capability.kind === "test-runner" &&
      (capability.value === "playwright" || capability.value === "cypress"),
  );
  if (e2eCapability && !commandIds.has("e2e-deep")) {
    options.addSkipped({
      id: "e2e-deep",
      label: "End-to-end or visual checks",
      capability: "e2e-or-visual",
      reason: "missing-explicit-command",
      detail:
        "A test-runner capability was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
      provenance: capabilityProvenance(e2eCapability),
    });
  }

  const migrationCapability = options.capabilities.find(
    (capability) => capability.kind === "migration-tool",
  );
  if (
    migrationCapability &&
    !commandIds.has("schema-fast") &&
    !commandIds.has("migration-impact") &&
    !commandIds.has("rollback-deep")
  ) {
    options.addSkipped({
      id: "migration-impact",
      label: "Migration dry-run",
      capability: "migration-dry-run",
      reason: "missing-explicit-command",
      detail:
        "A migration-tool capability was detected, but no repo-local migration validation script or explicit oracle exposes the executable command.",
      provenance: capabilityProvenance(migrationCapability),
    });
  }
}

function normalizeScriptBody(scriptBody: string): string {
  return scriptBody.trim().replace(/\s+/gu, " ");
}

function buildScriptCommand(
  packageManager: ProfileRepoSignals["packageManager"],
  script: string,
): { command: string; args: string[] } | undefined {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: ["run", script] };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: [script] };
  }
  if (packageManager === "bun") {
    return { command: "bun", args: ["run", script] };
  }
  if (packageManager === "npm") {
    return { command: "npm", args: ["run", script] };
  }
  return undefined;
}

function packageScriptProvenance(script: string): ProfileSignalProvenance {
  return {
    signal: `script:${script}`,
    source: "root-config",
    path: "package.json",
    detail: "Repo-local package.json script.",
  };
}

function packageMetadataProvenance(signal: string): ProfileSignalProvenance {
  return {
    signal,
    source: "root-config",
    path: "package.json",
    detail: "Package export metadata.",
  };
}

function capabilityProvenance(capability: ProfileCapabilitySignal): ProfileSignalProvenance {
  return {
    signal: `${capability.kind}:${capability.value}`,
    source: capability.source,
    ...(capability.path ? { path: capability.path } : {}),
    ...(capability.detail ? { detail: capability.detail } : {}),
  };
}
