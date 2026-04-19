export function resolveScenarios(input) {
  const definitions = new Map(
    [
      {
        id: "node-package",
        sourcePath: "src/message.js",
        gitBacked: true,
        packageJson: true,
      },
      {
        id: "package-free",
        sourcePath: "src/message.mjs",
        gitBacked: false,
        packageJson: false,
      },
    ].map((scenario) => [scenario.id, scenario]),
  );
  return input
    .split(",")
    .map((scenario) => scenario.trim())
    .filter((scenario) => scenario.length > 0)
    .map((scenario) => {
      const definition = definitions.get(scenario);
      if (!definition) {
        throw new Error(
          `Unsupported ORACULUM_HOST_NATIVE_SCENARIOS value "${scenario}". Use node-package and/or package-free.`,
        );
      }
      return definition;
    });
}

export function assertRuntimes(values) {
  const allowed = new Set(["claude-code", "codex"]);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Unsupported launch-smoke runtime "${value}". Use claude-code and/or codex.`);
    }
  }
}

export function assertCandidateAgent(value) {
  const allowed = new Set(["claude-code", "codex", "host"]);
  if (!allowed.has(value)) {
    throw new Error(
      'Unsupported ORACULUM_HOST_NATIVE_AGENT value. Use "codex", "claude-code", or "host".',
    );
  }
}

export function resolveCandidateAgent(candidateAgentInput, runtime) {
  return candidateAgentInput === "host" ? runtime : candidateAgentInput;
}

export function parseBoundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}
