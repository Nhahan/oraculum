import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const ROOT_DOCS = ["README.md", "README.ko.md", "AGENTS.md"];
const LOCAL_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)|href="([^"]+)"/gu;

describe("tracked docs", () => {
  it("resolve local markdown and html links to existing files", async () => {
    const files = [...ROOT_DOCS, ...(await collectMarkdownFiles(join(REPO_ROOT, "docs")))];
    const failures: string[] = [];

    for (const file of files) {
      const absoluteFile = resolve(REPO_ROOT, file);
      const content = await readFile(absoluteFile, "utf8");
      for (const rawLink of extractLocalLinks(content)) {
        const targetPath = rawLink.split("#")[0] ?? "";
        if (targetPath.length === 0) {
          continue;
        }

        const resolvedPath = targetPath.startsWith("/")
          ? resolve(REPO_ROOT, `.${targetPath}`)
          : resolve(dirname(absoluteFile), targetPath);

        try {
          await access(resolvedPath);
        } catch {
          failures.push(`${file} -> ${rawLink} (${resolvedPath})`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(absolutePath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    files.push(relativeFromRepoRoot(absolutePath));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function extractLocalLinks(content: string): string[] {
  const links: string[] = [];

  for (const match of content.matchAll(LOCAL_LINK_PATTERN)) {
    const candidate = match[1] ?? match[2];
    if (!candidate || isExternalLink(candidate) || candidate.startsWith("#")) {
      continue;
    }
    links.push(candidate);
  }

  return links;
}

function isExternalLink(target: string): boolean {
  return /^[a-z]+:\/\//iu.test(target) || target.startsWith("mailto:");
}

function relativeFromRepoRoot(path: string): string {
  return relative(REPO_ROOT, path);
}
