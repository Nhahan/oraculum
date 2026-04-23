# AGENTS.md

## Purpose

Build `Oraculum`: a `chat-native`, `TypeScript + Node-distributed` system for `Claude Code` and `Codex` that explores multiple patch candidates, judges them with repo-local oracles/invariants, and crowns only survivors. Do not generalize adapters beyond those two yet.

Primary surface: shared host-native `orc` commands across hosts, with `orc consult`, `orc verdict`, and `orc crown` as the preferred shape. After setup, workflow commands belong to host-native `orc`; keep the `oraculum` shell binary for setup, uninstall, diagnostics, direct-route packaging, packaging, and local validation only.

## Read Order

`README.md` -> `/docs/` -> `internal/proposal.md` -> `internal/HARNESS_RESEARCH.md` -> `internal/VALIDATION.md` when touching maintainer test policy -> `internal/RELEASING.md` when release work is relevant. This file is a pointer, not a spec. Keep durable detail in repo docs. If docs and the working tree diverge, trust code, tests, and artifacts.

## Harness Engineering

Harness engineering = encoding agent work into repo-native operating surfaces so it is directed, stateful, inspectable, and repeatable. The harness lives in specs, commands/modes/skills/hooks, typed state/context, workspaces/isolation, tests/oracles, and artifacts/evals/replay. Treat the harness as an operating system, not a prompt pack. Source of truth is repo state and artifacts. On failure, assume a harness gap first: spec, command/mode/hook, state boundary/context injection, workspace isolation, oracle/check, fixture/repro, or artifacts/eval/replay.

## Oraculum-Specific Harness

Do not treat Oraculum as a generic multi-agent shell. Its core harness unit is candidate, not chat session; oracle, not roleplay; witness, not vague failure; crowning gate, not open-ended autonomy; comparison report, not raw transcript.

Default loop: `specify -> generate -> execute -> judge -> repair/eliminate -> compare -> crown`.

Operational bias:

- optimize for falsification and patch selection, not autonomy
- `orc consult` is the default one-command flow with immediate latest-result output; `verdict` reopens a consultation later; planning-only flows are advanced
- chat-native planning commands (`orc consult`, `orc plan`) expose task input only; move runtime, candidate-count, timeout, and deliberate/deeper-planning controls into task contracts or `.oraculum/config.json` / `.oraculum/advanced.json`
- quick-start stays one-command and near-zero-config; explicit settings beat inferred defaults; `/.oraculum/config.json` is for quick-start defaults, `/.oraculum/advanced.json` is for operator controls, and auto-init must not leak stale `advanced.json` settings into the default UX
- Oraculum is local-first, not CI-first
- follow [`internal/frontier-boundary-policy.md`](internal/frontier-boundary-policy.md): assume a frontier human-level coding model; deterministic code owns raw fact collection, contracts, and safety enforcement; the model owns semantic profile/check selection; prefer repo-local scripts/oracles, keep deterministic boundaries narrow and regression-tested, and do not treat Oraculum being Node-distributed as evidence that target repositories are Node projects
- Tool-specific labels may be evidence, but do not add named framework, ORM, migration-tool, test-runner, or language-ecosystem command recipes by default.
- If a deterministic boundary is necessary, justify it at the code/test/doc boundary, keep it narrow, explain why the model cannot safely own it, add a regression test, and document stable policy in repo docs or code comments.

## Working Bias

- Humans set intent and judge tradeoffs; agents execute loops.
- Before editing, read the full affected files plus immediate contracts, call sites, and tests; after non-trivial edits, re-read touched scope and fix local drift before moving on.
- Keep `src/services/*.ts` root files as facades or cross-cutting services; feature implementation belongs under a domain directory such as `src/services/<domain>/...`.
- Wire every new field/state/path/flag/schema through read/write paths, CLI/API boundaries, persistence, and tests, and add failure-path tests for execution, state, isolation, subprocess, and artifact changes.
- Cross-platform support is mandatory: avoid POSIX-only assumptions; prefer Node APIs or explicit `command + args`; canonicalize in-repo persisted/compared paths to portable forward-slash relative paths unless a boundary explicitly requires native absolute paths; keep diagnostics portable; in tests, normalize cwd-derived paths and parse structured logs semantically instead of assuming raw JSON-only stderr/stdout.
- Prefer mechanized enforcement over prose, small legible abstractions over cleverness, lean context over repetition, and replayable machine-readable outputs over ad-hoc chat state.
- Use an opinionated workflow; force clarification before coding when intent is vague; build harness surfaces before polish; prefer one product workflow, thin adapters, shared manifests plus host-specific generated skills/rules/plugins, and explicit target-vs-shipped docs over per-host drift or implied future state; do not let future command names masquerade as already-available host features.
- Pass artifacts forward: `spec -> plan -> implementation -> review -> test -> release`. Before committing or pushing, run `npm run check`, `git diff --check`, and targeted validation for any touched flow. Only add `npm run test:slow` or `npm run check:full` when changes hit real runtime boundaries such as adapters, execution, workspaces, exports, consultation-plan execution, evidence harnesses, test infrastructure, or slow suites themselves. Pure domain/schema/rendering/doc work stays on the fast lane unless a touched flow specifically depends on a slow boundary.
- Runtime validation hygiene is mandatory: if you start tmux/PTY/background host sessions or long-lived wrapper processes, record them, tear them down before ending the turn, and verify no stray `oraculum`/`codex`/`claude` validation processes remain. Do not leave smoke sessions, `host-wrapper` loops, or detached tmux sessions running after validation.
- Distinguish surfaces strictly: interactive host chat input (`orc ...` in Claude Code/Codex) is the product UX surface; direct action calls, shell binaries, generated skills/rules/plugins, and tests are internal verification surfaces. Validate `orc` UX only in real interactive host sessions, preferably via tmux/PTY capture (`codex --no-alt-screen` when relevant), and judge only what the user would actually see.
- Review is iterative: a review/audit/polish request implies `review -> fix -> re-review -> validate` unless blocked by a real ambiguity or conflict; do not wait for repeated user prompts. A full code review means reading the current working tree line-by-line; once code changes, do not rely on earlier review conclusions. End only when no material findings remain, the user redirects, or progress is genuinely blocked.
- Use fresh-context review/QA when independent judgment matters. Parallel workers require isolated workspaces and explicit coordination.
- Borrow the references' command/hook/state-machine discipline, but adapt it to `candidate -> oracle -> witness -> crowning`, not generic team orchestration. Preferred cadence: `clarify/specify -> plan -> build -> review -> test -> ship/crown -> reflect/learn`.

## Doc Visibility

Root docs should be user-facing; public docs that are not root-required belong under `/docs/`. Internal governance/process/meta docs belong under `/internal/`; proposal / strategy / operating-design docs are internal by default. If mixed, publish the sanitized user-facing doc and keep the operating appendix private.

System shape lives in code and repo docs; AGENTS.md is for operating rules, not architecture inventory.
