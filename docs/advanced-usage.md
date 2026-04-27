# Advanced Usage

This page is for users who want more control than the default one-command flow.

After running setup in your terminal, open Claude Code or Codex and use:

```text
orc consult "fix session loss on refresh"
```

`consult` already prints the latest summary. Everything below is for reopening a consultation later, shaping the tournament more explicitly, or using shell-only setup, uninstall, diagnostics, and direct CLI commands.
When a consultation finishes with a safe recommended result, the default host flow asks for apply approval and then materializes through the guarded crown path. Use `orc consult --defer ...` when you want verdict-only output and a later manual `orc crown`.

The primary product surface is interactive `orc ...` commands inside Claude Code and Codex after setup. The shell binary remains for setup, uninstall, diagnostics, and the direct host route used by installed artifacts. Run `oraculum setup ...` in your terminal first. Current setup is host-level and global for your local Claude Code or Codex installation, not directory-scoped.

If you want to inspect whether the interactive `orc ...` surface is ready, run:

```bash
oraculum setup status
```

The npm package is only Oraculum's distribution channel. It does not mean the target repository must be a Node project.

Every `consult` also runs an automatic validation-posture selection step. Oraculum collects repo facts, asks the chosen runtime for a structured recommendation, validates the recommendation, and applies the resulting posture draft to that consultation only. Explicit quick-start and advanced settings still win over inferred defaults.

## Consult On A Task File

```text
orc consult tasks/fix-session-loss.md
```

`consult` accepts:

- inline task text
- a task note file
- a task packet path

Use `--defer` to skip the apply approval prompt for this consultation:

```text
orc consult --defer tasks/fix-session-loss.md
```

After a deferred consultation, reopen the verdict with `orc verdict` or materialize manually with `orc crown`.

## Configure Runtime And Candidate Count

Chat-native planning commands stay task-only:

```text
orc consult tasks/fix-session-loss.md
```

Available runtimes today:

- `codex`
- `claude-code`

Choose the default runtime and candidate count by editing `.oraculum/config.json`:

```json
{
  "version": 1,
  "defaultAgent": "codex",
  "defaultCandidates": 4
}
```

Both runtimes support structured validation-posture selection through their structured non-interactive output paths. That structured step is what lets Oraculum treat validation posture choice as a bounded selection problem instead of an unstructured free-form guess.

## Timeouts

The default `consult` and `plan` product path does not expose a consultation-wide adapter timeout flag. Keep bounded long-running checks at the repo-local oracle boundary with `timeoutMs` in `.oraculum/advanced.json`.

Internal validation harnesses may still apply their own process bounds. They are not part of the chat-native product input.

Shell setup and diagnostics commands still keep their explicit safety and installation flags. The task-only rule applies to `orc consult` and `orc plan`.

## Automatic Validation Posture Selection

Each consultation now writes a validation-posture selection artifact under:

```text
.oraculum/runs/<consultation-id>/reports/profile-selection.json
```

That artifact records the repo signals, the command catalog offered to the runtime, skipped command candidates, the selected validation posture, and any missing capabilities.

Today the built-in validation posture ids are:

- `generic`
- `library`
- `frontend`
- `migration`

The selected validation posture is consultation-scoped. It does not rewrite your saved quick-start config, and it does not overwrite explicit advanced project settings.

## Validation Posture Boundaries

The runtime does not invent executable commands. It selects from the command ids Oraculum already provided in the consultation-scoped catalog.

Unknown strategy ids and command ids are filtered out or replaced by safe fallbacks before the recommendation is applied. Unsupported validation posture ids from runtime output are normalized through deterministic fallback before they become current state. If a plausible command is not safe to generate, Oraculum records it under `skippedCommandCandidates` instead of running it. If runtime validation-posture selection fails or is disabled, fallback behavior stays conservative: zero-signal repositories use `generic`, ambiguous package managers do not silently become npm, and missing proof obligations are recorded in `validationGaps`.

If consultation preflight runtime is unavailable, times out, or does not return a structured readiness recommendation, Oraculum fails closed with `needs-clarification` and one bounded task-contract question. It does not proceed to candidate generation from a preflight guess.

