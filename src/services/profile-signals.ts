import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";
import type {
  ProfileCapabilitySignal,
  ProfileRepoSignals,
  ProfileSignalProvenance,
} from "../domain/profile.js";
import { shouldManageProjectPath } from "./managed-tree.js";
import {
  CYPRESS_CONFIG_PATHS,
  E2E_CONFIG_PATHS,
  FRONTEND_BUILD_CONFIG_PATHS,
  KNOWN_SIGNAL_PATHS,
  MIGRATION_SIGNAL_PATHS,
  MIGRATION_TOOL_SIGNALS,
  MIGRATION_TOOL_VALUES,
  PLAYWRIGHT_CONFIG_PATHS,
  WORKSPACE_MARKER_FILES,
  WORKSPACE_PARENT_DIRS,
} from "./profile-detector-data.js";
import type {
  ProfilePackageJsonManifest,
  WorkspacePackageJsonManifest,
} from "./profile-repo-facts.js";

export async function detectWorkspaceRoots(
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const workspaceRoots = new Set<string>();

  for (const parentDir of WORKSPACE_PARENT_DIRS) {
    const parentPath = join(projectRoot, parentDir);
    if (!(await pathExists(parentPath))) {
      continue;
    }
    let entries: Dirent[];
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(parentPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const relativeRoot = `${parentDir}/${entry.name}`;
      if (!shouldManageProjectPath(relativeRoot, rules)) {
        continue;
      }
      for (const marker of WORKSPACE_MARKER_FILES) {
        if (!shouldManageProjectPath(`${relativeRoot}/${marker}`, rules)) {
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(join(projectRoot, relativeRoot, marker))) {
          workspaceRoots.add(relativeRoot);
          break;
        }
      }
    }
  }

  return [...workspaceRoots].sort((left, right) => left.localeCompare(right));
}

export async function detectKnownFiles(
  projectRoot: string,
  workspaceRoots: string[] = [],
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const present = new Set<string>();
  for (const candidate of KNOWN_SIGNAL_PATHS) {
    if (!shouldManageProjectPath(candidate, rules)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, candidate))) {
      present.add(candidate);
    }
  }

  for (const workspaceRoot of workspaceRoots) {
    for (const candidate of KNOWN_SIGNAL_PATHS) {
      const relativePath = `${workspaceRoot}/${candidate}`;
      if (!shouldManageProjectPath(relativePath, rules)) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(join(projectRoot, relativePath))) {
        present.add(relativePath);
      }
    }
  }

  return [...present].sort((left, right) => left.localeCompare(right));
}

export function buildLegacySignalTags(options: {
  files: string[];
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined;
  scripts: string[];
  workspacePackageJsons: WorkspacePackageJsonManifest[];
}): string[] {
  const tags = new Set<string>();

  if (hasSignalPath(options.files, FRONTEND_BUILD_CONFIG_PATHS)) {
    tags.add("frontend-build");
  }
  if (hasSignalPath(options.files, E2E_CONFIG_PATHS)) {
    tags.add("e2e-config");
  }
  if (hasSignalPath(options.files, MIGRATION_SIGNAL_PATHS)) {
    tags.add("migration-files");
  }
  if (
    hasPackageExportMetadata(options.packageJson) ||
    options.workspacePackageJsons.some((workspaceManifest) =>
      hasPackageExportMetadata(workspaceManifest.packageJson),
    )
  ) {
    tags.add("package-export");
  }
  if (options.scripts.includes("lint")) {
    tags.add("lint-script");
  }
  if (options.scripts.some((script) => ["typecheck", "check-types", "tsc"].includes(script))) {
    tags.add("typecheck-script");
  }
  if (options.scripts.includes("build")) {
    tags.add("build-script");
  }
  if (options.scripts.some((script) => script === "test" || script.includes("test:"))) {
    tags.add("test-script");
  }

  return [...tags].sort((left, right) => left.localeCompare(right));
}

