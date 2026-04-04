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
- machine-readable run artifacts under `.oraculum/`
- round-aware judging: `fast -> impact -> deep`
- finalist selection and export plan generation

Not implemented yet:

- repo-defined oracle plugins
- rich comparison reports
- direct branch / PR export

## Quick Start

```bash
npm install
npm run check
npm run dev -- init
```

Create a task:

```bash
cat > tasks/fix-session-loss.md <<'EOF'
# Fix session loss
Preserve login state during refresh.
Do not redesign auth.
EOF
```

Run Oraculum:

```bash
npm run dev -- run --task tasks/fix-session-loss.md --candidates 4 --agent codex
```

Inspect promoted finalists:

```bash
npm run dev -- finalists <run-id>
```

Prepare export metadata for a promoted candidate:

```bash
npm run dev -- export --run <run-id> --winner cand-01 --as-branch fix/session-loss --with-report
```

`run` is the default end-to-end command. `run --plan-only` exists only for internal or development use.

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
oraculum run --task tasks/fix-session-loss.md --candidates 4 --agent codex
oraculum finalists <run-id>
oraculum export --run <run-id> --winner cand-01 --as-branch fix/session-loss --with-report
```
