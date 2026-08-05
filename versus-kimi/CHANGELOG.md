# Changelog

## [0.3.1] - 2026-08-05

### Changed
- **The findings-table gate requires one row, not three.** The threshold was measurement, not verification: Versus is used to study whether the methodology surfaces defects, and a floor of three findings puts a thumb on the scale of the very number being measured. One row is enough to do the gate's actual job — reject a severity-only grid, which has zero rows carrying a finding id. A genuine Phase 2 that found exactly one thing now advances.
- **Phase 2's exit gate no longer offers a skip to Phase 4.** It read "zero findings → advance to Phase 3 (optional refinement) OR skip to Phase 4", which named a transition the engine does not allow and framed Phase 3 as optional. Zero findings across all lenses is now stated for what it is — a red flag that the critique was shallow or the modules too coarse, not a clean bill — and the only valid transition from Phase 2 is to Phase 3.
- **The `lens` column must carry the canonical lens name** (`Security`, not `Segurança` or `SEG`). Findings tables are only aggregable across projects if the lens is spelled the same way every time.
- Removed the leftover "Table of modules × lenses … with severities" line, which still described the grid the findings table replaced.

### Fixed
- **A contradictory phase-gate test had been failing since the `.env` change, unnoticed.** One test asserted `.env` must be writable while another asserted the opposite; the second was added when `.env` was dropped from the allowlist and the first was never updated. `npm test` had been exiting 1 the whole time — the runner does set `process.exitCode`, but the verification here was `npm test | grep -c "✓"`, which counts checkmarks and discards both the ✗ lines and the exit code. Checking the exit code is the fix on both sides.

## [0.3.0] - 2026-08-05

### Changed
- **The coverage matrix is a findings table, and the gate checks its shape.** A module×lens grid of severities records that something was found, not *what* — so two lenses hitting the same defect look identical to two lenses hitting different ones, and a post-mortem cannot tell overlap from orthogonality. `specs/design/coverage-matrix.md` is now one row per finding (`id | module | lens | severity | description`), each with a unique in-project id and `duplica: <id>` when it is a defect another lens already recorded. `coverage_matrix` gained `artifactRows`, so the engine requires at least three rows carrying a finding id before `advance_phase()` to Phase 3 opens — an existing file in the old grid form no longer passes. Phase 3 now resolves findings **by id**. The engine checks the form only: whether a finding is real, or a `duplica` mark honest, stays a human judgment. You may still display a readable grid in chat; the persisted file is the findings table.

Ported from Versus Claude 0.12.0. `engine.ts` and `phases.ts` diffed clean against the Kimi build (pure additions) and were taken wholesale; the Phase 2 and Phase 3 guidance blocks were replaced by hand, since this file carries the chat-template questions and the switch-point decisions. 64 tests. Verified end to end: no file blocks, a severity-only grid blocks naming the required format, a findings table with ids releases.

## [0.2.0] - 2026-08-01

### Added
- **Exit gates require persisted or witnessed evidence, not a boolean.** Four required criteria could be marked met with nothing behind them, and the record died with the chat. They now demand a trace the engine can inspect: `architecture_doc` needs `specs/technical/architecture.md`, `coverage_matrix` needs `specs/design/coverage-matrix.md`, `lessons_documented` needs `specs/references/lessons.md` (each existing with ≥80 non-whitespace characters), and `tests_passing` needs a green run the `test-outcome` hook actually witnessed **in Phase 6** — a stamped criterion no longer opens `advance_phase()` or `start_new_cycle()`. The engine checks existence and observation, never quality: whether the architecture is good stays a human judgment. Phases 1, 2, 3, 5, 6 and 7 of the guidance were updated to say where each artifact goes and that the gate is shut until it does, and Phase 3 now works from the persisted matrix instead of chat recall.
- **The MCP server reloads state before every tool call.** It loaded once at startup, but the hooks write `state.json` from separate processes — the loop counter and the witnessed test result. Without the reload, `tests_passing` would never see the green run the hook had just recorded. The engine saves after every mutation, so disk is authoritative.

### Note for this build
The witnessed-pass gate depends on a hook seeing the run, which makes the Phase 6 guidance about foreground execution load-bearing rather than advisory: Kimi's `Bash` defaults to a 60-second foreground timeout and moves the command to the background on expiry, and a backgrounded run is never witnessed — the gate would stay shut with the suite passing. Phase 6 now says so at the point of use.

Ported from Versus Claude 0.11.0. `engine.ts` and `phases.ts` were identical pre-patch and were taken wholesale; `types.ts`, `mcp/server.ts` and `full-guidance.ts` carry Kimi-specific changes and were patched by hand.

## [0.1.1] - 2026-08-01

### Fixed
- **A project declaring `"type": "module"` silently disabled the methodology.** Node resolves module type from the nearest `package.json`, so an ESM project — routine in modern JS — turned the deployed CommonJS bundle into an ES module and the MCP server died on its first `require` with `ReferenceError: require is not defined in ES module scope`. Losing the server is worse than losing a hook: without it there is no phase state at all, and the failure is silent from the chat's point of view. Every deploy directory now gets a `{"type":"commonjs"}` marker (`pinCommonJs()`), applied by both deploy paths — the extension's and `init_project`'s — plus the plugin directory, which is outside the project tree and therefore safe from the project's manifest but not from a stray one higher up the user's home. Reactivating the extension repairs an already-broken project. Three tests, including one that boots the real bundle inside a `type:module` project and asserts the MCP handshake still answers. Ported from Versus Claude 0.10.1; the Kimi layout needed the marker in a different place, and its hooks — running from `~/.kimi-code/plugins/` — were never exposed.

## [0.1.0] - 2026-07-31

Initial port of Versus Claude 0.9.0 to **Kimi Code** (extension >= 0.6.6, `@moonshot-ai/kimi-code-sdk`). The methodology engine, rules, MCP tools and sidebar are unchanged; everything below is about how the same behaviour is wired into a different host.