export function buildCapabilitySignals(options: {
  files: string[];
  packageManagerEvidence?:
    | {
        detail: string;
        path?: string;
        source: ProfileSignalProvenance["source"];
      }
    | undefined;
  packageJson: ProfilePackageJsonManifest | undefined;
  packageManager: ProfileRepoSignals["packageManager"];
  scripts: string[];
  workspacePackageJsons: WorkspacePackageJsonManifest[];
  workspaceRoots: string[];
}): ProfileCapabilitySignal[] {
  const files = new Set(options.files);
  const rootDependencies = new Set(collectManifestDependencies(options.packageJson));
  const rootScripts = new Set(Object.keys(options.packageJson?.scripts ?? {}));
  const playwrightConfigPath = findSignalPath(files, PLAYWRIGHT_CONFIG_PATHS);
  const cypressConfigPath = findSignalPath(files, CYPRESS_CONFIG_PATHS);
  const frontendBuildConfigPath = findSignalPath(files, FRONTEND_BUILD_CONFIG_PATHS);
  const capabilities: ProfileCapabilitySignal[] = [];
  const seen = new Set<string>();
  type CapabilityInput = Omit<ProfileCapabilitySignal, "confidence"> &
    Partial<Pick<ProfileCapabilitySignal, "confidence">>;
  const add = (capability: CapabilityInput) => {
    const normalized: ProfileCapabilitySignal = {
      ...capability,
      confidence: capability.confidence ?? "medium",
    };
    const key = [normalized.kind, normalized.value, normalized.source, normalized.path ?? ""].join(
      "\0",
    );
    if (!seen.has(key)) {
      seen.add(key);
      capabilities.push(normalized);
    }
  };

  if (options.packageJson) {
    add({
      kind: "language",
      value: "javascript",
      source: "root-config",
      path: "package.json",
      detail: "package.json is present.",
    });
  }
  for (const workspacePackageFile of options.files.filter((file) =>
    file.endsWith("/package.json"),
  )) {
    add({
      kind: "language",
      value: "javascript",
      source: "workspace-config",
      path: workspacePackageFile,
      detail: "Nested package.json is present.",
    });
  }
  if (options.workspaceRoots.length > 0) {
    add({
      kind: "build-system",
      value: "workspace",
      source: "workspace-config",
      confidence: "medium",
      detail: `Detected workspace roots: ${options.workspaceRoots.join(", ")}.`,
    });
  }
  if (files.has("tsconfig.json") || rootDependencies.has("typescript")) {
    add({
      kind: "language",
      value: "typescript",
      source: "root-config",
      path: files.has("tsconfig.json")
        ? "tsconfig.json"
        : rootDependencies.has("typescript")
          ? "package.json"
          : undefined,
      confidence: "high",
      ...(files.has("tsconfig.json")
        ? {}
        : rootDependencies.has("typescript")
          ? { detail: "TypeScript dependency is declared in package metadata." }
          : {}),
    });
  }
  for (const workspaceTsconfig of options.files.filter((file) => file.endsWith("/tsconfig.json"))) {
    add({
      kind: "language",
      value: "typescript",
      source: "workspace-config",
      path: workspaceTsconfig,
      confidence: "high",
      detail: "Nested tsconfig.json is present.",
    });
  }
  for (const workspaceManifest of options.workspacePackageJsons) {
    const workspaceDependencies = new Set(
      collectManifestDependencies(workspaceManifest.packageJson),
    );
    if (!workspaceDependencies.has("typescript")) {
      continue;
    }
    add({
      kind: "language",
      value: "typescript",
      source: "workspace-config",
      path: workspaceManifest.manifestPath,
      confidence: "high",
      detail: "TypeScript dependency is declared in workspace package metadata.",
    });
  }
  if (options.packageManager !== "unknown") {
    add({
      kind: "build-system",
      value: options.packageManager,
      source: options.packageManagerEvidence?.source ?? "root-config",
      ...(options.packageManagerEvidence?.path
        ? { path: options.packageManagerEvidence.path }
        : {}),
      confidence: "high",
      detail:
        options.packageManagerEvidence?.detail ??
        (options.packageJson
          ? "Package manager detected from package metadata."
          : "Package manager detected from a lockfile."),
    });
  }
  if (frontendBuildConfigPath) {
    add({
      kind: "build-system",
      value: "frontend-config",
      source: signalSourceForPath(frontendBuildConfigPath, FRONTEND_BUILD_CONFIG_PATHS),
      path: frontendBuildConfigPath,
      detail: "Frontend build configuration file is present.",
    });
  }
  if (hasPackageExportMetadata(options.packageJson)) {
    add({
      kind: "intent",
      value: "library",
      source: "root-config",
      path: "package.json",
      confidence: "high",
      detail: "Package export metadata is present.",
    });
  }
  for (const workspaceManifest of options.workspacePackageJsons) {
    if (!hasPackageExportMetadata(workspaceManifest.packageJson)) {
      continue;
    }
    add({
      kind: "intent",
      value: "library",
      source: "workspace-config",
      path: workspaceManifest.manifestPath,
      confidence: "high",
      detail: "Workspace package export metadata is present.",
    });
  }
  if (rootScripts.has("lint")) {
    add({ kind: "command", value: "lint", source: "root-config", path: "package.json" });
  }
  if ([...rootScripts].some((script) => ["typecheck", "check-types", "tsc"].includes(script))) {
    add({ kind: "command", value: "typecheck", source: "root-config", path: "package.json" });
  }
  if (rootScripts.has("build")) {
    add({ kind: "command", value: "build", source: "root-config", path: "package.json" });
  }
  if ([...rootScripts].some((script) => script === "test" || script.includes("test:"))) {
    add({
      kind: "test-runner",
      value: "package-script",
      source: "root-config",
      path: "package.json",
    });
  }
  for (const workspaceManifest of options.workspacePackageJsons) {
    const workspaceScripts = new Set(Object.keys(workspaceManifest.packageJson.scripts ?? {}));
    if (workspaceScripts.has("lint")) {
      add({
        kind: "command",
        value: "lint",
        source: "workspace-config",
        path: workspaceManifest.manifestPath,
        detail: "Workspace package.json lint script is present.",
      });
    }
    if (
      [...workspaceScripts].some((script) => ["typecheck", "check-types", "tsc"].includes(script))
    ) {
      add({
        kind: "command",
        value: "typecheck",
        source: "workspace-config",
        path: workspaceManifest.manifestPath,
        detail: "Workspace package.json typecheck script is present.",
      });
    }
    if (workspaceScripts.has("build")) {
      add({
        kind: "command",
        value: "build",
        source: "workspace-config",
        path: workspaceManifest.manifestPath,
        detail: "Workspace package.json build script is present.",
      });
    }
    if ([...workspaceScripts].some((script) => script === "test" || script.includes("test:"))) {
      add({
        kind: "test-runner",
        value: "package-script",
        source: "workspace-config",
        path: workspaceManifest.manifestPath,
        detail: "Workspace package.json test script is present.",
      });
    }
  }
  if (playwrightConfigPath) {
    add({
      kind: "test-runner",
      value: "playwright",
      source: signalSourceForPath(playwrightConfigPath, PLAYWRIGHT_CONFIG_PATHS),
      path: playwrightConfigPath,
    });
  }
  if (cypressConfigPath) {
    add({
      kind: "test-runner",
      value: "cypress",
      source: signalSourceForPath(cypressConfigPath, CYPRESS_CONFIG_PATHS),
      path: cypressConfigPath,
    });
  }
  for (const toolSignal of MIGRATION_TOOL_SIGNALS) {
    const configPath = findSignalPath(files, [...toolSignal.configPaths]);
    if (configPath) {
      add({
        kind: "migration-tool",
        value: toolSignal.value,
        source: signalSourceForPath(configPath, [...toolSignal.configPaths]),
        path: configPath,
        confidence: "high",
        detail: "Migration tool configuration file is present.",
      });
    }
  }
  if (capabilities.every((capability) => capability.kind !== "intent")) {
    add({
      kind: "intent",
      value: "unknown",
      source: "fallback-inference",
      confidence: "low",
      detail: "No repository-intent capability was detected.",
    });
  }

  return capabilities;
}

