import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildCodexRuleFiles,
  buildCodexSkillFiles,
  getExpectedCodexRuleFileName,
  getExpectedCodexSkillDirs,
  getPackagedCodexRoot,
  setupCodexHost,
  uninstallCodexHost,
} from "../src/services/codex-chat-native.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-codex-setup-");
tempRootHarness.registerCleanup();

describe("Codex chat-native packaging", () => {
  it("generates rules and skills from the shared manifest", () => {
    const rules = buildCodexRuleFiles(oraculumCommandManifest);
    const skills = buildCodexSkillFiles(oraculumCommandManifest);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.path).toBe("rules/oraculum.md");
    expect(rules[0]?.content).toContain("## Exact-Prefix Dispatch");
    expect(rules[0]?.content).toContain(
      "after the Oraculum CLI returns, return only its stdout or failure to the user",
    );
    expect(rules[0]?.content).toContain("do not inspect files, run extra shell commands");
    expect(rules[0]?.content).toContain(
      "`orc consult` -> run `oraculum orc consult --json`; this resumes the latest running consultation first",
    );
    expect(rules[0]?.content).toContain("orc consult --defer");
    expect(rules[0]?.content).toContain("orc crown [materializationName] [--branch <branchName>]");
    expect(rules[0]?.content).toContain("apply-approval");
    expect(rules[0]?.content).toContain("oraculum orc consult --json");
    expect(rules[0]?.content).toContain("oraculum orc plan --json");
    expect(rules[0]?.content).toContain("oraculum orc verdict --json");
    expect(rules[0]?.content).toContain("structured user-input");
    expect(rules[0]?.content).toContain("oraculum orc answer --json");
    expect(rules[0]?.content).toContain("userInteraction.kind");
    expect(rules[0]?.content).toContain("include only those exact choices");
    expect(rules[0]?.content).toContain("__other__");
    expect(skills.map((file) => file.path)).toEqual([
      "skills/route-consult/SKILL.md",
      "skills/route-plan/SKILL.md",
      "skills/route-verdict/SKILL.md",
      "skills/route-crown/SKILL.md",
    ]);
    expect(skills.find((file) => file.path.endsWith("route-plan/SKILL.md"))?.content).toContain(
      "userInteraction.question",
    );
    expect(skills.find((file) => file.path.endsWith("route-plan/SKILL.md"))?.content).toContain(
      "userInteraction.options",
    );
    expect(skills.find((file) => file.path.endsWith("route-plan/SKILL.md"))?.content).toContain(
      "include only those exact choices",
    );
    expect(skills.find((file) => file.path.endsWith("route-consult/SKILL.md"))?.content).toContain(
      "oraculum orc consult --json",
    );
    expect(skills.find((file) => file.path.endsWith("route-consult/SKILL.md"))?.content).toContain(
      "apply-approval",
    );
    expect(skills.find((file) => file.path.endsWith("route-verdict/SKILL.md"))?.content).toContain(
      "oraculum orc verdict --json",
    );
    expect(skills.find((file) => file.path.endsWith("route-consult/SKILL.md"))?.content).toContain(
      "oraculum orc answer --json",
    );
    expect(getExpectedCodexRuleFileName()).toBe("oraculum.md");
    expect(getExpectedCodexSkillDirs()).toContain("route-consult");
  });

  it("resolves the packaged Codex root inside dist", () => {
    expect(getPackagedCodexRoot().replaceAll("\\", "/")).toContain("/dist/chat-native/codex");
  });
});

describe("Codex setup", () => {
  it("fails before touching host wiring when packaged Codex artifacts are incomplete", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-missing-packaged-");
    const homeDir = join(root, "home");
    const packagedRoot = join(root, "packaged-codex");
    await mkdir(join(packagedRoot, "rules"), { recursive: true });
    await writeFile(join(packagedRoot, "rules", "oraculum.md"), "# Oraculum\n", "utf8");

    await expect(
      setupCodexHost({
        homeDir,
        packagedRoot,
        platform: "darwin",
      }),
    ).rejects.toThrow("Packaged Codex host artifacts are incomplete.");
  });

  it("installs packaged skills and rules for direct CLI routing", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-install-");
    const homeDir = join(root, "home");
    const packagedRoot = join(root, "packaged-codex");

    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
      await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, rule.path)), { recursive: true });
      await writeFile(join(packagedRoot, rule.path), rule.content, "utf8");
    }

    const result = await setupCodexHost({
      directCliInvocation: {
        command: process.execPath,
        args: ["/tmp/oraculum-cli.js"],
      },
      homeDir,
      packagedRoot,
      platform: "darwin",
    });

    await expect(
      readFile(join(result.skillsRoot, "route-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain(`${process.execPath} /tmp/oraculum-cli.js orc consult`);
    await expect(
      readFile(join(result.skillsRoot, "route-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain("If empty, resume the latest running consultation first");
    await expect(
      readFile(join(result.skillsRoot, "route-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain(
      "report only its stdout summary, crown materialization result, or failure",
    );
    await expect(
      readFile(join(result.skillsRoot, "route-crown", "SKILL.md"), "utf8"),
    ).resolves.toContain("Do not inspect files, run extra shell commands, edit files");
    await expect(readFile(join(result.rulesRoot, "oraculum.md"), "utf8")).resolves.toContain(
      "Handle exact `orc ...` commands through the local Oraculum CLI.",
    );
    await expect(readFile(result.configPath, "utf8")).rejects.toThrow();
  });

  it("uninstalls Codex direct-route skills and rules", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-uninstall-");
    const homeDir = join(root, "home");
    const packagedRoot = join(root, "packaged-codex");

    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
      await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, rule.path)), { recursive: true });
      await writeFile(join(packagedRoot, rule.path), rule.content, "utf8");
    }

    const setupResult = await setupCodexHost({
      homeDir,
      packagedRoot,
      platform: "darwin",
    });

    const uninstallResult = await uninstallCodexHost({
      homeDir,
      platform: "darwin",
    });

    await expect(readdir(uninstallResult.skillsRoot)).resolves.not.toContain("route-consult");
    await expect(
      readFile(join(uninstallResult.rulesRoot, "oraculum.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(setupResult.installRoot, "rules", "oraculum.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("preserves unrelated Codex skills and rules during setup and uninstall", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-preserve-custom-");
    const homeDir = join(root, "home");
    const packagedRoot = join(root, "packaged-codex");
    const customSkillPath = join(homeDir, ".codex", "skills", "route-custom", "SKILL.md");
    const customRulePath = join(homeDir, ".codex", "rules", "orchestrator.md");

    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
      await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, rule.path)), { recursive: true });
      await writeFile(join(packagedRoot, rule.path), rule.content, "utf8");
    }

    await mkdir(dirname(customSkillPath), { recursive: true });
    await mkdir(dirname(customRulePath), { recursive: true });
    await writeFile(customSkillPath, "custom skill\n", "utf8");
    await writeFile(customRulePath, "# custom rule\n", "utf8");

    await setupCodexHost({
      homeDir,
      packagedRoot,
      platform: "darwin",
    });

    await expect(readFile(customSkillPath, "utf8")).resolves.toBe("custom skill\n");
    await expect(readFile(customRulePath, "utf8")).resolves.toBe("# custom rule\n");

    await uninstallCodexHost({
      homeDir,
      platform: "darwin",
    });

    await expect(readFile(customSkillPath, "utf8")).resolves.toBe("custom skill\n");
    await expect(readFile(customRulePath, "utf8")).resolves.toBe("# custom rule\n");
  });
});
