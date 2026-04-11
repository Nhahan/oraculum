# TODO: Generalize Oraculum Beyond Node-Centric Repositories

This file is intentionally split into three layers:

- `Release Blockers`: hard gates for the next beta
- `Roadmap`: concrete follow-up engineering work after the beta gate is closed
- `Policy`: durable design and review rules; these are not release-gate checkboxes

Only `Release Blockers` should decide whether the next beta can ship.

## Release Blockers

The next beta must not be published until every checkbox in this section is checked.

### Publish-Path Verification

- [x] Run `npm run evidence:release-smoke`.
- [x] Run `npm run evidence:host-native`.
- [x] Run installed-package smoke in a fresh temporary project.

### Raw Facts / Commands Split

- [x] Extract package and repository manifest reading from `src/services/consultation-profile.ts` into a raw fact collector that records manifests, lockfiles, scripts, exports, and config paths without turning tool names into commands.
- [x] Add a generic explicit-command collector for repo-local command surfaces.
- [x] Support package-manager scripts only when a package manager is explicitly known.
- [x] Support Make, Just, and Taskfile targets only when they are explicitly present and safely enumerable.
- [x] Support repo-local `scripts/` or `bin/` entry points only when they are explicitly configured or unambiguous.
- [x] Keep each collector small and independently tested; do not turn `consultation-profile.ts` or `profile-command-catalog.ts` into a larger hardcoded switchboard.
- [x] Resolve the remaining Node-centric hotspot in `src/services/consultation-profile.ts` after the split lands.

### Explicit Oracles And Command Precedence

- [x] Keep explicit `.oraculum/advanced.json` oracles as the highest-priority execution source.
- [x] Add tests proving two different explicit command collectors can contribute commands without duplicate command execution.

### Execution Environment Generalization

- [x] Prefer candidate-workspace local tool paths when the workspace owns or links dependencies; only fall back to project-root tool paths when that is intentional and recorded.
- [x] Add local tool path support for `.venv/bin` and `.venv/Scripts`.
- [x] Add local tool path support for `venv/bin` and `venv/Scripts`.
- [x] Add local tool path support for repo-local `bin/`.
- [x] Add local tool path support for Gradle and Maven wrappers.
- [x] Keep Windows behavior explicit for shell wrappers and executable suffixes.
- [x] Ensure repo-local oracle env remains deterministic and does not accidentally expose extra host-specific state.

### Evidence And Artifact Integrity

- [x] Preserve backward compatibility for existing run artifacts where possible; if schema changes are required, add a versioned migration or tolerant reader.
- [x] Align the bounded repository signal walker with the managed-tree exclusion policy once raw signal output drives workspace copy and linking.
- [x] Add workspace and monorepo fact collection for explicit workspace metadata. It may record workspace roots and labels, but must not imply root-level commands.
- [x] Reduce Node bias in `scripts/beta-evidence.mjs`; `docs`, `service`, and `monorepo` scenarios should not rely on `package.json` scripts when they are being used as generality evidence.

## Roadmap

These items matter, but they are not the beta gate by themselves unless they are promoted into `Release Blockers`.

### Open Follow-Up Engineering Work

- [ ] Inventory every hardcoded tool, framework, file, and script list in `src/services/consultation-profile.ts`, `src/services/profile-signals.ts`, `src/services/managed-tree.ts`, `src/services/oracles.ts`, and tests.
- [ ] Classify each hardcoded item as one of: raw fact collector, explicit-command bridge, safety boundary, compatibility field, or removable semantic shortcut.
- [ ] Add a short `why this is safe` note or metadata field for every remaining generated command.

### Completed Milestones

- [x] Introduced a conservative `generic` profile path so zero-signal repositories do not masquerade as `library` repositories.
- [x] Split profile intent from raw capability evidence and signal provenance.
- [x] Removed direct Prisma-generated commands; named tools now remain evidence unless a repo-local script or explicit oracle owns execution.
- [x] Stopped treating `packageManager=unknown` as npm by default.
- [x] Added project-root resolution for nested invocation and non-Git `orc crown` workspace-sync behavior.
- [x] Generalized task input handling for Unicode, spaces, and source-file-looking task references.
- [x] Generalized workspace copy and isolation rules for common non-Node dependency and cache trees.
- [x] Added non-Node and package-json-free evidence fixtures for Python, Go, Rust, Java, docs/static, migration, nested workspace, polyglot, subdirectory invocation, and timed-out oracles.
- [x] Extended workflow comparison and host-native smoke evidence with non-Node and package-json-free coverage.
- [x] Documented that npm is only Oraculum's distribution channel and that target repositories do not need to be Node projects.

