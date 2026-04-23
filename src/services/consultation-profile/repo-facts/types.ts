import type { PackageManager, ProfileSignalProvenance } from "../../../domain/profile.js";

export interface ProfilePackageJsonManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  main?: string;
  module?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  types?: string;
}

export interface WorkspacePackageJsonManifest {
  manifestPath: string;
  packageJson: ProfilePackageJsonManifest;
  root: string;
}

export interface ProfileRepoFacts {
  dependencies: string[];
  files: string[];
  invalidPackageJsons: string[];
  lockfiles: string[];
  manifests: string[];
  packageJson?: ProfilePackageJsonManifest;
  packageManager: PackageManager;
  packageManagerEvidence?: {
    detail: string;
    path?: string;
    source: ProfileSignalProvenance["source"];
  };
  scripts: string[];
  workspacePackageJsons: WorkspacePackageJsonManifest[];
  workspaceMetadata: Array<{
    label: string;
    manifests: string[];
    root: string;
  }>;
  workspaceRoots: string[];
}
