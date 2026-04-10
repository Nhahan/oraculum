import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { OraculumError } from "../core/errors.js";
import type { ManagedTreeRules } from "../domain/config.js";

import {
  listManagedProjectEntries,
  type ManagedPathEntry,
  readSymlinkTargetType,
} from "./managed-tree.js";

const managedSnapshotEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["dir", "file", "symlink"]),
  hash: z.string().min(1).optional(),
  mode: z.number().int().min(0).optional(),
  target: z.string().min(1).optional(),
  targetType: z.enum(["file", "dir", "junction"]).optional(),
});

const managedProjectSnapshotSchema = z.object({
  createdAt: z.string().min(1),
  entries: z.array(managedSnapshotEntrySchema),
});

type ManagedSnapshotEntry = z.infer<typeof managedSnapshotEntrySchema>;
export type ManagedProjectSnapshot = z.infer<typeof managedProjectSnapshotSchema>;

export async function captureManagedProjectSnapshot(
  root: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ManagedProjectSnapshot> {
  const paths = await listManagedProjectEntries(root, options);
  const entries = await Promise.all(paths.map((entry) => captureManagedEntry(root, entry)));

  return managedProjectSnapshotSchema.parse({
    createdAt: new Date().toISOString(),
    entries,
  });
}

export async function readManagedProjectSnapshot(path: string): Promise<ManagedProjectSnapshot> {
  const raw = await readFile(path, "utf8");
  return managedProjectSnapshotSchema.parse(JSON.parse(raw) as unknown);
}

export async function assertManagedProjectSnapshotUnchanged(
  projectRoot: string,
  snapshotPath: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<void> {
  const expected = await readManagedProjectSnapshot(snapshotPath);
  const current = await captureManagedProjectSnapshot(projectRoot, options);
  const differences = diffSnapshots(expected.entries, current.entries);

  if (differences.length === 0) {
    return;
  }

  const preview = differences.slice(0, 3).join(", ");
  const suffix = differences.length > 3 ? `, plus ${differences.length - 3} more` : "";
  throw new OraculumError(
    `Cannot export into a non-git project because managed project paths changed since the run started: ${preview}${suffix}.`,
  );
}

async function captureManagedEntry(
  root: string,
  entry: ManagedPathEntry,
): Promise<ManagedSnapshotEntry> {
  const absolutePath = join(root, entry.path);
  if (entry.kind === "dir") {
    const stats = await lstat(absolutePath);
    return managedSnapshotEntrySchema.parse({
      path: entry.path,
      kind: "dir",
      mode: getManagedMode(stats.mode),
    });
  }

  const stats = await lstat(absolutePath);

  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath);

    return managedSnapshotEntrySchema.parse({
      path: entry.path,
      kind: "symlink",
      target,
      targetType: await readSymlinkTargetType(absolutePath),
    });
  }

  const hash = createHash("sha256")
    .update(await readFile(absolutePath))
    .digest("hex");
  return managedSnapshotEntrySchema.parse({
    path: entry.path,
    kind: "file",
    hash,
    mode: getManagedMode(stats.mode),
  });
}

function diffSnapshots(
  expectedEntries: ManagedSnapshotEntry[],
  currentEntries: ManagedSnapshotEntry[],
): string[] {
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));
  const current = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const allPaths = new Set([...expected.keys(), ...current.keys()]);
  const differences: string[] = [];

  for (const relativePath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const expectedEntry = expected.get(relativePath);
    const currentEntry = current.get(relativePath);

    if (!expectedEntry || !currentEntry) {
      differences.push(relativePath);
      continue;
    }

    if (
      expectedEntry.kind !== currentEntry.kind ||
      expectedEntry.hash !== currentEntry.hash ||
      expectedEntry.mode !== currentEntry.mode ||
      expectedEntry.target !== currentEntry.target ||
      expectedEntry.targetType !== currentEntry.targetType
    ) {
      differences.push(relativePath);
    }
  }

  return differences;
}

function getManagedMode(mode: number): number {
  return mode & 0o777;
}