### Completed Validation Outcomes

- [x] A non-Node repository with no `package.json` can complete `orc consult -> orc crown` without npm assumptions.
- [x] A nested workspace or monorepo can complete `orc consult -> orc crown` using workspace-level checks rather than only root-level scripts.
- [x] Zero-signal repositories get a generic or default profile result instead of a misleading Node or library result.
- [x] Non-English paths, spaces in paths, and source-file-looking task references are handled intentionally rather than accidentally treated as inline prose.
- [x] Nested cwd invocation, non-Git crowning, relative oracle cwd, and large-output or timed-out subprocess behavior are covered by regression tests.
- [x] Node, Python, Go, Rust, Java, docs/static, and migration-style fixtures have explicit evidence coverage through raw facts, repo-local commands, or missing-capability outcomes.
- [x] Named-tool inferred commands are not generated from frameworks, ORMs, migration tools, test runners, or language ecosystems.
- [x] Generated Node package checks do not silently use `npm` when another package manager or no package-manager policy applies.
- [x] Missing capabilities are visible in verdict and profile artifacts instead of being hidden behind weak or invented commands.
- [x] Existing Node happy paths, frontend e2e detection, package smoke checks, and Prisma raw-signal and no-direct-command behavior remain covered by regression tests.

### Archived Validation Checkpoints Already Run

- [x] After profile schema changes: run `npm exec vitest run test/consultation-profile.test.ts`.
- [x] After task input and path parsing changes: run `npm exec vitest run test/contracts.test.ts test/project.test.ts`.
- [x] After oracle environment changes: run `npm exec vitest run test/execution.test.ts test/workspaces.test.ts`.
- [x] After workspace copy and link changes: run `npm exec vitest run test/managed-tree.test.ts test/workspaces.test.ts test/exports.test.ts`.
- [x] After project-root resolution or relative oracle cwd changes: run `npm exec vitest run test/project.test.ts test/execution.test.ts test/exports.test.ts`.
- [x] After subprocess timeout and output changes: run `npm exec vitest run test/subprocess.test.ts test/execution.test.ts`.
- [x] After evidence corpus changes: run `npm run evidence:beta:corpus`.
- [x] After polyglot evidence changes: run `npm run evidence:polyglot`.
- [x] After workflow comparison changes: run `npm run evidence:workflow-comparison`.
- [x] Before commits touching this area: run `npm run check`.

## Policy

These are ongoing constraints and review rules. They should stay true continuously, but they are not tracked as release-gate checkboxes.

### Scope Guardrails

- Keep Oraculum itself as a TypeScript and Node-distributed tool unless there is a separate packaging decision.
- Keep host-runtime support scoped to `Claude Code` and `Codex`; do not add new agent adapters just to solve repository-language generality.
- Treat this work as target-repository generalization: profile detection, oracle generation, workspace handling, and evidence coverage.
- Prefer repo-local explicit commands; reject tool-specific inferred commands.
- Do not add direct inferred commands from named frameworks, ORMs, migration tools, test runners, or language ecosystems by default.
- When no repo-local explicit command exists, record facts and missing capabilities instead of inventing a command from a tool name.
- Avoid making the default UX heavier. Any advanced toolchain controls should live behind `.oraculum/advanced.json` or future optional profile packs.

### Frontier Model Boundary Policy

Assumption: Oraculum is designed around frontier, human-level coding models such as Claude Code and Codex, not weak rule-following bots. Under that assumption, the product must not grow a brittle in-core expert system that tries to outguess the model with framework, ORM, language, or migration-tool encyclopedias. Use deterministic code for facts, contracts, and safety; use the model for semantic judgment, tradeoff analysis, and check selection.

#### Code-Owned Responsibilities