Repo-local scripts and explicit `.oraculum/advanced.json` oracles are strongest. Oraculum prefers repository-owned commands and configuration over built-in ecosystem-specific guesses.

## Project Roots And Task Paths

If Oraculum finds an initialized `.oraculum/config.json` in an ancestor directory, nested invocations use that initialized project root for config, runs, reports, and workspaces. If no initialized root exists, Oraculum keeps the current directory local instead of guessing a repository root.

Task paths are resolved from the invocation directory first, then from the initialized project root. Existing file-looking inputs such as `.html`, `.py`, `.go`, or `.rs` are loaded as task notes. Missing file-looking inputs fail fast instead of being treated as inline prose. Plain inline text is materialized under `.oraculum/tasks/`.

## Inspect A Specific Consultation

```text
orc verdict run_20260404_xxxx
```

Without a consultation id, `verdict` uses the latest consultation automatically.

## Crown The Recommended Result

```text
orc crown
```

The shared `crown` path is still available for deferred apply, recovery, and shell-only workflows. The default `orc consult` host flow uses the same crown materialization logic after you approve an eligible recommendation.

By default, `crown` applies the recommended result directly into the current project workspace. In a Git-backed project, that means the current branch working tree; in a non-Git project, Oraculum syncs the crowned workspace back into the project folder. If you pass a first positional argument, Oraculum records it as a materialization label. To create a Git branch before applying, use `orc crown --branch fix/session-loss`.

When available, the crowning record points at artifacts such as:

- finalist-to-finalist comparison summaries
- Markdown comparison reports
- recommended result records
- change summaries, witness rollups, and why-this-won rationale

By default, `crown` refuses to materialize a result when validation gaps remain, the recommendation came from fallback policy, or a second-opinion judge disagreed or was unavailable. Use `orc crown --allow-unsafe` only after manual operator review; the export plan records `safetyOverride: "operator-allow-unsafe"`.

## Research Briefs And Failure Analysis

When preflight decides that repo-only evidence is insufficient, Oraculum writes a bounded research artifact under:

```text
.oraculum/runs/<consultation-id>/reports/research-brief.json
```

That artifact carries the research question, summary, sources, claims, version notes, unresolved conflicts, and conflict handling. You can reuse it directly as the next task input:

```text
orc consult .oraculum/runs/<consultation-id>/reports/research-brief.json
```

If bounded repair or finalist judgment fails to converge, Oraculum may also write:

```text
.oraculum/runs/<consultation-id>/reports/failure-analysis.json
```

That artifact is for investigation, not auto-retry. It summarizes why execution stalled, which candidates failed repeatedly, and what evidence should be inspected before rerunning or manually crowning.

## Repeated Clarify Follow-Up

When the same scope repeatedly lands in `needs-clarification` or `external-research-required`, Oraculum can persist a bounded follow-up artifact under:

```text
.oraculum/runs/<consultation-id>/reports/clarify-follow-up.json
```

That artifact does not replace the blocked preflight decision. It records:

- one key clarify question
- one missing result contract statement
- one missing judging basis statement

`orc verdict` and saved consultation summaries replay that artifact into rerun guidance so the operator can answer the bounded question before reopening the consultation.

## Saved Verdict Artifacts

`orc verdict` stays read-only, but the saved consultation directory can include richer artifacts than the default summary prints.

Common examples include:

- comparison reports
- winner-selection records
- research briefs
- failure-analysis summaries

Use these when you want to inspect why a consultation stopped, why a winner was recommended, or what to rerun next.

## Plan First

```text
orc plan tasks/fix-session-loss.md
```

Use this when the task is broad, risky, or still needs a stronger execution contract before candidate generation. Oraculum persists:

- `.oraculum/runs/<consultation-id>/reports/planning-depth.json`
- `.oraculum/runs/<consultation-id>/reports/planning-interview.json` when clarification is needed
- `.oraculum/runs/<consultation-id>/reports/planning-spec.json` when the interview/spec gate is ready
- `.oraculum/runs/<consultation-id>/reports/plan-consensus.json` when Plan Conclave completes
- `.oraculum/runs/<consultation-id>/reports/consultation-plan.json`
- `.oraculum/runs/<consultation-id>/reports/plan-readiness.json`
- `.oraculum/runs/<consultation-id>/reports/consultation-plan.md`

