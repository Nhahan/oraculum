# AGENTS.md

## Purpose

Build `Oraculum`: a `CLI-first`, `TypeScript + Node.js` system for `Claude Code` and `Codex` that explores multiple patch candidates, judges them with repo-local oracles/invariants, and promotes only survivors. Do not generalize adapters beyond those two yet.

## Read Order

- `README.md`: shortest overview
- `internal/proposal.md`: local/internal proposal, if present
- `internal/HARNESS_RESEARCH.md`: local/internal harness reference synthesis, if present

This file is a pointer, not a spec. Keep durable detail in repo docs, not here.

## Harness Engineering

Harness engineering = encoding agent work into repo-native operating surfaces so it is directed, stateful, inspectable, and repeatable. The harness lives in:

- specs and acceptance criteria
- stable commands, modes, skills, and hooks
- typed schemas, state stores, session/job ownership, and context injection
- workspaces / worktrees / isolation boundaries
- tests, linters, deterministic checks, and oracles
- artifacts, evals, replay, and reports

Treat the harness as an operating system for agent work, not a prompt pack. Source of truth is repo state and artifacts, not chat transcript. On failure, assume a harness gap first: spec, command/mode/hook, state boundary, context injection, workspace isolation, oracle/check, fixture/repro, or artifacts/eval/replay.

## Oraculum-Specific Harness

Do not treat Oraculum as a generic multi-agent shell. Its core harness unit is:

- candidate, not chat session
- oracle, not roleplay
- witness, not vague failure
- promotion gate, not open-ended autonomy
- comparison report, not raw transcript

Default loop:

- specify task
- generate competing candidates
- execute in isolated workspaces
- judge with oracles
- repair or eliminate
- compare finalists
- export winner

Optimize for falsification and selection of patches, not maximum agent freedom.

## Working Bias

- Humans set intent and judge tradeoffs; agents execute loops.
- Prefer mechanized enforcement over prose; if a behavior must survive runs, encode it as command, mode, skill, hook, state transition, config, test, oracle, or evaluator.
- Prefer small, legible, in-repo abstractions over cleverness.
- Keep context lean; link outward instead of bloating root instructions.
- Prefer replayable, machine-readable outputs.
- Use an opinionated workflow, not ad-hoc chatting; force clarification before coding when intent is vague.
- Build harness surfaces before polish: one product workflow across hosts, thin adapters at the edge, stable orchestration operations, state flow, isolation, evaluators, artifacts.
- Pass artifacts forward: `spec -> plan -> implementation -> review -> test -> release`.
- Use fresh-context review/QA when independent judgment matters.
- Parallel workers require isolated workspaces and explicit coordination.
- Borrow the references' command/hook/state-machine discipline, but adapt it to `candidate -> oracle -> witness -> promotion`, not generic team orchestration.
- Preferred execution cadence: `clarify/specify -> plan -> build -> review -> test -> ship/export -> reflect/learn`.

## Doc Visibility

- Root docs should be user-facing; public docs that are not root-required belong under `/docs/`.
- Internal governance/process/meta docs belong under `/internal/`; proposal / strategy / operating-design docs are internal by default.
- If mixed, publish the sanitized user-facing doc and keep the operating appendix private.

## System Shape

Target modules:

- task intake / packet
- candidate workspace manager
- adapters
- oracle runner
- tournament / scoring / promotion
- reports / export / replay
