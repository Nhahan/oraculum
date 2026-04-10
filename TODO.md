# TODO: Generalize Oraculum Beyond Node-Centric Repositories

## Scope Guardrails

- [ ] Keep Oraculum itself as a TypeScript/Node-distributed tool unless there is a separate packaging decision.
- [ ] Keep host-runtime support scoped to `Claude Code` and `Codex`; do not add new agent adapters just to solve repository-language generality.
- [ ] Treat this TODO as target-repository generalization: profile detection, oracle generation, workspace handling, and evidence coverage.
- [ ] Prefer repo-local explicit commands; reject tool-specific inferred commands.
- [ ] Do not add direct inferred commands from named frameworks, ORMs, migration tools, test runners, or language ecosystems by default.
- [ ] When no repo-local explicit command exists, record facts and missing capabilities instead of inventing a command from a tool name.
- [ ] Avoid making the default UX heavier. Any advanced toolchain controls should live behind `.oraculum/advanced.json` or future optional profile packs.

## Frontier Model Boundary Policy

Assumption: Oraculum is designed around frontier, human-level coding models such as Claude Code and Codex, not weak rule-following bots. Under that assumption, the product must not grow a brittle in-core expert system that tries to outguess the model with framework, ORM, language, or migration-tool encyclopedias. Use deterministic code for facts, contracts, and safety; use the model for semantic judgment, tradeoff analysis, and check selection.

### Code-Owned Responsibilities

- [ ] Collect observable raw facts deterministically: files, lockfiles, manifest fields, scripts, workspace roots, local tool paths, and explicit Oraculum config.
- [ ] Preserve provenance for every signal: root config, workspace config, task text, explicit config, local tool discovery, or conservative default inference.
- [ ] Enforce safety boundaries: workspace isolation, path traversal rejection, command allowlists, timeout, process-tree cleanup, stdout/stderr bounds, schema validation, and artifact persistence.
- [ ] Validate LLM output: reject unknown profile IDs, unknown strategy IDs, unknown command IDs, malformed JSON, unsafe cwd values, or invented commands.
- [ ] Provide compact, high-signal context to the model instead of pre-deciding the answer in code. Raw facts should make the model smarter, not replace the model's judgment.
- [ ] Prefer repo-local explicit commands over inferred commands. A script or explicit oracle defined by the repo/operator is stronger evidence than a tool-name heuristic.
- [ ] Generate built-in commands only for generic product-owned checks or explicit repo-local commands. Do not derive commands from dependency names, config filenames, or framework names.
- [x] When a command is plausible but unsafe or under-specified, record `missingCapabilities` or skipped-command evidence instead of running it.

### Model-Owned Responsibilities

- [ ] Let the frontier model decide semantic intent from the raw facts: profile choice, risk level, validation sufficiency, and fast/impact/deep check ordering.
- [ ] Let the frontier model choose among provided repo-local commands; do not ask it to invent shell commands that bypass Oraculum validation.
- [ ] Let the frontier model compare finalists and select or abstain from a survivor based on verdicts, witnesses, artifacts, and missing capabilities.
- [ ] Let the frontier model explain uncertainty. If facts are insufficient, the correct outcome is a conservative missing-capability note or abstention, not a guessed command.

### Allowed Deterministic Facts

- [ ] File and manifest presence as raw facts: collect paths and manifest fields, but do not turn tool-specific filenames into tool-specific commands.
- [ ] Package manager detection from explicit fields or lockfiles, as long as unknown remains unknown and does not silently become npm.
- [ ] Workspace root discovery from common parent directories or explicit workspace files, as long as the result is recorded as provenance and does not imply root-level commands.
- [ ] Existing local tool path discovery, as long as candidate-local paths precede project-root paths and explicit `oracle.env.PATH` wins.
- [ ] Small runtime-unavailable profile defaults such as `generic` for zero-signal repositories, with low confidence and missing-capability notes.

### Disallowed Heuristics