If the requested plan lacks a concrete result contract or judging basis, `orc plan` stops before candidate planning and asks one clarification question. Answer that Augury prompt in the host UI. Shell-only integrations can use the internal answer route shown in the CLI output:

```text
orc answer augury-question <run-id> "Email/password login only, protect /dashboard, no OAuth."
```

Host-installed Claude Code and Codex handlers run `oraculum orc consult --json`, `oraculum orc plan --json`, and `oraculum orc verdict --json` and use the stable `userInteraction` field to guide clarification loops. When `userInteraction` is present, the host asks that question with structured choices from `userInteraction.options` when present, waits for your selected label or custom text, and invokes `oraculum orc answer --json <userInteraction.kind> <userInteraction.runId> <answer>`. Plain CLI output prints the same clarification question and numbered choices for humans. A later `orc plan "<task>"` always starts a new planning task.
The same loop handles `apply-approval`: `Apply` materializes the recommended result directly into the current project workspace, and a custom label applies with that label recorded in the crowning plan. `Do not apply`, `skip`, `cancel`, and `defer` leave the verdict unchanged so you can crown manually later. Branch creation remains an explicit manual crown choice through `orc crown --branch <branch-name>`.

The JSON artifact is rerunnable:

```text
orc consult .oraculum/runs/<consultation-id>/reports/consultation-plan.json
```

Plan Conclave does not have a user remediation continuation. It is an internal post-spec architect/critic quality gate. When it finds a normal plan quality gap, rejection, revision-cap miss, or review-runtime-unavailable condition, planning stops as an internal planning failure before candidate generation. When it finds that user intent, scope, success criteria, non-goals, or judging basis are still missing and internal revision cannot safely infer them, it emits one Augury-style task clarification question. That question is recorded in `planning-interview.json`, surfaced as `Clarification needed`, and answered through the same `orc answer augury-question` route.

Explicit planning uses model judgment for Augury Interview depth, Plan Conclave intensity, interview questions, structured answer choices, readiness scoring, planning-spec crystallization, architect review, critic review, bounded revision, and deciding whether a Plan Conclave issue is truly missing user intent. Deterministic code validates schemas, routes answers to the specified active Augury run, derives the effective Plan Conclave revision budget from the selected intensity within the operator cap, writes artifacts, checks path safety through the plan schema, and enforces runaway caps.

The planning lane has two named loops:

- Augury Interview: runs before `planning-spec.json` when the task still needs operator clarification. It extracts the signs future candidates must satisfy or violate as the `ontologySnapshot` sign bundle: goals, constraints, non-goals, acceptance criteria, and risks. The runtime must leave sign arrays empty when the answer provides no evidence, and it should mark spec readiness only when a witnessable goal/scope boundary or acceptance/judging basis is visible enough for future candidate evidence. `interviewDepth`, `estimatedInterviewRounds`, and `explicitPlanMaxInterviewRounds` bound this loop.
- Plan Conclave: runs after `planning-spec.json` and revises the consultation-plan draft when architect/critic review asks for internal plan changes. `consensusReviewIntensity` is the primary signal for this loop; `interviewDepth` is only a bounded budget modifier, not extra interview work. `revise` means bounded required changes can still make the plan safe. `reject` is terminal for the current planning run unless the review supplies a task clarification question, in which case control returns to Augury. Runtime-unavailable review rejects conservatively instead of approving by fallback.

The default safety caps live in the advanced project layer:

```json
{
  "version": 1,
  "planning": {
    "explicitPlanMaxInterviewRounds": 8,
    "explicitPlanMaxConsensusRevisions": 10,
    "explicitPlanModelCallTimeoutMs": 120000,
    "consultLiteMaxPlanningCalls": 1
  }
}
```

