# Oraculum Chat-Native Pivot

## Context

Oraculum now works primarily as a host-native chat surface (`orc consult`, `orc verdict`, `orc crown`).

That is no longer the target product surface.

The target is closer to Ouroboros:
- users type Oraculum commands directly inside Claude Code or Codex chat
- those commands are intercepted as chat-native skills/rules
- the chat-native surface routes to Oraculum MCP tools instead of being treated as natural-language requests
- terminal CLI may remain for setup, MCP, and debugging, but it is no longer the workflow product surface
- preferred short command prefix: `orc`
- `oc` is intentionally not preferred because it is less distinctive and more collision-prone

The core failure discovered in review:
- typing `oraculum consult "..."` inside Claude Code or Codex chat does **not** invoke Oraculum
- the host treats that text as a normal user request because this repo does not yet install or register chat-native command surfaces

Current shipped state:
- the reusable orchestration core exists
- the packaged npm surface still includes the `oraculum` shell binary for setup, MCP, debugging, and local validation
- the chat-native `orc` surface is now shipped for both Claude Code and Codex after setup
- a plain `npm install -g oraculum` is **not** enough for the target product surface because it does not yet register MCP or install host-native skills/rules/plugins

## Reference Findings

Ouroboros works because it ships **all three** layers together:
- MCP server registration
- packaged skills / commands
- host-native rules / keyword interception

Observed reference structure:
- Claude Code: plugin + commands/skills + MCP registration
- Codex: packaged skills + rules + MCP registration
- both hosts ultimately route `ooo <command>` into MCP tools instead of free-form chat interpretation

## Product Direction

Target Oraculum shape:
- same user-facing command language in Claude Code and Codex
- same conceptual flow on both hosts
- same MCP-backed orchestration core
- thin host adapters at the edge for skill/rule installation and interception

Important nuance:
- the **UX contract** can be the same across Claude and Codex
- the **installation artifacts** will not be byte-for-byte identical because the host extension systems differ

Installation model:
- package installation and host setup are separate concerns
- the target product needs both:
  - install the Oraculum package/runtime payload
  - register MCP and install host-native artifacts for the chosen host
- acceptable end states:
  - one bootstrap installer that performs install + setup automatically
  - or `npm install -g oraculum` followed by an explicit `oraculum setup ...` step
- unacceptable end state:
  - package installed, but `orc consult` still gets treated as plain chat text because host registration never happened

## Hard Rules

- Do not treat shell CLI as the primary product surface anymore.
- Do not rely on natural-language prompting to trigger Oraculum flows.
- Keep one shared Oraculum command vocabulary across Claude and Codex.
- Use `orc` as the preferred short command prefix in chat-native flows.
- Route chat-native commands to MCP tools, not ad-hoc shell execution.
- Keep the candidate -> oracle -> witness -> verdict -> crowning model intact.
- Avoid host-specific product divergence unless the host makes it unavoidable.
- Avoid overengineering: prefer one shared manifest/spec for skill routing, then generate host-specific artifacts from it.
- Preserve cross-platform setup and installation paths.

## TODO

- [x] Decide the chat-native command prefix and vocabulary
  - preferred prefix: `orc`
  - keep the core vocabulary: `consult`, `verdict`, `crown`, `draft`, `init`
  - shell `oraculum ...` remains only for setup/MCP/debug support

- [x] Define the MCP tool surface Oraculum needs for chat-native use
  - consultation start
  - consultation status / reopen
  - crowning
  - draft / planning
  - setup / install diagnostics
  - checkpoints:
    - [x] write the MCP tool list and exact request/response schemas
    - [x] map each tool to existing orchestration services or note the missing adapter layer
    - [x] document which tool outputs must remain machine-readable artifacts
    - [x] confirm the tool surface is sufficient for `consult`, `verdict`, `crown`, `draft`, and setup diagnostics without shell-only escape hatches

- [x] Design a shared skill-command manifest
  - one source of truth for command name, description, trigger prefixes, MCP tool name, and argument mapping
  - generate Claude and Codex artifacts from this instead of hand-maintaining two separate surfaces
  - checkpoints:
    - [x] define the manifest schema
    - [x] include command name, aliases, argument model, MCP tool target, and help text
    - [x] prove both Claude and Codex artifacts can be generated from the same manifest shape
    - [x] keep host-specific fields additive so the shared surface does not fork

- [x] Define the packaged host-artifact layout
  - decide which generated Claude and Codex artifacts ship inside the npm package
  - make sure setup can install those artifacts without reaching back into the git checkout
  - keep versioning aligned so MCP/schema/skills/rules/plugin artifacts do not drift from the shipped core
  - checkpoints:
    - [x] choose the package paths for generated Claude artifacts
    - [x] choose the package paths for generated Codex artifacts
    - [x] ensure `npm pack` contains everything setup needs
    - [x] define one versioning rule so shipped host artifacts cannot drift from the packaged orchestration core