export function buildSignalProvenance(
  tags: string[],
  capabilities: ProfileCapabilitySignal[],
): ProfileSignalProvenance[] {
  return [
    ...capabilities.map((capability) => ({
      signal: `${capability.kind}:${capability.value}`,
      source: capability.source,
      ...(capability.path ? { path: capability.path } : {}),
      ...(capability.detail ? { detail: capability.detail } : {}),
    })),
    ...tags.map((tag) => {
      const relatedCapability = findLegacyTagCapability(tag, capabilities);
      return {
        signal: `tag:${tag}`,
        source: relatedCapability?.source ?? profileSignalSourceForLegacyTag(tag),
        ...(relatedCapability?.path ? { path: relatedCapability.path } : {}),
        detail: relatedCapability
          ? `Legacy compatibility tag derived from ${relatedCapability.kind}:${relatedCapability.value}.`
          : "Legacy compatibility tag derived from repository signals.",
      };
    }),
  ];
}

function profileSignalSourceForLegacyTag(tag: string): ProfileSignalProvenance["source"] {
  if (tag.startsWith("task-")) {
    return "task-text";
  }
  if (
    tag.endsWith("-script") ||
    ["e2e-config", "frontend-build", "migration-files", "package-export"].includes(tag)
  ) {
    return "root-config";
  }
  return "fallback-inference";
}