These caps are operator safety boundaries, not exact semantic budgets. For Plan Conclave, `explicitPlanMaxConsensusRevisions` is a maximum cap. `planning-depth.json` records that configured cap as `operatorMaxConsensusRevisions` and records the effective Plan Conclave budget as `maxConsensusRevisions`; the effective value comes from the runtime-selected `consensusReviewIntensity` plus `interviewDepth`, clamped by the operator cap and the hard safety ceiling. `orc answer augury-question` runs depth/intensity selection again before scoring the active Augury answer, so the final budget reflects the clarified task contract. `consultLiteMaxPlanningCalls` is the consult-lite preflight cap for the lighter `orc consult` path. `orc consult` can block on one high-value clarification, but it does not run the full multi-round Augury Interview and Plan Conclave pipeline unless you explicitly use `orc plan`.

Plan Conclave blocked summaries distinguish four cases:

- task clarification: `plan-consensus.json` has `approved=false`, `planning-interview.json` records the Augury question, and the next action is to answer that clarification.
- reviewer rejection: `plan-consensus.json` is terminal with `approved=false`, no revision is attempted, and readiness reports an internal planning blocker instead of asking for reviewer remediation.
- review runtime unavailable: `plan-consensus.json` is terminal with `approved=false`, and readiness asks for planning to be rerun when review can execute.
- revision cap miss: `plan-consensus.json` is terminal with `approved=false` after exhausting `maxConsensusRevisions`, and readiness reports the cap miss separately from rejection.

`orc consult <consultation-plan.json>` checks `plan-readiness.json` before creating candidates. If the plan still lacks information, Oraculum asks for clarification instead of treating that as an execution block. It fails fast only for hard readiness problems such as invalid artifacts, stale plan basis, or planned oracle ids that no longer exist in the execution contract.

Plan review findings, when present, are advisory unless deterministic readiness finds a hard execution blocker such as stale plan basis, unresolved questions, or missing planned oracles. Plan Conclave review is different: its `reject` verdict is terminal for the current planning run. `orc verdict` shows review and readiness artifacts that were produced by the planning lane.

Codex structured-output schemas require every top-level field to be present, so prompts may mention nullable placeholders such as `candidateId: null` or `clarificationQuestion: null`. These placeholders are normalized away at Oraculum's schema boundary when the canonical artifact treats the field as optional.

## Shell Setup And Direct Commands

Use the shell binary for installation, uninstall, diagnostics, and the direct host route.

### Setup Host Integration

```bash
oraculum setup --runtime claude-code
oraculum setup --runtime codex
```

Run setup in your terminal, not inside the Claude Code or Codex chat input. This registers Oraculum globally for your local host installation.

Stable/default usage is the interactive `orc ...` path inside the host, for example:

```text
orc consult "안녕"
```

### Check Setup Status

```bash
oraculum setup status
oraculum setup status --json
```

Use the plain command for a readable summary, or `--json` when you want machine-readable diagnostics.

### Host Policies

Oraculum keeps the `orc ...` language shared across Claude Code and Codex. The stable/default workflow for both hosts is the interactive `orc ...` path inside the host session.

| Host | Interactive `orc ...` | Product status |
| --- | --- | --- |
| Claude Code | supported | stable default |
| Codex | supported | stable default |

Interpretation:

- Oraculum installs the host-specific plugin, skills, and rules needed for `orc ...`.
- Under the hood, Oraculum routes exact prefixes to the local `oraculum orc ...` direct CLI path.

Use `oraculum setup status --json` when you want the current host setup state as machine-readable diagnostics.

### Uninstall Host Integration

Use `oraculum uninstall` to remove Oraculum's global Claude Code and Codex host wiring.

```bash
oraculum uninstall
oraculum uninstall --runtime claude-code
oraculum uninstall --runtime codex
```

This removes host registration and installed host artifacts. If you also want to remove the globally installed npm package itself, run `npm uninstall -g oraculum` separately.

### Run The Direct Route Explicitly

```bash
oraculum orc consult "fix session loss on refresh"
oraculum orc verdict
oraculum orc crown
```

Normal Claude Code and Codex usage should go through `orc ...` after setup; those installed host artifacts call this direct route for you.

## Repo-Local Oracles

