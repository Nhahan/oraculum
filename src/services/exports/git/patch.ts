import { OraculumError } from "../../../core/errors.js";
import { runSubprocess } from "../../../core/subprocess.js";
import type { ManagedTreeRules } from "../../../domain/config.js";
import { shouldManageProjectPath } from "../../managed-tree.js";

export async function generateWorkspacePatch(
  projectRoot: string,
  workspaceDir: string,
  baseRevision: string,
  managedTreeRules: ManagedTreeRules,
): Promise<string> {
  const stage = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "add", "-A"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (stage.exitCode !== 0) {
    throw new OraculumError(`Failed to stage candidate workspace at ${workspaceDir}.`);
  }

  const changedPathsResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "diff", "--cached", "--name-status", baseRevision, "--"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  const untrackedResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "ls-files", "--others", "--exclude-standard"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (changedPathsResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
    throw new OraculumError(`Failed to inspect branch materialization paths from ${workspaceDir}.`);
  }

  const changedPaths = new Set<string>();
  for (const line of changedPathsResult.stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const status = parts[0]?.trim() ?? "";
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const renameOrCopyPaths = status.startsWith("R")
        ? [parts[1]?.trim(), parts[2]?.trim()]
        : [parts[2]?.trim()];
      for (const candidatePath of renameOrCopyPaths) {
        if (candidatePath && shouldManageProjectPath(candidatePath, managedTreeRules)) {
          changedPaths.add(candidatePath);
        }
      }
      continue;
    }

    const candidatePath = parts[1]?.trim();
    if (candidatePath && shouldManageProjectPath(candidatePath, managedTreeRules)) {
      changedPaths.add(candidatePath);
    }
  }
  for (const line of untrackedResult.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed && shouldManageProjectPath(trimmed, managedTreeRules)) {
      changedPaths.add(trimmed);
    }
  }

  if (changedPaths.size === 0) {
    return "";
  }

  const diff = await runSubprocess({
    command: "git",
    args: [
      "-C",
      workspaceDir,
      "diff",
      "--cached",
      "--binary",
      baseRevision,
      "--",
      ...[...changedPaths].sort((left, right) => left.localeCompare(right)),
    ],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (diff.exitCode !== 0) {
    throw new OraculumError(
      `Failed to generate branch materialization changes from ${workspaceDir}.`,
    );
  }

  return diff.stdout;
}
