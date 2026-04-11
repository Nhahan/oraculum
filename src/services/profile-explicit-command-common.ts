import type { ProfileCommandCandidate, ProfileSignalProvenance } from "../domain/profile.js";

export const DEDUPED_PACKAGE_SCRIPT_CAPABILITIES = new Set([
  "build",
  "changed-area-test",
  "e2e-or-visual",
  "full-suite-test",
  "migration-dry-run",
  "rollback-simulation",
  "unit-test",
]);

export interface ExplicitCommandDefinition {
  aliases: string[];
  capability: string;
  id: string;
  invariant: string;
  label: string;
  roundId: ProfileCommandCandidate["roundId"];
}

export interface ExplicitCommandSurface {
  args: string[];
  command: string;
  kind: "just-target" | "local-entrypoint" | "make-target" | "package-script" | "taskfile-target";
  name: string;
  normalizedName: string;
  pathPolicy: NonNullable<ProfileCommandCandidate["pathPolicy"]>;
  relativeCwd?: string;
  provenance: ProfileSignalProvenance;
  safetyRationale: string;
  scriptBody?: string;
}

export const EXPLICIT_COMMAND_DEFINITIONS: ExplicitCommandDefinition[] = [
  {
    id: "lint-fast",
    roundId: "fast",
    label: "Lint",
    capability: "lint",
    aliases: ["lint"],
    invariant: "The codebase should satisfy lint checks.",
  },
  {
    id: "typecheck-fast",
    roundId: "fast",
    label: "Typecheck",
    capability: "typecheck",
    aliases: ["typecheck", "check-types", "tsc"],
    invariant: "The codebase should satisfy type checking.",
  },
  {
    id: "schema-fast",
    roundId: "fast",
    label: "Schema validation",
    capability: "schema-validation",
    aliases: ["schema-check", "check-schema", "db-schema", "schema-validation", "prisma-validate"],
    invariant: "Schema definitions should validate cleanly.",
  },
  {
    id: "unit-impact",
    roundId: "impact",
    label: "Unit tests",
    capability: "unit-test",
    aliases: ["test-unit", "unit"],
    invariant: "Impacted unit tests should pass.",
  },
  {
    id: "changed-tests-impact",
    roundId: "impact",
    label: "Changed-area tests",
    capability: "changed-area-test",
    aliases: ["test-changed", "test-affected", "affected-test"],
    invariant: "Changed-area tests should pass.",
  },
  {
    id: "build-impact",
    roundId: "impact",
    label: "Build",
    capability: "build",
    aliases: ["build"],
    invariant: "The project should build successfully after the patch.",
  },
  {
    id: "migration-impact",
    roundId: "impact",
    label: "Migration dry-run",
    capability: "migration-dry-run",
    aliases: [
      "migration-dry-run",
      "migrate-dry-run",
      "db-dry-run",
      "migration-status",
      "migrate-status",
      "prisma-migrate-status",
    ],
    invariant: "Migration planning or dry-run should succeed.",
  },
  {
    id: "e2e-deep",
    roundId: "deep",
    label: "End-to-end or visual checks",
    capability: "e2e-or-visual",
    aliases: [
      "e2e",
      "test-e2e",
      "playwright",
      "cypress",
      "visual",
      "test-visual",
      "test-smoke",
      "smoke",
    ],
    invariant: "Deep end-to-end or visual validation should pass.",
  },
  {
    id: "full-suite-deep",
    roundId: "deep",
    label: "Full test suite",
    capability: "full-suite-test",
    aliases: ["test", "test-full", "test-ci", "ci-test", "verify", "check"],
    invariant: "The full test suite should pass before crowning.",
  },
  {
    id: "rollback-deep",
    roundId: "deep",
    label: "Rollback simulation",
    capability: "rollback-simulation",
    aliases: [
      "migration-rollback",
      "rollback-simulate",
      "rollback-simulation",
      "db-rollback-dry-run",
    ],
    invariant: "Rollback simulation should succeed.",
  },
];

export function normalizeScriptBody(scriptBody: string): string {
  return scriptBody.trim().replace(/\s+/gu, " ");
}

export function normalizeCommandName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
