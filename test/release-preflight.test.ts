import { describe, expect, it } from "vitest";

import { buildReleasePreflightSteps, runReleasePreflight } from "../scripts/release-preflight.mjs";

describe("release preflight", () => {
  it("uses evidence:smoke in the canonical baseline", () => {
    const { steps } = buildReleasePreflightSteps([]);

    expect(steps.map((step) => step.label)).toEqual([
      "npm whoami",
      "npm run check:full",
      "npm run build",
      "npm pack --dry-run",
      "npm run evidence:smoke",
    ]);
  });

  it("adds optional evidence lanes only when explicitly requested", () => {
    const { steps } = buildReleasePreflightSteps([
      "--with-launch-smoke",
      "--with-workflow-comparison",
    ]);

    expect(steps.map((step) => step.label)).toEqual([
      "npm whoami",
      "npm run check:full",
      "npm run build",
      "npm pack --dry-run",
      "npm run evidence:smoke",
      "npm run evidence:launch-smoke",
      "npm run evidence:workflow-comparison",
    ]);
  });

  it("does not accept the removed host-native alias", () => {
    const { steps } = buildReleasePreflightSteps(["--with-host-native"]);

    expect(steps.map((step) => step.label)).toEqual([
      "npm whoami",
      "npm run check:full",
      "npm run build",
      "npm pack --dry-run",
      "npm run evidence:smoke",
    ]);
  });

  it("honors skip flags without invoking the skipped step", () => {
    const calls: string[] = [];
    const stdout: string[] = [];

    const exitCode = runReleasePreflight(["--skip-npm-whoami", "--skip-smoke"], {
      run(command, args) {
        calls.push(`${command} ${args.join(" ")}`);
        return { status: 0 };
      },
      writeStdout(message) {
        stdout.push(message);
      },
      writeStderr() {},
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SKIP npm whoami\n");
    expect(stdout).toContain("SKIP npm run evidence:smoke\n");
    expect(calls).toEqual(["npm run check:full", "npm run build", "npm pack --dry-run"]);
  });

  it("returns the first failing exit code and stops the remaining steps", () => {
    const calls: string[] = [];
    const stderr: string[] = [];

    const exitCode = runReleasePreflight(["--skip-npm-whoami"], {
      run(command, args) {
        const label = `${command} ${args.join(" ")}`;
        calls.push(label);
        return { status: label === "npm run build" ? 17 : 0 };
      },
      writeStdout() {},
      writeStderr(message) {
        stderr.push(message);
      },
    });

    expect(exitCode).toBe(17);
    expect(calls).toEqual(["npm run check:full", "npm run build"]);
    expect(stderr).toEqual(["FAIL npm run build (exit 17)\n"]);
  });
});
