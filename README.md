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

Oraculum is an oracle-guided patch workflow for Claude Code and Codex.

The primary product surface is a shared in-chat command language across both hosts: `orc consult`, `orc verdict`, and `orc crown`.

Under that surface, Oraculum turns patching into a repeatable workflow: run competing candidates in isolation, judge them with repo-local oracles, keep verdicts and witnesses, and crown only the survivor.

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

## Quick Start

After setup in Claude Code or Codex:

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

The shell fallback still exists for setup, debugging, and compatibility:

```bash
oraculum consult "fix session loss on refresh"
oraculum crown --branch fix/session-loss
```

That flow initializes Oraculum on first use, runs the tournament, and prints the verdict summary immediately. `crown` uses the latest consultation with a recommended survivor by default.

In a Git-backed project, `crown` creates the branch and applies the survivor there. In a non-Git project, it syncs the survivor back into the project folder.

If you want to reopen the latest consultation later, inspect an older one, or browse consultation history, see [Advanced Usage](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md).

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate fixes.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a survivor, explains the verdict, and lets you crown it.

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, not chat transcript.

## Advanced Usage

If you want more control over consultation-scoped profile selection, runtimes, candidate counts, specific consultation IDs, report packaging, repo-local oracle configuration, or manually overriding the recommended survivor, see [Advanced Usage](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; operator controls belong in `.oraculum/advanced.json`.