- [ ] Do not encode final profile decisions such as “Prisma means migration profile” or “React means frontend profile” as an override that bypasses model judgment.
- [ ] Do not design semantic heuristics as if the model is low-intelligence. Any heuristic that merely imitates judgment belongs in the prompt/context layer or should be removed.
- [ ] Do not keep expanding core command recipes for every ORM, framework, build tool, or migration tool.
- [ ] Do not generate database-touching migration commands from tool names alone.
- [ ] Do not add named-tool lists just to chase ecosystems. If a tool name is observable, pass it as raw evidence and let the model reason over it.
- [ ] Do not use English task keywords as a primary signal. Task text can be auxiliary context for the model, not the core fact collector.
- [ ] Do not treat `packageManager=unknown` as npm.
- [ ] Do not use global tools unless the use is explicit, provenance-tracked, and tested.
- [ ] Do not run commands invented by an LLM unless they map to validated repo-local or explicit Oraculum command candidates.

### Tool-Specific Signal Policy

- [ ] Tool names may appear as raw capability labels only when they are observable from repo facts.
- [ ] Tool-specific labels must not automatically imply a direct command. They are evidence passed to the model unless a repo-local script or explicit `.oraculum/advanced.json` oracle owns the command.
- [x] Remove direct Prisma-generated commands. Prisma remains raw capability evidence unless a repo-local script or explicit oracle defines validation.
- [ ] Migration tool names should be recorded as capabilities only unless a repo-local explicit command exists.

## Hardcoding And Heuristic Reduction Workstream

### Classification Pass

- [ ] Inventory every hardcoded tool/framework/file/script list in `src/services/consultation-profile.ts`, `src/services/profile-signals.ts`, `src/services/managed-tree.ts`, `src/services/oracles.ts`, and tests.
- [ ] Classify each hardcoded item as one of: raw fact collector, explicit-command bridge, safety boundary, compatibility field, or removable semantic shortcut.
- [ ] Keep safety boundaries deterministic even if they are hardcoded: path traversal rejection, unmanaged dependency/cache directories, output limits, timeout, process cleanup, schema validation, and explicit command id validation are allowed hardcoding.
- [ ] Treat semantic shortcuts as suspect by default: task-text regexes, tool-name-to-profile scoring, framework-name-to-profile scoring, and direct tool-name-to-command generation need removal unless they are raw evidence or explicit-command plumbing.
- [ ] Add a short `why this is safe` note or metadata field for every remaining generated command.

### Refactoring Targets

- [x] Move tool-specific constants out of `consultation-profile.ts` into smaller modules so the profile orchestrator only merges raw facts and explicit command candidates.
- [x] Extract shared tool/config signal constants into `src/services/profile-detector-data.ts` as a raw signal constants slice. The file name is legacy; it must not become a precedent for named-tool command packs.
- [x] Move legacy command-catalog generation out of `consultation-profile.ts`; the profile orchestrator now calls `src/services/profile-command-catalog.ts` instead of owning generated command recipes directly.
- [x] Continue by reducing `profile-command-catalog.ts` to explicit repo-local command plumbing and product-owned generic checks; remove named-tool command-generation branches rather than splitting them into more packs.
- [x] Replace legacy `tags`-driven runtime-unavailable scoring with executable command evidence. Keep `tags` only as artifact compatibility until readers no longer need it.
- [x] Split final profile choice from raw fact output: collectors may emit `intent`/`language`/`build-system`/`test-runner`/`migration-tool` evidence, but they must not force `library`, `frontend`, or `migration` directly.
- [x] Make runtime-unavailable profile selection conservative: prefer `generic` plus missing-capability evidence unless repo-local explicit commands make a stronger profile safe.
- [x] Introduce command-candidate metadata such as `source`, `capability`, `safety`, `requiresExplicitOptIn`, and `provenance` for commands that survive the explicit-command boundary.
- [x] Store skipped command candidates in profile artifacts with reasons such as `unsafe-db-touching`, `global-tool-not-explicit`, `missing-config`, `ambiguous-package-manager`, `duplicate-expensive-command`, or `requires-opt-in`.
- [x] Remove or gate global PATH use for generated commands. Generated and explicit repo-local oracles now default to `pathPolicy: "local-only"` and only inherit the host global `PATH` when the oracle or command candidate explicitly records `pathPolicy: "inherit"`, with witness details and regression coverage.
- [x] Remove Prisma direct commands instead of quarantining them as a command pack.