### Changed — host integration
- **Hooks ship as a Kimi plugin.** Kimi reads hook definitions only from `~/.kimi-code/config.toml` or from an installed plugin — there is no project-scoped equivalent of `.claude/settings.json`. The extension writes `~/.kimi-code/plugins/versus-kimi/` (manifest + the 7 hook bundles) and registers it in `plugins/installed.json` on activation. Because registration is machine-wide, every hook now short-circuits in workspaces without `.versus/state.json`. The command **Versus Kimi: Remove Kimi Plugin (hooks)** uninstalls it.
- **Hooks read the workspace from the payload, not the environment.** There is no `CLAUDE_PROJECT_DIR`, and plugin hooks run with the *plugin* directory as their working directory, so `process.cwd()` is meaningless. Every hook now parses stdin first and walks up from the payload's `cwd` looking for `.versus/state.json` — which also makes opening a subdirectory of the project work.
- **`tool_input.path`** replaces `tool_input.file_path` (Kimi's `Read`/`Write`/`Edit` name the argument `path`); both are accepted. Tool names are otherwise identical to Claude Code's, so the `Write|Edit`, `Bash` and `Grep|Bash` matchers carry over verbatim.
- **MCP server moved to `.versus/kimi/server.js`** and is registered in `.kimi-code/mcp.json` instead of the shared `.mcp.json`. Claude Code also reads `.mcp.json`: registering there would make a workspace with both extensions load two methodology servers into the same session. `.versus/state.json` stays at the top level, shared with the Claude and Qwen builds.
- **Sibling Versus servers are shadowed off inside Kimi.** The collision runs both ways: Kimi *also* reads the project-root `.mcp.json`, so a workspace where Versus Claude was initialized would expose two complete sets of methodology tools to Kimi, both driving the same `state.json`. Kimi merges user → `.mcp.json` → `.kimi-code/mcp.json` with later files winning by name, so any `versus-*` server found in `.mcp.json` is re-declared in `.kimi-code/mcp.json` with `enabled: false`. That shadows it for Kimi sessions only — `.mcp.json` is left byte-for-byte untouched and Claude Code is unaffected. Non-Versus servers are never touched.
- **Permissions.** Kimi has no `permissions.allow`; it has `[permission]` rules in the user config. The extension appends a marked block auto-approving `mcp__versus-kimi__*`, `Read`, `Glob` and `Grep` — and refuses to touch the file if the user already maintains a `[permission]` section, showing the snippet to paste instead. Write, Edit and Bash deliberately keep going through Kimi's own approval flow.
- **Session priming moved into the plugin's `systemPrompt`.** Kimi has no `type: "prompt"` hooks, so the SessionStart and PreCompact prompts of the Claude build are replaced by a static primer that only applies when the workspace has `.versus/state.json`.

### Changed — methodology
- **The LLM Switch Point is now a decision, not a notice.** Phase 4 told the model to "Display the LLM Switch Point notification" and then, in the very next step, to `advance_phase()` and "begin Phase 5 implementation immediately" — so the model correctly announced the option and started coding, leaving the user to interrupt if they wanted a different model. That inverts R2: the switch is a user decision, and it is only free *before* any code exists, since afterwards switching means abandoning a session mid-implementation. Phase 4 now asks in chat with two options (default "Continue here"), advances the phase in either case (the gate is already satisfied — a new session should resume at Phase 5, not re-run the convergence check), and on "Switch model" records the decision and stops. This mirrors the Session Renewal step Phase 6 already had. **The same wording exists in the Claude, Qwen and LocalQwen builds — this is a methodology-level gap and the fix belongs upstream.**
- **The reverse switch (Phase 7 → new cycle) had the same defect, and now matches.** `start_new_cycle` returns a `_modelSwitchAction` recommending a move back to a design-grade model for the new Phase 0 — and the guidance said "MUST DISPLAY" it, then loaded Phase 0 and carried on. Same inversion, same moment: the choice is free only before the new cycle's design work starts. It now asks in chat with "Switch model" recommended (Phase 0 is design), records `category='process'` and stops if the user switches.
- **`process` is documented as a decision category.** Both switch points ask for `record_decision(category='process')`. The engine accepts any string — `category` is free text, and only the diagnosis aliases have runtime meaning (they clear the S6 counter) — so nothing was broken, but the tool description listed every other category and not this one, leaving the model to guess whether it was legitimate.

### Changed — host limits that had no answer, and now do
- **Plan mode is refused inside a Versus project.** Kimi's plan mode makes the session read-only and its prompt states it "supersedes any other instructions you have received" — entering it mid-methodology suspends the process, including the `specs/` writes Phase 0 requires. The phase gate now also matches `EnterPlanMode` and denies it whenever `.versus/state.json` exists, explaining that Phases 0-4 already are the planning process and carry gates plan mode does not (exit criteria, convergence score, adversarial critique, safeguards). This covers the model-initiated path only: the user's own Shift-Tab toggle goes through a separate RPC (`setPlanMode`) that no hook observes, so the denial message tells the model to say so rather than enter plan mode on the user's behalf.
- **Compaction recovery moved into the plugin's `systemPrompt`.** `PostCompact` is fire-and-forget, so no hook can re-inject anything after a summarization, and the per-message injection only resumes on the user's next prompt — leaving a window where the model continues mid-turn without the methodology. The system prompt is the one channel compaction cannot touch (it is rebuilt on every request), so it now carries an explicit recovery clause: if you cannot state the current phase, its exit criteria and the recorded decisions — or the conversation was just compacted — call `get_phase_state()` and `get_phase_guidance()` before acting, and never infer the phase from the conversation.
- **`.env` removed from the phase gate's writable list.** Kimi refuses sensitive files natively for Read/Write/Edit, so the entry never granted anything — it only implied Versus considers writing credentials normal.

### Changed — permissions
- **`Write` and `Edit` are auto-approved; the phase gate is the single authority on writes.** The narrow allowlist (read-only tools + the Versus MCP server) looked conservative and cost a real failure: a background `coder` subagent researched GTD for 16.6 minutes, tried to deposit three cited files under `specs/` — blessed by the gate, required by rule R4 — and both writes died as `{"decision":"cancelled","feedback":"Turn cancelled"}` because the approval request surfaced in a queue the webview renders without any source attribution (`sourceKind`/`agentId` appear nowhere in `webview.js`). Zero Versus denials in either wire log: the methodology had already decided the write was legitimate, and a weaker, invisible second layer vetoed it. The gate is the more selective of the two — it refuses everything outside specs/ and scaffolding in Phases 0-4, and from Phase 5 writing code is the point — so it now decides alone. `Bash` deliberately stays behind Kimi's approval flow: `block-destructive.js` catches `rm -rf /` and force pushes, not a `curl | sh`.
- **The managed permission block is now rewritten in place when the rule set changes.** It was only ever appended, so an upgrade that adds a rule would never reach an install that already had the block — the fix would ship to nobody. `ensureGlobalPermissions()` gained an `updated` result, splices between its markers, preserves user content above and below, and still refuses to touch a `[permission]` section it did not write. Three tests cover write / update / hands-off.

### Changed — interaction model
- **Questions are asked in chat, not through `AskUserQuestion`.** Kimi's question panel renders only `questions[0]` and answers on the first click, so the methodology's "group up to 4 questions per call, multi-select where non-exclusive" turned into one single-choice question per round trip — slow enough to change how the phases feel. The Kimi build therefore adopts the numbered-block chat template already used by the LocalQwen and Copilot builds (same wording, so the three stay in sync): one question per block, blocks separated by `---`, up to 4 per message, reply by number or free text. Multi-choice works again (the user answers "1,3"), and a Phase 1 pattern round is one message instead of six. R2 also states plainly why the tool is not used, so the model does not "helpfully" fall back to it. All 21 call sites in the guidance and the two MCP hints were converted; Phase 1's pattern collection returns to its original two-round grouping.

### Changed — degraded, and why
- **PostToolUse hooks can no longer talk back in the same turn.** Kimi fires `PostToolUse` as fire-and-forget: the hook runs, but its stdout is discarded and it cannot block. `test-outcome` and `truncation-check` therefore queue their messages in `.versus/notices.json`, and `inject-context` flushes them on the next `UserPromptSubmit`. The S6 counter itself is unaffected — it is state, and `loop-detector` (`PreToolUse`) still blocks on the next test run.
- **`stop-verify` blocks via structured output** (`permissionDecision: "deny"`) rather than exit code 2, which in Kimi reads the reason from stderr. Its non-blocking "no toolchain detected" warning is queued like the others.
- **Truncation detection is best-effort.** Kimi caps `tool_output` in the hook payload at 2000 characters and appends its truncation markers at the end of the output, so a marker past that cap is invisible. The hook matches Kimi's own markers (`[stdout truncated at N bytes…]`, `[Truncated at N matches…]`, `Results truncated to N lines…`) and still catches short outputs; long ones will slip through. No gate depends on it.

### Fixed
- **The VS Code question panel renders one question and cannot multi-select — corrected in R2 after reading the client, not the docs.** Kimi's `AskUserQuestion` *tool* accepts up to 4 questions and a `multi_select` flag, and the agent forwards both. The VS Code webview does neither: its panel reads `questions[0]` and drops the rest, and every option is a button that answers and closes on click (`multiSelect` does not appear anywhere in `webview.js`). So a 4-question call silently loses three of them, and a multi-select question degrades to single choice — which is what made Phase 1's "Call 1 / Call 2, up to 4 questions each" produce one answer per call. R2 now states both limits and tells the model to ask one question per call and to offer pre-combined packages where a decision is genuinely non-exclusive; Phase 1's pattern collection was rewritten accordingly. This supersedes the earlier `multi_select` note: the parameter name was indeed wrong, but fixing it does not restore multi-select in this client.
- **Test runs could slip past safeguard S6.** Kimi's Bash defaults to a 60-second foreground timeout (max 300s) and, on timeout, *moves the command to the background* instead of killing it — the result then arrives as a notification, so the `PostToolUse` payload carries no pass/fail evidence and `test-outcome` records nothing. Any suite slower than a minute silently stopped feeding the S6 counter. Phase 6 now instructs an explicit `timeout` on foreground test runs and forbids `run_in_background` for them. This is guidance, not enforcement: a backgrounded run still goes uncounted, it just no longer happens by default.
- **The phase gate blocked the writes Phase 0 requires.** Kimi's file tools accept relative paths (resolved against the workspace); Claude Code's always arrive absolute. The allowlist inherited from the Claude build matched substrings like `/specs/` against the raw string, so the ordinary relative form — `specs/domain/gtd.md`, no leading slash — fell through and was denied. Rule R4 *mandates* depositing domain material under `specs/` during Phase 0, so the gate was making its own phase impossible to complete and pushing the model to reroute the write through Bash. Paths are now normalized to a workspace-relative form before matching, so both shapes resolve identically; writes escaping the workspace are still refused. The denial message now also names the writable locations and tells the model not to reroute the same write through another tool. Covered by six new tests.
- **`state.json` recorded `agent: "claude"`.** The field identifies which extension owns the state — the sidebar uses it to decide whether a phase transition deserves a notification, so with the wrong value a state driven by Kimi would notify from the Claude build instead (and vice versa) whenever both are installed. Now written as `"kimi"`, with the union widened to `"copilot" | "claude" | "qwen" | "kimi"`.

### Added
- `test-outcome` also runs on **`PostToolUseFailure`**, an event Claude Code does not have — a failed test command is now recorded as a failure without having to infer it from the output text.

## [0.9.0] - 2026-07-14

### Changed
- **S6 loop detection now counts understanding, not commands.** The detector counted *executions* of a test command: 4 runs in a phase = blocked. But a blind loop runs the tests N times for the same unknown reason, while normal debugging runs them N times for N *named* reasons — and the old rule could not tell them apart, because it counted `Bash` calls rather than diagnoses. Worse, being a `PreToolUse` hook it could not see the result of a run, so it blocked the final **green** run — the one moment where running tests is most legitimate, and the one S4 (`NEVER assume tests passed — execute and verify`) explicitly requires. In practice S6 made S4 impossible to satisfy, and the only way out was to delegate the run to another agent, which is a bypass of zero cost and therefore no protection at all. The new rule:
  - Only a **FAILED** run accumulates. A passing run clears the counter — verification is never blockable.
  - **3 consecutive failures with no diagnosis recorded between them** block the next test run (`LOOP_FAILURE_THRESHOLD` in `rules/safeguards.ts`).
  - `record_decision(category='diagnosis' | 'bugfix' | 'root-cause')` clears the counter immediately. This is the escape hatch the block message always promised and never honored — nothing in the engine cleared the counter on a recorded decision.
  - Counting moved to a new `test-outcome` hook (`PostToolUse`/Bash), the only place a run's result is visible; `loop-detector` (`PreToolUse`) now only blocks. Ambiguous output records nothing: only positive evidence of failure counts, since a false "failed" causes a bogus block while a missed failure merely delays a legitimate one.
- **`normalizeCommandPattern` no longer collapses every JS test into one pattern.** `npm test`, `npx jest`, `npm test -- consent` and `npm test -- link` all normalized to `"test:js"`, so failures in four different suites compounded into a single counter — even though the S6 clause it implements speaks of iterations *on the same module*. The suite/target argument is now part of the pattern.

### Fixed
- **A blocked phase transition no longer reports an empty reason.** `validatePhaseTransition` vetoes a transition when any safeguard for the phase is `violated`, but `TransitionError` had no field for safeguard violations — they were computed and discarded, leaving `Cannot advance from Phase X to Phase Y.` with an empty `missingCriteria`. `TransitionError.safeguardViolations` added and surfaced through `advance_phase`.
- **Three hooks had never been deployed.** `deployServer` copied only 4 of the 7 bundles, while `settings.json` registered hooks pointing at `.versus/stop-verify.js`, `.versus/truncation-check.js` and `.versus/block-destructive.js` — files that were never written to any workspace. Those hooks have been silently dead since v0.5.0 (node could not find the file). The deploy list now covers every bundle referenced by `buildOrchestratorHooks()`.
- `resetLoopCounter()` was dead code (the reset was inlined in `advancePhase` and `startNewCycle`); it is now the single reset path.

### Notes
- Existing `.versus/state.json` files are compatible: `LoopCounter` gained an optional `lastDiagnosis` field and `count` changed meaning (failures, not executions). A stale count from an older version clears on the first passing run, the first recorded diagnosis, or the next phase change.

## [0.8.0] - 2026-05-02

### Added
- **Brownfield bootstrap mode in `init_project`.** Versus now supports projects in progress that need to grow under methodology — the most common real-world scenario. `init_project` accepts an optional `bootstrap_data` parameter with: `stack`, `patterns`, `constraints`, `apparent_use_cases`, `domain_vocabulary`, `module_map`. When present, the handler populates `projectSpec`, records AS-IS decisions in P0/P1 for traceability, and pre-populates `specs/technical/AS-IS-stack.md`, `specs/references/AS-IS-modules.md`, `specs/domain/AS-IS-vocabulary.md`. The init_project tool description carries the full BOOTSTRAP PROTOCOL the AI must follow before calling: (1) detect existing code via surface files, (2) read README + configs + dir structure (NOT implementations), (3) infer stack/modules/use-cases/vocabulary, (4) present Bootstrap Proposal in chat, (5) wait for user confirmation in single turn, (6) call init_project with bootstrap_data populated.
- **DELTA MODE in Phase 0** when bootstrap was applied. The first action of P0 is now MODE DETECTION: if get_decisions(phase=0) returns AS-IS decisions, P0 runs in delta mode — skips HSA Level 1 (Domain, already captured), focuses Levels 2-5 on the new change/feature, Capacity Check asks about modification capacity (not greenfield production), Out of Scope explicitly excludes "everything in the existing system not touched by this delta". Eliminates the failure mode where brownfield projects ran greenfield HSA and produced fictional context.
- **SessionStart hook updated** to point the LLM at the bootstrap protocol when get_phase_state returns "not initialized" and the workspace has existing code.

### Changed
- **`init_project` response includes `mode: "greenfield" | "brownfield"`** and a brownfield-specific instruction block when bootstrap_data was applied.

## [0.7.1] - 2026-05-02

### Added
- **Reverse LLM Switch on `start_new_cycle()`.** Closes the asymmetry: the methodology has a P4→P5 LLM Switch Point (Opus→Sonnet) but had no equivalent for the Pn→P0_v2 transition (when starting a new cycle). Users typically switched to a code-execution model in cycle 1 and never returned to the design-grade model — cycle 2 then started Phase 0 (design) on the wrong model. Now `start_new_cycle()` returns `_modelSwitchAction` with the same close+reopen+retomar Versus mechanic, and P7 Meta-iteration guidance instructs the LLM to display this notification when starting a new cycle.

## [0.7.0] - 2026-05-02

### Changed
- **Complete guidance now injected on every UserPromptSubmit (replaces compact-guidance).** The previous strategy curated a compact summary of full-guidance and injected only that. Audit revealed potential precision loss: the compact omits details from full (score weights table, HSA sub-areas, Tier 1/2/3 criteria, lens central questions, etc.) — the LLM operating only with compact for many turns could drift from the full methodology. The new strategy injects the entire full-guidance content (cross-cutting rules + antipatterns + all 8 phase blocks) on every UserPromptSubmit, guaranteeing the LLM has the complete methodology in context regardless of session length. Token cost is bounded by prompt caching (the content is static and cache-hit after first injection per session). Single source of truth: drift between compact and full is now structurally impossible.

### Removed
- **`compact-guidance.ts` deleted.** No longer used. The 8 compact-sync tests are replaced with 8 presence tests over the complete guidance text (assertPresent for critical terms in full-guidance.ts).

## [0.6.4] - 2026-05-02

### Changed
- **Model switch mechanic added to LLM Switch Point (P4→P5)**: previously the notification told the user "you can switch to a faster/cheaper model" without explaining how. Switching models mid-conversation in the same chat causes the new (smaller-context) model to attempt compaction of the previous session, which destroys the structured context Versus preserves via MCP. The notification now instructs the user to: (1) close the current chat, (2) open a new chat with the target model, (3) type `retomar Versus` so the SessionStart hook recovers state cleanly via MCP. The new model starts with fresh context but full methodology state.
- **P6 Step 0 (Session Renewal) clarified for model switching**: the "New session" option now mentions explicitly that this is also the right moment to switch models if desired (e.g., test execution does not need Opus capabilities), reinforcing the same close+reopen+retomar mechanic.

## [0.6.3] - 2026-05-02

### Added
- **Original Scope Adversarial Review** as a mandatory step at end of Phase 5, before the existing Scope Inventory. Forces the LLM to compare P0 commitments (Delivery Target, Success Criteria, Capacity Check inventory) against actual delivery, build a "Promise vs Delivered" table in adversarial mode (find every gap, no charity), and ask the user via AskUserQuestion how to proceed: (1) Continue Phase 5 to complete missing items, (2) Renegotiate scope via `record_decision(category='scope', content='SCOPE REVISION...')`, or (3) Accept gaps as known debt via `record_decision(category='constraint', content='ACCEPTED GAPS...')`. No default, no silent path. Eliminates silent scope deferral (AP10) by making every deferral explicit, recorded, and consented by the user.
- **3-layer ready-to-advance enforcement** for the failure pattern where the LLM marks all exit criteria met but stops with a phase-end summary instead of calling `advance_phase()`:
  - **Layer 1:** `mark_exit_criterion` returns `_nextAction` field with imperative language when the marked criterion completes the phase
  - **Layer 2:** `get_phase_state` returns `_nextAction` whenever state shows "all met but currentPhase unchanged" — catches the LLM on any context recovery
  - **Layer 3:** `inject-context` hook adds a `⚠️ READY TO ADVANCE` banner at the top of every UserPromptSubmit while in this state — three independent reminders in three different points

## [0.6.2] - 2026-05-02

### Changed
- **`ui_runnable` description shortened to "Smoke test: user runs P0 end-to-end"** for sidebar readability. The full rules (AP10, literal user confirmation in details, primary P0 use case) remain in `full-guidance.ts` and `compact-guidance.ts` where the LLM consumes them — sidebar is for human glance.

## [0.6.1] - 2026-05-01

### Added
- **A — Production Capacity Check in Phase 0** (mandatory when Delivery Target is "Complete product"). After Level 5, the LLM must DISPLAY an asset inventory table (authoring / visual / audio / data / integrations × quantity × production source) and ask the user via AskUserQuestion whether capacity to produce them exists. Capacity gap → reduce scope or record_decision(constraint, CAPACITY GAP). Closes the failure mode where P0 design score reaches 90+ while the actual production of content/assets has no plan ("Lágrima de Paladine" pattern).
- **B — AP10: Silent Scope Deferral** as a new antipattern. The inverse of AP9 (silent scope creep): marking an exit criterion as met=true while textually noting "will be done in next cycle / out of scope / pending content". The criterion is NOT met. Resolution: either reduce Delivery Target via record_decision OR return to the appropriate phase and complete before advancing. Textual prose is NOT acceptable substitute for met=false. Cross-referenced from P0 capacity check and P5 scope inventory.

### Changed
- **C — `ui_runnable` exit criterion now requires empirical user confirmation.** Description changed from "UI implemented and accessible" to "Human user has executed AT LEAST ONE Phase 0 use case end-to-end and confirmed it works". Without explicit user confirmation captured in the `details` field of mark_exit_criterion, the criterion stays pending. P5 Scope Inventory updated accordingly: it now requires the LLM to ask the user via AskUserQuestion to execute one P0 use case and report back, with literal confirmation stored as evidence. Eliminates the failure mode where placeholder UI passed ui_runnable through prose ressalva.

## [0.6.0] - 2026-04-30

### Added
- **P6 Step 0 — Session Renewal (RECOMMENDED).** Before testing, P6 now suggests the user start a fresh chat session via AskUserQuestion (options: "New session" / "Continue here"). Decouples implementer from tester to reduce confirmation bias — the LLM that wrote the code carries an implicit "of course it works" prior. Automated form of S4 (anti-validador). If user picks "New session", a SESSION RENEWAL decision is recorded and the LLM stops; user resumes in a fresh chat with `retomar Versus`.
- **P6 Step 2 — UI Testing Tooling proposal (only if P1 declared a UI module).** When a UI module exists, P6 detects the project stack and proposes 2-3 stack-appropriate browser/automation tools via AskUserQuestion (with a recommended option marked + "Other" for free choice). Stack→tools mapping: Web SPA → Playwright (rec) / Puppeteer / Cypress; React Native → Detox (rec) / Maestro; Electron → Playwright; CLI → bats / expect; Mobile → Maestro / Appium. The chosen tool is installed and a single smoke test of the primary user flow is implemented before regular spec-driven tests. The choice is recorded as a P6 decision and treated as the BINDING-CONSTRAINTS exception (additive, not a P1 violation).

### Changed
- **P6 step numbering.** Existing steps renumbered to fit new structure: Step 0 (renewal) → Step 1 (Spec-Driven Test Protocol) → Step 2 (UI Tooling) → Step 3 (Write and Execute) → Step 4 (Record Spec Coverage) → Step 5 (Manual Exploratory Testing). Compact guidance and tests updated accordingly.

## [0.5.5] - 2026-04-08

### Added
- **specs/README.md generated on init_project.** Contains: (1) a mini operation manual — "retomar Versus" anchor phrase and MCP discovery behavior, (2) description of each of the 9 subdirectories (domain, references, technical, examples, design, models, datasets, validation, competitors), (3) mapping of which subdirectory feeds which phase. Written idempotently (never overwrites user edits). Reduces onboarding friction — users no longer need to guess what goes in each folder.

## [0.5.4] - 2026-04-08

### Fixed
- **Prerequisites dialog button targets the right destination.** Previously, when Node.js was missing, the error dialog offered a single "Open Marketplace" button that searched the VSCode Marketplace — but Node.js is not a VSCode extension. Now the dialog shows context-aware buttons: "Download Node.js" opens https://nodejs.org/en/download in the browser, "Open Marketplace" opens the marketplace only when Claude Code is missing. If both are missing, both buttons appear.

## [0.5.3] - 2026-04-08

### Added
- **Visible methodology banner on session start/resume.** SessionStart hooks (both default and compact matcher) now instruct the LLM to START its first response with a one-line banner (e.g., "📍 Versus ativo — Fase X, iteração Y. Próximo passo: ..."). The user now sees when methodology context was loaded; previously the LLM could load state silently and the user wouldn't know.
- **"Retomar Versus" as user-facing anchor phrase.** The init_project message (both MCP and VSCode notification) now tells the user they can type "retomar Versus" in chat at any time to force the LLM to recover methodology context (get_phase_state + get_phase_guidance + get_decisions). Empirically validated as the phrase that reliably triggers context recovery across sessions.

## [0.5.2] - 2026-04-08

### Changed
- **P7 refocused on project-level review.** Removed "Methodology Self-Improvement" 5-step ceremony and "Double-loop evaluation of the PROCESS" — these only benefit the methodology maintainer (who has access to SKILL.md) and risk methodology degradation when applied by end users. P7 now has 3 steps: (1) update specs/ with actual results, (2) product evaluation via AskUserQuestion (does the software meet P0 requirements?), (3) capture 3-5 project-level lessons (domain insights, stack pitfalls, patterns, wrong P0/P1 assumptions) and deposit in specs/. Meta-iteration v1→v2 via `start_new_cycle()` is unchanged. Applied to full-guidance.ts, compact-guidance.ts, and the MUST DISPLAY artifacts list.

## [0.5.1] - 2026-04-07

### Fixed
- **MCP args type coercion (sanitizer).** All MCP tool arguments are now sanitized before dispatch: `phase`, `target_phase`, and `score` are coerced to number; `met` is coerced to boolean; array params (`stack`, `outOfScope`, `patterns`, `constraints`) accept both single strings and arrays. Prevents silent failures when an LLM sends `"2"` (string) instead of `2` (number) — strict equality comparisons in the engine would fail without coercion. Bug was latent with Claude (which sends correct types) but manifested with other models.

## [0.5.0] - 2026-04-06

### Added
- **`stop-verify` hook (Stop event).** Blocks task completion until the project compiles, lints, and passes tests. Auto-detects TypeScript (tsc), ESLint, Python (mypy/ruff), Rust (cargo), and test runners (npm test, pytest, cargo test). Prevents the LLM from declaring "Done!" with broken code. Fail-open if no toolchain is detected (warns instead of blocking). Infinite-loop protection via `stop_hook_active` flag.
- **`truncation-check` hook (PostToolUse: Grep|Bash).** Detects when Claude Code truncates tool output (>50K chars → 2KB preview) and injects a warning so the agent reads the full file or narrows its search scope. Also flags suspiciously low grep result counts.
- **`block-destructive` hook (PreToolUse: Bash).** Blocks destructive commands before execution: `rm -rf /`, `DROP TABLE`, `git push --force`, `.env` file reads. Denied operations can be run manually by the user in a separate terminal.

### Changed
- Hook count increased from 3 to 6 (inject-context, phase-gate, loop-detector + stop-verify, truncation-check, block-destructive).
- Bundle pipeline updated to compile all 7 entry points (6 hooks + MCP server).

## [0.4.3] - 2026-03-12

### Added
- **P5 exit criterion `ui_runnable` (required).** The engine now blocks advancing to Phase 6 unless the UI is explicitly marked as implemented and accessible for manual testing — or documented as N/A for backend-only projects. Fixes the pattern where the LLM implements the backend and skips the UI, leaving Phase 6 manual testing with nothing to test.

### Changed
- **P1 guidance: UI as explicit module.** Full and compact guidance now require that any project with a user interface list the UI as a named module in the decomposition (with its own interface contract), never as an implied extension of a backend module.
- **P5 Scope Inventory: item 3 — UI runnable check.** Added a third item to the mandatory scope inventory: verify the UI is implemented and navigable, with explicit `mark_exit_criteria()` instructions. Backend-only projects document N/A and mark the criterion as met.

## [0.4.2] - 2026-03-04

### Changed
- **AP1 reframed as GENERATION MODE.** Phase 2 antipattern AP1 updated from "ask for refutation, not validation" to explicit generation mode framing: "produce failure scenarios ('how does this fail?'), not quality judgments ('is this good?')". The distinction prevents confirmation bias — generative framing produces new content with no anchor, evaluative framing asks the AI to judge its own output. Applied to `full-guidance.ts`, `compact-guidance.ts`, and `SKILL.md` (v3.11).
- **P0 Step 0.5 — Delivery Target (SKILL.md v3.11).** Added mandatory first question before HSA: establish the delivery target (prototype/MVP/production) before starting the problem analysis. Previously, delivery target appeared only at Level 5, which was too late in the flow.

## [0.4.1] - 2026-03-04

### Fixed
- **Global MCP permissions on activation.** `ensureGlobalPermissions()` now runs on every extension activation and writes all MCP tool permissions to `~/.claude/settings.json` (global). Previously, permissions were only written to the workspace `.claude/settings.json` — on a fresh machine or new workspace before `init_project`, Claude Code would prompt for each MCP tool call. Global write ensures tools are pre-approved across all workspaces on the machine.
- **Log prefix `[Versus Lite]` corrected to `[Versus Claude]`** — leftover from the rename in v0.4.0.

## [0.4.0] - 2026-03-02

### Changed
- **Full codebase refactoring** based on adversarial analysis. All changes below are part of this release.

### Removed
- **`methodology.ts` deleted (zombie facade).** Pure re-export passthrough with one logic function (`validatePhaseTransition`) — moved to `engine.ts` as module-level function. Eliminates indirection layer.
- **`guidance.ts` deleted (773-line monolith).** Split into `full-guidance.ts` (MCP `get_phase_guidance` tool) and `compact-guidance.ts` (hook `inject-context`). Eliminates ~400 lines of mixed concerns in a single file.
- **`inject-context.ts`: removed TRANSITION RULE and "For detailed phase instructions" lines.** ~45 tokens/msg overhead eliminated. Transition rule was duplicating phase gate logic already enforced by `phase-gate.ts` hook.
- **`inject-context.ts`: removed `PHASE_NAMES` constant.** 10-line duplicate of `phases.ts` data — replaced with `getPhaseDefinition()` call.
- **`sidebar.ts`: removed 3s polling (`setInterval`).** Replaced with `FileSystemWatcher`-only approach. Eliminates unnecessary CPU/disk activity between state changes.
- **P2 compact: removed static `VALID LENS NAMES` block (~526 tokens/msg).** Replaced with dynamic injection of the model's own `ACTIVATED LENSES` decision from `state.decisions`. Fallback warning (~25 tokens) when Step 1 not yet executed. Prevents token waste on lenses not activated for the project.

### Fixed
- **`inject-context.ts`: fixed `(d: any)` filter callback.** TypeScript strict mode violation — removed explicit `any` annotation.
- **`server.ts`: corrected version string** from `"0.2.0"` to match package version.
- **`phase-gate.ts` + `loop-detector.ts`: added 5s stdin timeout (fail-open).** Hooks were hanging indefinitely if stdin closed unexpectedly. Timeout prevents blocking the agent.
- **`sidebar.ts`: added 300ms debounce on watcher.** A single `state.json` write could fire `onDidChange` multiple times, causing duplicate refresh calls and duplicate phase-transition notifications.
- **`sidebar.ts`: phase-transition notification text** updated to `"Versus Claude:"` prefix (was generic). Prevents confusion when multiple extensions are installed.
- **`specs/` directories created on `initProject`.** 9 subdirectories (`domain`, `references`, `technical`, `examples`, `design`, `models`, `datasets`, `validation`, `competitors`) were not being created — agent found empty workspace on Phase 0 start.
- **P5 compact: scope inventory auto-advance.** Changed `"YOUR NEXT TOOL CALL is advance_phase()"` to `"call advance_phase() IN THIS SAME TURN"` — model was stopping after displaying the inventory and waiting for user input before advancing.

### Added
- **`engine.ts`: `markExitCriteria()` batch method.** Accepts array of `{phase, criterion, met, details}` — saves once after all updates instead of N individual writes.
- **`inject-context.ts`: P2+P3 ACTIVATED LENSES pinning.** The `ACTIVATED LENSES` decision from Phase 2 is pinned in the sliding decision window for both P2 and P3 — prevents lens drift across P3 iterations when the decision falls out of the last-3 window.

## [0.3.33] - 2026-03-01

### Added
- **P5: Adversarial micro-check per module.** After each module, the agent must ask "Where does this implementation DIVERGE from spec?" — adversarial framing prevents AP1 self-validation bias. Divergences fixed before moving to next module (catches drift early, not at end).
- **P5: Scope inventory at exit gate (MUST DISPLAY).** Before `advance_phase()`, agent displays ✅/❌ for: (1) all P1 modules present in codebase, (2) all specs/validation requirements covered by at least one module. Presence/absence check only — quality is Phase 6's job. Both checks in compact and full `PHASE_5_GUIDANCE`. Regression tests added.

## [0.3.32] - 2026-03-01

### Fixed
- **P5: Inter-module stopping caused by text output ending the turn.** Root cause: S7 said "announce X/N completed" — writing text output ends the agent turn, requiring user input to continue. The instruction "YOUR NEXT TOOL CALL" was contradicted by the preceding text output. Fix: replaced announcement with explicit prohibition — NEVER write text between modules (`'X/N completed'`, `'I will now implement X'`, `'Next:'`). Progress visible from tool calls. Regression test: `assertContains(5, "text between modules")`.

## [0.3.31] - 2026-03-01

### Fixed
- **P2 compact: enumerate all 19 lens names.** Previously compact listed 7 universal lenses but not the 8 conditional lenses or 4 DTLs. The agent could not distinguish legitimate lenses (e.g., UI/UX, Observability/Operability) from invented ones. Added `VALID LENS NAMES` line enumerating all 8 conditionals (Resilience, UI/UX, Migration/Coexistence, Sustainability/Proportionality, Ethical/Human Impact, Process/Workflow, Governance/Accountability, Observability/Operability) and 4 DTLs (Control Engineering, Game Theory, Linguistics/Grammar, Mechanical Engineering). Regression tests updated.

## [0.3.30] - 2026-03-01

### Fixed
- **P2 compact: MODULE BOUNDARY guard.** Agent could apply lenses to modules not in P1 decomposition. Added instruction: apply lenses to ONLY modules defined in P1.
- **P2 compact: P1 negative scope items are OOB in P2.** `BOUNDARY` instruction now explicitly states: "P1 negative scope items CANNOT become implementation proposals."
- **P3 compact: ANTI-SCOPE-CREEP checklist with P1 negative scope guard.** 4-item checklist (MUST DISPLAY ✅/❌) including: P1 negative scope is still negative.
- **P6 compact: P3 scope merge.** `get_decisions(phase=3)` added to Step 1 scope recovery — P3 boundary revisions now included in P6 test scope.
- **P6 compact: BINDING CONSTRAINTS in test code.** P1-approved tech stack enforced in test frameworks and runtimes.
- Regression tests updated for P2, P3, P6. All 24 tests pass.

## [0.3.29] - 2026-03-01

### Fixed
- **P5 compact: BINDING CONSTRAINTS.** Agent was using unapproved frameworks even when P1 specified vanilla JS. Added `BINDING CONSTRAINTS` block in compact and full `PHASE_5_GUIDANCE`. Regression test added.
- **P5 compact: context recovery conditional.** Made `get_decisions()` + `check_specs_status()` conditional on new session — not mandatory overhead in continuous P0→P5 flows.

## [0.3.28] - 2026-03-01

### Fixed
- **P4 compact: LLM Switch duplicate.** Both compact P4 and full P4 guidance displayed LLM Switch notification — shown twice. Fixed: display only from full guidance (called once via `get_phase_guidance()`).
- **P4 compact: intentional pause exception.** P4→P5 pause is explicit — agent must NOT auto-call `get_phase_guidance()` after advancing; resumes only on user "continue".

## [0.3.27] - 2026-03-01

### Fixed
- **P2–P6 compact: FLOW instruction added to all phases.** Phases P1–P6 were stopping mid-phase after recording decisions. Added FLOW to every phase.
- **P1 compact: FLOW after architecture answers.** Prevents "I'll draft the architecture decomposition" + stop pattern.

## [0.3.22] - 2026-03-01

### Fixed
- **P2 compact: `invent` prohibition added.** Explicit constraint after universal lens enumeration preventing invention of lens names not in the methodology.

## [0.3.21] - 2026-03-01

### Fixed
- **AI Confident criterion: added explicit description.** Both `guidance.ts` (full guidance) and `SKILL.md` now show `AI Confident (can answer "why?" for every scope, assumption, and decision)` — previously the criterion was opaque with no explanation of what the AI evaluates. Replicated to Versus-Copilot v0.3.18.

## [0.3.20] - 2026-03-01

### Added
- **Compact guidance sync guard: content regression tests (P0-P7).** 8 new test cases in `engine.test.ts` assert key terms per phase. Replicated from Versus-Copilot v0.3.17.
- **Anchor comments in `getCompactGuidance()`.** Each `lines.push()` references its full guidance section.
- **Maintenance checklist in JSDoc of `getCompactGuidance()`.** 5-item checklist.

### Fixed
- **P0 compact: added get_phase_guidance() chain** after advance_phase() in AFTER SCORE (score ≥90 path).
- **P2 compact: added get_phase_guidance() chain** after advance_phase() in AFTER GATE.
- **P3 compact: added get_phase_guidance() chain** for 'More iterations' path after advance_phase() to P2.
- **P4 compact: normalized "LLM Switch Point"** wording (was "LLM SWITCH POINT" — inconsistent with test assertions).

## [0.3.19] - 2026-03-01

### Fixed
- **P2 compact guidance: enumerate the 7 universal lenses by name.** The AI was inventing lens names instead of applying the 7 mandatory universal lenses. Fixed by listing them explicitly: `(1)Assumptions (2)Architectural (3)Implementability (4)Scientific (5)Security (6)Performance (7)Regulatory`. Added `Do NOT invent lens names.` constraint. (Replicated from Versus-Copilot v0.3.15.)

## [0.3.14] - 2026-03-01

### Fixed
- Systematic inconsistency: `PHASE_4_GUIDANCE`, `PHASE_5_GUIDANCE`, and `PHASE_6_GUIDANCE` full constants had no "Next Step" section — no advance_phase(), no get_phase_guidance(). Only compact guidance had the transition instructions.
- `PHASE_3_GUIDANCE` Step 4: Phase 4 path had advance_phase() but no get_phase_guidance() — compact was ahead of full guidance.
- Same fixes applied to SKILL.md Phase 3, 4, 5, 6 sections.

### Changed
- `guidance.ts` PHASE_3_GUIDANCE: Step 4 "→ Phase 4" now includes get_phase_guidance() after advance_phase()
- `guidance.ts` PHASE_4_GUIDANCE: added "Next Step (MANDATORY when all items are ✅)" section
- `guidance.ts` PHASE_5_GUIDANCE: added "Next Step (MANDATORY when all modules are implemented)" section
- `guidance.ts` PHASE_6_GUIDANCE: added "Next Step (MANDATORY when all testing is complete)" section
- SKILL.md Phase 3, 4, 5, 6: same "Next Step" additions mirroring guidance.ts

## [0.3.13] - 2026-03-01

### Fixed
- P1→P2 inconsistency: `PHASE_1_GUIDANCE` full constant (returned by `get_phase_guidance()`) was missing the transition instruction added to compact guidance in v0.3.12. AI calling `get_phase_guidance()` in Phase 1 now receives the same "Next Step (MANDATORY)" instruction.

### Changed
- `guidance.ts` `PHASE_1_GUIDANCE`: added "Next Step (MANDATORY after user confirms architecture)" section after CAUTION AP3
- `SKILL.md` Phase 1: added "Next Step (MANDATORY after user confirms architecture)" section after Exit Criteria Phase 1

## [0.3.12] - 2026-03-01

### Fixed
- Global transition rule: after `advance_phase()` succeeds, AI now immediately calls `get_phase_guidance()` and begins the new phase's first step. Fixes the AI stopping silently after phase transitions (reported at P3→P4).

### Changed
- `inject-context.ts`: added global `TRANSITION RULE` line injected on every message
- `guidance.ts` P3 compact: `AFTER CONFIRMATION` now includes `get_phase_guidance()` after `advance_phase()`
- `guidance.ts` P1, P4, P5, P6 compact: added `WHEN DONE` / `WHEN ALL ✅` / `WHEN TESTING COMPLETE` transition instructions (phases that had no transition instruction at all)
- `SKILL.md`: added R6 (Phase transition) to Global Rules

## [0.3.11] - 2026-03-01

### Fixed
- **Phase 0**: When score < 90, AI now calls `start_iteration()` and continues HSA targeting lowest-scoring criteria. Previously the AI stopped after displaying the score.
- **Phase 2 → Phase 3**: Removed incorrect "Zero 🔴 to advance" blocker. Phase 3 exists to address criticals — advancement is always valid when findings exist. The 🔴 count informs what Phase 3 must do, not whether Phase 3 happens.
- **Phase 3 post-cycle**: AI now executes the agreed action after confirmation — `advance_phase()` for Phase 4, or `start_iteration()` + return to Phase 2 critique for more iterations. Previously the AI stopped after displaying the recommendation.

### Changed
- Compact guidance updated for P0, P2, P3 with explicit AFTER SCORE / AFTER GATE / AFTER CONFIRMATION instructions
- SKILL.md updated with same three fixes

## [0.3.10] - 2026-03-01

### Fixed
- Phase 2 Exit Gate: AI now proactively offers next step after displaying gate summary (advance to Phase 3 / iterate), instead of stopping silently and waiting for the user to ask what to do next.

### Changed
- `PHASE_2_GUIDANCE`: added "Next Step" section after Exit Gate with mandatory AskUserQuestion transition offer
- Compact guidance P2: added explicit "AFTER GATE" instruction and updated DON'T to include "stop silently after gate summary"
- `SKILL.md`: added "Next Step" section after Phase 2 Exit Gate

## [0.3.9] - 2026-02-28

### Added
- 4 Domain Transfer Lenses integrated into Phase 2 as additional conditional lenses (same activation mechanism, unified coverage matrix):
  - **Control Engineering** — detects systems that react to events but don't regulate state (oscillation, drift, runaway feedback). Signal: state synchronization, runtime configuration, feedback-driven systems.
  - **Game Theory** — detects architectures that assume cooperation but collapse under adversarial/strategic behavior. Signal: multiple independent actors, public API, marketplace or platform design.
  - **Linguistics / Grammar** — detects protocol ambiguity where two correct implementations produce incompatible behaviors. Signal: inter-component communication, protocol definitions, interface contracts between independent teams.
  - **Mechanical Engineering** — detects rigid coupling disguised as tolerance; failure from small deviations in dependencies, environment, or load. Signal: module maintenance, system evolution, long-lived systems with technical debt.
- Phase 2 conditional lens count updated from 8 to 12 in guidance header and SKILL.md
- `activated_lenses_recorded` exit criterion description updated to explicitly name all 4 DTLs

## [0.3.8] - 2026-02-28

### Changed
- Phase 2 exit criteria: added `activated_lenses_recorded` (required) — AI must call `record_decision(category='architecture')` declaring which conditional lenses were activated and why each non-activated lens was skipped, **before** starting the critique
- Strengthened `lenses_applied` description: "no lens skipped — absence of findings is a valid result"
- Strengthened `coverage_matrix` description: "all applied lenses as columns"
- P2 compact guidance now has explicit Step 1 (record activation) before Step 2 (apply lenses)
- SKILL.md Phase Guardrails P2: updated DO to "Record activated/non-activated lenses first"

## [0.3.7] - 2026-02-27

### Removed
- HLI (Human Lead Index) metric — removed entirely. The metric measured AI bookkeeping (decision recording, safeguard checks) rather than actual human engagement. The methodology's structural mechanisms (phase gates, exit criteria, safeguards, DO/DON'T guardrails) already prevent vibe-coding by design, making a numeric overlay redundant and misleading.
  - Removed: `PhaseHLI`, `HLIAlert`, `HLIData` types, `metrics/hli.ts`, HLI calculation in `advancePhase()`, sidebar HLI section, context hook HLI injection, MCP tool HLI responses, SKILL.md HLI documentation