- [x] Add Claude Code chat-native integration
  - project/package plugin metadata
  - command/skill files
  - MCP registration guidance / setup path
  - exact-prefix interception so Oraculum commands are not interpreted as natural-language tasks
  - checkpoints:
    - [x] generate Claude-facing artifacts from the shared manifest
    - [x] register the Oraculum MCP server in the Claude host config
    - [x] make `orc consult`, `orc verdict`, and `orc crown` route to MCP instead of free-form chat
    - [x] verify failure mode without setup is explicit and actionable

- [x] Add Codex chat-native integration
  - packaged skills
  - packaged rules
  - MCP registration guidance / setup path
  - exact-prefix interception so Oraculum commands are not interpreted as natural-language tasks
  - checkpoints:
    - [x] generate Codex-facing artifacts from the shared manifest
    - [x] register the Oraculum MCP server in Codex config
    - [x] make `orc consult`, `orc verdict`, and `orc crown` route to MCP instead of free-form chat
    - [x] verify failure mode without setup is explicit and actionable

- [x] Decide whether shell CLI remains as a compatibility/debug surface
  - yes, for setup/MCP/debug only
  - workflow commands are removed from the shell surface
  - keep it demoted in docs and product framing

- [x] Update README and docs around the new primary surface
  - quick start shows chat-native commands first
  - shell usage is limited to setup/MCP/debug guidance

- [x] Add installation/setup flows for both hosts
  - Claude Code install/setup path
  - Codex install/setup path
  - validation that MCP + skills/rules are actually installed
  - make the install model explicit in user-facing docs: install alone is not sufficient for `orc ...`
  - choose the shipped UX:
    - bootstrap installer that auto-detects host and performs setup
    - or explicit two-step flow: install, then setup
  - checkpoints:
    - [x] decide bootstrap installer vs explicit install-then-setup
    - [x] implement the chosen Claude setup path
    - [x] implement the chosen Codex setup path
    - [x] add a setup verification command or diagnostics path that proves host registration is complete
    - [x] update public docs so users cannot mistake package install for finished setup

- [x] Add host-native e2e tests
  - Claude Code: command typed in chat-native form routes correctly
  - Codex: command typed in chat-native form routes correctly
  - negative case: without setup, commands fail with explicit setup guidance rather than silent misrouting
  - checkpoints:
    - [x] add Claude host-native happy-path e2e
    - [x] add Codex host-native happy-path e2e
    - [x] add setup-missing negative e2e for Claude Code
    - [x] add setup-missing negative e2e for Codex
    - [x] confirm host-native command routing works without falling back to shell command parsing

- [x] Keep the current orchestration core reusable
  - reuse existing consultation/crowning/oracle/report logic
  - move only the outer command surface, not the inner harness behavior
  - checkpoints:
    - [x] keep the existing consultation/crowning state machine unchanged where possible
    - [x] isolate new host-native layers at the edge instead of forking inner orchestration services
    - [x] ensure shell fallback and host-native surface both call the same core operations during the transition
    - [x] rerun existing core validation after each integration step to catch accidental harness drift

## Release Gates

- [x] Manifest and MCP tool surface are stable enough to wire both hosts from one source of truth
- [x] Claude host-native path works end-to-end
- [x] Codex host-native path works end-to-end
- [x] Setup/install flow is explicit and validated on both hosts
- [x] Shell workflow fallback can be removed without leaving broken public guidance

## Completion Status

This TODO is complete once every item, checkpoint, and release gate above is checked.

That is the current state.

Remaining work after this point should be treated as follow-on product work, not as unfinished scope from this TODO.

Examples of follow-on work:
- host-native UX polish after shell workflow fallback removal
- more host-native UX polish, diagnostics, and packaging cleanup
- broader evidence collection, release hardening, and operational polish
- future host/runtime expansion only if product direction changes

## Follow-On Work

- [x] Demote shell fallback further in root docs and default user guidance
- [x] Remove shell workflow fallback while keeping shell setup/MCP/debug commands
- [x] Improve host-native UX polish, diagnostics, and packaging cleanup
- [x] Add a clean-install release smoke that validates packaged setup for both hosts
- [x] Expand the curated evidence corpus with a docs-heavy repository shape
- [x] Continue broader evidence collection, release hardening, and operational polish
  - added broader curated corpus coverage for service-style repos and non-pnpm monorepo package-manager variants
  - wired packaged smoke checks into CI and the GitHub release workflow
- [ ] Revisit future host/runtime expansion only if product direction changes

## Suggested Order

1. Define the MCP tool surface.
2. Design the shared command manifest.
3. Define the packaged host-artifact layout.
4. Wire Claude Code integration.
5. Wire Codex integration.
6. Add install/setup flows for both hosts.
7. Add host-native e2e coverage.
8. Remove shell workflow fallback only after the host-native path is proven.

## Current Decision

Feasibility answer:
- yes, Claude Code and Codex can share the **same product model**
- no, they will not use the exact same host artifact format
- the right architecture is:
  - one shared Oraculum MCP core
  - one shared command manifest
  - host-specific generated skills/rules/plugins on top

Command decision:
- primary chat-native prefix: `orc`
- keep `consult`, `verdict`, `crown`, `draft`, `init`
- treat `oraculum ...` shell commands as setup/MCP/debug paths, not product-facing workflow commands