### Regression Tests For Heuristics

- [x] Add tests proving a React dependency alone does not force `frontend` when the task and repo evidence fit a shared library.
- [x] Add tests proving named tool signals alone do not force a profile or generate direct commands without explicit repo-local evidence.
- [x] Add tests proving English task keywords such as `frontend`, `migration`, `schema`, or `database` are auxiliary context only and cannot override stronger repo facts.
- [x] Add tests proving `packageManager=unknown` never produces npm script commands, npm pack checks, or Node-only smoke commands.
- [x] Add tests proving a zero-signal repo produces `generic`, low confidence, and visible missing-capability evidence rather than a weak guessed profile.
- [x] Add tests proving duplicate expensive commands are deduplicated even if multiple collectors propose them under different labels.
- [x] Add tests proving skipped command candidates are persisted in the profile-selection artifact and visible to `verdict`.
- [ ] Add counterexample fixtures for polyglot repos where Node and non-Node signals coexist and neither ecosystem silently dominates profile choice.

### Code Review Gate

- [ ] Before adding a new fact collector, answer: is this raw evidence, a safety boundary, or a semantic decision the frontier model should make?
- [ ] Before adding a new generated command, require: deterministic behavior, read-only/dry-run safety or explicit opt-in, repo-local or provenance-tracked tool path, cross-platform behavior, timeout, and regression tests.
- [ ] Before adding a new profile score, prefer adding raw facts to the model prompt. If code must score it, document why model selection is unavailable or insufficient.
- [ ] Run `rg -n "prisma|drizzle|alembic|react|frontend|migration|packageManager|which|where|npm pack" src test` during review and verify each hit is raw-evidence-owned, safety-owned, compatibility-owned, or explicitly being removed.

## Audit Findings

- [x] `src/domain/profile.ts` currently models only `library`, `frontend`, and `migration` profiles. That is too coarse for non-Node repositories and conflates workflow intent with ecosystem-specific tooling.
- [ ] `src/services/consultation-profile.ts` remains the main Node-centric hotspot: it reads `package.json`, detects Node package managers, inspects JS/frontend dependencies, and still coordinates package command selection. Prisma, Playwright, and Cypress direct command generation has been removed.
- [x] `src/adapters/prompt.ts`, `src/adapters/claude.ts`, and `src/adapters/codex.ts` embed the same limited profile enum in prompts and JSON schemas. Any profile model change must update both host adapters.
- [x] `src/services/oracles.ts` always prepends `node_modules/.bin` to oracle `PATH`. That helps Node repositories but is not a general local-tool strategy for Python, Go, Rust, Java, or generic Makefile repos.
- [x] `src/services/managed-tree.ts` and `src/services/workspaces.ts` have useful isolation rules, but copy-mode dependency linking only knows `node_modules`. Non-Node dependency/cache/build trees are not modeled explicitly.
- [ ] `scripts/beta-evidence.mjs` is still mostly Node-backed. Even `docs`, `service`, and `monorepo` scenarios use `package.json` scripts, so the evidence corpus overstates generality.
- [x] Existing Prisma direct command generation is not acceptable as default behavior. It was removed; Prisma now remains raw capability evidence unless validation is provided by a repo-local script or explicit oracle.
- [x] `collectProfileRepoSignals` only inspects root-level Node metadata and a fixed root-level file list. Nested packages, polyglot subprojects, and workspace/module-level toolchain signals can be missed.
- [x] `buildScriptCommand` treats `packageManager=unknown` as `npm run`. That is acceptable only through an explicit Node package-manager policy, not as a generic repository behavior.
- [x] Node package smoke checks currently hardcode `npm pack` even when the detected package manager is `pnpm`, `yarn`, or `bun`. Treat npm pack checks as a Node/npm-specific capability unless the package-manager policy says otherwise.
- [x] `materializeTaskInput` only treats missing `.md`, `.json`, and `.txt` values as task-file paths. File-like task references such as `.html`, `.py`, `.go`, `.rs`, or non-English filenames can be misread as inline task text.
- [x] Runtime-unavailable profile scoring uses English task-text keywords such as `frontend`, `migration`, `schema`, and `prisma`. It should not rely on English-only text as a primary generalization signal.
- [x] `UNMANAGED_ENTRY_NAMES` excludes ambiguous names such as `dist` globally. Some repositories intentionally track generated distribution/source directories, so ambiguous exclusions need raw workspace context or an override path.
- [x] `resolveProjectRoot` currently treats the invocation `cwd` as the project root. That is simple, but nested invocation from a package/subdirectory can create the wrong `.oraculum` root and miss repository-level signals.
- [x] Repo-local oracle `cwd` is limited to `workspace` or `project`. Monorepos and polyglot repos often need safe relative subproject working directories.
- [x] Non-Git crowning still requires a `branchName` even though workspace-sync mode does not create a branch. That is a Git-shaped UX leak into generic/local repositories.
- [x] Subprocess stdout/stderr are accumulated in memory without output limits. Arbitrary repo-local checks can produce very large logs.
- [x] POSIX timeout cleanup kills only the immediate subprocess, not necessarily its process tree. Arbitrary repo-local checks can leave child processes behind.
- [x] Task packet ids derived from filenames currently normalize to ASCII-only slugs. Non-English task filenames can collapse to generic ids such as `task`.

