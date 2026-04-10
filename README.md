<p align="right">
  <strong>English</strong> | <a href="https://github.com/Nhahan/oraculum/blob/main/README.ko.md">한국어</a>
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
  <strong>Consult competing patches. Read the verdict. Crown only the survivor.</strong>
  <br />
  <sub>Oracle-guided chat-native patch workflow for Claude Code and Codex</sub>
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

Oraculum turns AI patching into a tournament instead of a one-shot edit.

Candidates run in isolation, repo-local checks act as oracles, evidence is recorded, and only the survivor is crowned.

Claude Code or Codex remains the reasoning runtime; Oraculum supplies the deterministic harness around it: isolation, checks, witnesses, and the crowning gate.

## Installation

Install from npm:

```bash
npm install -g oraculum
```

Then register Oraculum with the host you use:

```bash
oraculum setup --runtime claude-code
oraculum setup --runtime codex
```

If you want to verify the wiring later:

```bash
oraculum setup status
```

## Quick Start

After setup in Claude Code or Codex:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

That flow initializes Oraculum on first use, runs the tournament, and prints the verdict summary immediately. `crown` uses the latest consultation with a recommended survivor by default.

In a Git-backed project, `crown` creates the named branch and applies the survivor there. In a non-Git project, use bare `orc crown`; it syncs the survivor back into the project folder without requiring a fake branch name.

If you want to reopen the latest consultation later, inspect an older one, browse consultation history, or use setup/MCP/debug commands from the shell binary, see [Advanced Usage](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md).

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate fixes.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a survivor, explains the verdict, and lets you crown it.

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, not chat transcript.

## Advanced Usage

If you want more control over consultation-scoped profile selection, runtimes, consultation history, repo-local oracle configuration, setup diagnostics, or MCP wiring details, see [Advanced Usage](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; operator controls belong in `.oraculum/advanced.json`.
