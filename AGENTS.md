# AGENTS.md

## Purpose

Build `Oraculum`: a `chat-native`, `TypeScript + Node-distributed` system for `Claude Code` and `Codex` that explores multiple patch candidates, judges them with repo-local oracles/invariants, and crowns only survivors. Do not generalize adapters beyond those two yet.

Target primary product surface:

- shared in-chat command language across hosts
- preferred short prefix: `orc`
- examples: `orc consult`, `orc verdict`, `orc crown`

After global host setup, host-native `orc` is available for both Claude Code and Codex. Keep the `oraculum` shell binary for setup, uninstall, MCP serving, debugging, packaging, and local validation; workflow commands such as `consult`, `verdict`, `crown`, `draft`, and `init` belong to the host-native `orc` surface, not to shell command routing.

## Read Order

- `README.md`: shortest overview
- `/docs/`: public detail docs, if present
- `internal/proposal.md`: local/internal proposal, if present
- `internal/HARNESS_RESEARCH.md`: local/internal harness reference synthesis, if present
- `internal/RELEASING.md`: local/internal npm release runbook, if package publishing or dist-tags are involved

This file is a pointer, not a spec. Keep durable detail in repo docs. If docs and the working tree diverge, trust code, tests, and artifacts first.

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

Optimize for falsification and patch selection, not maximum agent freedom.
`orc consult` is the default end-to-end tournament command: one user command should cover candidate generation, execution, judging, elimination/crowning, artifactization, and immediate latest-result output. Planning-only flows belong under advanced subcommands, and `verdict` is for reopening a consultation later, not for completing the default path.
Protect quick-start as a product contract: first success should stay one-command and near-zero-config. Keep operator complexity in optional flags, profiles, or advanced config; explicit quick-start or advanced settings must beat inferred defaults.
Treat Oraculum first as a local installable, host-native workflow tool, not a CI-first gate. Use `/.oraculum/config.json` for quick-start defaults, `/.oraculum/advanced.json` for operator controls, and keep auto-init / `init --force` from leaking stale `advanced.json` settings into the default UX.
For target-repository generalization, follow [`docs/frontier-boundary-policy.md`](docs/frontier-boundary-policy.md): assume a frontier, human-level coding model. Deterministic code owns raw fact collection, contracts, and safety enforcement; the model owns semantic profile/check selection. Tool-specific labels may be evidence, but do not add named framework, ORM, migration-tool, test-runner, or language-ecosystem command recipes by default. Prefer repo-local scripts, explicit `.oraculum/advanced.json` oracles, or missing-capability evidence.
If a new deterministic boundary is still necessary, justify it at the code/test/doc boundary directly: keep the rule narrow, explain why the model cannot safely own it, add a regression test, and document product-policy tables in stable repo docs or code comments instead of growing temporary audit ledgers by default.
The npm/Node distribution model is an implementation and packaging fact for Oraculum itself; it must not imply that target repositories are Node projects.

## Working Bias

- Humans set intent and judge tradeoffs; agents execute loops.
- Before editing, read the full affected files plus the immediate contracts, call sites, and tests; do not patch from partial context.
- Treat implementation as continuous review: after each non-trivial edit, re-read the touched scope plus its immediate contracts, read/write paths, and tests, and fix local drift before moving on.
- Any new field, state, path, flag, or schema must be wired through read/write paths, CLI/API boundaries, persistence, and tests, with boundary validation and explicit terminal states for host/process/workspace failures.
- For execution, state, isolation, subprocess, or artifact changes, add or update failure-path tests, not just happy-path tests.
- Cross-platform support is mandatory: avoid POSIX-only shell, signal, or path assumptions in user-facing flows; prefer Node APIs or explicit `command + args` execution and keep CI coverage across supported operating systems.
- Prefer mechanized enforcement over prose; if a behavior must survive runs, encode it as command, mode, skill, hook, state transition, config, test, oracle, or evaluator.
- Prefer small, legible, in-repo abstractions over cleverness.
- Keep context lean, link outward, and prefer replayable, machine-readable outputs.
- Use an opinionated workflow, not ad-hoc chatting; force clarification before coding when intent is vague.
- Build harness surfaces before polish: one product workflow across hosts, thin adapters at the edge, stable orchestration/state flow, isolation, evaluators, and artifacts.
- Prefer shared command manifests plus host-specific generated skills/rules/plugins over hand-maintained per-host drift.
- Keep target state and current shipped state explicit in docs and setup flows; do not let future command names masquerade as already-available host features.
- Pass artifacts forward: `spec -> plan -> implementation -> review -> test -> release`.
- Before committing or pushing, run `npm run check` and `git diff --check`, plus targeted validation for any touched flow.
- Review is iterative, not one-shot: after substantial implementation or after fixing findings, re-read the affected files in full and rerun validation before claiming the tree is clean. A full code review means reviewing the current working tree line-by-line, not relying on earlier conclusions once code has changed.
- A review/audit/polish request is standing authorization for `review -> fix -> re-review -> validate` on the current scope. Do not wait for repeated user prompts unless blocked by a real ambiguity, product decision, or conflicting repo change.
- End the loop only when no material findings remain, the user redirects, or further progress is genuinely blocked.
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