## [0.3.6] - 2026-02-27

### Added
- Exit criteria progress in sidebar — shows "[3/8] Exit Criteria" with per-criterion status (met/required/optional), expanded by default
- Phase DO/DON'T guardrails in compact guidance — each phase has explicit boundaries injected into AI context (e.g., P5: "DON'T: Run the application or tests — that is Phase 6")
- Phase hint in sidebar — userHint child item under phase (e.g., "Implement code. Testing happens in Phase 6.") with tooltip
- VS Code notification on phase transition — `showInformationMessage()` with phase name and hint
- HLI explanation tooltip — hover explains the metric, scoring, and how to improve
- Phase Guardrails section in SKILL.md documenting DO/DON'T per phase

### Changed
- All exit criterion IDs translated from Portuguese to English (e.g., `usuario_confirmou` → `user_confirmed`, `viabilidade_tech` → `tech_feasibility`)
- Auto-migration of old Portuguese IDs on state load — existing projects seamlessly upgraded
- Sidebar now imports phase definitions from `phases.ts` instead of hardcoded `PHASE_NAMES` map

## [0.3.5] - 2026-02-27

### Added
- HLI (Human Lead Index) — anti-vibe-coding metric (0-10) calculated at each phase transition measuring human leadership via criteria ratio (30%), decision density (30%), and phase-specific indicator (40%)
- HLI sidebar display with per-phase breakdown, drop alerts (>2 points), context hook injection, and MCP tool response integration

