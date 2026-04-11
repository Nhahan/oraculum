import type { ProfileSkippedCommandCandidate } from "../domain/profile.js";

import type {
  ExplicitCommandDefinition,
  ExplicitCommandSurface,
} from "./profile-explicit-command-common.js";
import { normalizeCommandName } from "./profile-explicit-command-common.js";
import type { ProfileRepoFacts } from "./profile-repo-facts.js";

export function collectPackageScriptSurfaces(facts: ProfileRepoFacts): ExplicitCommandSurface[] {
  if (
    facts.packageManager === "unknown" ||
    (!facts.packageJson?.scripts && facts.workspacePackageJsons.length === 0)
  ) {
    return [];
  }

  const command = buildPackageScriptCommand(facts.packageManager);
  if (!command) {
    return [];
  }

  const rootSurfaces = Object.entries(facts.packageJson?.scripts ?? {}).map(
    ([scriptName, scriptBody]) =>
      buildPackageScriptSurface({
        args: command.args,
        command: command.command,
        scriptBody,
        scriptName,
      }),
  );
  const workspaceCandidates = facts.workspacePackageJsons.flatMap((workspaceManifest) =>
    Object.entries(workspaceManifest.packageJson.scripts ?? {}).map(([scriptName, scriptBody]) =>
      buildPackageScriptSurface({
        args: command.args,
        command: command.command,
        manifestPath: workspaceManifest.manifestPath,
        relativeCwd: workspaceManifest.root,
        scriptBody,
        scriptName,
      }),
    ),
  );
  const rootNames = new Set(rootSurfaces.map((surface) => surface.normalizedName));
  const unambiguousWorkspaceSurfaces = collectUnambiguousWorkspaceScriptSurfaces(
    workspaceCandidates,
    rootNames,
  );

  return [...rootSurfaces, ...unambiguousWorkspaceSurfaces].sort((left, right) => {
    const nameDelta = left.name.localeCompare(right.name);
    if (nameDelta !== 0) {
      return nameDelta;
    }

    return (left.relativeCwd ?? "").localeCompare(right.relativeCwd ?? "");
  });
}

export function recordAmbiguousPackageScriptSkip(options: {
  definition: ExplicitCommandDefinition;
  facts: ProfileRepoFacts;
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}): void {
  const matchedRootScript = Object.keys(options.facts.packageJson?.scripts ?? {}).find(
    (scriptName) => options.definition.aliases.includes(normalizeCommandName(scriptName)),
  );

  const matchingWorkspaceScripts = collectMatchingWorkspaceScripts(
    options.facts,
    options.definition.aliases,
  );
  if (options.facts.packageManager === "unknown") {
    if (matchedRootScript) {
      recordSkippedCandidate(options.skippedCommandCandidates, {
        id: options.definition.id,
        label: options.definition.label,
        capability: options.definition.capability,
        reason: "ambiguous-package-manager",
        detail: `package.json script "${matchedRootScript}" exists, but no package manager was detected; Oraculum will not guess npm/pnpm/yarn/bun.`,
        provenance: {
          signal: `script:${matchedRootScript}`,
          source: "root-config",
          path: "package.json",
          detail: "Repo-local package.json script.",
        },
      });
      return;
    }

    if (matchingWorkspaceScripts.length === 1) {
      const [match] = matchingWorkspaceScripts;
      if (!match) {
        return;
      }
      recordSkippedCandidate(options.skippedCommandCandidates, {
        id: options.definition.id,
        label: options.definition.label,
        capability: options.definition.capability,
        reason: "ambiguous-package-manager",
        detail: `Workspace package.json script "${match.scriptName}" exists at ${match.root}, but no package manager was detected; Oraculum will not guess npm/pnpm/yarn/bun.`,
        provenance: {
          signal: `script:${match.scriptName}`,
          source: "workspace-config",
          path: match.manifestPath,
          detail: "Workspace package.json script.",
        },
      });
      return;
    }

    if (matchingWorkspaceScripts.length > 1) {
      recordSkippedCandidate(options.skippedCommandCandidates, {
        id: options.definition.id,
        label: options.definition.label,
        capability: options.definition.capability,
        reason: "ambiguous-package-manager",
        detail: `Workspace package.json scripts match this command (${matchingWorkspaceScripts.map((match) => `${match.root}:${match.scriptName}`).join(", ")}), but no package manager was detected; Oraculum will not guess npm/pnpm/yarn/bun.`,
        provenance: {
          signal: `workspace-script:${options.definition.id}`,
          source: "workspace-config",
          detail:
            "Workspace package.json scripts matched this command, but the package manager is ambiguous.",
        },
      });
      return;
    }
  }

  if (matchingWorkspaceScripts.length < 2) {
    return;
  }

  if (matchedRootScript) {
    return;
  }

  recordSkippedCandidate(options.skippedCommandCandidates, {
    id: options.definition.id,
    label: options.definition.label,
    capability: options.definition.capability,
    reason: "ambiguous-workspace-command",
    detail: `Multiple workspace package scripts match this command (${matchingWorkspaceScripts.map((workspaceManifest) => workspaceManifest.root).join(", ")}); Oraculum will not guess which workspace to run.`,
    provenance: {
      signal: `workspace-script:${options.definition.id}`,
      source: "workspace-config",
      detail: "Multiple workspace package.json scripts matched the same command alias.",
    },
  });
}

