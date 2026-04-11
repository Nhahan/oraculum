import type { ManagedTreeRules } from "../domain/config.js";
import type { ProfileCommandCandidate, ProfileSkippedCommandCandidate } from "../domain/profile.js";

import {
  DEDUPED_PACKAGE_SCRIPT_CAPABILITIES,
  EXPLICIT_COMMAND_DEFINITIONS,
  type ExplicitCommandSurface,
  normalizeScriptBody,
} from "./profile-explicit-command-common.js";
import { collectLocalEntrypointSurfaces } from "./profile-explicit-command-entrypoints.js";
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
  const surfaces = await collectExplicitCommandSurfaces(
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
  }

  return { commandCatalog, skippedCommandCandidates };
}

async function collectExplicitCommandSurfaces(
  facts: ProfileRepoFacts,
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<ExplicitCommandSurface[]> {
  return [
    ...collectPackageScriptSurfaces(facts),
    ...(await collectMakeTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
    ...(await collectJustTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
    ...(await collectTaskfileTargetSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
    ...(await collectLocalEntrypointSurfaces(projectRoot, ...(rules ? [{ rules }] : []))),
  ];
}
