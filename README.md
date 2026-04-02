# Oraculum

<p align="center">
  <img src="docs/images/logo.png" alt="Oraculum logo" width="320">
</p>

> Generate competing patches, judge them with repo-local oracles, and promote only the survivors.

Oraculum is a design-stage concept for a CLI-first patch search and invariant judgment engine built on top of `Claude Code` and `Codex`.

Instead of trusting the first plausible diff, Oraculum would explore multiple candidate patches in parallel, eliminate weak directions early with executable repo rules, and carry only the strongest finalists into deeper verification.

This repository is currently for publishing the idea, shaping the product boundary, and refining the harness model before a real implementation lands.

## Status

Oraculum is not a shipped tool yet.

Today, this repository is primarily:

- a public concept repo
- a product-definition repo
- an architecture and harness-design workspace

It is not yet a production-ready CLI or an installable OSS package.

## What Oraculum Is

Oraculum is not a new coding agent. It is a planned system that sits above existing coding-agent runtimes and adds structured patch search, repo-local judgment, staged elimination, and evidence-backed promotion.

## Why Oraculum

Most coding-agent workflows fail in three predictable ways:

1. They converge too quickly on the first plausible approach.
2. Repo-specific invariants disappear into prompts and tribal memory.
3. Expensive validation happens too late, after the wrong direction is already overbuilt.

Oraculum addresses this by turning one task into multiple candidates, judging each candidate with repo-local oracles, and spending deep verification only on the candidates that survive earlier rounds.

## How It Works

### 1. Specify

Oraculum starts by turning a task into a structured task packet.

That packet captures:

- intent
- non-goals
- acceptance criteria
- likely risk areas
- oracle profile
- execution budget
- candidate strategy portfolio

This keeps the run spec-first instead of letting each candidate drift from an underspecified prompt.

### 2. Search

Oraculum expands one task into multiple candidate patches.

Each candidate represents a different patch worldline, for example:

- minimal change
- safety-first
- test-amplified
- structural refactor
- exploratory
- repo-defined custom strategies

Each candidate runs in its own isolated workspace.

### 3. Judge

Oraculum evaluates each candidate with repo-local oracles.

An oracle is an executable repo rule or validation judge. It can encode things like:

- architecture boundaries
- auth requirements
- public API stability
- migration safety
- impacted tests
- rollback feasibility
- performance limits
- team-specific safety policies

Oracles do more than return pass or fail. They return verdicts with witnesses: concrete evidence for why a candidate should survive, be repaired, or be eliminated.

### 4. Eliminate

Oraculum does not send every candidate through the most expensive checks.

It evaluates in rounds:

- `Fast round`: lint, typecheck, formatting, generated file integrity, forbidden imports, boundary checks, touched-area smoke tests
- `Impact round`: impacted tests, touched-module integration tests, public API drift, selective security checks
- `Deep round`: full suites, e2e, rollback simulation, scenario tests, benchmarks, stress checks

Weak directions die early. Repairable candidates get a bounded chance to recover. Strong candidates become finalists.

### 5. Promote

At the end of the run, Oraculum does not just hand you a diff.

It gives you:

- finalists
- oracle verdicts
- witnesses
- comparison reports
- a recommended winner
- export to branch or PR draft

That means a human can review the final choice with actual evidence instead of trusting a single opaque agent run.

## Core Concepts

**Task packet**  
A structured contract for the run: intent, acceptance criteria, risks, oracle profile, budget, and strategy portfolio.

**Candidate**  
One possible patch worldline for the same task.

**Oracle**  
An executable repo-local rule, invariant, or validation check.

**Witness**  
Concrete evidence explaining an oracle verdict.

**Round**  
A staged evaluation layer: fast, impact, deep.

**Promotion**  
Moving a surviving candidate to the next round or into a final exportable result.

## What Makes Oraculum Different

Most agent harnesses try to make a single agent run behave better.

Oraculum changes the unit of work itself.

Instead of:

- generating one patch
- validating it later
- discovering the real problem at the end

Oraculum:

- searches a patch space
- judges candidates against repo invariants early
- eliminates weak directions before full CI
- promotes only the surviving finalists

That makes it especially useful for:

- risky bug fixes
- migrations
- refactors with hidden invariants
- security-sensitive paths
- legacy systems where the prompt alone is not enough

## Why This Repo Is Public Early

The goal of publishing early is not to claim completion. It is to make the product thesis inspectable while the shape is still being formed.

That means this repository is being used to:

- clarify the product boundary
- refine the Oraculum-specific harness model
- test whether the search/judge/promote framing is actually compelling
- make future implementation choices easier to evaluate in public

## Repo-Local Oracles

Oraculum is built around repo-local oracles: executable checks that encode what a repository must not break.

Examples:

- "Sensitive endpoints must pass through AuthGuard."
- "Public SDK methods must remain backward compatible."
- "Writes must stay inside the transaction boundary."
- "This migration must preserve rollback safety."
- "Payment retries must remain idempotent."

This is where repo truth lives.

## Intended CLI Shape

The intended CLI shape looks like this:

```bash
oraculum init
oraculum run --task tasks/fix-session-loss.md --candidates 6 --agent claude-code
oraculum finalists run_2026_04_02_001
oraculum export --winner cand-02 --as-branch fix/session-loss --with-report
```

A typical run would look like this:

- 6 candidates generated from different strategies
- fast round reduces them to 3
- impact round reduces them to 2 finalists
- deep verification selects the winner
- final output includes a verdict matrix, witnesses, and a promotion recommendation

## Current Scope

Current design scope is intentionally narrow:

- supported runtimes: `Claude Code`, `Codex`
- product shape: `CLI-first`
- core loop: `search -> judge -> eliminate/repair -> promote`

Support for other runtimes is not the current priority.

## What Oraculum Is Not

Oraculum is not:

- a new LLM
- a replacement for `Claude Code` or `Codex`
- a role-playing multi-agent framework
- a memory platform
- a CI/CD suite

Oraculum is a patch search and invariant judgment engine for coding agents.

## What Exists Today

Today, the repository should be read as:

- product thesis
- terminology and mental model
- harness direction
- public-facing concept material

If you are looking for a ready-to-run tool, it is not here yet.

## The Idea In One Sentence

Oraculum turns:

**"an agent generates a patch"**

into:

**"a system searches and judges a patch space."**