## [0.3.4] - 2026-02-27

### Changed
- Version bump and rebuild to sync with Copilot extension versioning

## [0.3.3] - 2026-02-27

### Changed
- Stability release — version bump only (no code changes)

## [0.3.2] - 2026-02-27

### Added
- Phase 6: Spec-Driven Test Protocol — tests against specs not implementation, Test Map with mandatory display, negative tests (1:2 ratio), false coverage detection, spec coverage report as traceable decision
- Phase 6: Multi-session testing protocol with structured record_decision(category='testing') for cross-session continuity
- LLM Compatibility section in READMEs (Opus S / Sonnet A / Haiku C tiers)

### Changed
- Phase 3: AI computes structural change % and criticals, presents recommendation, user confirms (instead of asking user to choose percentage range)
- Phase 5: Autonomous sequential implementation (S7 reinforced)
- SKILL.md synced with guidance.ts (R3 removed, Phase 3/5/6 updated)
- Publisher ID to JasmineMoreira, URLs to public Versus repo

## [0.3.1] - 2026-02-26

### Added
- New `start_new_cycle` MCP tool: resets to Phase 0 preserving decisions, projectSpec, history, and specs/
- Phase 7 engine hints (_phase7Action) in get_phase_state and mark_exit_criterion to enforce meta-iteration offer
- Delivery Target question in Phase 0 Level 5 conditioning Phase 1 Progressive Scope
- R5 (Mandatory Display) rule with MUST DISPLAY markers across all phases

