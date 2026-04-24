import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { getExpectedCodexSkillDirs } from "./packaged.js";
import { CODEX_INSTALL_VERSION, CODEX_RULE_FILENAME } from "./shared.js";

export async function prepareCodexSetupRoot(options: {
  homeDir: string;
  packagedRoot: string;
}): Promise<string> {
  const installRoot = join(
    options.homeDir,
    ".oraculum",
    "chat-native",
    "codex",
    CODEX_INSTALL_VERSION,
  );
  await rm(installRoot, { force: true, recursive: true });
  await cp(options.packagedRoot, installRoot, {
    force: true,
    recursive: true,
  });
  return installRoot;
}

export function assertPackagedCodexArtifacts(packagedRoot: string): void {
  const expectedPaths = [
    join(packagedRoot, "rules", CODEX_RULE_FILENAME),
    ...getExpectedCodexSkillDirs().map((dirName) =>
      join(packagedRoot, "skills", dirName, "SKILL.md"),
    ),
  ];

  const missing = expectedPaths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new OraculumError(
      [
        "Packaged Codex host artifacts are incomplete.",
        "Build Oraculum first so setup can install the generated host artifacts.",
        ...missing.map((path) => `Missing: ${path}`),
      ].join("\n"),
    );
  }
}

export async function installCodexArtifacts(options: {
  installRoot: string;
  rulesRoot: string;
  skillsRoot: string;
}): Promise<void> {
  await mkdir(options.skillsRoot, { recursive: true });
  await mkdir(options.rulesRoot, { recursive: true });

  const packagedSkillsRoot = join(options.installRoot, "skills");
  const packagedRulesRoot = join(options.installRoot, "rules");

  const packagedSkillDirs = await readdir(packagedSkillsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const desiredSkillNames = packagedSkillDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const desired of desiredSkillNames) {
    const sourcePath = join(packagedSkillsRoot, desired);
    const targetPath = join(options.skillsRoot, desired);
    await rm(targetPath, { recursive: true, force: true });
    await cp(sourcePath, targetPath, {
      force: true,
      recursive: true,
    });
  }

  await pruneManagedCodexSkills(options.skillsRoot, new Set(desiredSkillNames));

  const packagedRules = await readdir(packagedRulesRoot, { withFileTypes: true });
  const desiredRuleNames = packagedRules
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const desired of desiredRuleNames) {
    const sourcePath = join(packagedRulesRoot, desired);
    const targetPath = join(options.rulesRoot, desired);
    await rm(targetPath, { recursive: true, force: true });
    await cp(sourcePath, targetPath, {
      force: true,
      recursive: true,
    });
  }

  await pruneManagedCodexRules(options.rulesRoot, new Set(desiredRuleNames));
}

export async function pruneManagedCodexSkills(
  skillsRoot: string,
  desired: Set<string>,
): Promise<void> {
  try {
    await readdir(skillsRoot);
  } catch {
    return;
  }

  const managedSkillDirs = new Set(getExpectedCodexSkillDirs());
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!managedSkillDirs.has(entry.name) || desired.has(entry.name)) {
      continue;
    }

    await rm(join(skillsRoot, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

export async function pruneManagedCodexRules(
  rulesRoot: string,
  desired: Set<string>,
): Promise<void> {
  try {
    await readdir(rulesRoot);
  } catch {
    return;
  }

  const managedRuleFiles = new Set([CODEX_RULE_FILENAME]);
  for (const entry of await readdir(rulesRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !managedRuleFiles.has(entry.name) || desired.has(entry.name)) {
      continue;
    }

    await rm(join(rulesRoot, entry.name), {
      force: true,
      recursive: true,
    });
  }
}