function findLegacyTagCapability(
  tag: string,
  capabilities: ProfileCapabilitySignal[],
): ProfileCapabilitySignal | undefined {
  const capabilityMatches: Record<string, Array<Partial<ProfileCapabilitySignal>>> = {
    "build-script": [{ kind: "command", value: "build" }],
    "e2e-config": [
      { kind: "test-runner", value: "playwright" },
      { kind: "test-runner", value: "cypress" },
    ],
    "frontend-build": [{ kind: "build-system", value: "frontend-config" }],
    "lint-script": [{ kind: "command", value: "lint" }],
    "migration-files": [
      ...MIGRATION_TOOL_VALUES.map((value) => ({ kind: "migration-tool" as const, value })),
    ],
    "package-export": [{ kind: "intent", value: "library" }],
    "test-script": [{ kind: "test-runner", value: "package-script" }],
    "typecheck-script": [{ kind: "command", value: "typecheck" }],
  };
  const matches = capabilityMatches[tag] ?? [];
  for (const match of matches) {
    const capability = capabilities.find((candidate) =>
      Object.entries(match).every(
        ([key, value]) => candidate[key as keyof ProfileCapabilitySignal] === value,
      ),
    );
    if (capability) {
      return capability;
    }
  }

  return undefined;
}

function collectManifestDependencies(
  manifest:
    | {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }
    | undefined,
): string[] {
  return Object.keys({
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  });
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

function hasSignalPath(files: string[], expectedPaths: string[]): boolean {
  return files.some((file) =>
    expectedPaths.some(
      (expectedPath) => file === expectedPath || file.endsWith(`/${expectedPath}`),
    ),
  );
}

function findSignalPath(files: Set<string>, expectedPaths: string[]): string | undefined {
  for (const expectedPath of expectedPaths) {
    if (files.has(expectedPath)) {
      return expectedPath;
    }
  }

  return [...files].find((file) =>
    expectedPaths.some((expectedPath) => file.endsWith(`/${expectedPath}`)),
  );
}

function signalSourceForPath(
  signalPath: string,
  rootSignalPaths: string[],
): ProfileCapabilitySignal["source"] {
  return rootSignalPaths.includes(signalPath) ? "root-config" : "workspace-config";
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await lstat(candidatePath);
    return true;
  } catch {
    return false;
  }
}