## Phase 1: Separate Profile Intent From Ecosystem Tooling

- [x] Add a `generic` or `custom` runtime-unavailable profile so zero-signal repositories do not masquerade as `library` repositories.
- [x] Decide whether existing `library`, `frontend`, and `migration` names remain public profile IDs or become higher-level intent profiles. Decision: keep them as public intent profile IDs; move ecosystem-specific behavior into raw capabilities and explicit command evidence, not tool-specific command packs.
- [x] Introduce a capability-oriented signal model, for example:
  - repository intent: `library`, `frontend`, `service`, `docs`, `migration`, `unknown`
  - languages as raw labels from manifests and repo facts
  - build systems as raw labels from manifests, lockfiles, wrappers, and repo facts
  - test runners as raw labels only when explicitly defined by repo scripts or config
  - migration tools as raw labels only, never as default command recipes
- [x] Update `ProfileRepoSignals` so it is not centered on a single Node `packageManager` plus `dependencies`. Compatibility fields remain during the raw-signal split; `capabilities` and `provenance` are now the primary prompt/artifact surface.
- [x] Add signal provenance so profile selection can explain whether a signal came from root config, workspace config, task text, explicit config, local tool discovery, or conservative default inference.
- [x] Model multi-root and monorepo signals explicitly; do not collapse every repository into one root package/toolchain.
- [x] Add a project-root resolution policy:
  - default behavior for nested invocation
  - explicit override path if needed
  - artifact location guarantees
  - tests for repo root, package root, and arbitrary subdirectory invocation
- [ ] Preserve backward compatibility for existing run artifacts where possible; if schema changes are required, add a versioned migration or tolerant reader.
- [x] Update `buildProfileSelectionPrompt` so it describes capabilities/toolchains instead of implying package-manager-first detection.
- [x] Update Claude Code and Codex profile output schemas from the same shared source so profile enum drift cannot happen across adapters.
- [x] Continue migrating runtime-unavailable scoring and command selection from legacy tags/package-manager fields to executable command evidence.
- [x] Enforce the frontier-model boundary policy in runtime-unavailable profile scoring: code should collect capability evidence, while profile intent and validation sufficiency should be delegated to the structured model recommendation whenever runtime selection is available.

## Phase 2: Separate Raw Facts From Commands

- [ ] Extract package/repo manifest reading from `consultation-profile.ts` into a raw fact collector that records manifests, lockfiles, scripts, exports, and config paths without creating tool-specific commands from tool names.
- [ ] Add a generic explicit-command collector for repo-local command surfaces:
  - package-manager scripts only when a package manager is explicitly known
  - Make/Just/Taskfile targets only when explicitly present and safely enumerable
  - repo-local `scripts/` or `bin/` entry points only when explicitly configured or unambiguous
