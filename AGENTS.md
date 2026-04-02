# AGENTS.md

## Purpose

Build `Oraculum`: a `CLI-first`, `TypeScript + Node.js` system for `Claude Code` and `Codex` that explores multiple patch candidates, judges them with repo-local oracles/invariants, and promotes only survivors. Do not generalize adapters beyond those two yet.

## Read Order

- `README.md`: shortest overview
- `internal/proposal.md`: local/internal proposal, if present
- `internal/HARNESS_RESEARCH.md`: local/internal harness reference synthesis, if present

This file is a pointer, not a spec. Keep durable detail in repo docs, not here.

## Harness Engineering

Harness engineering = engineering the environment around agents so work is reliable, inspectable, and repeatable. The harness is the repo-level system of:

- specs and acceptance criteria
- typed schemas and stable commands
- tests, linters, and deterministic checks
- invariants / oracles
- tool boundaries and safety limits
- logs, artifacts, replay, and reports

Treat the harness as an operating system for agent work, not a prompt pack. If an agent fails, first assume a harness gap and add the missing thing to the repo: clearer spec, better oracle/check, fixture/repro, safer boundary, or better logs/replay/report.

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
- Prefer mechanized enforcement over prose; encode durable rules as code, config, test, oracle, or hook.
- Prefer small, legible, in-repo abstractions over cleverness.
- Keep context lean; link outward instead of bloating root instructions.
- Prefer replayable, machine-readable outputs.
- Use an opinionated workflow, not ad-hoc chatting.
- Force clarification before coding when intent is vague.
- Pass artifacts forward: `spec -> plan -> implementation -> review -> test -> release`.
- Use fresh-context review/QA when independent judgment matters.
- Parallel workers require isolated workspaces and explicit coordination.
- When borrowing harness ideas, adapt them to `candidate -> oracle -> witness -> promotion`, not generic team orchestration.
- Preferred execution cadence: `clarify/specify -> plan -> build -> review -> test -> ship/export -> reflect/learn`.

## Doc Visibility

- Root docs should be user-facing.
- Public docs that are not root-required belong under `/docs/`.
- Internal governance/process/meta docs belong under `/internal/`.
- Proposal / strategy / operating-design docs are internal by default.
- If mixed, publish the sanitized user-facing doc and keep the operating appendix private.

## System Shape

Target modules:

- task intake / packet
- candidate workspace manager
- adapters
- oracle runner
- tournament / scoring / promotion
- reports / export / replay
