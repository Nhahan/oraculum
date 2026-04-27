<p align="right">
  <strong>English</strong> | <a href="./README.ko.md">한국어</a>
</p>

# Oraculum

<p align="center">
  <img src="https://raw.githubusercontent.com/Nhahan/oraculum/main/docs/images/logo.png" alt="Oraculum logo" width="320">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/oraculum">
    <img src="https://img.shields.io/npm/v/oraculum?color=blue" alt="npm">
  </a>
  <a href="https://github.com/Nhahan/oraculum/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </a>
</p>

<p align="center">
  <strong>Consult competing candidates. Read the verdict. Crown only the recommended result.</strong>
  <br />
  <sub>Oracle-guided chat-native consultation workflow for Claude Code and Codex</sub>
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#advanced-usage">Advanced Usage</a>
</p>

---

## Overview

Oraculum turns AI implementation work into a tournament instead of a one-shot edit.

Candidates run in isolation, repo-local checks act as oracles, evidence is recorded, and only the recommended result is crowned.

Use it when you want Claude Code or Codex to explore multiple patch candidates before you accept a change.

It works in ordinary Git or non-Git project folders. Installing Oraculum with npm does not mean the target repository has to be a Node project.

## Installation

Install from npm:

```bash
npm install -g oraculum
```

Then register Oraculum with the host you use:

Claude Code:

```bash
oraculum setup --runtime claude-code
```

Codex:

```bash
oraculum setup --runtime codex
```

Run those `oraculum setup ...` commands in your terminal.
They register Oraculum globally for your local Claude Code or Codex installation, not just for the current directory.

If you want to verify the wiring later:

```bash
oraculum setup status
```

## Quick Start

Register Oraculum with the host you use:

```bash
oraculum setup --runtime codex
oraculum setup --runtime claude-code
```

Then open Claude Code or Codex and use:

```text
orc consult "fix session loss on refresh"
```

That flow initializes Oraculum on first use, runs the tournament, and prints the verdict summary immediately.
When the verdict has a safe recommended result, the host asks whether to apply it. Approving that prompt materializes the result through the same guarded crown path.

When you want to inspect first and apply the latest recommended result later:

```text
orc consult --defer "fix session loss on refresh"
```

Then crown manually:

```text
orc crown
```

By default, approving the apply prompt or running `orc crown` applies the recommended result directly into the current project workspace. In a Git-backed project, that means the current branch working tree; in a non-Git project, Oraculum syncs the crowned workspace back into the project folder. To materialize onto a new Git branch instead, use `orc crown --branch fix/session-loss`.

`crown` blocks by default when the verdict still has validation gaps, a fallback-policy winner, or second-opinion manual-review pressure. After operator review, `orc crown --allow-unsafe` records that explicit override in the export plan.

The chat-native planning commands keep their input surface task-only. Configure quick-start defaults in `.oraculum/config.json`, put advanced project policy in `.oraculum/advanced.json`, and keep task-specific requirements in the task text. Repo-local oracle commands can still carry their own bounded `timeoutMs` values in `.oraculum/advanced.json`.

If runtime preflight is unavailable or does not return structured readiness, Oraculum fails closed with one bounded clarification instead of starting candidate generation from a guess.

Use `orc plan "<task>"` when you want to shape a broad or high-risk consultation first. Explicit planning has one user-facing clarification loop: Augury Interview. Augury runs before the planning spec when operator clarification is needed and records an `ontologySnapshot` sign bundle: goals, constraints, non-goals, acceptance criteria, and risks that future candidates must satisfy or violate. Plan Conclave still runs after the planning spec as an internal architect/critic quality gate, but it does not ask the operator for reviewer fixes, crown gates, oracle design, or implementation details. If Plan Conclave finds that user intent, scope, success criteria, or non-goals are still missing, it records an Augury clarification question and `orc plan` asks that question through the host UI. When ready, it persists `planning-spec.json`, `plan-consensus.json`, a reusable `consultation-plan.json`, `plan-readiness.json`, and a human-readable `consultation-plan.md`; you can later run `orc consult <plan-artifact>`.

If you want to reopen the latest consultation later, inspect saved verdict artifacts, or use shell-only setup, uninstall, diagnostics, or direct CLI commands, see [Advanced Usage](./docs/advanced-usage.md).

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate implementations.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a result, explains the verdict, and lets you crown it.

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, including verdict review, finalist comparison, research briefs, and failure analysis, not chat transcript.

## Advanced Usage

If you want more control over runtimes, candidate counts, repo-local checks, saved research artifacts, setup diagnostics, or repo-local oracle timeouts, see [Advanced Usage](./docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; advanced project settings belong in `.oraculum/advanced.json`.
