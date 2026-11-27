# Versus for Kimi

**IACDM (Interactive Adversarial Convergence Development Methodology) orchestrator for Kimi Code.**

An original methodology created by [Jasmine Moreira](https://github.com/jasminemoreira) that transforms LLMs from reactive code generators into disciplined agents following a structured 8-phase process — from problem discovery to delivery with tests and post-review.

## Why?

AI coding tools (Lovable, Cursor, Kimi Code, Claude Code, ChatGPT) all share the same fundamental limitation: **zero internal verification capability**. They generate statistically plausible output without distinguishing correct code from incorrect code. The METR study (2025) showed experienced developers using AI tools were actually **19% slower** — despite believing they were 20% faster.

**The real distinction isn't between tools — it's between process and no process.**

Versus implements the GA/VA (Generative Agent / Verification Agent) model: the AI generates, external agents (automated tests + human operator) verify at discrete **gates**. The gates are enforced by a state machine outside the model — the agent may request advancement, not grant it. Errors are caught at the earliest possible phase, not in production.

## Features

- **8 sequential phases** with verifiable exit criteria — no skipping steps
- **8 safeguards (S0-S7)** that prevent common AI agent errors (premature convergence, scope creep, reimplementation)
- **Convergence score** (0-100) that gates advancement until the problem is truly understood
- **15 MCP tools** for state management, decision recording, phase transitions, and meta-iteration (v1→v2)
- **7 Kimi Code hooks**, shipped as a Kimi plugin — context injection, edit blocking in early phases, loop detection, destructive-command blocking, truncation warnings, stop verification
- **Persistent decision registry** that survives context switches
- **Gateway guard** that detects when models skip loading context
- **Adversarial critique** with up to 19 specialized lenses — 7 universal + 12 conditional (8 situational, 4 domain transfer); in a pre-registered 12-project experiment, every lens found defects no other lens found
- **VS Code sidebar** showing methodology state in real time
- **Multi-session testing protocol** for Phase 6 continuity across sessions
- **Phase 6 session renewal** to decouple implementer from tester (reduces confirmation bias)
- **UI testing tooling proposal** — Phase 6 detects UI modules from Phase 1 and offers stack-appropriate browser/automation tools (Playwright, Puppeteer, Cypress, Detox, Maestro, etc.) via interactive selection
- **Production Capacity Check** in Phase 0 — mandatory asset inventory (authoring/visual/audio/data/integrations) before P0 score can converge, preventing "complete product" targets without production capacity
- **AP10 — Silent Scope Deferral** — new antipattern blocking `met=true` with prose like "will be done in next cycle"; the inverse of AP9 (silent scope creep)
- **Empirical `ui_runnable`** — exit criterion now requires explicit user confirmation that a P0 use case was executed end-to-end (literal user confirmation captured in `details`), not just "UI rendered"
- **Original Scope Adversarial Review** at end of Phase 5 — mandatory comparison between P0 commitments and actual delivery, with 3 explicit user options (Continue / Renegotiate / Accept gaps as debt). Eliminates silent scope deferral by forcing every gap into a user decision recorded as `record_decision`.
- **Ready-to-advance enforcement** — when all exit criteria of a phase are met but the phase has not advanced, three layers signal the LLM to call `advance_phase()` immediately: `_nextAction` field in `mark_exit_criterion` and `get_phase_state` responses + warning banner in the context-injection hook. Eliminates the "phase done but stopped on summary" failure pattern.
- **Complete guidance injection** — every UserPromptSubmit injects the full methodology (cross-cutting rules + antipatterns + all 8 phase blocks). Replaces the previous compact-guidance summary, which could omit critical rules under context pressure. Token cost is bounded by prompt caching (static content cached after first injection per session). Single source of truth: no drift possible between compact and full.
- **Brownfield bootstrap** — `init_project` now supports two modes: greenfield (empty workspace, full HSA) and brownfield (existing codebase). In brownfield mode, the AI reads surface files (README, configs, src/ structure), infers stack/modules/use-cases/vocabulary, presents a Bootstrap Proposal for user confirmation, then captures the as-is context as `projectSpec.constraints`/`patterns`/`stack` and AS-IS decisions in P0/P1. Phase 0 then runs in **DELTA MODE**: explores only the new change/feature, skipping HSA Level 1 (Domain) — already captured. Lets Versus take over projects already in progress without pretending they are greenfield.

## How It Works

```
Phase 0: Problem Discovery    → HSA 5-level exploration (score >= 90 to advance)
Phase 1: Architecture         → Define modules, interfaces, patterns
Phase 2: Adversarial Critique → Attack the architecture with up to 19 specialized lenses
Phase 3: Simplification       → Address criticals, simplify (loops with Phase 2)
Phase 4: Convergence Gate     → Validate all exit criteria + safeguards
Phase 5: Implementation       → Code the final architecture
Phase 6: Tests                → 100% passing + exploratory testing
Phase 7: Post-Review          → Double-loop learning: evaluate product AND process
```

### Phase 0: Hierarchical Semantic Analysis (HSA)

The most distinctive contribution. Structures problem exploration in 5 levels, each building on the previous:

| Level | Focus | What is sought |
|---|---|---|
| 1. Domain | Universe where the problem exists | Vocabulary, theoretical/technical field, tools, state of the art |
| 2. Problem | What needs to be solved | 5W1H: who, what, when, where, why, how solved today |
| 3. Elements | Parts composing the problem | Components, entities, actors, constraints |
| 4. Processes | How parts relate | Flows, transformations, dependencies, feedback cycles |
| 5. Product | Expected outcome | Deliverables, acceptance criteria, success metrics |

### Context Efficiency

The methodology maximizes `E = I₀/C` (relevant information / total context consumed) through granularization: each session focuses on one module with just its interface signatures, so `C` stays bounded and `I₀` remains a large fraction of it — while in a monolithic session `E` tends to zero as the system grows. (`E` is a conceptual definition, not a measured metric.)

## Quick Start

1. Install the extension
2. Open the Command Palette (`Ctrl+Shift+P`) and run **Versus Kimi: Initialize Project**
3. Enter a project name and description when prompted
4. Start a **new Kimi Code conversation** (the extension registers the MCP server on initialization and the hook plugin on activation)
5. Type **`start`** — Kimi will load the methodology state and begin Phase 0

> **Important:** After initializing, always start a **new conversation** so Kimi picks up the MCP server. If Kimi doesn't use the MCP tools, run "Developer: Reload Window" from the Command Palette.

## Kimi Code Hooks

| Hook | Event | Function |
|---|---|---|
| **inject-context** | `UserPromptSubmit` | Injects phase, score, and recent decisions into each prompt |
| **phase-gate** | `PreToolUse` (Write/Edit) | Blocks code editing in Phases 0-4 |
| **loop-detector** | `PreToolUse` (Bash) | Blocks a test run after 3 consecutive failures with no diagnosis recorded (S6) |
| **test-outcome** | `PostToolUse` / `PostToolUseFailure` (Bash) | Counts failed test runs; a passing run or a recorded diagnosis clears the counter |
| **block-destructive** | `PreToolUse` (Bash) | Blocks destructive commands |
| **truncation-check** | `PostToolUse` (Grep/Bash) | Warns when tool output was truncated |
| **stop-verify** | `Stop` | Verifies methodology state before the turn ends |

**Loop detection counts failures, not executions.** Re-running the tests after a named fix is the normal debugging cycle, not a loop — so only a *failed* run accumulates, a passing run clears the counter, and `record_decision(category='diagnosis')` clears it too. Verification (S4) is therefore never blockable: the green run always goes through.

## The 8 Safeguards

| ID | Name | Protects Against |
|---|---|---|
| S0 | Problem Convergence | Advancing without understanding the problem |
| S1 | Anti-Bug | Simplification that introduces bugs |
| S2 | Stopping Criterion | AI deciding when to stop (user's decision) |
| S3 | Premature Convergence | Stopping iteration too early |
| S4 | Explicit Verification | Skipping human validation at gates |
| S5 | Scope Preservation | Scope creep during critique-simplification |
| S6 | Do Not Reimplement | Recreating what already exists |
| S7 | Sequence Discipline | Starting tangential discussions during implementation |

## The GA/VA Model

```
P₀ → G₀ → P₁ → G₁ → ... → Pₙ → Gₙ → delivery
      ↑              ↑                    ↑
  VA evaluates   VA evaluates        VA evaluates
```

- **GA (Generative Agent):** The LLM. Produces artifacts without verification capability.
- **VA-automatic:** Tests, linters, compilers — binary verdict on formalizable properties.
- **VA-human:** The operator — evaluates semantic adequacy, usability, domain correctness.
- **Gate (Gₖ):** Discrete point where progression requires VA approval. Rejection feeds concrete error information back to the GA.

## LLM Compatibility

The IACDM methodology demands strict instruction following, reliable MCP tool calling, and sustained reasoning across long contexts. Not all models meet these requirements equally.

### Selection Criteria

| Criterion | Why it matters |
|---|---|
| Instruction following | Each phase has detailed behavioral rules (~2-4k tokens). Models that summarize or skip steps break the methodology |
| MCP tool reliability | The methodology relies on 15 tools being called consistently. Models that "narrate" tool calls instead of executing them are incompatible |
| Context window | Phases 0-2 accumulate significant context. Minimum 32k tokens, recommended 128k+ |
| Reasoning depth | Phases 0-4 (design) require architectural analysis, not code generation. Shallow reasoning produces shallow designs |

### Model Tier Classification

| Tier | Model | Phases 0-4 (Design) | Phases 5-7 (Code) | Notes |
|---|---|---|---|---|
| S | Kimi K2 (thinking) | Very good | Very good | Reasoning mode matters most in Phases 0-4; enable thinking for design phases |
| A | Kimi K2 (standard) | Good | Very good | Fine for Phases 5-7 with a validated architecture |

Tiers are indicative: what the methodology actually requires is consistent tool calling and enough reasoning depth in Phases 0-4. Any model that narrates tool calls instead of executing them is incompatible, regardless of tier.

### Recommended Strategy (LLM Switch Point)

The methodology includes a natural **LLM Switch Point at Phase 4**. The architecture is fully validated and persisted in `state.json` + `specs/`, so no context is lost when switching models.

| Strategy | Phases 0-4 | Phases 5-7 | Best for |
|---|---|---|---|
| Maximum quality | Kimi with thinking enabled | Kimi with thinking enabled | Critical/high-complexity projects |
| Optimal cost/quality | Kimi with thinking enabled | Kimi standard | Most projects — leverages the LLM Switch Point |

> **Rule of thumb:** An architectural error detected in Phase 5-6 costs far more than using a more capable model in Phases 0-4. Invest in reasoning where reasoning matters. The switch point is also where you can hand the project to a different Versus build entirely — `.versus/state.json` is shared across the Claude, Qwen and Kimi extensions.

### Built-in Protections for Weaker Models

| Mechanism | Protects against |
|---|---|
| Gateway Guard | Model forgetting to load context (>30min without `get_phase_state`) |
| Phase Gate hook | Code editing in Phases 0-4 (blocked regardless of model) |
| Loop Detector | Blind debugging: 3 failed runs with no diagnosis named — safeguard S6 |
| Complete Guidance | The full methodology injected into every prompt via hook |
| Phase 7 Engine Hint | Forces meta-iteration offer even if model didn't read guidance |

## Requirements

| Requirement | Minimum | Why |
|---|---|---|
| **VS Code** | >= 1.85.0 | Extension API compatibility |
| **Node.js** | >= 18.0.0 | Runs the MCP server (`node .versus/kimi/server.js`) and the hooks |
| **Kimi Code** | >= 0.6.6 | Hosts the MCP server, hooks and plugin system |

> **Node.js is mandatory.** Without it, the MCP server cannot start and Kimi will ignore the methodology entirely. Install from [nodejs.org](https://nodejs.org).

## Companion Extensions

**[Versus for Claude](https://marketplace.visualstudio.com/items?itemName=jasminemoreira.versus-claude)**, **[Versus for Qwen](https://marketplace.visualstudio.com/items?itemName=jasminemoreira.versus-qwen)**, **[Versus for Cursor](https://open-vsx.org/extension/jmoreira/versus-cursor)** and **[Versus for Local Qwen](https://marketplace.visualstudio.com/items?itemName=jasminemoreira.versus-localqwen)** cover the other agents. All of them share the same `.versus/state.json`, so a project can move between agents mid-methodology. Each build keeps its own binaries in its own subfolder (`.versus/kimi/` here) and registers its MCP server in its own agent's config file, so several can be installed side by side without colliding.

## Where Versus writes

| Path | Scope | What |
|---|---|---|
| `.versus/state.json` | project | Methodology state — **shared** with the sibling Versus extensions |
| `.versus/kimi/server.js` | project | MCP server for this build |
| `.kimi-code/mcp.json` | project | Registers the MCP server with Kimi |
| `~/.kimi-code/plugins/versus-kimi/` | machine | The hook plugin (Kimi has no project-scoped hooks) |
| `~/.kimi-code/config.toml` | machine | A marked `[permission]` block auto-approving the Versus MCP tools plus Read/Glob/Grep |

The hooks are registered per machine because Kimi only reads hook definitions from the user config or from an installed plugin. They exit immediately in any workspace without `.versus/state.json`, so unrelated projects are unaffected. Run **Versus Kimi: Remove Kimi Plugin (hooks)** from the Command Palette to uninstall them; reloading the window installs them again.

## References

- Source methodology: **[Versus](https://github.com/jasminemoreira/Versus)** — canonical repository with the methodology's theory, history, and evolution.
- Academic paper: **[arxiv:2604.16399](https://arxiv.org/abs/2604.16399)** — formal description of IACDM.

## License

[MIT](LICENSE) - Created by [Jasmine Moreira](https://github.com/jasminemoreira).
