import type { ProjectConfig } from "../../domain/config.js";
import type {
  ConsultationProfileSelection,
  ProfileCommandCandidate,
  ProfileRepoSignals,
} from "../../domain/profile.js";
import { profileRepoSignalsSchema } from "../../domain/profile.js";
import { buildCommandCatalog, hasCapabilityCommand } from "../profile-command-catalog.js";
import { collectExplicitCommandCatalog } from "../profile-explicit-command-collector.js";
import { collectProfileRepoFacts } from "../profile-repo-facts.js";
import { buildCapabilitySignals, buildSignalProvenance } from "../profile-signals.js";

export async function collectProfileRepoSignals(
  projectRoot: string,
  options: { rules: ProjectConfig["managedTree"] },
): Promise<ProfileRepoSignals> {
  const facts = await collectProfileRepoFacts(projectRoot, {
    rules: options.rules,
  });
  const capabilities = buildCapabilitySignals({
    files: facts.files,
    packageManagerEvidence: facts.packageManagerEvidence,
    packageJson: facts.packageJson,
    packageManager: facts.packageManager,
    scripts: facts.scripts,
    workspacePackageJsons: facts.workspacePackageJsons,
    workspaceRoots: facts.workspaceRoots,
  });
  const { commandCatalog: explicitCommandCatalog, skippedCommandCandidates: explicitSkipped } =
    await collectExplicitCommandCatalog({
      facts,
      projectRoot,
      rules: options.rules,
    });
  const { commandCatalog, skippedCommandCandidates } = buildCommandCatalog({
    capabilities,
    explicitCommandCatalog,
    explicitSkippedCommandCandidates: explicitSkipped,
    packageJson: facts.packageJson,
    packageManager: facts.packageManager,
    workspacePackageJsons: facts.workspacePackageJsons,
  });
  const provenance = buildSignalProvenance(capabilities);
  const notes = buildSignalNotes(
    capabilities,
    commandCatalog,
    facts.packageManager,
    facts.packageJson,
    facts.workspaceMetadata,
  );

  return profileRepoSignalsSchema.parse({
    packageManager: facts.packageManager,
    scripts: facts.scripts,
    dependencies: facts.dependencies,
    files: facts.files,
    workspaceRoots: facts.workspaceRoots,
    workspaceMetadata: facts.workspaceMetadata,
    notes,
    capabilities,
    provenance,
    commandCatalog,
    skippedCommandCandidates,
  });
}

export function buildSelectionSignalSummary(
  signals: ProfileRepoSignals,
): ConsultationProfileSelection["signals"] {
  const summary: string[] = [];
  const add = (label: string) => {
    if (!summary.includes(label)) {
      summary.push(label);
    }
  };
  const hasCapability = (
    predicate: (capability: ProfileRepoSignals["capabilities"][number]) => boolean,
  ) => signals.capabilities.some(predicate);
  const hasRepoLocalCapability = (capability: string) =>
    signals.commandCatalog.some(
      (command) => command.source === "repo-local-script" && command.capability === capability,
    );

  if (signals.commandCatalog.some((command) => command.source === "repo-local-script")) {
    add("repo-local-validation");
  }
  if (hasRepoLocalCapability("e2e-or-visual")) {
    add("repo-e2e-anchor");
  }
  if (
    ["schema-validation", "migration-dry-run", "rollback-simulation", "migration-drift"].some(
      hasRepoLocalCapability,
    )
  ) {
    add("repo-migration-anchor");
  }
  if (
    hasCapability(
      (capability) =>
        capability.kind === "build-system" && capability.value === "package-export-metadata",
    )
  ) {
    add("package-export-metadata");
  }
  if (
    hasCapability(
      (capability) => capability.kind === "build-system" && capability.value === "frontend-config",
    )
  ) {
    add("frontend-config-evidence");
  }
  if (
    hasCapability(
      (capability) =>
        capability.kind === "test-runner" &&
        (capability.value === "playwright" || capability.value === "cypress"),
    )
  ) {
    add("e2e-runner-evidence");
  }
  if (hasCapability((capability) => capability.kind === "migration-tool")) {
    add("migration-tool-evidence");
  }
  if (signals.workspaceRoots.length > 0) {
    add("workspace");
  }
  if (
    summary.length === 0 &&
    hasCapability((capability) => capability.kind === "intent" && capability.value === "unknown")
  ) {
    add("unknown");
  }

  return summary;
}

function buildSignalNotes(
  capabilities: ProfileRepoSignals["capabilities"],
  commandCatalog: ProfileCommandCandidate[],
  packageManager: ProfileRepoSignals["packageManager"],
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined,
  workspaceMetadata: ProfileRepoSignals["workspaceMetadata"],
): string[] {
  const notes: string[] = [];
  if (
    capabilities.some(
      (capability) =>
        capability.kind === "build-system" && capability.value === "package-export-metadata",
    ) &&
    !hasCapabilityCommand(commandCatalog, "package-export-smoke", ["impact", "deep"])
  ) {
    notes.push(
      "Package export metadata signals were detected, but no packaging verification command was auto-generated.",
    );
  }
  if (packageManager === "unknown") {
    notes.push(
      "No unambiguous lockfile or packageManager metadata was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
  }
  if (!packageJson) {
    notes.push(
      workspaceMetadata.some((workspace) =>
        workspace.manifests.some((manifestPath) => manifestPath.endsWith("/package.json")),
      )
        ? "No root package.json was found; repository facts come from workspace manifests, files, and task context."
        : "No package.json was found; repository facts are limited to files and task context.",
    );
  }

  return notes;
}
