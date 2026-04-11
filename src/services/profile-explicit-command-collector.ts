import type { ManagedTreeRules } from "../domain/config.js";
import type { ProfileCommandCandidate, ProfileSkippedCommandCandidate } from "../domain/profile.js";

import {
  DEDUPED_PACKAGE_SCRIPT_CAPABILITIES,
  EXPLICIT_COMMAND_DEFINITIONS,
  type ExplicitCommandSurface,
  normalizeScriptBody,
} from "./profile-explicit-command-common.js";
import { collectLocalEntrypointSurfaceReport } from "./profile-explicit-command-entrypoints.js";
import {
  collectPackageScriptSurfaces,
  recordAmbiguousPackageScriptSkip,
} from "./profile-explicit-command-package.js";
import {
  collectJustTargetSurfaces,
  collectMakeTargetSurfaces,
  collectTaskfileTargetSurfaces,
} from "./profile-explicit-command-task-runners.js";
import type { ProfileRepoFacts } from "./profile-repo-facts.js";

export interface ExplicitCommandCatalogResult {
  commandCatalog: ProfileCommandCandidate[];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}

export async function collectExplicitCommandCatalog(options: {
  facts: ProfileRepoFacts;
  projectRoot: string;
  rules?: ManagedTreeRules;
}): Promise<ExplicitCommandCatalogResult> {
  const commandCatalog: ProfileCommandCandidate[] = [];
  const skippedCommandCandidates: ProfileSkippedCommandCandidate[] = [];
  const { localEntrypointReport, surfaces } = await collectExplicitCommandSurfaces(
    options.facts,
    options.projectRoot,
    options.rules,
  );

  for (const definition of EXPLICIT_COMMAND_DEFINITIONS) {
    const match = surfaces.find((surface) => definition.aliases.includes(surface.normalizedName));
    if (match) {
      commandCatalog.push({
        id: definition.id,
        roundId: definition.roundId,
        label: definition.label,
        command: match.command,
        args: match.args,
        invariant: definition.invariant,
        ...(match.scriptBody && DEDUPED_PACKAGE_SCRIPT_CAPABILITIES.has(definition.capability)
          ? {
              dedupeKey: match.relativeCwd
                ? `package-script:${match.relativeCwd}:${normalizeScriptBody(match.scriptBody)}`
                : `package-script:${normalizeScriptBody(match.scriptBody)}`,
            }
          : {}),
        ...(match.relativeCwd ? { relativeCwd: match.relativeCwd } : {}),
        pathPolicy: match.pathPolicy,
        source: "repo-local-script",
        capability: definition.capability,
        safety: "repo-local-declared",
        requiresExplicitOptIn: false,
        provenance: match.provenance,
        safetyRationale: match.safetyRationale,
      });
      continue;
    }

    recordAmbiguousPackageScriptSkip({
      definition,
      facts: options.facts,
      skippedCommandCandidates,
    });
    recordAmbiguousLocalEntrypointSkip({
      ambiguousRootEntrypoints: localEntrypointReport.ambiguousRootEntrypoints,
      ambiguousWorkspaceEntrypoints: localEntrypointReport.ambiguousWorkspaceEntrypoints,
      definition,
      skippedCommandCandidates,
    });
  }

  return { commandCatalog, skippedCommandCandidates };
}

async function collectExplicitCommandSurfaces(
  facts: ProfileRepoFacts,
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<{
  localEntrypointReport: Awaited<ReturnType<typeof collectLocalEntrypointSurfaceReport>>;
  surfaces: ExplicitCommandSurface[];
}> {
  const localEntrypointReport = await collectLocalEntrypointSurfaceReport(projectRoot, {
    ...(rules ? { rules } : {}),
    workspaceRoots: facts.workspaceRoots,
  });
  return {
    localEntrypointReport,
    surfaces: [
      ...collectPackageScriptSurfaces(facts),
      ...(await collectMakeTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
      ...(await collectJustTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
      ...(await collectTaskfileTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
      ...localEntrypointReport.surfaces,
    ],
  };
}

function recordAmbiguousLocalEntrypointSkip(options: {
  ambiguousRootEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }>;
  ambiguousWorkspaceEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }>;
  definition: {
    aliases: string[];
    capability: string;
    id: string;
    label: string;
  };
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}): void {
  const rootMatch = options.ambiguousRootEntrypoints.find((entrypoint) =>
    options.definition.aliases.includes(entrypoint.normalizedName),
  );
  if (rootMatch) {
    const candidate: ProfileSkippedCommandCandidate = {
      id: options.definition.id,
      label: options.definition.label,
      capability: options.definition.capability,
      reason: "ambiguous-local-command",
      detail: `Multiple repo-local entry points match this command (${rootMatch.entrypointPaths.join(", ")}); Oraculum will not guess which one to run.`,
      provenance: {
        signal: `root-entrypoint:${rootMatch.normalizedName}`,
        source: "local-tool",
        detail: "Multiple repo-local entry points matched the same command alias.",
      },
    };
    recordSkippedCandidate(options.skippedCommandCandidates, candidate);
    return;
  }

  const match = options.ambiguousWorkspaceEntrypoints.find((entrypoint) =>
    options.definition.aliases.includes(entrypoint.normalizedName),
  );
  if (!match) {
    return;
  }

  const candidate: ProfileSkippedCommandCandidate = {
    id: options.definition.id,
    label: options.definition.label,
    capability: options.definition.capability,
    reason: "ambiguous-workspace-command",
    detail: `Multiple workspace-local entry points match this command (${match.entrypointPaths.join(", ")}); Oraculum will not guess which workspace to run.`,
    provenance: {
      signal: `workspace-entrypoint:${match.normalizedName}`,
      source: "local-tool",
      detail: "Multiple workspace-local entry points matched the same command alias.",
    },
  };
  recordSkippedCandidate(options.skippedCommandCandidates, candidate);
}

function recordSkippedCandidate(
  skippedCommandCandidates: ProfileSkippedCommandCandidate[],
  candidate: ProfileSkippedCommandCandidate,
): void {
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
}
