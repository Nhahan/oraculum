export function countToolCalls(_runtime, output, command) {
  const directCliUses = countDirectCliRouteUses(output, command);
  if (directCliUses > 0) {
    return directCliUses;
  }

  return countOccurrences(output, `oraculum orc ${command}`);
}

export function assertVerifiedCrownMaterialization(runtime, output) {
  const materializations = collectVerifiedCrownMaterializations(output);
  const verified = materializations.some(
    (entry) =>
      entry?.materialization?.verified === true &&
      Array.isArray(entry.materialization.checks) &&
      entry.materialization.checks.length > 0 &&
      Number.isInteger(entry.materialization.changedPathCount) &&
      entry.materialization.changedPathCount > 0,
  );

  const verifiedText =
    output.includes("Crowned ") &&
    output.includes("Changed paths:") &&
    output.includes("Post-checks:") &&
    output.includes("passed");

  if (!verified && !verifiedText) {
    throw new Error(
      `${runtime} crown did not return verified materialization evidence.\n${output}`,
    );
  }
}

function countDirectCliRouteUses(output, command) {
  const commands = new Set();
  const needles = [
    `oraculum orc ${command}`,
    `dist/cli.js orc ${command}`,
    `cli.js orc ${command}`,
  ];

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      collectDirectCliCommands(JSON.parse(trimmed), needles, commands);
    } catch {
      // Host CLIs can mix JSONL with plain diagnostics; non-JSON lines are not route evidence.
    }
  }

  return commands.size;
}

function collectDirectCliCommands(value, needles, commands) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDirectCliCommands(entry, needles, commands);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  const command = typeof value.command === "string" ? value.command : undefined;
  if (command && needles.some((needle) => command.includes(needle))) {
    commands.add(command);
  }

  for (const child of Object.values(value)) {
    collectDirectCliCommands(child, needles, commands);
  }
}

function countOccurrences(value, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next < 0) {
      return count;
    }
    count += 1;
    offset = next + needle.length;
  }
}

function collectVerifiedCrownMaterializations(output) {
  const matches = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      collectCrownMaterializations(JSON.parse(trimmed), matches);
    } catch {
      // Host CLIs can mix JSONL with plain diagnostics; non-JSON lines are not response evidence.
    }
  }

  return matches;
}

function collectCrownMaterializations(value, matches) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"mode":"crown"')) {
      try {
        collectCrownMaterializations(JSON.parse(trimmed), matches);
      } catch {
        // Ignore non-JSON string payloads.
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCrownMaterializations(entry, matches);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (value.mode === "crown" && isObject(value.materialization)) {
    matches.push(value);
  }

  for (const child of Object.values(value)) {
    collectCrownMaterializations(child, matches);
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}
