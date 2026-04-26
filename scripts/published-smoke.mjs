import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolvePackedInstallSpec, runOrThrow, writeNodeBinary } from "./smoke/shared-install.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const publishedSpec = process.env.ORACULUM_PUBLISHED_SPEC;
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";

export function classifyPublishedSmokePrompt(prompt) {
  if (
    prompt.includes(
      "You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.",
    )
  ) {
    return "preflight";
  }

  if (
    prompt.includes(
      "You are selecting the best Oraculum consultation validation posture for the current repository.",
    )
  ) {
    return "profile";
  }

  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    return "winner";
  }

  if (
    prompt.includes("You are proposing one Oraculum implementation spec.") ||
    prompt.includes("You are selecting Oraculum implementation specs")
  ) {
    return "read-only";
  }

  return /^Candidate ID: (.+)$/m.test(prompt) ? "candidate" : "read-only";
}

export function shouldPublishedSmokeMutateWorkspace(prompt) {
  return classifyPublishedSmokePrompt(prompt) === "candidate";
}

export function buildPublishedSmokeFakeCodexSource() {
  return `const fs = require("node:fs");
const path = require("node:path");
const classifyPublishedSmokePrompt = ${classifyPublishedSmokePrompt.toString()};
const shouldPublishedSmokeMutateWorkspace = ${shouldPublishedSmokeMutateWorkspace.toString()};

	const prompt = fs.readFileSync(0, "utf8");
	const promptKind = classifyPublishedSmokePrompt(prompt);
	const args = process.argv.slice(2);
	const cwdIndex = args.indexOf("-C");
	if (cwdIndex >= 0 && typeof args[cwdIndex + 1] === "string") {
	  process.chdir(args[cwdIndex + 1]);
	}
	const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);
	const candidateId = candidateMatch ? candidateMatch[1].trim() : "cand-01";

	function preflightPayload() {
	  return {
	    decision: "proceed",
	    confidence: "high",
	    summary: "The repository and task are grounded enough to start the consultation.",
	    researchPosture: "repo-only",
	  };
	}

	function profilePayload() {
	  return {
	    validationProfileId: "library",
    confidence: "high",
    validationSummary: "library profile fits the repository signals.",
    candidateCount: 2,
    strategyIds: ["minimal-change", "test-amplified"],
    selectedCommandIds: ["lint-fast", "typecheck-fast", "unit-impact", "full-suite-deep"],
    validationGaps: [],
  };
}

	function winnerPayload() {
  return {
    decision: "select",
    candidateId: "cand-02",
    confidence: "high",
    summary: "cand-02 preserved the strongest evidence.",
    judgingCriteria: ["The winner-specific hello string is implemented."],
  };
}

function resolveWorkspaceRoot() {
  const current = process.cwd();
  if (current.includes(path.sep + '.oraculum' + path.sep + 'workspaces' + path.sep)) {
    return current;
  }

  const workspacesRoot = path.join(current, '.oraculum', 'workspaces');
  if (!candidateId || !fs.existsSync(workspacesRoot)) {
    return current;
  }

  for (const runDir of fs.readdirSync(workspacesRoot)) {
    const candidateRoot = path.join(workspacesRoot, runDir, candidateId);
    if (fs.existsSync(path.join(candidateRoot, 'src', 'index.js'))) {
      return candidateRoot;
    }
  }

  return current;
}

function mutateWorkspace() {
  const file = path.join(resolveWorkspaceRoot(), "src", "index.js");
  const next = fs.readFileSync(file, "utf8").replace('"Bye"', '"Hello from ' + candidateId + '"');
  fs.writeFileSync(file, next, "utf8");
}

	if (shouldPublishedSmokeMutateWorkspace(prompt)) {
	  mutateWorkspace();
	}

let out = "";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "-o") {
    out = args[index + 1] || "";
  }
}

	process.stdout.write(JSON.stringify({ event: "started" }) + "\\n");
	if (out) {
	  const payload = promptKind === "preflight"
	    ? preflightPayload()
	    : promptKind === "profile"
	      ? profilePayload()
	      : promptKind === "winner"
	        ? winnerPayload()
	        : "candidate patch ready";
	  fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
	}
process.exit(0);
`;
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-published-smoke-"));

  try {
    const prefix = join(tempRoot, "prefix");
    const projectRoot = join(tempRoot, "project");
    await mkdir(prefix, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    const installSpec = resolvePackedInstallSpec(repoRoot, tempRoot, publishedSpec);

    runOrThrow("npm", ["install", "-g", "--prefix", prefix, installSpec], { cwd: tempRoot });

    const oraculumBinary =
      process.platform === "win32" ? join(prefix, "oraculum.cmd") : join(prefix, "bin", "oraculum");
    if (!existsSync(oraculumBinary)) {
      throw new Error(`Installed Oraculum binary was not found at ${oraculumBinary}.`);
    }
    const packageRootCandidates =
      process.platform === "win32"
        ? [join(prefix, "node_modules", "oraculum")]
        : [
            join(prefix, "lib", "node_modules", "oraculum"),
            join(prefix, "node_modules", "oraculum"),
          ];
    const packageRoot = packageRootCandidates.find((candidate) => existsSync(candidate));
    if (!packageRoot) {
      throw new Error(`Installed Oraculum package directory was not found under ${prefix}.`);
    }
    const oraculumCliPath = join(packageRoot, "dist", "cli.js");
    if (!existsSync(oraculumCliPath)) {
      throw new Error(`Installed Oraculum CLI entry was not found at ${oraculumCliPath}.`);
    }
    const oraculumOrcActionsPath = join(packageRoot, "dist", "services", "orc-actions.js");
    if (!existsSync(oraculumOrcActionsPath)) {
      throw new Error(
        `Installed Oraculum Orc action entry was not found at ${oraculumOrcActionsPath}.`,
      );
    }

    await writeFile(
      join(projectRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "published-smoke",
          version: "0.0.0",
          type: "module",
          packageManager: "npm@10.9.3",
          main: "./src/index.js",
          exports: {
            ".": "./src/index.js",
          },
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "index.js"),
      'export function greet() {\n  return "Bye";\n}\n',
      "utf8",
    );
    await mkdir(join(projectRoot, "node_modules", ".bin"), { recursive: true });
    const fakeBinaryPath = await writeNodeBinary(
      projectRoot,
      "published-smoke-codex",
      buildPublishedSmokeFakeCodexSource(),
    );

    runOrThrow("git", ["init"], { cwd: projectRoot });
    runOrThrow("git", ["config", "user.name", "Smoke Bot"], { cwd: projectRoot });
    runOrThrow("git", ["config", "user.email", "smoke@example.com"], { cwd: projectRoot });
    runOrThrow("git", ["add", "."], { cwd: projectRoot });
    runOrThrow("git", ["commit", "-m", "base"], { cwd: projectRoot });

    const env = {
      ...process.env,
      ORACULUM_AGENT_RUNTIME: "codex",
      ORACULUM_CODEX_BIN: fakeBinaryPath,
    };

    const { runConsultAction, runCrownAction } = await import(
      pathToFileURL(oraculumOrcActionsPath).href
    );

    const consult = await invokeTool(env, async () => {
      const response = await runConsultAction({
        cwd: projectRoot,
        taskInput: "Update src/index.js so greet() returns a winner-specific hello string.",
      });
      return `Consultation complete.\n${response.summary}`;
    });
    assertContains(consult.stdout, "Consultation complete.");

    const crown = await invokeTool(env, async () => {
      const response = await runCrownAction({
        cwd: projectRoot,
        materializationName: "fix/published-smoke",
      });
      return [
        `Crowned ${response.plan.winnerId}`,
        `Consultation: ${response.plan.runId}`,
        `Branch: ${response.plan.branchName}`,
        `Crowning record: ${response.recordPath}`,
      ].join("\n");
    });
    assertContains(crown.stdout, "Crowned cand-02");

    const branch = runOrThrow("git", ["branch", "--show-current"], {
      cwd: projectRoot,
    }).stdout.trim();
    if (branch !== "fix/published-smoke") {
      throw new Error(`Expected crowned branch fix/published-smoke, received ${branch}.`);
    }
    const contents = await readFile(join(projectRoot, "src", "index.js"), "utf8");
    assertContains(contents, "cand-02");

    process.stdout.write(`Packaged smoke passed for ${installSpec}.\n`);
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Published smoke workspace preserved at ${tempRoot}\n`);
    }
  }
}

async function invokeTool(envPatch, action) {
  const restoreEnv = patchEnv(envPatch);

  try {
    const stdout = await action();
    return {
      status: 0,
      stdout,
      stderr: "",
    };
  } finally {
    restoreEnv();
  }
}

function patchEnv(envPatch = {}) {
  const keys = Object.keys(envPatch);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function assertContains(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to contain "${expected}".\nReceived:\n${value}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
