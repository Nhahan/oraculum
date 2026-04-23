import type {
  ProfileCommandCandidate,
  ProfileSignalProvenance,
  ProfileSkippedCommandCandidate,
} from "../../domain/profile.js";

export const DEDUPED_PACKAGE_SCRIPT_CAPABILITIES = new Set([
  "build",
  "changed-area-test",
  "full-suite-test",
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
    id: "full-suite-deep",
    roundId: "deep",
    label: "Full test suite",
    capability: "full-suite-test",
    aliases: ["test", "test-full", "test-ci", "ci-test", "verify"],
    invariant: "The full test suite should pass before crowning.",
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

export function pushUniqueSkippedCommandCandidate(
  skippedCommandCandidates: ProfileSkippedCommandCandidate[],
  candidate: ProfileSkippedCommandCandidate,
): void {
  const key = buildSkippedCommandCandidateKey(candidate);
  const alreadyRecorded = skippedCommandCandidates.some(
    (existing) => buildSkippedCommandCandidateKey(existing) === key,
  );
  if (!alreadyRecorded) {
    skippedCommandCandidates.push(candidate);
  }
}

function buildSkippedCommandCandidateKey(candidate: ProfileSkippedCommandCandidate): string {
  return [
    candidate.id,
    candidate.reason,
    candidate.capability,
    candidate.provenance?.signal ?? "",
    candidate.provenance?.path ?? "",
  ].join("\0");
}
