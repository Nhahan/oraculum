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
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </a>
</p>

<p align="center">
  <strong>Generate competing patches. Judge them. Promote only the survivors.</strong>
  <br />
  <sub>Patch search and judgment harness for Claude Code and Codex</sub>
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

Oraculum is a local installable workflow tool that sits between your codebase and an AI coding runtime.

Instead of trusting the first patch an AI gives you, Oraculum tries multiple candidate fixes, checks them, and helps you keep only the survivors.

## Installation

Install the current beta:

```bash
npm install -g oraculum@beta
```

## Quick Start

From the project folder:

```bash
oraculum consult "fix session loss on refresh"
oraculum promote --branch fix/session-loss
```

That is the default flow. `consult` initializes Oraculum on first use, runs the tournament, and prints the result summary immediately. `promote` uses the latest promotable consultation and its recommended promotion by default.

In a Git-backed project, `promote` creates the branch and applies the winner there. In a non-Git project, it syncs the winner back into the project folder.

If you want to reopen the latest consultation later, inspect an older one, or browse consultation history, see [Advanced Usage](docs/advanced-usage.md).

## How It Works

1. You give Oraculum one task.
2. Oraculum creates multiple candidate fixes.
3. Each candidate runs in its own workspace.
4. Checks remove weak candidates in stages.
5. Oraculum recommends a survivor, explains the comparison, and lets you promote it.

Results are saved under `.oraculum/`. The source of truth is the saved run state and artifacts, not chat transcript.

## Advanced Usage

If you want more control over consultation-scoped profile selection, runtimes, candidate counts, specific consultation IDs, report packaging, repo-local oracle configuration, or manually overriding the recommended promotion, see [Advanced Usage](docs/advanced-usage.md). Quick-start defaults live in `.oraculum/config.json`; operator controls belong in `.oraculum/advanced.json`.
