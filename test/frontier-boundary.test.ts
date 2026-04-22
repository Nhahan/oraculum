import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

describe("frontier boundary policy", () => {
  it("keeps named detector packs out of product source", async () => {
    const projectRoot = process.cwd();
    const srcRoot = join(projectRoot, "src");
    const files = (await listFilesRecursive(srcRoot))
      .filter((file) => file.endsWith(".ts"))
      .sort((left, right) => left.localeCompare(right));
    const bannedDetectorTerms = [
      "playwright",
      "cypress",
      "prisma",
      "drizzle",
      "alembic",
      "frontend-config",
      "migration-tool",
      "e2e-or-visual",
      "migration-dry-run",
      "schema-validation",
      "rollback-simulation",
      "migration-drift",
    ];
    const offenders: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      const lower = text.toLowerCase();
      for (const term of bannedDetectorTerms) {
        if (lower.includes(term)) {
          offenders.push(`${relative(projectRoot, file)} contains ${term}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(path)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}
