import type { ManagedTreeRules } from "../../../domain/config.js";
import { detectKnownFiles, detectWorkspaceRoots } from "../../profile-signals.js";
import { WORKSPACE_MARKER_FILES } from "../detector-data.js";
import {
  buildWorkspaceMetadata,
  collectManifestDependencies,
  collectManifestScripts,
  collectRelativePaths,
  collectWorkspacePackageJsons,
  readPackageJson,
} from "./manifests.js";
import { detectPackageManager, KNOWN_LOCKFILES } from "./package-manager.js";
import type { ProfileRepoFacts } from "./types.js";

export async function collectProfileRepoFacts(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ProfileRepoFacts> {
  const rootPackageJson = await readPackageJson(projectRoot, options.rules);
  const workspaceRoots = await detectWorkspaceRoots(projectRoot, options.rules);
  const workspacePackageJsonsResult = await collectWorkspacePackageJsons(
    projectRoot,
    workspaceRoots,
    options.rules,
  );
  const workspacePackageJsons = workspacePackageJsonsResult.manifests;
  const packageManagerResolution = await detectPackageManager(projectRoot, {
    rootPackageManagerField: rootPackageJson.packageJson?.packageManager,
    workspacePackageJsons,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const files = await detectKnownFiles(projectRoot, workspaceRoots, options.rules);
  const manifests = await collectRelativePaths(
    projectRoot,
    WORKSPACE_MARKER_FILES,
    workspaceRoots,
    options.rules,
  );
  const lockfiles = await collectRelativePaths(
    projectRoot,
    KNOWN_LOCKFILES,
    workspaceRoots,
    options.rules,
  );
  const workspaceMetadata = buildWorkspaceMetadata(workspaceRoots, manifests);
  const scripts = [
    ...new Set([
      ...collectManifestScripts(rootPackageJson.packageJson),
      ...workspacePackageJsons.flatMap((workspaceManifest) =>
        collectManifestScripts(workspaceManifest.packageJson),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const dependencies = [
    ...new Set([
      ...collectManifestDependencies(rootPackageJson.packageJson),
      ...workspacePackageJsons.flatMap((workspaceManifest) =>
        collectManifestDependencies(workspaceManifest.packageJson),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const invalidPackageJsons = [
    ...rootPackageJson.invalidPaths,
    ...workspacePackageJsonsResult.invalidPaths,
  ].sort((left, right) => left.localeCompare(right));

  return {
    dependencies,
    files,
    invalidPackageJsons,
    lockfiles,
    manifests,
    ...(rootPackageJson.packageJson ? { packageJson: rootPackageJson.packageJson } : {}),
    packageManager: packageManagerResolution.packageManager,
    ...(packageManagerResolution.evidence
      ? { packageManagerEvidence: packageManagerResolution.evidence }
      : {}),
    scripts,
    workspacePackageJsons,
    workspaceMetadata,
    workspaceRoots,
  };
}