- [x] Add an initial bounded repository signal walker that can inspect nested workspace roots without entering dependency/cache directories.
- [ ] Align the bounded repository signal walker with the managed-tree exclusion policy once raw signal output drives workspace copy/linking.
- [ ] Add workspace/monorepo fact collection for explicit workspace metadata. It may record workspace roots and labels, but must not imply root-level commands.
- [x] Stop treating an unknown Node package manager as silently equivalent to npm unless an explicit Node package-manager policy has recorded that decision.
- [ ] Do not add Python/Go/Rust/JVM/docs command generators by default. For those ecosystems, collect raw facts and rely on repo-local scripts, explicit `.oraculum/advanced.json` oracles, or missing-capability reporting.
- [ ] Keep each collector small and independently tested; do not turn `consultation-profile.ts` or `profile-command-catalog.ts` into a larger hardcoded switchboard.
- [x] Move tool-specific signal lists out of core profile orchestration into smaller modules, and keep them limited to raw facts unless explicit command evidence exists.

## Phase 3: Make Oracle Generation Capability-Based

- [x] Extend `ProfileCommandCandidate` with enough metadata to explain why a command exists:
  - `toolchain`
  - `capability`
  - `cost`
  - `source` such as `script`, `config`, `local-tool`, or `explicit`
  - `requiresExplicitOptIn` when relevant
- [x] Ensure command selection chooses by capability, not by ecosystem-specific command IDs.
- [x] Add a package-manager policy for Node checks so package/export smoke uses the detected toolchain or explicitly records why npm is being used.
- [x] Keep `fast`, `impact`, and `deep` as workflow rounds, but map explicit command capabilities into them without assuming tool-specific semantics.
- [ ] Keep explicit `.oraculum/advanced.json` oracles as the highest priority.
- [x] If a direct command would require tool-specific inference, emit raw capability evidence instead of generating a command.
- [x] Record skipped command candidates and why they were skipped, for example missing explicit command, unsafe global tool use, no safe cwd, or ambiguous package manager.
- [x] Extend generated and explicit oracle cwd support to safe relative subdirectories, for example `{ "cwd": "workspace", "relativeCwd": "packages/app" }`, with path traversal rejection.
- [x] Do not generate database-touching migration commands from tool names. Migration validation must come from repo-local scripts or explicit oracles.
- [x] Revisit Prisma generated-command naming. Decision: no Prisma command pack in default behavior.
- [x] Decide whether existing Prisma direct command generation should remain as a safe optional pack or become missing-capability evidence by default. Decision: remove direct commands; use repo-local scripts or explicit oracles only.
- [x] Add tests proving non-Prisma migration tools are detected as capabilities but do not receive unsafe invented commands.
- [ ] Add tests proving two different explicit command collectors can contribute commands without duplicate command execution.
- [x] Add tests proving duplicated capabilities do not run the same expensive command twice under different labels unless explicitly configured.

## Phase 4: Generalize Oracle Execution Environment

- [x] Replace the unconditional `node_modules/.bin` PATH injection in `src/services/oracles.ts` with an existing-only generic local binary path list. Explicit config or candidate-workspace local paths remain the preferred source for execution metadata.
- [x] Keep Node local bin support, but make it one entry in a generic local-tool path list.
- [ ] Prefer candidate-workspace local tool paths when the workspace owns or links dependencies; only fall back to project-root tool paths when that is intentional and recorded.
- [x] Make global PATH tool use explicit, provenance-tracked, and optionally disabled for generated oracles.
- [ ] Add local tool path support for at least:
  - `.venv/bin` and `.venv/Scripts`
  - `venv/bin` and `venv/Scripts`
  - repo-local `bin/`
  - Gradle/Maven wrappers