Put repo-specific command checks in `.oraculum/advanced.json`.

Example:

```json
{
  "version": 1,
  "oracles": [
    {
      "id": "lint-fast",
      "roundId": "fast",
      "command": "npm",
      "args": ["run", "lint"],
      "cwd": "workspace",
      "relativeCwd": "packages/app",
      "pathPolicy": "inherit",
      "invariant": "The candidate must satisfy lint checks.",
      "enforcement": "hard",
      "timeoutMs": 300000
    }
  ]
}
```

Use `command` with `args` when you want an exact executable invocation. Use a shell-style command string only when that is the behavior you want.
`cwd` can be `workspace` or `project`; add `relativeCwd` when a monorepo or polyglot check must run below that scope. `relativeCwd` must stay inside the selected scope, so absolute paths and `..` traversal are rejected.
`pathPolicy` defaults to `local-only`, which exposes only discovered candidate/project local tool paths; an explicit oracle `env.PATH` overrides that computed value. Use `pathPolicy: "inherit"` only when the oracle intentionally needs the host global `PATH`, for example an operator-owned package-manager command.
`timeoutMs` is optional and applies only to that oracle command. Use it when the repository wants a bounded long-running check; leaving it out does not inherit a product-wide adapter timeout.

Supported enforcement levels:

- `hard`: fail the candidate immediately
- `repairable`: record a failure that can trigger a bounded repair attempt in the same round; unresolved repairable findings still block crowning
- `signal`: keep the candidate alive, but record the warning

You can also tune bounded repair behavior in `.oraculum/advanced.json`:

```json
{
  "version": 1,
  "repair": {
    "enabled": true,
    "maxAttemptsPerRound": 1
  }
}
```

## Managed Tree Rules

Copy-mode workspaces and non-Git crowning ignore dependency, cache, runtime-state, and sensitive paths by default. Copy-mode workspaces may link unmanaged local dependency/cache trees such as `node_modules`, `.venv`, `venv`, `.tox`, `target`, or `.gradle` instead of copying them. This preserves existing local tool behavior without treating those names as validation commands.

Local state directories such as `.idea`, `.terraform`, `.serverless`, and `.pulumi` are unmanaged by default because they are commonly machine-local or generated. Source-like settings that are often intentionally checked in, such as `.vscode` and `.devcontainer`, are not excluded by default.

Sensitive paths stay protected even if an include rule is present. Examples include `.env*`, `.aws`, `.ssh`, `.kube`, `.npmrc`, `.docker/config.json`, `.azure/accessTokens.json`, and gcloud credential files under `.config/gcloud`.

Managed files are processed as bytes. Snapshots hash file content through streams, and workspace-sync copies files without text decoding, so large or binary source artifacts stay valid without being loaded as UTF-8 text.

Some names are ambiguous across ecosystems: `dist` or `target` may be generated output in one repository and intentional source or published artifacts in another.

Use `managedTree` only when the repository really intends to include or exclude such paths:

```json
{
  "version": 1,
  "managedTree": {
    "includePaths": ["dist", "target/docs"],
    "excludePaths": ["build"]
  }
}
```

Paths must be safe relative paths inside the project root. `includePaths` can opt ambiguous generated or local-state directories back into workspace copy, snapshots, change detection, and non-Git crowning. Included paths are managed, so they are not dependency-tree linked. `includePaths` does not override protected paths such as `.git`, `.oraculum`, `.env*`, or credential paths.

## Where Advanced Settings Belong

Quick start should stay simple.

Use `.oraculum/config.json` for quick-start defaults such as:

- `defaultAgent`
- `defaultCandidates`

Use `.oraculum/advanced.json` for advanced project settings such as:

- repo-local oracles
- repair policy
- managed tree include/exclude rules for ambiguous generated paths
- custom rounds and strategy portfolios
- future profile-level overrides

Use advanced settings only for things like:

- choosing a specific runtime
- changing candidate count
- adding repo-local oracle commands in `.oraculum/advanced.json`
- tuning repair, judge, strategy, round, and managed-tree policy

If a workflow can be expressed without these controls, prefer the simple path.
