import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach } from "vitest";

export function createTempRootHarness(defaultPrefix: string): {
  createTempRoot(prefix?: string): Promise<string>;
  registerCleanup(): void;
} {
  const tempRoots: string[] = [];

  return {
    async createTempRoot(prefix = defaultPrefix): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), prefix));
      tempRoots.push(root);
      return root;
    },
    registerCleanup(): void {
      afterEach(async () => {
        await Promise.all(
          tempRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
        );
      });
    },
  };
}

export async function writeJsonArtifact(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeTextArtifact(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}
