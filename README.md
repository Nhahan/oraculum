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
  <a href="#quick-start">Quick Start</a> ·
  <a href="#simple-path">Simple Path</a> ·
  <a href="#advanced-path">Advanced Path</a> ·
  <a href="#why-oraculum">Why</a> ·
  <a href="#the-loop">The Loop</a> ·
  <a href="#artifacts">Artifacts</a> ·
  <a href="#commands">Commands</a>
</p>

---

Oraculum sits between your repository and an AI coding runtime.

Instead of trusting one patch from one run, it creates multiple candidates, executes them in isolated workspaces, judges them with deterministic oracles, and keeps only the promoted finalists.

---

## Status

Oraculum is early, but it is already executable.

Current implementation includes:

- `Claude Code` and `Codex` adapters
- isolated candidate workspaces
- config-driven repo-local oracle commands
- machine-readable run artifacts under `.oraculum/`
- round-aware judging: `fast -> impact -> deep`
- finalist selection and export plan generation

Not implemented yet:

- rich comparison reports
- direct branch / PR export

## Quick Start

```bash
npm install
npm run check
```

## Simple Path

```bash
npm run dev -- run "fix session loss on refresh"
npm run dev -- show
npm run dev -- export cand-01 --branch fix/session-loss
```

`run` auto-initializes the project on first use, materializes inline task text if needed, executes the full tournament, and records the latest run so `show` and `export` can default to it.

## Advanced Path

```bash
npm run dev -- init
npm run dev -- run tasks/fix-session-loss.md --agent codex --candidates 4
npm run dev -- show run_20260404_xxxx
npm run dev -- export cand-01 --run run_20260404_xxxx --branch fix/session-loss --with-report
```

`run --plan-only` still exists for internal or development use, but it is not the default path.

## Why Oraculum

Most AI coding flows fail in predictable ways:

- they converge too early on the first plausible diff
- repo invariants stay trapped in prompts or tribal memory
- expensive verification happens after the wrong direction is already overbuilt

Oraculum turns one task into a small patch tournament.

## The Loop

```text
specify -> generate -> execute -> judge -> eliminate/promote -> export
```

Current judging rounds:

- `fast`: execution viability and artifact capture
- `impact`: reviewable output checks
- `deep`: framework exists; real deep oracles are still to be added

## Artifacts

```text
.oraculum/
  config.json
  runs/<run-id>/
    run.json
    candidates/<candidate-id>/
      candidate.json
      task-packet.json
      agent-run.json
      verdicts/
      witnesses/
      logs/
  workspaces/<run-id>/<candidate-id>/
```

The source of truth is run state and artifacts, not transcript.

## Commands

```bash
oraculum init
oraculum run "fix session loss on refresh"
oraculum run tasks/fix-session-loss.md --agent codex --candidates 4
oraculum show
oraculum show <run-id>
oraculum export cand-01 --branch fix/session-loss
oraculum export cand-01 --run <run-id> --branch fix/session-loss --with-report
```
