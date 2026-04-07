# Oraculum

<p align="center">
  <img src="docs/images/logo.png" alt="Oraculum logo" width="320">
</p>

<p align="center">
  <strong>Generate competing patches. Judge them. Promote only the survivors.</strong>
  <br />
  <sub>Patch search and judgment harness for Claude Code and Codex</sub>
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#requirements">Requirements</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#advanced-usage">Advanced Usage</a>
</p>

---

## Overview

Oraculum sits between your codebase and an AI coding runtime.

Instead of trusting the first patch an AI gives you, Oraculum tries multiple candidate fixes, checks them, and helps you keep only the survivors.

## Status

Oraculum is early, but it already runs end to end.

It can already:

- run multiple candidates in isolated workspaces
- call `Claude Code` or `Codex`
- run repo-local command checks
- retry repairable candidates within bounded repair loops
- compare finalists with richer change/risk summaries
- save machine-readable run artifacts under `.oraculum/`
- materialize the recommended promotion back into your project

Packaging and public release flow are still being finalized.

## Requirements

- `Node.js 18+`

## Installation

Planned public install:

```bash
npm install -g oraculum
```

## Quick Start

In the folder containing the code you want Oraculum to work on:

Consult Oraculum on a task:

```bash
oraculum consult "fix session loss on refresh"
```

This runs the full tournament and prints the result summary, including the recommended promotion, why it won, and the comparison report path.

Promote the recommended result:

```bash
oraculum promote --branch fix/session-loss
```

In a Git-backed project, this creates the branch and applies the winner there. In a non-Git project, it syncs the winner back into the project folder.

If you want to look at the latest result again later:

```bash
oraculum verdict
```

What happens in the default flow:

- `consult` starts the full flow in one command
- Oraculum initializes itself on first use
- the latest completed consultation is remembered automatically
- `consult` prints the latest result summary immediately
- `promote` uses the latest exportable consultation and its recommended promotion by default
- `verdict` lets you reopen the latest result later

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate fixes.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a survivor, explains the comparison, and lets you promote it.

Current judging stages:

- `fast`: basic execution and artifact checks
- `impact`: reviewable-output and materialized-patch checks
- `deep`: stage exists, but real deep checks are still to be added

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, not chat transcript.

## Advanced Usage

If you want more control over runtimes, candidate counts, specific consultation IDs, report packaging, repo-local oracle configuration, or manually overriding the recommended promotion, see [Advanced Usage](docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; operator controls belong in `.oraculum/advanced.json`.