- [ ] Keep Windows behavior explicit for shell wrappers and executable suffixes.
- [x] Add regression tests for oracle PATH composition in Node and non-Node fixtures.
- [ ] Ensure repo-local oracle env remains deterministic and does not accidentally expose extra host-specific state.
- [x] Add bounded stdout/stderr capture for subprocesses while preserving enough log output for witnesses and debugging.
- [x] Add cross-platform process-tree cleanup coverage for timed-out repo-local oracle commands and host runtime commands. POSIX process-group cleanup is covered; Windows still relies on existing `taskkill /T` behavior and native CI coverage.

## Phase 5: Generalize Workspace Copy/Isolation Rules

- [x] Audit `UNMANAGED_ENTRY_NAMES` in `src/services/managed-tree.ts` for language-specific cache/build/dependency directories.
- [x] Add safe defaults for common non-Node generated directories where copying them is wasteful or risky:
  - `.venv`, `venv`
  - `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`
  - `target`
  - `.gradle`
  - `.tox`
- [x] Be careful with ambiguous names like `dist`, `build`, `target`, and `vendor`; they can be source or published artifacts in some ecosystems and generated/dependency cache in others.
- [x] Replace `linkWorkspaceDependencyTrees` with a generalized dependency-tree linker driven by explicit config and safe raw facts.
- [x] Preserve current `node_modules` symlink/junction behavior.
- [x] Add copy-mode e2e fixtures for Python `.venv`, Rust `target`, and Gradle `.gradle` so workspace sync does not accidentally copy or delete heavy dependency trees.
- [x] Keep managed tree rules configurable if a repository intentionally tracks generated directories.
- [x] Add a large/binary file policy for non-git snapshot mode so hashing and copying do not make general repositories unexpectedly slow or memory-heavy.
- [x] Add configurable unmanaged/sensitive path rules for common IDE, cloud, infra, and credential directories without over-excluding legitimate source trees.

## Phase 6: Generalize Task Input And Crowning UX

- [x] Make task-path detection extension-aware without limiting it to `.md`, `.json`, and `.txt`.
- [x] Preserve stable, collision-resistant task packet ids for Unicode and non-English filenames.
- [x] Add tests for task filenames with spaces, Unicode, source-code extensions, and no extension.
- [x] Separate Git branch naming from generic workspace-sync crowning so non-Git projects are not forced to provide a fake branch-like name.
- [x] Decide whether `orc crown` should accept an optional materialization label for workspace-sync mode or no positional value when no Git branch will be created.
- [x] Keep existing Git-backed `orc crown <branch-name>` behavior stable.

Decision: Git-backed crowning keeps `orc crown <branch-name>`. Non-Git workspace-sync crowning uses bare `orc crown` by default; a first positional value is recorded only as `materializationLabel`, not as a Git branch.

## Phase 7: Expand Evidence Corpus Beyond Node

- [x] Add a `generic-no-package-json` evidence scenario where no `package.json` exists and Oraculum still consults/crowns without assuming npm.
- [x] Add a Python-shaped fixture that uses explicit repo-local scripts or `.oraculum/advanced.json` oracles, not inferred `pytest`/`ruff` commands.
- [x] Add a Go-shaped fixture that uses explicit repo-local scripts or `.oraculum/advanced.json` oracles, not inferred `go test` commands.
- [ ] Add a Rust-shaped fixture that uses explicit repo-local scripts or `.oraculum/advanced.json` oracles, not inferred `cargo` commands.
- [ ] Add a Java/Gradle-shaped fixture that uses explicit repo-local scripts or `.oraculum/advanced.json` oracles, not inferred Gradle commands.
- [ ] Add a Java/Maven-shaped fixture that uses explicit repo-local scripts or `.oraculum/advanced.json` oracles, not inferred Maven commands.
- [ ] Add a docs/static fixture that does not use Node scripts.
- [ ] Add a mixed polyglot fixture where Node and non-Node raw facts coexist and neither ecosystem silently dominates profile choice.
- [ ] Add a nested workspace fixture where the actionable code and checks live below the repository root.
- [ ] Add a migration fixture for Alembic or Django that records missing capability unless safe repo-local scripts exist.
- [ ] Add task-input fixtures with non-English filenames, spaces in paths, and source-file-looking task references such as `.html`, `.py`, `.go`, and `.rs`.
- [ ] Ensure each corpus fixture exercises `consult -> crown`, not just profile selection.
- [ ] Keep the corpus fast by using fake local tools behind explicit repo-local commands; do not use the corpus to justify new named-tool inferred command recipes.
- [ ] Add a separate `evidence:polyglot` script if the full corpus becomes too slow for normal beta checks.
- [ ] Extend `workflow-comparison` and `host-native` smoke evidence with at least one non-Node or package-json-free scenario before using them as generality evidence.
- [ ] Add subdirectory-invocation evidence where Oraculum is invoked below the repository root and still records artifacts/checks in the intended root.
- [ ] Add timed-out oracle evidence that proves child processes do not survive after timeout.

