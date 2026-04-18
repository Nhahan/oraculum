import { describe, expect, it } from "vitest";

// @ts-expect-error host-native smoke is an untyped ESM script.
import { runCommand } from "../scripts/host-native-smoke/process.mjs";

describe("host-native smoke process runner", () => {
  it("passes explicit env overrides to spawned commands", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env.ORACULUM_SMOKE_ENV ?? '')"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ORACULUM_SMOKE_ENV: "expected-value",
        },
        label: "env passthrough",
        timeoutMs: 10_000,
      },
    );

    expect(result.stdout).toBe("expected-value");
  });
});
