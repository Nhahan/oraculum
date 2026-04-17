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

Claude Code or Codex remains the reasoning runtime; Oraculum supplies the deterministic harness around it: isolation, checks, witnesses, and the crowning gate.

npm is only the distribution channel for Oraculum. Target repositories do not have to be Node projects.

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

Run those `oraculum setup ...` commands in your terminal, not inside the Claude Code or Codex chat input.
They register Oraculum globally for your local Claude Code or Codex installation, not just for the current directory.

If you want to verify the wiring later:

```bash
oraculum setup status
```

## Quick Start

After running setup in your terminal, switch to the Claude Code or Codex chat input and use:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

That flow initializes Oraculum on first use, runs the tournament, and prints the verdict summary immediately. `crown` uses the latest consultation with a recommended result by default.

In a Git-backed project, `crown` creates the named branch and materializes the recommended result there. In a non-Git project, use bare `orc crown`; it syncs the recommended result back into the project folder without requiring a fake branch name.

By default, `consult` and `plan` do not impose an Oraculum-level adapter timeout. Use `--timeout-ms <ms>` only when you want to bound a specific consultation explicitly. Repo-local oracle commands remain independent and can still carry their own bounded `timeoutMs` values in `.oraculum/advanced.json`.

Use `orc plan "<task>"` when you want to shape a broad or high-risk consultation first. It persists a reusable `consultation-plan.json` plus a human-readable `consultation-plan.md`, and you can later run `orc consult <plan-artifact>`. `orc draft` remains as a compatibility alias for the same planning lane.

If you want to reopen the latest consultation later, inspect an older one, browse consultation history, or use shell-only setup, uninstall, diagnostics, or MCP commands, see [Advanced Usage](./docs/advanced-usage.md).

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate implementations.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a result, explains the verdict, and lets you crown it.

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, including verdict review, finalist comparison, research briefs, and failure analysis, not chat transcript.

## Advanced Usage

If you want more control over consultation-scoped validation posture selection, runtimes, consultation history, repo-local oracle configuration, research artifacts, setup diagnostics, MCP wiring details, host uninstall instructions, or explicit consultation timeouts, see [Advanced Usage](./docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; operator controls belong in `.oraculum/advanced.json`.
