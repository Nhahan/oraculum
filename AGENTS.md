# AGENTS.md

## Purpose

Build `Oraculum`: a `chat-native`, `TypeScript + Node-distributed` system for `Claude Code` and `Codex` that explores multiple patch candidates, judges them with repo-local oracles/invariants, and crowns only survivors. Do not generalize adapters beyond those two yet.

Target primary product surface:

- shared in-chat command language across hosts
- preferred short prefix: `orc`
- examples: `orc consult`, `orc verdict`, `orc crown`

Host-native `orc` integration is now available for both Claude Code and Codex after setup. The `oraculum` shell binary still ships for setup, MCP serving, debugging, packaging, and local validation.
The shell binary is now setup/MCP/debug-only. Workflow commands such as `consult`, `verdict`, `crown`, `draft`, and `init` belong to the host-native `orc` surface, not to shell command routing.

## Read Order

- `README.md`: shortest overview
- `/docs/`: public detail docs, if present
- `internal/proposal.md`: local/internal proposal, if present
- `internal/HARNESS_RESEARCH.md`: local/internal harness reference synthesis, if present
- `internal/RELEASING.md`: local/internal npm release runbook, if package publishing or dist-tags are involved

This file is a pointer, not a spec. Keep durable detail in repo docs, not here. If docs and the current working tree diverge, trust the current code, tests, and artifacts first.

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
- crowning gate, not open-ended autonomy
- comparison report, not raw transcript

Default loop:

- specify task
- generate competing candidates
- execute in isolated workspaces
- judge with oracles
- repair or eliminate
- compare finalists
- crown the recommended survivor

Optimize for falsification and selection of patches, not maximum agent freedom.
`orc consult` is the default end-to-end tournament command: one user command should cover candidate generation, execution, judging, elimination/crowning, and artifactization. Planning-only flows belong under structured advanced subcommands and must not become the default UX.
Protect the quick-start path as a product contract: first success should stay one-command and near-zero-config. Keep advanced controls available, but move operator complexity into optional flags, profiles, or advanced config rather than the default path.
The default end-to-end command is host-native `orc consult`, and it must print the latest result summary immediately. `verdict` is for reopening an earlier or latest consultation later, not for completing the default path.
Treat Oraculum first as a local installable, host-native workflow tool, not a CI-first gate. CI/PR paths may exist, but they are secondary to the default local `consult -> crown` workflow.
The default consultation command may infer a consultation-scoped profile from repo signals and structured runtime selection, but explicit quick-start or advanced operator settings must win over inferred defaults.
Use `/.oraculum/config.json` for quick-start defaults only. Put operator controls such as custom rounds, strategies, or repo-local oracles in `/.oraculum/advanced.json`.
Auto-init and `init --force`, reached through host-native `orc` commands, must keep the quick-start path clean: stale or orphaned `advanced.json` must not leak operator settings into the default UX.
For target-repository generalization, follow `TODO.md`'s Frontier Model Boundary Policy: assume a frontier, human-level coding model. Deterministic code owns raw fact collection, contracts, and safety enforcement; the model owns semantic profile/check selection. Tool-specific labels may be evidence, but do not add named framework, ORM, migration-tool, test-runner, or language-ecosystem command recipes by default. Prefer repo-local scripts, explicit `.oraculum/advanced.json` oracles, or missing-capability evidence.
The npm/Node distribution model is an implementation and packaging fact for Oraculum itself; it must not imply that target repositories are Node projects.

## Working Bias

- Humans set intent and judge tradeoffs; agents execute loops.
- Prevent errors early: before editing, read the full affected files plus the immediate contracts, call sites, and tests; do not patch from partial context.
- Any new field, state, path, flag, or schema must be traced through read path, write path, CLI/API boundary, persistence, and tests; wire it fully or do not add it.
- Validate at boundaries first: parse and reject bad CLI input early, normalize external inputs, and turn host/process/workspace failures into explicit terminal states.
- For execution, state, isolation, subprocess, or artifact changes, add or update failure-path tests, not just happy-path tests.
- Cross-platform support is mandatory: avoid POSIX-only shell, signal, or path assumptions in user-facing flows; prefer Node APIs or explicit `command + args` execution and keep CI coverage across supported operating systems.
- Prefer mechanized enforcement over prose; if a behavior must survive runs, encode it as command, mode, skill, hook, state transition, config, test, oracle, or evaluator.
- Prefer small, legible, in-repo abstractions over cleverness.
- Keep context lean; link outward instead of bloating root instructions.
- Prefer replayable, machine-readable outputs.
- Use an opinionated workflow, not ad-hoc chatting; force clarification before coding when intent is vague.
- Build harness surfaces before polish: one product workflow across hosts, thin adapters at the edge, stable orchestration operations, state flow, isolation, evaluators, artifacts.
- Prefer shared command manifests plus host-specific generated skills/rules/plugins over hand-maintained per-host drift.
- Keep target state and current shipped state explicit in docs and setup flows; do not let future command names masquerade as already-available host features.
- Pass artifacts forward: `spec -> plan -> implementation -> review -> test -> release`.
- Review is iterative, not one-shot: after substantial implementation or after fixing review findings, re-read the affected files in full and rerun validation before claiming the tree is clean.
- A full code review means reviewing the current working tree line-by-line; do not rely on earlier review conclusions once code has changed.
- Use fresh-context review/QA when independent judgment matters.
- Parallel workers require isolated workspaces and explicit coordination.
- Borrow the references' command/hook/state-machine discipline, but adapt it to `candidate -> oracle -> witness -> crowning`, not generic team orchestration.
- Preferred execution cadence: `clarify/specify -> plan -> build -> review -> test -> ship/crown -> reflect/learn`.

## Doc Visibility

- Root docs should be user-facing; public docs that are not root-required belong under `/docs/`.
- Internal governance/process/meta docs belong under `/internal/`; proposal / strategy / operating-design docs are internal by default.
- If mixed, publish the sanitized user-facing doc and keep the operating appendix private.

## System Shape

Target modules:

- task intake / packet
- MCP tool surface
- shared command manifest
- host artifact generator
- candidate workspace manager
- adapters
- oracle runner
- tournament / finalist judge / crowning
- reports / crowning / replay