function collectMatchingWorkspaceScripts(
  facts: ProfileRepoFacts,
  aliases: readonly string[],
): Array<{ manifestPath: string; root: string; scriptName: string }> {
  return facts.workspacePackageJsons.flatMap((workspaceManifest) =>
    Object.keys(workspaceManifest.packageJson.scripts ?? {}).flatMap((scriptName) =>
      normalizeCommandName(scriptName) !== "" && aliases.includes(normalizeCommandName(scriptName))
        ? [
            {
              manifestPath: workspaceManifest.manifestPath,
              root: workspaceManifest.root,
              scriptName,
            },
          ]
        : [],
    ),
  );
}

function buildPackageScriptSurface(options: {
  args: string[];
  command: string;
  manifestPath?: string;
  relativeCwd?: string;
  scriptBody: string;
  scriptName: string;
}): ExplicitCommandSurface {
  return {
    kind: "package-script",
    name: options.scriptName,
    normalizedName: normalizeCommandName(options.scriptName),
    command: options.command,
    args: [...options.args, options.scriptName],
    pathPolicy: "inherit",
    ...(options.relativeCwd ? { relativeCwd: options.relativeCwd } : {}),
    provenance: {
      signal: `script:${options.scriptName}`,
      source: options.relativeCwd ? "workspace-config" : "root-config",
      path: options.manifestPath ?? "package.json",
      detail: options.relativeCwd
        ? "Workspace package.json script."
        : "Repo-local package.json script.",
    },
    scriptBody: options.scriptBody,
    safetyRationale: options.relativeCwd
      ? "Uses a workspace package.json script with a validated workspace-relative cwd; Oraculum does not infer a tool-specific command."
      : "Uses a repo-local package.json script selected from an explicit script name; Oraculum does not infer a tool-specific command.",
  };
}

function collectUnambiguousWorkspaceScriptSurfaces(
  surfaces: ExplicitCommandSurface[],
  rootNames: Set<string>,
): ExplicitCommandSurface[] {
  const byName = new Map<string, ExplicitCommandSurface[]>();
  for (const surface of surfaces) {
    byName.set(surface.normalizedName, [...(byName.get(surface.normalizedName) ?? []), surface]);
  }

  return [...byName.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .flatMap(([, matches]) => {
      if (matches.length !== 1) {
        return [];
      }
      const candidate = matches[0];
      if (!candidate || rootNames.has(candidate.normalizedName)) {
        return [];
      }
      return [candidate];
    });
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

function buildPackageScriptCommand(
  packageManager: ProfileRepoFacts["packageManager"],
): { args: string[]; command: string } | undefined {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: ["run"] };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: [] };
  }
  if (packageManager === "bun") {
    return { command: "bun", args: ["run"] };
  }
  if (packageManager === "npm") {
    return { command: "npm", args: ["run"] };
  }
  return undefined;
}