- Collect observable raw facts deterministically: files, lockfiles, manifest fields, scripts, workspace roots, local tool paths, and explicit Oraculum config.
- Preserve provenance for every signal: root config, workspace config, task text, explicit config, local tool discovery, or conservative default inference.
- Enforce safety boundaries: workspace isolation, path traversal rejection, command allowlists, timeout, process-tree cleanup, stdout and stderr bounds, schema validation, and artifact persistence.
- Validate LLM output: reject unknown profile IDs, unknown strategy IDs, unknown command IDs, malformed JSON, unsafe cwd values, or invented commands.
- Provide compact, high-signal context to the model instead of pre-deciding the answer in code. Raw facts should make the model smarter, not replace the model's judgment.
- Prefer repo-local explicit commands over inferred commands. A script or explicit oracle defined by the repo or operator is stronger evidence than a tool-name heuristic.
- Generate built-in commands only for generic product-owned checks or explicit repo-local commands. Do not derive commands from dependency names, config filenames, or framework names.
- When a command is plausible but unsafe or under-specified, record `missingCapabilities` or skipped-command evidence instead of running it.

#### Model-Owned Responsibilities

- Let the frontier model decide semantic intent from the raw facts: profile choice, risk level, validation sufficiency, and fast, impact, and deep check ordering.
- Let the frontier model choose among provided repo-local commands; do not ask it to invent shell commands that bypass Oraculum validation.
- Let the frontier model compare finalists and select or abstain from a survivor based on verdicts, witnesses, artifacts, and missing capabilities.
- Let the frontier model explain uncertainty. If facts are insufficient, the correct outcome is a conservative missing-capability note or abstention, not a guessed command.

#### Allowed Deterministic Facts

- File and manifest presence as raw facts: collect paths and manifest fields, but do not turn tool-specific filenames into tool-specific commands.
- Package manager detection from explicit fields or lockfiles is allowed as long as unknown remains unknown and does not silently become npm.
- Workspace root discovery from common parent directories or explicit workspace files is allowed as long as the result is recorded as provenance and does not imply root-level commands.
- Existing local tool path discovery is allowed as long as candidate-local paths precede project-root paths and explicit `oracle.env.PATH` wins.
- Small runtime-unavailable profile defaults such as `generic` are allowed for zero-signal repositories, with low confidence and missing-capability notes.

#### Disallowed Heuristics

- Do not encode final profile decisions such as `Prisma means migration profile` or `React means frontend profile` as an override that bypasses model judgment.
- Do not design semantic heuristics as if the model is low-intelligence. Any heuristic that merely imitates judgment belongs in the prompt or context layer or should be removed.
- Do not keep expanding core command recipes for every ORM, framework, build tool, or migration tool.
- Do not generate database-touching migration commands from tool names alone.
- Do not add named-tool lists just to chase ecosystems. If a tool name is observable, pass it as raw evidence and let the model reason over it.
- Do not use English task keywords as a primary signal. Task text can be auxiliary context for the model, not the core fact collector.
- Do not treat `packageManager=unknown` as npm.
- Do not use global tools unless the use is explicit, provenance-tracked, and tested.
- Do not run commands invented by an LLM unless they map to validated repo-local or explicit Oraculum command candidates.

#### Tool-Specific Signal Policy

- Tool names may appear as raw capability labels only when they are observable from repo facts.
- Tool-specific labels must not automatically imply a direct command. They are evidence passed to the model unless a repo-local script or explicit `.oraculum/advanced.json` oracle owns the command.
- Prisma direct commands remain removed. Prisma is raw capability evidence unless a repo-local script or explicit oracle defines validation.
- Migration tool names should be recorded as capabilities only unless a repo-local explicit command exists.

### Code Review Gate

- Before adding a new fact collector, answer: is this raw evidence, a safety boundary, or a semantic decision the frontier model should make?
- Before adding a new generated command, require deterministic behavior, read-only or dry-run safety or explicit opt-in, a repo-local or provenance-tracked tool path, cross-platform behavior, timeout, and regression tests.
- Before adding a new profile score, prefer adding raw facts to the model prompt. If code must score it, document why model selection is unavailable or insufficient.
- During review, run `rg -n "prisma|drizzle|alembic|react|frontend|migration|packageManager|which|where|npm pack" src test` and verify each hit is raw-evidence-owned, safety-owned, compatibility-owned, or explicitly being removed.
