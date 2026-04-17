export function countToolCalls(runtime, output, command) {
  if (runtime === "claude-code") {
    return countHostToolUses(output, `mcp__plugin_oraculum_oraculum__oraculum_${command}`);
  }

  const parsed = countHostToolUses(output, `oraculum_${command}`);
  if (parsed > 0) {
    return parsed;
  }

  return countOccurrences(output, `mcp: oraculum/oraculum_${command} started`);
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

  if (!verified) {
    throw new Error(
      `${runtime} crown did not return verified materialization evidence.\n${output}`,
    );
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

function countHostToolUses(output, toolName) {
  const toolUseIds = new Set();
  let anonymousToolUses = 0;

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      for (const toolUse of collectHostToolUses(JSON.parse(trimmed), toolName)) {
        if (toolUse.id) {
          toolUseIds.add(toolUse.id);
        } else {
          anonymousToolUses += 1;
        }
      }
    } catch {
      // Host CLIs can mix JSONL with plain diagnostics; non-JSON lines are not tool-use evidence.
    }
  }

  return toolUseIds.size + anonymousToolUses;
}

function collectHostToolUses(value, toolName, inheritedId = undefined) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectHostToolUses(entry, toolName, inheritedId));
  }

  if (!isObject(value)) {
    return [];
  }

  const localId = extractToolUseId(value) ?? inheritedId;
  const name = typeof value.name === "string" ? value.name : undefined;
  const tool = typeof value.tool === "string" ? value.tool : undefined;
  const type = typeof value.type === "string" ? value.type : "";
  const isClaudeToolUse = type === "tool_use" && name === toolName;
  const isCodexMcpToolUse = tool === toolName && isLikelyCodexToolUseType(type);
  const matches = isClaudeToolUse || isCodexMcpToolUse ? [{ id: localId }] : [];

  for (const child of Object.values(value)) {
    matches.push(...collectHostToolUses(child, toolName, localId));
  }

  return matches;
}

function extractToolUseId(value) {
  for (const key of ["id", "call_id", "callId", "tool_call_id", "toolCallId"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function isLikelyCodexToolUseType(type) {
  return type.length === 0 || /call|item|mcp|tool/iu.test(type);
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}
