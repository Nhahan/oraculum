import { basename, join } from "node:path";

export function collectOracleLocalToolPaths(options: {
  exists: (path: string) => boolean;
  platform?: NodeJS.Platform;
  projectRoot: string;
  workspaceDir: string;
}): string[] {
  const roots = [options.workspaceDir, options.projectRoot];
  const relativeToolDirs = listRelativeLocalToolDirs(options.platform);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of roots) {
    for (const relativeDir of relativeToolDirs) {
      const absolutePath = join(root, relativeDir);
      if (!seen.has(absolutePath) && options.exists(absolutePath)) {
        seen.add(absolutePath);
        paths.push(absolutePath);
      }
    }
  }

  return paths;
}

export function listRelativeLocalToolDirs(platform: NodeJS.Platform = process.platform): string[] {
  return [
    join("node_modules", ".bin"),
    join(".venv", platform === "win32" ? "Scripts" : "bin"),
    join("venv", platform === "win32" ? "Scripts" : "bin"),
    "bin",
  ];
}

export function resolveRepoLocalWrapperCommand(options: {
  command: string;
  exists: (path: string) => boolean;
  platform?: NodeJS.Platform;
  projectRoot: string;
  scopeRoot: string;
}): {
  resolvedCommand: string;
  resolution: "project-wrapper" | "workspace-wrapper" | "unresolved";
} {
  const wrapperNames = listRepoLocalWrapperCandidates(options.command, options.platform);
  if (wrapperNames.length === 0) {
    return {
      resolvedCommand: options.command,
      resolution: "unresolved",
    };
  }

  const roots =
    options.scopeRoot === options.projectRoot
      ? [{ kind: "project-wrapper" as const, root: options.projectRoot }]
      : [
          { kind: "workspace-wrapper" as const, root: options.scopeRoot },
          { kind: "project-wrapper" as const, root: options.projectRoot },
        ];
  for (const candidate of roots) {
    for (const wrapperName of wrapperNames) {
      const resolved = join(candidate.root, wrapperName);
      if (options.exists(resolved)) {
        return {
          resolvedCommand: resolved,
          resolution: candidate.kind,
        };
      }
    }
  }

  return {
    resolvedCommand: options.command,
    resolution: "unresolved",
  };
}

export function listRepoLocalWrapperCandidates(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const base = basename(command).toLowerCase();
  if (base !== command.toLowerCase()) {
    return [];
  }

  if (platform === "win32") {
    if (base === "gradlew" || base === "gradlew.bat") {
      return ["gradlew.bat", "gradlew"];
    }
    if (base === "mvnw" || base === "mvnw.cmd") {
      return ["mvnw.cmd", "mvnw"];
    }
    return [];
  }

  if (base === "gradlew") {
    return ["gradlew"];
  }
  if (base === "mvnw") {
    return ["mvnw"];
  }
  return [];
}
