import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertManagedProjectSnapshotUnchanged,
  captureManagedProjectSnapshot,
} from "../src/services/base-snapshots.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("managed project snapshots", () => {
  it("captures large binary files as managed byte content and detects changes", async () => {
    const root = await createTempRoot();
    const binary = Buffer.alloc(256 * 1024, 0x2a);
    binary[0] = 0x00;
    binary[1] = 0xff;
    binary[binary.length - 1] = 0x7f;
    await writeFile(join(root, "asset.bin"), binary);

    const snapshot = await captureManagedProjectSnapshot(root);
    const entry = snapshot.entries.find((candidate) => candidate.path === "asset.bin");
    expect(entry?.kind).toBe("file");
    expect(entry?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(entry?.size).toBe(binary.length);

    const snapshotPath = join(root, ".oraculum", "snapshot.json");
    await mkdir(join(root, ".oraculum"), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    await expect(
      assertManagedProjectSnapshotUnchanged(root, snapshotPath),
    ).resolves.toBeUndefined();

    binary[2] = 0x11;
    await writeFile(join(root, "asset.bin"), binary);

    await expect(assertManagedProjectSnapshotUnchanged(root, snapshotPath)).rejects.toThrow(
      "asset.bin",
    );
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-snapshots-"));
  tempRoots.push(path);
  return path;
}
