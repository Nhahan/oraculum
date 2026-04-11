import { posix } from "node:path";

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
      const absolutePath = joinPortablePath(root, relativeDir);
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
    "node_modules/.bin",
    platform === "win32" ? ".venv/Scripts" : ".venv/bin",
    platform === "win32" ? "venv/Scripts" : "venv/bin",
    "bin",
  ];
}

export function resolveRepoLocalEntrypointCommand(options: {
  command: string;
  cwd: string;
  exists: (path: string) => boolean;
  platform?: NodeJS.Platform;
}): {
  resolvedCommand: string;
  resolution: "local-entrypoint" | "unresolved";
} {
  const normalizedCommand = normalizePortablePath(options.command);
  if (
    !normalizedCommand.includes("/") ||
    normalizedCommand.startsWith("./") ||
    normalizedCommand.startsWith("../") ||
    isPortableAbsolutePath(normalizedCommand)
  ) {
    return {
      resolvedCommand: options.command,
      resolution: "unresolved",
    };
  }

  for (const candidate of listRepoLocalEntrypointCandidates(normalizedCommand, options.platform)) {
    const resolved = joinPortablePath(options.cwd, candidate);
    if (options.exists(resolved)) {
      return {
        resolvedCommand: resolved,
        resolution: "local-entrypoint",
      };
    }
  }

  return {
    resolvedCommand: options.command,
    resolution: "unresolved",
  };
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
      const resolved = joinPortablePath(candidate.root, wrapperName);
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
  const normalizedCommand = normalizePortablePath(command);
  const base = posix.basename(normalizedCommand).toLowerCase();
  if (base !== normalizedCommand.toLowerCase()) {
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

function listRepoLocalEntrypointCandidates(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (posix.extname(command)) {
    return [command];
  }

  if (platform === "win32") {
    return [`${command}.cmd`, `${command}.bat`, `${command}.ps1`, command];
  }

  return [command, `${command}.sh`];
}

function isPortableAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//u.test(path);
}

function joinPortablePath(root: string, relativePath: string): string {
  const normalizedRoot = normalizePortablePath(root).replace(/\/+$/u, "");
  const normalizedRelative = normalizePortablePath(relativePath).replace(/^\/+/u, "");
  return normalizedRelative.length > 0 ? `${normalizedRoot}/${normalizedRelative}` : normalizedRoot;
}

function normalizePortablePath(path: string): string {
  return path.replace(/\\/gu, "/");
}
