import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getFinalistComparisonMarkdownPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createTempRoot,
  registerExecutionTempRootCleanup,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerExecutionTempRootCleanup();

describe("run execution oracles", () => {
  it("runs repo-local hard-gate oracles and eliminates failing candidates", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "workspace-sanity",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.stderr.write('missing expected file'); process.exit(7);"],
        invariant: "Impact checks must pass before promotion.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "repo-oracle.md"), "# Repo oracle\nValidate impact.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? "not-json"
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/repo-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "workspace-sanity",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.severity).toBe("error");

    const stderrPath = getCandidateOracleStderrLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "workspace-sanity",
    );
    expect(await readFile(stderrPath, "utf8")).toContain("missing expected file");
  });

  it("runs workspace-scoped repo-local oracles inside safe relative cwd values", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", "README.md"), "app package\n", "utf8");
    await configureProjectOracles(cwd, [
      {
        id: "workspace-package-cwd",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const expected = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'packages', 'app');",
            "if (fs.realpathSync(process.cwd()) !== fs.realpathSync(expected)) { console.error('cwd=' + process.cwd() + ' expected=' + expected); process.exit(2); }",
            "if (fs.realpathSync(process.env.ORACULUM_ORACLE_CWD) !== fs.realpathSync(expected)) { console.error('oracle cwd env mismatch'); process.exit(3); }",
            "if (!fs.existsSync(path.join(process.cwd(), 'candidate-change.txt'))) { console.error('missing nested candidate change'); process.exit(4); }",
          ].join(" "),
        ],
        cwd: "workspace",
        relativeCwd: "packages/app",
        invariant: "Workspace-scoped oracles may run in a safe nested package directory.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "workspace-relative-cwd.md"),
      "# Workspace relative cwd\nValidate nested package checks.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "packages", "app", "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/workspace-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("runs project-scoped repo-local oracles inside safe relative cwd values", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tools"), { recursive: true });
    await writeFile(join(cwd, "tools", "project-marker.txt"), "project tool\n", "utf8");
    await configureProjectOracles(cwd, [
      {
        id: "project-tool-cwd",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const expected = path.join(process.env.ORACULUM_PROJECT_ROOT, 'tools');",
            "if (fs.realpathSync(process.cwd()) !== fs.realpathSync(expected)) { console.error('cwd=' + process.cwd() + ' expected=' + expected); process.exit(2); }",
            "if (fs.realpathSync(process.env.ORACULUM_ORACLE_CWD) !== fs.realpathSync(expected)) { console.error('oracle cwd env mismatch'); process.exit(3); }",
            "if (!fs.existsSync(path.join(process.cwd(), 'project-marker.txt'))) { console.error('missing project marker'); process.exit(4); }",
          ].join(" "),
        ],
        cwd: "project",
        relativeCwd: "tools",
        invariant: "Project-scoped oracles may run in a safe nested project tool directory.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "project-relative-cwd.md"),
      "# Project relative cwd\nValidate project tool checks.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/project-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("rejects repo-local oracle relative cwd symlink escapes", async () => {
    const cwd = await createTempRoot();
    const outside = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await symlink(
      outside,
      join(cwd, "escaped-cwd"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await configureProjectOracles(cwd, [
      {
        id: "escaped-cwd",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.exit(0);"],
        cwd: "project",
        relativeCwd: "escaped-cwd",
        invariant:
          "Relative oracle cwd must stay inside the selected scope after symlink resolution.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "escaped-relative-cwd.md"),
      "# Escaped relative cwd\nReject symlink escape.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/escaped-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    await expect(
      readFile(
        getCandidateOracleStderrLogPath(cwd, planned.id, "cand-01", "impact", "escaped-cwd"),
        "utf8",
      ),
    ).resolves.toContain("relativeCwd escapes the project scope");
  }, 20_000);

  it("runs repo-local signal oracles without blocking promotion", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "comparison-signal",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.stderr.write('needs human review'); process.exit(9);"],
        invariant: "Comparison signals should be preserved even when they do not block promotion.",
        enforcement: "signal",
        failureSummary: "Candidate should still be promoted, but the signal must be preserved.",
      },
    ]);
    await writeFile(join(cwd, "tasks", "signal-oracle.md"), "# Signal oracle\nKeep going.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/signal-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner?.source).toBe("fallback-policy");

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("pass");
    expect(verdict.severity).toBe("warning");

    const stdoutPath = getCandidateOracleStdoutLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    const stderrPath = getCandidateOracleStderrLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    expect(await readFile(stdoutPath, "utf8")).toBe("");
    expect(await readFile(stderrPath, "utf8")).toContain("needs human review");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.toContain("fallback-policy");
  }, 20_000);

  it("runs repo-local command plus args oracles through the platform-safe default shell", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    const fakeOracle = await writeNodeBinary(
      cwd,
      "fake-oracle",
      `const fs = require("node:fs");
const path = require("node:path");
const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, "oracle-marker.txt");
fs.writeFileSync(marker, process.argv.slice(2).join(" "), "utf8");
process.stdout.write("oracle ok");
`,
    );
    await configureProjectOracles(cwd, [
      {
        id: "wrapper-oracle",
        roundId: "impact",
        command: fakeOracle,
        args: ["lint", "--strict"],
        invariant: "Repo-local wrapper commands should run across supported platforms.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "wrapper-oracle.md"), "# Wrapper oracle\nRun wrapper.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/wrapper-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    await expect(
      readFile(
        join(cwd, ".oraculum", "workspaces", planned.id, "cand-01", "oracle-marker.txt"),
        "utf8",
      ),
    ).resolves.toBe("lint --strict");
  }, 20_000);

  it("builds oracle PATH from existing local tool directories only", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "local-tool-paths",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const { delimiter, join } = require('node:path');",
            "const entries = (process.env.PATH || '').split(delimiter);",
            "const workspaceVenv = join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');",
            "const projectNodeBin = join(process.env.ORACULUM_PROJECT_ROOT, 'node_modules', '.bin');",
            "if (!entries.includes(workspaceVenv)) { console.error('missing workspace venv'); process.exit(2); }",
            "if (entries.includes(projectNodeBin)) { console.error('unexpected project node_modules bin'); process.exit(3); }",
          ].join(" "),
        ],
        invariant: "Repo-local oracle PATH should include only existing local tool directories.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "local-tool-paths.md"), "# Local tool paths\nCheck PATH.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts" : "bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/local-tool-paths.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("orders candidate-local oracle PATH entries before project-root local tools", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await configureProjectOracles(cwd, [
      {
        id: "candidate-tool-path-precedence",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const { delimiter, join } = require('node:path');",
            "const entries = (process.env.PATH || '').split(delimiter);",
            "const candidateNodeBin = join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'node_modules', '.bin');",
            "const projectNodeBin = join(process.env.ORACULUM_PROJECT_ROOT, 'node_modules', '.bin');",
            "const candidateIndex = entries.indexOf(candidateNodeBin);",
            "const projectIndex = entries.indexOf(projectNodeBin);",
            "if (candidateIndex < 0) { console.error('missing candidate node_modules bin'); process.exit(2); }",
            "if (projectIndex < 0) { console.error('missing project node_modules bin'); process.exit(3); }",
            "if (candidateIndex >= projectIndex) { console.error('candidate tools should precede project tools'); process.exit(4); }",
          ].join(" "),
        ],
        invariant: "Candidate-local tools should take precedence over project-root tools.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "candidate-tool-path-precedence.md"),
      "# Candidate tool path precedence\nCheck PATH order.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), "node_modules", ".bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/candidate-tool-path-precedence.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("preserves an explicit empty oracle PATH override over local tool directory injection", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "empty-path",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "if (process.env.PATH !== '') {",
            "  console.error('expected empty PATH, received: ' + process.env.PATH);",
            "  process.exit(2);",
            "}",
          ].join(" "),
        ],
        env: {
          PATH: "",
        },
        invariant: "Explicit oracle PATH overrides should be preserved.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "empty-path.md"), "# Empty PATH\nCheck env override.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), "node_modules", ".bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/empty-path.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("does not inherit global oracle PATH unless the oracle opts in", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    const globalBin = join(cwd, "global-bin");
    const pathExpectationScript = (expected: boolean) =>
      [
        "const { delimiter } = require('node:path');",
        `const sentinel = ${JSON.stringify(globalBin)};`,
        "const entries = (process.env.PATH || '').split(delimiter).filter(Boolean);",
        `if (entries.includes(sentinel) !== ${expected}) {`,
        "  console.error('unexpected PATH entries: ' + entries.join('|'));",
        "  process.exit(2);",
        "}",
      ].join(" ");
    await configureProjectOracles(cwd, [
      {
        id: "local-path-only",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", pathExpectationScript(false)],
        invariant: "Repo-local oracles should not inherit global PATH by default.",
        enforcement: "hard",
      },
      {
        id: "inherit-path",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", pathExpectationScript(true)],
        pathPolicy: "inherit",
        invariant: "Repo-local oracles can explicitly inherit global PATH.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "path-policy.md"), "# PATH policy\nCheck oracle PATH.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/path-policy.md",
      agent: "codex",
      candidates: 1,
    });

    const originalPath = process.env.PATH;
    process.env.PATH = [globalBin, originalPath].filter((entry) => entry).join(delimiter);
    try {
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      await expect(
        readFile(
          getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-local-path-only"),
          "utf8",
        ),
      ).resolves.toContain("PathPolicy=local-only");
      await expect(
        readFile(
          getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-inherit-path"),
          "utf8",
        ),
      ).resolves.toContain("PathPolicy=inherit");
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  }, 20_000);

  it("does not leak unrelated host environment variables into repo-local oracles", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "host-env-isolation",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "if (process.env.ORACULUM_TEST_HOST_SECRET) {",
            "  console.error('unexpected leaked env');",
            "  process.exit(2);",
            "}",
          ].join(" "),
        ],
        invariant:
          "Repo-local oracles should only receive deterministic Oraculum env plus explicit overrides.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "host-env-isolation.md"),
      "# Host env isolation\nCheck env.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/host-env-isolation.md",
      agent: "codex",
      candidates: 1,
    });

    const originalSecret = process.env.ORACULUM_TEST_HOST_SECRET;
    process.env.ORACULUM_TEST_HOST_SECRET = "should-not-leak";
    try {
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ORACULUM_TEST_HOST_SECRET;
      } else {
        process.env.ORACULUM_TEST_HOST_SECRET = originalSecret;
      }
    }
  }, 20_000);

  it("resolves bare repo-local Gradle wrappers without inheriting the global PATH", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeNodeBinary(
      cwd,
      "gradlew",
      `const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, "gradle-wrapper-marker.txt"), process.argv.slice(2).join(" "), "utf8");
`,
    );
    await configureProjectOracles(cwd, [
      {
        id: "gradle-wrapper",
        roundId: "impact",
        command: "gradlew",
        args: ["test"],
        invariant: "Repo-local Gradle wrappers should resolve from the repository checkout.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "gradle-wrapper.md"), "# Gradle wrapper\nRun wrapper.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/gradle-wrapper.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    await expect(
      readFile(
        join(cwd, ".oraculum", "workspaces", planned.id, "cand-01", "gradle-wrapper-marker.txt"),
        "utf8",
      ),
    ).resolves.toBe("test");
    await expect(
      readFile(
        getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-gradle-wrapper"),
        "utf8",
      ),
    ).resolves.toContain("ResolvedCommand=");
  }, 20_000);
});
