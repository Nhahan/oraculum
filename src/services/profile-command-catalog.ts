import type { ProfileCommandCandidate, ProfileRepoSignals } from "../domain/profile.js";

export function buildCommandCatalog(options: {
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
}): ProfileCommandCandidate[] {
  const scripts = new Set(options.scripts);
  const catalog: ProfileCommandCandidate[] = [];
  const hasPackageExport =
    options.packageJson?.exports !== undefined ||
    options.packageJson?.main ||
    options.packageJson?.module ||
    options.packageJson?.types;

  const addScriptCommand = (
    id: string,
    roundId: ProfileCommandCandidate["roundId"],
    label: string,
    script: string,
    invariant: string,
  ) => {
    if (!scripts.has(script)) {
      return;
    }
    const command = buildScriptCommand(options.packageManager, script);
    if (!command) {
      return;
    }
    catalog.push({
      id,
      roundId,
      label,
      command: command.command,
      args: command.args,
      invariant,
    });
  };

  addScriptCommand("lint-fast", "fast", "Lint", "lint", "The codebase should satisfy lint checks.");
  for (const script of ["typecheck", "check-types", "tsc"]) {
    addScriptCommand(
      "typecheck-fast",
      "fast",
      "Typecheck",
      script,
      "The codebase should satisfy type checking.",
    );
    if (catalog.some((command) => command.id === "typecheck-fast")) {
      break;
    }
  }
  for (const script of ["schema:check", "check:schema", "db:schema", "prisma:validate"]) {
    addScriptCommand(
      "schema-fast",
      "fast",
      "Schema validation",
      script,
      "Schema definitions should validate cleanly.",
    );
    if (catalog.some((command) => command.id === "schema-fast")) {
      break;
    }
  }
  for (const script of ["test:unit", "unit"]) {
    addScriptCommand(
      "unit-impact",
      "impact",
      "Unit tests",
      script,
      "Impacted unit tests should pass.",
    );
    if (catalog.some((command) => command.id === "unit-impact")) {
      break;
    }
  }
  for (const script of ["test:changed", "test:affected", "affected:test"]) {
    addScriptCommand(
      "changed-tests-impact",
      "impact",
      "Changed-area tests",
      script,
      "Changed-area tests should pass.",
    );
    if (catalog.some((command) => command.id === "changed-tests-impact")) {
      break;
    }
  }
  addScriptCommand(
    "build-impact",
    "impact",
    "Build",
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
    addScriptCommand(
      "migration-impact",
      "impact",
      "Migration dry-run",
      script,
      "Migration planning or dry-run should succeed.",
    );
    if (catalog.some((command) => command.id === "migration-impact")) {
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
    addScriptCommand(
      "e2e-deep",
      "deep",
      "End-to-end or visual checks",
      script,
      "Deep end-to-end or visual validation should pass.",
    );
    if (catalog.some((command) => command.id === "e2e-deep")) {
      break;
    }
  }
  for (const script of ["test", "test:full", "test:ci", "ci:test", "verify", "check"]) {
    addScriptCommand(
      "full-suite-deep",
      "deep",
      "Full test suite",
      script,
      "The full test suite should pass before crowning.",
    );
    if (catalog.some((command) => command.id === "full-suite-deep")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "package-smoke-deep") &&
    hasPackageExport &&
    options.packageManager === "npm"
  ) {
    catalog.push({
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
    });
  }
  for (const script of [
    "migration:rollback",
    "rollback:simulate",
    "rollback:simulation",
    "db:rollback:dry-run",
  ]) {
    addScriptCommand(
      "rollback-deep",
      "deep",
      "Rollback simulation",
      script,
      "Rollback simulation should succeed.",
    );
    if (catalog.some((command) => command.id === "rollback-deep")) {
      break;
    }
  }
  if (hasPackageExport && options.packageManager === "npm") {
    catalog.push({
      id: "pack-impact",
      roundId: "impact",
      label: "Package export check",
      command: "npm",
      args: ["pack", "--dry-run"],
      invariant: "The package should be packable for downstream consumers.",
    });
  }

  return catalog;
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
