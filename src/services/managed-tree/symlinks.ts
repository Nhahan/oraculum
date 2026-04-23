import { readlink, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { ManagedTreeRules } from "../../domain/config.js";
import { isPathWithinRoot, isPortableAbsolutePath, shouldManageProjectPath } from "./rules.js";

export async function readSymlinkTargetType(
  absolutePath: string,
): Promise<"file" | "dir" | "junction" | undefined> {
  try {
    const target = await readlink(absolutePath);
    const targetStats = await stat(absolutePath);
    if (!targetStats.isDirectory()) {
      return "file";
    }

    if (process.platform !== "win32") {
      return "dir";
    }

    return isPortableAbsolutePath(target) ? "junction" : "dir";
  } catch {
    return undefined;
  }
}

interface ManagedSymlinkTargetOptions {
  destinationPath: string;
  destinationRoot: string;
  rules?: ManagedTreeRules;
  sourcePath: string;
  sourceRoot: string;
  target: string;
  targetType: "file" | "dir" | "junction" | undefined;
}

export function normalizeManagedSymlinkTarget(options: ManagedSymlinkTargetOptions): string {
  if (!isPortableAbsolutePath(options.target)) {
    return options.target;
  }

  const relativeToSourceRoot = relative(options.sourceRoot, options.target);
  if (
    isPathWithinRoot(relativeToSourceRoot) &&
    shouldManageProjectPath(relativeToSourceRoot, options.rules)
  ) {
    return join(options.destinationRoot, relativeToSourceRoot);
  }

  return options.target;
}

export function shouldManageSymlinkTarget(options: {
  rules?: ManagedTreeRules;
  sourcePath: string;
  sourceRoot: string;
  target: string;
}): boolean {
  const targetPath = resolveSymlinkTargetPath(dirname(options.sourcePath), options.target);
  const relativeTargetPath = relativePathInsideRoot(options.sourceRoot, targetPath);
  return (
    relativeTargetPath !== undefined && shouldManageProjectPath(relativeTargetPath, options.rules)
  );
}

function resolveSymlinkTargetPath(anchorDir: string, target: string): string {
  return isPortableAbsolutePath(target) ? target : resolve(anchorDir, target);
}

function relativePathInsideRoot(root: string, path: string): string | undefined {
  const relativePath = relative(root, path);
  if (isPathWithinRoot(relativePath)) {
    return relativePath.replaceAll("\\", "/");
  }
  return undefined;
}