## Phase 8: Documentation And Product Language

- [ ] Add non-Node/generalized README claims or examples only after the generalized behavior is actually implemented and verified.
- [x] Update `docs/advanced-usage.md` to distinguish:
  - core Oraculum workflow
  - raw fact collection versus explicit command execution
  - repo-local explicit oracles
  - missing capability reporting
- [x] Document that npm is only the distribution channel for Oraculum, not a requirement that target repositories be Node projects.
- [x] Document that named-tool inferred commands are not generated by default and when Oraculum intentionally refuses to invent commands.
- [x] Document profile signal provenance and how users can override ambiguous profile decisions.
- [x] Document project-root resolution behavior, nested invocation behavior, and non-Git crowning semantics after those decisions are implemented.
- [ ] Keep examples simple, but include at least one non-Node example once tested.

## Phase 9: Verification Checkpoints

- [x] After profile schema changes: run `npm exec vitest run test/consultation-profile.test.ts`.
- [x] After task input/path parsing changes: run `npm exec vitest run test/contracts.test.ts test/project.test.ts`.
- [x] After oracle environment changes: run `npm exec vitest run test/execution.test.ts test/workspaces.test.ts`.
- [x] After workspace copy/link changes: run `npm exec vitest run test/managed-tree.test.ts test/workspaces.test.ts test/exports.test.ts`.
- [x] After project-root resolution or relative oracle cwd changes: run `npm exec vitest run test/project.test.ts test/execution.test.ts test/exports.test.ts`.
- [x] After subprocess timeout/output changes: run `npm exec vitest run test/subprocess.test.ts test/execution.test.ts`.
- [ ] After evidence corpus changes: run `npm run evidence:beta:corpus`.
- [ ] After polyglot evidence changes: run the new `npm run evidence:polyglot` script if added.
- [ ] After workflow comparison changes: run `npm run evidence:workflow-comparison`.
- [x] Before any commit touching this area: run `npm run check`.
- [ ] Before beta publish after this work: run `npm run evidence:release-smoke`, `npm run evidence:host-native`, and installed-package smoke.

## Definition Of Done

- [x] A non-Node repository with no `package.json` can complete `orc consult -> orc crown` without npm assumptions.
- [ ] A nested workspace or monorepo can complete `orc consult -> orc crown` using the correct workspace-level checks rather than only root-level scripts.
- [x] Zero-signal repositories get a generic/default profile result, not a misleading Node/library result.
- [x] Non-English paths, spaces in paths, and source-file-looking task references are handled intentionally rather than accidentally treated as inline prose.
- [ ] Nested cwd invocation, non-Git crowning, relative oracle cwd, and large-output/time-out subprocess behavior are covered by regression tests.
- [ ] Node, Python, Go, Rust, Java, docs/static, and migration-style fixtures have explicit evidence coverage through raw facts, repo-local commands, or missing-capability outcomes.
- [x] Named-tool inferred commands are not generated from frameworks, ORMs, migration tools, test runners, or language ecosystems.
- [x] Generated Node package checks do not silently use `npm` when another package manager or no package-manager policy applies.
- [ ] Missing capabilities are visible in verdict/profile artifacts instead of hidden behind weak or invented commands.
- [x] Existing Node happy paths, frontend e2e detection, package smoke checks, and Prisma raw-signal/no-direct-command behavior remain covered by regression tests.
