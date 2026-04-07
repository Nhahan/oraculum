import { runSubprocess } from "../core/subprocess.js";
import type { CandidateManifest } from "../domain/run.js";

import {
  captureManagedProjectSnapshot,
  type ManagedProjectSnapshot,
  readManagedProjectSnapshot,
} from "./base-snapshots.js";

export interface CandidateChangeInsight {
  changedPaths: string[];
  changeSummary: {
    mode: "git-diff" | "snapshot-diff" | "none";
    changedPathCount: number;
    createdPathCount: number;
    removedPathCount: number;
    modifiedPathCount: number;
    addedLineCount?: number;
    deletedLineCount?: number;
  };
}

export async function collectCandidateChangeInsight(
  candidate: CandidateManifest,
): Promise<CandidateChangeInsight> {
  if (candidate.workspaceMode === "git-worktree" && candidate.baseRevision) {
    return collectGitChangeInsight(candidate.workspaceDir, candidate.baseRevision);
  }

  if (candidate.baseSnapshotPath) {
    return collectSnapshotChangeInsight(candidate.workspaceDir, candidate.baseSnapshotPath);
  }

  return emptyChangeInsight();
}

export function emptyChangeInsight(): CandidateChangeInsight {
  return {
    changedPaths: [],
    changeSummary: {
      mode: "none",
      changedPathCount: 0,
      createdPathCount: 0,
      removedPathCount: 0,
      modifiedPathCount: 0,
    },
  };
}

async function collectGitChangeInsight(
  workspaceDir: string,
  baseRevision: string,
): Promise<CandidateChangeInsight> {
  const [nameStatus, numstat, untracked] = await Promise.all([
    runSubprocess({
      command: "git",
      args: ["diff", "--name-status", baseRevision, "--"],
      cwd: workspaceDir,
      timeoutMs: 30_000,
    }),
    runSubprocess({
      command: "git",
      args: ["diff", "--numstat", baseRevision, "--"],
      cwd: workspaceDir,
      timeoutMs: 30_000,
    }),
    runSubprocess({
      command: "git",
      args: ["ls-files", "--others", "--exclude-standard"],
      cwd: workspaceDir,
      timeoutMs: 30_000,
    }),
  ]);

  if (nameStatus.exitCode !== 0 || numstat.exitCode !== 0 || untracked.exitCode !== 0) {
    return emptyChangeInsight();
  }

  let createdPathCount = 0;
  let removedPathCount = 0;
  let modifiedPathCount = 0;
  const changedPaths = new Set<string>();

  for (const line of nameStatus.stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const status = parts[0]?.trim() ?? "";
    if (!status) {
      continue;
    }

    if (status.startsWith("A")) {
      createdPathCount += 1;
    } else if (status.startsWith("D")) {
      removedPathCount += 1;
    } else {
      modifiedPathCount += 1;
    }

    const resolvedPath = parts.at(-1)?.trim();
    if (resolvedPath) {
      changedPaths.add(resolvedPath);
    }
  }

  for (const line of untracked.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (!changedPaths.has(trimmed)) {
      createdPathCount += 1;
    }
    changedPaths.add(trimmed);
  }

  let addedLineCount = 0;
  let deletedLineCount = 0;
  for (const line of numstat.stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const [added, deleted] = line.split("\t");
    if (added && /^\d+$/u.test(added)) {
      addedLineCount += Number.parseInt(added, 10);
    }
    if (deleted && /^\d+$/u.test(deleted)) {
      deletedLineCount += Number.parseInt(deleted, 10);
    }
  }

  return {
    changedPaths: [...changedPaths].sort((left, right) => left.localeCompare(right)),
    changeSummary: {
      mode: "git-diff",
      changedPathCount: changedPaths.size,
      createdPathCount,
      removedPathCount,
      modifiedPathCount,
      addedLineCount,
      deletedLineCount,
    },
  };
}

async function collectSnapshotChangeInsight(
  workspaceDir: string,
  snapshotPath: string,
): Promise<CandidateChangeInsight> {
  const [expected, current] = await Promise.all([
    readManagedProjectSnapshot(snapshotPath),
    captureManagedProjectSnapshot(workspaceDir),
  ]);

  const diff = diffSnapshotEntries(expected, current);

  return {
    changedPaths: diff.changedPaths,
    changeSummary: {
      mode: "snapshot-diff",
      changedPathCount: diff.changedPaths.length,
      createdPathCount: diff.createdPathCount,
      removedPathCount: diff.removedPathCount,
      modifiedPathCount: diff.modifiedPathCount,
    },
  };
}

function diffSnapshotEntries(
  expected: ManagedProjectSnapshot,
  current: ManagedProjectSnapshot,
): {
  changedPaths: string[];
  createdPathCount: number;
  removedPathCount: number;
  modifiedPathCount: number;
} {
  const expectedEntries = new Map(expected.entries.map((entry) => [entry.path, entry]));
  const currentEntries = new Map(current.entries.map((entry) => [entry.path, entry]));
  const allPaths = new Set([...expectedEntries.keys(), ...currentEntries.keys()]);
  const changedPaths: string[] = [];
  let createdPathCount = 0;
  let removedPathCount = 0;
  let modifiedPathCount = 0;

  for (const relativePath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const expectedEntry = expectedEntries.get(relativePath);
    const currentEntry = currentEntries.get(relativePath);

    if (!expectedEntry && currentEntry) {
      changedPaths.push(relativePath);
      createdPathCount += 1;
      continue;
    }

    if (expectedEntry && !currentEntry) {
      changedPaths.push(relativePath);
      removedPathCount += 1;
      continue;
    }

    if (!expectedEntry || !currentEntry) {
      continue;
    }

    if (
      expectedEntry.kind !== currentEntry.kind ||
      expectedEntry.hash !== currentEntry.hash ||
      expectedEntry.mode !== currentEntry.mode ||
      expectedEntry.target !== currentEntry.target ||
      expectedEntry.targetType !== currentEntry.targetType
    ) {
      changedPaths.push(relativePath);
      modifiedPathCount += 1;
    }
  }

  return {
    changedPaths,
    createdPathCount,
    removedPathCount,
    modifiedPathCount,
  };
}
