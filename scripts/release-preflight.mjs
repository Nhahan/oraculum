import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] ? process.argv[1] === scriptPath : false;

export function buildReleasePreflightSteps(rawArgs) {
  const args = new Set(rawArgs);

  const steps = [
    {
      label: "npm whoami",
      command: "npm",
      args: ["whoami"],
      skipFlag: "--skip-npm-whoami",
    },
    {
      label: "npm run check:full",
      command: "npm",
      args: ["run", "check:full"],
      skipFlag: "--skip-check-full",
    },
    {
      label: "npm run build",
      command: "npm",
      args: ["run", "build"],
      skipFlag: "--skip-build",
    },
    {
      label: "npm pack --dry-run",
      command: "npm",
      args: ["pack", "--dry-run"],
      skipFlag: "--skip-pack-dry-run",
    },
    {
      label: "npm run evidence:smoke",
      command: "npm",
      args: ["run", "evidence:smoke"],
      skipFlag: "--skip-smoke",
    },
  ];

  if (args.has("--with-launch-smoke")) {
    steps.push({
      label: "npm run evidence:launch-smoke",
      command: "npm",
      args: ["run", "evidence:launch-smoke"],
      skipFlag: "--skip-launch-smoke",
    });
  }

  if (args.has("--with-workflow-comparison")) {
    steps.push({
      label: "npm run evidence:workflow-comparison",
      command: "npm",
      args: ["run", "evidence:workflow-comparison"],
      skipFlag: "--skip-workflow-comparison",
    });
  }

  return { args, steps };
}

export function runReleasePreflight(rawArgs, options = {}) {
  const { args, steps } = buildReleasePreflightSteps(rawArgs);
  const run =
    options.run ??
    ((command, commandArgs) =>
      spawnSync(command, commandArgs, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        stdio: "inherit",
      }));
  const writeStdout = options.writeStdout ?? ((message) => process.stdout.write(message));
  const writeStderr = options.writeStderr ?? ((message) => process.stderr.write(message));

  for (const step of steps) {
    if (args.has(step.skipFlag)) {
      writeStdout(`SKIP ${step.label}\n`);
      continue;
    }

    writeStdout(`RUN ${step.label}\n`);
    const result = run(step.command, step.args);

    if (result.status !== 0) {
      const code = result.status ?? 1;
      writeStderr(`FAIL ${step.label} (exit ${code})\n`);
      return code;
    }
  }

  writeStdout("Release preflight passed.\n");
  return 0;
}

if (isEntrypoint) {
  const exitCode = runReleasePreflight(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
