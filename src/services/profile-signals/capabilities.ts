import type {
  ProfileCapabilitySignal,
  ProfileRepoSignals,
  ProfileSignalProvenance,
} from "../../domain/profile.js";
import type {
  ProfilePackageJsonManifest,
  WorkspacePackageJsonManifest,
} from "../profile-repo-facts.js";
import { collectManifestDependencies, hasPackageExportMetadata } from "./shared.js";

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
  const rootDependencies = new Set(collectManifestDependencies(options.packageJson));
  const rootScripts = new Set(Object.keys(options.packageJson?.scripts ?? {}));
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
  if (options.files.includes("tsconfig.json") || rootDependencies.has("typescript")) {
    add({
      kind: "language",
      value: "typescript",
      source: "root-config",
      path: options.files.includes("tsconfig.json")
        ? "tsconfig.json"
        : rootDependencies.has("typescript")
          ? "package.json"
          : undefined,
      confidence: "high",
      ...(options.files.includes("tsconfig.json")
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
  if (hasPackageExportMetadata(options.packageJson)) {
    add({
      kind: "build-system",
      value: "package-export-metadata",
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
      kind: "build-system",
      value: "package-export-metadata",
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
  const hasPostureEvidence = capabilities.some(
    (capability) =>
      capability.kind === "build-system" && capability.value === "package-export-metadata",
  );
  if (capabilities.every((capability) => capability.kind !== "intent") && !hasPostureEvidence) {
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
  capabilities: ProfileCapabilitySignal[],
): ProfileSignalProvenance[] {
  return capabilities.map((capability) => ({
    signal: `${capability.kind}:${capability.value}`,
    source: capability.source,
    ...(capability.path ? { path: capability.path } : {}),
    ...(capability.detail ? { detail: capability.detail } : {}),
  }));
}
