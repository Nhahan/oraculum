import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostWrapperShellSnippet,
  getHostWrapperSnippetPath,
  installHostWrapperShellBindings,
  resolveHostWrapperRcPath,
  stripHostWrapperSourceBlock,
  uninstallHostWrapperShellBindings,
} from "../src/services/host-wrapper.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

describe("host wrapper shell bindings", () => {
  it("builds a shell snippet that preserves codex and claude entrypoints", () => {
    const snippet = buildHostWrapperShellSnippet("/tmp/oraculum-host-wrapper.zsh");

    expect(snippet).toContain('command oraculum host-wrapper codex -- "$@"');
    expect(snippet).toContain('command oraculum host-wrapper claude-code -- "$@"');
  });

  it("installs and removes the managed source block in the active shell rc", async () => {
    const homeDir = await createChatNativeTempRoot("oraculum-shell-wrapper-");
    const shellPath = "/bin/zsh";
    const rcPath = resolveHostWrapperRcPath(homeDir, shellPath);
    if (!rcPath) {
      throw new Error("expected zsh rc path");
    }

    await mkdir(join(homeDir, ".oraculum"), { recursive: true });
    await writeFile(rcPath, 'export PATH="$HOME/bin:$PATH"\n', "utf8");

    const installed = await installHostWrapperShellBindings({
      homeDir,
      shellPath,
    });

    expect(installed.snippetPath).toBe(getHostWrapperSnippetPath(homeDir, shellPath));
    expect(installed.rcPath).toBe(rcPath);

    const rcContent = await readFile(rcPath, "utf8");
    expect(rcContent).toContain("# >>> oraculum host wrapper >>>");
    expect(rcContent).toContain(installed.snippetPath);
    expect(
      (await readdir(dirname(installed.snippetPath))).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
    expect((await readdir(dirname(rcPath))).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);

    await uninstallHostWrapperShellBindings({
      homeDir,
      shellPath,
    });

    const cleaned = await readFile(rcPath, "utf8");
    expect(cleaned).not.toContain("# >>> oraculum host wrapper >>>");
    expect(cleaned).toContain('export PATH="$HOME/bin:$PATH"');
    expect((await readdir(dirname(rcPath))).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("strips existing wrapper blocks before rewriting rc files", () => {
    const existing = [
      'export PATH="$HOME/bin:$PATH"',
      "# >>> oraculum host wrapper >>>",
      '[ -f "/tmp/oraculum-host-wrapper.zsh" ] && source "/tmp/oraculum-host-wrapper.zsh"',
      "# <<< oraculum host wrapper <<<",
      "alias ll='ls -l'",
      "",
    ].join("\n");

    expect(stripHostWrapperSourceBlock(existing)).toBe(
      ['export PATH="$HOME/bin:$PATH"', "alias ll='ls -l'", ""].join("\n"),
    );
  });
});