### Changed
- R3 removed, S7 reinforced for autonomous Phase 5 implementation
- Auto-approved permissions: MCP tools + Read/Write/Edit/Glob/Grep/Bash/WebFetch/WebSearch/NotebookEdit
- READMEs: corrected Quick Start (palette → new conversation → start), added Node.js requirement
- package.json: node >= 18.0.0 engine requirement

## [0.3.0] - 2026-02-25

### Added
- HSA (Hierarchical Semantic Analysis) 5-level structure to Phase 0
- Multi-session testing and Phase 6 testing recovery in SessionStart hooks

### Changed
- Fix all hook/MCP paths from IACDM_Claude to Versus_Claude
- Strengthen SessionStart and compact hooks with imperative STOP prompts
- Force-replace hook merge strategy in ensureSettings (no stale duplicates)
- guidance R2: Add 'ALWAYS provide suggested options' clause
- guidance R4: Fix 'Popular' typo to 'Populate'

## [0.2.0] - 2026-02-24

### Added
- 8 conditional adversarial lenses for Phase 2 (Resilience, UI/UX, Migration, Sustainability, Ethical, Process, Governance, Observability)
- Disambiguated command titles with "Versus Claude:" prefix
- Comprehensive README with architecture documentation
- 3 Claude Code hooks: inject-context, phase-gate, loop-detector

### Changed
- Renamed from IACDM to Versus across all source files and configs
- Renamed source directory from `iacdm-claude` to `versus-claude`
- Full Portuguese-to-English translation of all source, docs, and config files

## [0.1.0] - 2026-02-18

### Added
- Initial release as IACDM Claude
- MCP server with 15 tools for methodology orchestration
- 8 sequential phases with verifiable exit criteria
- 8 safeguards (S0-S7) preventing common AI agent errors
- Convergence score (0-100) with weighted breakdown
- Persistent decision registry surviving context switches
- Gateway guard for smaller model detection
- VS Code sidebar (TreeView) showing methodology state
- Claude Code hooks: context injection, edit blocking in early phases, loop detection
- Project initialization with `state.json`, `specs/`, and config generation
