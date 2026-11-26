# Changelog

## [0.13.0] - 2026-11-26

Port of Versus Claude 0.18.0–0.19.0 (`99a041d`, `26fa5ea`, `b01d104`, `2300ad9`). The Claude CHANGELOG carries the evidence for each item. As the port document asks, the host was **measured first** and no number was carried over from Claude.

### The Kimi host, measured (Kimi Code 0.9.0, agent-core-v2; CLI 0.34.0)
Sources: the engine bundled in the Kimi Code extension (`dist/extension.js`, `features/externalHooks`, `tool/toolContract`) and the transcripts in `~/.kimi-code/sessions/*/agents/*/wire.jsonl`.

| Channel | Contract in the code | What the transcripts show |
|---|---|---|
| UserPromptSubmit | plain stdout appended **whole** as `<hook_result hook_event="UserPromptSubmit">`, **no cap**. A JSON stdout is parsed against the schema, and one with no `message` contributes nothing | 0.11.0/0.12.0 injections of **54,609–69,002 chars arrived to their last line** (35 injections, 11 sessions) |
| MCP tool result | inline up to **50,000 chars** (`DEFAULT_TOOL_RESULT_MAX_CHARS`). Above that it goes to a file plus a pointer, and lines are cut at 2,000. No per-tool override | `get_phase_guidance` **17,113** and `get_phase_state` **7,594** inline. **0 spills** in 113 Versus results |
| Hook JSON | only `message`, `hookSpecificOutput.message`, `permissionDecision` and `permissionDecisionReason` are read. **No `additionalContext`, no `systemMessage`, no `decision:block`.** Exit 2 blocks with stderr | `[Versus] Blocked: …` refusals in tool results |
| PostToolUse / PostToolUseFailure | fire-and-forget, output discarded. `tool_output` is capped at 2,000 chars | — (already handled by the notices queue) |
| Stop | only a block's reason is used: the model continues once per turn | — |
| **SessionStart / PreCompact** | awaited and **discarded**: their output reaches neither the model nor the user | — |
| Plugin `systemPrompt` | rebuilt on every request, max 32,768 bytes | present in every session |

**So Kimi never had Claude's critical defect.** The guidance did reach the model. The 0.11.0 premise was wrong in the other direction: its ~5,691-char "paging limit" was the VS Code chat host's (LocalQwen) and never applied here. Kimi inlines up to 50,000.

### Changed (A1): the injection carries state, and the guidance comes from `get_phase_guidance`
Delivered whole is not the same as cheap. Each injection **stays in the context**, so the methodology (~55–70K) was repeated once per user message, and every decision of every cycle went in full on top of it. Now:
- **`inject-context` carries state only** (`hooks/state-block.ts`), with the must-see lines first:
  - phase/iteration/cycle/version;
  - the update notice;
  - READY with `advance_phase(target_phase=N)`;
  - the RESTRICTION line;
  - S6;
  - the per-iteration P2 lens warning (Kimi's, kept);
  - the **queued notices**, which are still the only way back for the PostToolUse and Stop hooks;
  - the pointer to `get_phase_guidance()`.

  After those come the spec (lists capped at 600) and **this cycle's** decisions, newest first, shortened to 280. The 9,000 budget is a context-cost choice, not a host limit.
- **`get_phase_guidance` returns the text again**, undoing 0.11.0: the global rules, triggers and anti-patterns, plus the phase section. That is 10.2K–21.4K per phase, against the 50,000 limit, and a test asserts it for every phase.
- **The session primer** (plugin `systemPrompt`) used to say "the methodology rules are injected with each user message". It now says that the text comes only from `get_phase_guidance()`, at session start, after each `advance_phase` and after a compaction.
- **`get_phase_state` keeps its 0.11.0 budgets** (lean snapshot). The comments and notes that cited the 5.7K limit or "the complete spec is injected" were corrected.

### Not applicable (A2, A3)
- **SessionStart and PreCompact are not registered.** Kimi discards both outputs, so a hook there would be a no-op. Session-start and post-compaction recovery rely on the primer (on every request) and on the pointer in the per-message state block.
- **No mechanical banner.** Kimi's hook contract has no channel to the user (`systemMessage` does not exist there). The version is visible in the state header (`| v0.13.0`), in the plugin's `VERSION` and in `.versus/kimi/VERSION`.
- **A3 needed no shape changes:** `test-outcome`, `truncation-check` and `stop-verify` already queued their messages instead of printing to a channel Kimi discards. What changed is `kimi/hook-io.ts`:
  - output is written **synchronously and in full** before `exit()`. An exit right after `write()` drops what has not drained from a pipe (cut at 64 KB in Claude). A write callback was not an option, because the helpers are `never` and callers rely on nothing after them running;
  - the Kimi contract is documented next to `deny()`/`emit()`.

### Added (B, C, D: same engine as Claude, applied by 3-way merge)
- **Cycles archived** in `cycles[]`, with the numbering fixed and an export to `.versus/cycles/cycle-N.md` both at the close and at the Phase 7 approval. New tool: `export_cycle`.
- **Approvals** with `approvedBy` at 3→4, 4→5, 6→7 and the cycle close. They are ordered by `decisionsAt`, not the clock. Decisions also take `proposedBy`.
- **A run outside the project does not count:** `cwd`/`runDir`/`outsideWorkspace` are recorded. **Kimi:** the Bash tool takes its own `cwd` argument, and it is honoured, resolved against the session directory, both here and in `phase-gate` for relative redirect targets.
- **Fingerprint** of `architecture.md` on every transition.
- **Version:** `src/version.ts`, `versusVersion`, the update notice, `migrations[]`, and the version in the header.
- **`update_project_spec`** returns `{added, counts}`.
- **S6 pattern** comes from the structural reader.
- **Deploy (B8):**
  - a missing bundle is now a visible error (it used to be skipped in silence);
  - `VERSION` is written to the plugin root **and to `.versus/kimi/VERSION`**, not `.versus/VERSION`: `.versus/` is shared with the sibling builds and Claude writes its own there;
  - an `onDidChange` listener offers Reload Window. In Kimi it fires in every window, because the hooks are machine-scoped.
- **Gates of 0.19.0:**
  - declared checks (`check_command`/`check_expect`), witnessed by the hook in **any** phase. **Kimi:** the hook sees at most the first 2,000 chars of `tool_output`, so an `output:` expectation is matched against that, and a `VERSUS_EXIT=` echo is read only if it fits;
  - 6→7: the `T-xx` ids of the current version are found in test files, and the version has a `## Desvios` section;
  - 5→6: a `scope-inventory` decision;
  - `start_new_cycle`: every lesson carries a `guard:` line.
- **Guidance (C6):** the new texts are in. In two conflicts the Kimi text was kept and only the 0.19.0 edits were applied: the lens rationale and the guard rule. The severity rationale was rewritten to the product reason (Phase 6 traces every 🔴).
- **D: research instrumentation removed.** Spec entries are plain strings again (both forms are still read), and model-facing texts give the product reason.

### Tests
**178** (+36). Fixtures gained `approve()`, the scope inventory, `## Desvios` and `guard:`. The delivery-channel block was **rewritten for Kimi's contract**: registered events must be ones whose output Kimi uses, bundled and in `HOOK_BUNDLES`; JSON keys must be in Kimi's schema; UserPromptSubmit must be plain text; PostToolUse/Stop warnings must be queued, not printed; the primer stays under 32 KB. These tests run the **bundles**: `npm test` now bundles first (`pretest`). Unlike Claude's, `out/hooks/` held no stale build.

### Delivery audit
**`scripts/audit-delivery.mjs <project>`**, written for Kimi's `wire.jsonl`, reports per session:
- the primer;
- the injections (size, version, full guidance or not);
- the `get_phase_guidance` calls and the notices;
- the MCP results inline vs spilled;
- the gate texts the model saw.

It exits 2 on a failed channel. Run it after each Kimi Code update and before each release. Kimi does not log hook stdout, so only the delivered side can be audited.

### Verification
- `npm test`: 178/178.
- A real `kimi -p` (CLI 0.34.0) in a Phase 2 project ran the new plugin. The audit shows the primer, and an injection of 615 chars with `| v0.13.0` reaching the context. **The model call failed on the CLI's credentials** ("authorization grant is invalid"), so `get_phase_guidance` and a refused gate in a live session still need checking in a new VS Code session.

## [0.12.0] - 2026-11-25

Port of Versus Claude 0.17.0: seven defects found by the first external study of Versus (ESJUD, Zenodo 10.5281/zenodo.22664296), which ran Versus Claude 0.16.4 through all eight phases on macOS/Xcode. Every one of them was also present here; the Claude 0.17.0 CHANGELOG carries the evidence for each.

### Fixed
- **Text that only MENTIONS a test command no longer counts as a run.** `isTestCommand` ran its regexes over the whole command, so `cat >> GATES.md <<EOF … npm test … EOF` was recorded as an `unknown` run and overwrote a green `lastTestOutcome`. In the study this broke `advance_phase(7)`. A `grep VERSUS_TEST_EXIT LOG.md` would have forged a **pass**. The new `hooks/shell-parse.ts` (shared with Claude, unchanged) reads the command structurally: it drops heredoc bodies, tokenizes with quotes in mind, and anchors the runner at the start of a simple command. `test-outcome` (on both `PostToolUse` and `PostToolUseFailure`) and `loop-detector` use it, with the command still read through `toolCommand()` and the workspace through `resolveWorkspace()`.
- **Runners outside the npm world are recognized.** `xcodebuild … test`, `swift test`, `gradle`/`gradlew`, `mvn`/`mvnw`, `dotnet test`, `flutter`/`dart test`, `make test|check`, `ctest`, `rspec`, `phpunit`, `mix test`, `tox`, `uv`/`poetry run pytest`, and others. Without this, S6 was blind on Xcode. A project can add its own regexes, one per line, to `.versus/test-commands`. The Phase 6 guidance and the I.3 refusal now say so.
- **`stop-verify` no longer reports a timeout as a failure.** A check that overran its 60 s used to block with "TESTS FAILED" and no error line; the study's Xcode suite takes 120–185 s. Timeouts are now listed as *not verified*, and the whole run has a 110 s budget. **Kimi's Stop hook timeout is 120 s** (`buildPluginManifest`), the same as Claude's harness, so the 110 s budget carries over unchanged. A timeout-only result is queued as a notice, because Kimi discards non-blocking Stop output.
- **`phase-gate` covers the shell.** Writes through Bash (`cat > src/App.swift <<EOF`, `tee`, `sed -i`/`perl -i`, the `cp`/`mv`/`install` destination) used to pass in Phases 0–4. The study adopted this as standard practice (D0002). They are now checked against the same rules as Write/Edit. The matcher is `Write|Edit|EnterPlanMode|Bash`: Kimi Code 0.9.0 has no MultiEdit or NotebookEdit tool, so unlike Claude nothing else is added. Relative paths resolve against the payload's `cwd`.
- **`phase-gate` blocks less.** Documentation and data files (`.md .markdown .txt .csv .tsv .rst .adoc .log`) are writable anywhere. The study had its `research/` log blocked. This also lifts the 0.1.0 rule that refused a root-level `.md` as "ad-hoc". The denial message still points domain material at `specs/`.
- **`mark_exit_criterion` only accepts the current phase.** The study marked Phase 3 criteria while Versus was still in Phase 2, and gates G2 and G3 landed in the same second. The check lives in the handler, so the engine method stays unrestricted for the tests.
- **Phase 4 checks S1–S5**, matching its "Safeguards S1-S5 met" criterion. S1, S3 and S5 now apply in Phase 4, and S1 and S5 return a Phase 4 review warning.
- **`advance_phase` without `target_phase`** returns an error naming the current phase and the next one (and the 2↔3 loop from Phase 3), instead of "Phase undefined". It is deliberately not defaulted. The `_nextAction`, `readyToAdvanceHint` and seven guidance calls now spell `advance_phase(target_phase=N)`. `nextStep` points at the injected `## Phase N` section, because `get_phase_guidance` has been a pointer since 0.11.0.
- **S6 is `ok` at 0 undiagnosed failures** and `warning` only once they accumulate. **S7 is behavioral** and always `ok`. Both used to sit permanently on `warning` all through Phases 5–6.

### Changed — Kimi-specific decision
- **Writing outside the workspace is now allowed in Phases 0–4.** 0.11.0 refused it deliberately ("not ours to bless"). Claude 0.17.0 allows it, because the study had the session scratchpad blocked. Kimi now follows Claude: a file outside the project is not the project's code, so it is not the gate's concern. The other Kimi-specific rules are kept: `.env` stays out of the allowlist, `.kimi-code/` and `.vscode/` stay allowed, `agents.md` stays among the basenames, and `EnterPlanMode` is still refused.

### Notes
- The MCP server's reported version was stuck at `0.1.0` and now reads `0.12.0`.
- 142 tests (+11 ported from Claude's `External-study fixes (ESJUD)` block, adapted to Kimi's `path` argument and its outside-workspace policy). Two existing gate tests were updated to the new policy: a root `.md` and a path outside the workspace are now allowed.
- Verified end to end against the bundled hooks with Kimi-shaped payloads. A heredoc after a green run leaves `pass`. `xcodebuild test` with `VERSUS_TEST_EXIT=65` gives `fail`. A shell `cat > src/App.swift` in Phase 2 is denied, while `research/LOG.md` is allowed and `src/specs/Impl.swift` is denied. `"test": "sleep 75"` produces a timeout notice and does not block.
- Out of scope, as in Claude: an evidence gate for the Phase 5 Scope Inventory remains an open decision.

## [0.11.0] - 2026-09-03

### Fixed
- **The read tools no longer page to disk.** A tool result over ~5,691 chars is written to a file by the host instead of being returned inline. `get_phase_state` is the gateway guard — the model is instructed to call it before anything else — so when it spilled, the model proceeded without ever having seen the state.

  Measured against real `state.json` files on this machine before changing anything, because which field dominates varies by project:

  | handler | antes (pior caso) | agora |
  |---|---|---|
  | `get_decisions` | 601 KB — 106× | 5.1 KB |
  | `get_phase_state` | 50.9 KB — 8.9× | 5.1 KB |
  | `get_phase_guidance` | 17.3 KB — 3.0× | 0.3 KB |

  `get_exit_criteria`, `check_all_safeguards` and `check_specs_status` were already inline and are unchanged.

- **`get_phase_state` budgets its three heavy fields.** `projectSpec` keeps the newest entries per list, counted independently so a 200-entry stack cannot evict the constraints, and entries are normalized to plain strings (the `{value, phase, at}` stamp is analysis metadata the model never reads). Entries are never truncated — each is a distinct commitment, and half a constraint is worse than a counted omission. `recentDecisions` shortens long content before dropping a decision whole. `lastTestOutcome.command` is capped, which is what a 2 KB heredoc costs. Both omissions are stated in `_specNote` / `_decisionsNote`, pointing at `get_decisions(phase?)`.

- **A final ceiling backs the per-field budgets.** Those bound counts, not characters: a project with six very long constraints still measured 5,623 chars — 68 below the limit, which is luck rather than a fix, and a "ready to advance" hint alone adds ~350. The result is now trimmed oldest-first until it fits, decisions before spec entries, and **the hints are never dropped** — an instruction the model must act on outranks the context it acts with. Swept 85 projects: worst case 5,113, zero spills.

- **`get_decisions` is budgeted too**, since `get_phase_state` points at it — pointing at a bigger leak fixes nothing. A single decision larger than the whole budget is truncated rather than spilled.

### Changed
- **`get_phase_guidance` returns a pointer, not the text.** The complete methodology is injected before every message by `inject-context`, so repeating the phase section inline was pure redundancy that happened to be 3× the paging limit. It now names the section to read (`guidancePointer`); the `guidance` field is gone, and the tool description says so. Side effect: the MCP server bundle no longer pulls in `full-guidance.ts` and dropped 65 KB.

### Notes
- Evidence this was happening in practice: of 60 paged session-resource files sampled on this machine, 57 were `get_phase_guidance` results and 3 were `get_phase_state`.
- Display and transport only. No gate, no measurement and no engine logic changed, so nothing already run is invalidated.

## [0.10.3] - 2026-08-13

### Fixed
- **The safeguard panel showed a frozen portrait: S6 could be blocking test runs with every light green.** `state.safeguards[].status` starts `"ok"` and is only rewritten when the agent calls `check_all_safeguards` — which the guidance fires once, in Phase 4. `advance_phase` validates safeguards to decide a block but never persists the outcome, and neither does `recordTestOutcome` nor the loop detector. So the sidebar and `get_phase_state` were reading a field almost nothing writes.

  Both now derive the status on READ, via `validateSafeguard`. Enforcement was always real — this only makes the display agree with it. Display only: no gate, no engine, no hook changed.

### Notes
- By design only S0 and S6 can reach `violated`; S1/S5/S7 are warnings and S2/S3/S4 are behavioral (always `ok`). A mostly-green panel is legitimate — the fix is that the two which can go red now do so when they are red. In Phase 5, S7 always reads as a warning; that is the reminder it was written to be, not a new alarm.

## [0.10.2] - 2026-08-13

### Fixed
- **The cross-module gate lost the row after any row that declared a dependency.** `tableColumn2` ran one global regex over the whole file, and nothing in `\|\s*(?:M-\d+)\s*\|\s*([^|]+?)\s*\|` stops it crossing a newline: on a row whose `depends-on` cell is itself an id, it matched `| M-01 |\n|` and consumed the pipe that OPENS the next row — so that row was never recognized. The module vanished from the extracted set and `advance_phase(2→3)` refused it as drift, naming a module plainly present in the table.

  The symptom was selective, which is what made it undiagnosable from outside: the first row is safe, a row after `—` is safe, and only the row following a declared dependency disappears. No edit to `architecture.md` could fix it, because the file was never the problem.

  Fixed by matching per line, anchored (`^`, no `g` flag). A markdown table row does not span a newline, so nothing legitimate is lost and no match can walk over the row below.

- **`countArtifactRows` had the same exposure** and is now counted per line, as its name and docstring already said. A row whose `depends-on` repeats an id used to score twice.

### Notes
- Swept all 105 `architecture.md` / `coverage-matrix.md` on this machine with both readings. Three diverged: RestaUm (lost `game` — the reported case) and two copies of T27-despesas, where the old regex spliced a whole paragraph of prose into the module set. **No coverage matrix diverged**, so the silent direction of this bug — a finding's module dropped from the matrix set, letting real drift through — did not occur in the corpus.

## [0.10.1] - 2026-08-13

### Fixed
- **A test run is classified by its exit status, not by the language its runner prints in.** The marker regexes are English-only, so a suite reporting "67 aprovados, 3 falharam" was unclassifiable — and 0.10.0 leaned on them wherever no harness signal was available. The sanctioned invocation is now `<your test command>; echo "VERSUS_TEST_EXIT=$?"`: `$?` is expanded by the shell, not written by the agent or the reporter, so it reads the same in any language or output format. The markers remain only as a last resort and are deliberately **not** being extended per language — that is bailing water.

  The guidance also states, and the refusal message repeats: **do not modify the test runner to satisfy the hook.** Append the echo to the command instead. A real run in another build shows exactly this failure mode — the agent rewriting its runner to print English markers.

- **The echo outranks Kimi's event-name signal, inverting the order the other builds use — and it has to.** Kimi's harness signal is live here (`PostToolUse` vs `PostToolUseFailure`), but it reports the status of the *compound* command. Once the echo is appended, `npm test; echo "VERSUS_TEST_EXIT=$?"` exits 0 however red the suite is, because the shell returns the status of the last command. Trusting the event name first would have read every failing suite as a pass, precisely in the invocation the new guidance prescribes. The echo carries the test command's own status, so it wins; the event name is consulted only when no echo is present. A test locks this order.

### Changed
- **`nominal` now means the exit status was actually observed** (echo or harness) **and was 0** — not inferred from output markers. Provenance records `exitSource: "harness" | "echo"`, so a post-mortem can tell which path verified the gate.

- A run killed, backgrounded or aborted still records `unknown`, and the notice now teaches the echo form. The echo cannot contradict it: `cmd; echo` only prints once `cmd` has finished, so a killed run leaves no token behind.

## [0.10.0] - 2026-08-12

Post-batch lot (v0.15 → v0.16.2 of the reference build), adapted to Kimi.

### Added
- **A test run now has three outcomes, not two: `pass`, `fail` and `unknown`.** An unreadable run — killed by timeout, moved to the background, aborted — used to be indistinguishable from a red one. It is now recorded as `unknown`: it does **not** satisfy `tests_passing`, does **not** count toward S6, but **does** overwrite a stale `fail`, so a project cannot sit frozen on an outcome nobody produced.

- **The outcome is classified from the harness, not from the reporter's prose.** Kimi carries no `exit_code` in the hook payload, but it carries the equivalent: the Bash tool answers `ok` on exit 0 and `error` otherwise, and the runtime turns that into the event name — `PostToolUse` for a clean exit, `PostToolUseFailure` (with `Command failed with exit code: N`) for anything else. That signal is authoritative; the marker regexes are now only the fallback. A green suite whose reporter phrases its summary unusually is no longer read as red.

- **Provenance on every recorded run** (`source`, `toolUseId`, `sessionId`, `outputSha256`, `outputBytes`, `exitCode`). It does not prevent a forged pass — it makes one legible in a post-mortem, which is exactly what a bypassed gate leaves no trace of otherwise.

- **Exit criteria record HOW they were verified (`verifiedBy`), not only that they were.** A pass confirmed by the harness is `nominal`; one inferred from markers alone is stamped non-nominal with the reason.

- **`specs/validation/critical-coverage.md` BLOCKS 6→7 when the matrix has 🔴 findings.** One row per critical id — the test that catches its regression, or the stated reason there is none. The refusal names the missing id. In the batch, a critical said to be erased in Phase 3 came back in the code and was found only by luck.

- **`specs/validation/premise-coverage.md` BLOCKS 6→7 when the architecture NUMBERS its premises.** One row per premise — the test that would fail if it stopped holding. Prose premises do not trigger the gate (premise ids are not a universal convention), and Phase 1 now asks for numbered premises precisely so Phase 6 can protect them.

- **Guidance:** Phase 1 requires each `## V(N)` module table written COMPLETE, not as a delta (a partial table is indistinguishable, in the text, from one that deleted the rest). Phase 6 gains detection power (a green suite that *cannot* fail on the defect is not protection), the four practices that paid off in the batch, and the rule that a test fix must name the SCENARIO, not just the assertion.

- **Nine new conditional-lens triggers.**

### Kimi-specific
- The `unknown` outcome carries an explicit instruction to re-run in the foreground with a `timeout` — under Kimi a backgrounded run is never witnessed, so the gate would otherwise stay shut with no visible cause. Delivered through the deferred-notice channel, since Kimi discards PostToolUse output.

## [0.9.2] - 2026-08-09

### Added
- **The `severity` column of every finding is validated at the 2→3 gate.** Same family as the lens-column gate, and the same failure mode behind the last three discards: an instruction in the guidance with no latch in the gate. The guidance fixes three levels (🔴/🟡/🟢) and nothing checked the column — while the analysis counts criticals against important on exactly that column, so a word, a code like `P1` or an empty cell became a silently wrong count.

  Tolerant of decoration, strict on the signal: `🔴 Critical` and a bare `🔴` both pass; `high`, `P1`, an empty cell (no glyph) and `🔴🟡` (two glyphs, ambiguous) all block, naming the row. Form only — whether a finding deserves its severity stays human judgment.

  Safe by evidence, checked before implementing: the 899 findings across the 11 coverage matrices on this machine use exactly the three glyphs, zero variation, so no existing project is blocked.

### Not added, and why
The same audit found a second candidate — requiring a duplicate finding's description to stand on its own. It is deliberately **not** a gate: the quality part ("describes it well") is the oracle and unmechanizable, and the mechanizable shapes (pointer-only description, dangling `duplica:`) occur zero times in the corpus. A latch there would guard nothing and only risk false blocks. Declared as a protocol limitation instead of code — the same decision taken in the reference build.

106 tests, exit 0. Verified end to end with one isolated project per case: textual, empty and two-glyph block; bare glyph and decorated glyph advance.

## [0.9.1] - 2026-08-09

Housekeeping. **Non-behavioural**: the injected guidance comes out byte-for-byte identical and no gate changed — verified by dumping `getCompleteGuidance()` before and after and diffing.

### Changed
- **`lenses.ts` is the single source for the lens definitions.** The central question, failure class and trigger of each lens lived as hand-written markdown inside the Phase 2 guidance — a second copy of names `lenses.ts` already owned, and exactly where a trigger edit like 0.7.0's three could have drifted a name away from what the gate validates. Each lens is now a `LensDef` (`name`, `question`, `failureClass`, `trigger?`), the two guidance tables are rendered from those defs, and `UNIVERSAL_LENSES`/`CONDITIONAL_LENSES` — what the tool enum and the column gate compare against — are derived from the same list instead of being typed out again.

  Before touching anything, all 19 definitions in the reference were compared field by field against this build's markdown: 19 of 19 identical, which is what made the move safe. A regression test now asserts the rendered table still carries every name and the three revised triggers.

- **The Portuguese→English criterion-id migration is retired.** The shim rewrote criterion ids on `load()` for projects created before the v0.3.6 rename, with a defensive mirror in the sidebar. Removed from `engine.ts` (import, `load()` call, method), `phases.ts` (the map) and `sidebar.ts` (import and three lookup predicates).

  Removed on evidence, per the patch's instruction not to do it blind: a sweep of every live `.versus/state.json` on this machine found six projects still carrying Portuguese ids, all under `INDT/lixo/jogos/`, none of them a Kimi project — the only one with `agent: "kimi"` sits in the same trash folder and has none. A pre-rename project reopened after this shows its criteria as unmet; the ones in that situation are discardable here.

101 tests, exit 0.

## [0.9.0] - 2026-08-09

### Added
- **Lens activation is structured state, not prose.** `record_activated_lenses(conditional, notActivated)` replaces the free-text declaration. The schema enum accepts only the 12 canonical conditional names, so a translation or abbreviation is refused at the call. All 12 must be accounted for — activated, or not-activated with a non-empty reason — and four contradictions an adversarial pass found are refused too: the same lens in both lists, a duplicate inside `conditional`, and a universal lens passed as conditional in either list.

  The record lands in `state.activatedLenses` as **one entry per critique iteration** (`universal`, `conditional`, `notActivated`, `iteration`, `againstVersion`, `recordedAt`). The iteration is derived from how many transitions entered Phase 2 — `currentIteration` resets on every phase change, including the `3→2` loop-back, so it does not track critique rounds. Re-recording in the same iteration replaces that entry; a new iteration appends, preserving the history the column gate reads.

- **`activated_lenses_recorded` now demands evidence** (`verify: "lenses-recorded"`): an entry for the **current** iteration, which is what forces re-declaration on each turn of the loop. The legacy prose declaration is honoured only when `state.stateVersion` is absent — i.e. a project created before this version. `init_project` stamps `stateVersion: 1`, so on new projects the structured record is mandatory and the fallback cannot become an opt-out.

- **The `lens` column of every finding is validated at the 2→3 gate.** Minimum form: each value must be one of the 19 canonical names or the literal `NENHUMA`. `Sustainability` is refused, `sustainability / proportionality` accepted — this is the T21 case, four findings carrying a truncated name that the guidance already forbade and nothing checked. Strong form: a *conditional* lens must have been declared for **that finding's iteration**, read from the `## Iteração N` header above it; universals always pass. When the iteration cannot be resolved, or no declaration exists for it, the check degrades to the union of all declared sets — permissive, never blocking a legitimate project. The T14 trap is covered both ways: MEC is legitimate in the iteration that declared it, anachronistic in one that did not.

### Changed — convergence with the reference
`types.ts`, `engine.ts`, `phases.ts`, `record-tools.ts` and `index.ts` were taken from Versus Claude 0.14.0 wholesale, and this build's own changes re-applied on top: the `agent` union with `"kimi"`, the iteration-header gate (RO3 item 5), the chat-template phrasing in the MCP hints. The RO3 timestamped-`projectSpec` implementation was **renamed to the reference's** (`SpecEntry`/`specEntryValue`, `getProjectSpec()` returning flat strings with the stamps living in `state.json`) — same shape on disk, so the RO3 contract is unaffected, and future patches become copyable again instead of hand-merged. That divergence, flagged when 0.5.0 shipped, had started to cost.

100 tests, exit 0. Verified end to end: no declaration blocks 2→3 · a translated name is refused at the call · a valid declaration records iteration 1 against V(1) · a truncated `Sustainability` in the matrix blocks · the canonical declared name advances.

### Data consequence
Any slot in the batch run under the old behaviour with a non-canonical lens name carries findings the analysis cannot group — discard as done with T21 on the Claude side. No Kimi project reached Phase 2.

## [0.8.0] - 2026-08-08

### Fixed
- **The loop-back reset was asymmetric: Phase 3 kept iteration 1's stamps.** 0.6.1 cleared every Phase 2 criterion on `3→2` but left Phase 3's four (`criticals_addressed`, `important_decided`, `scope_preserved`, `architecture_simplified`) marked from the first pass. A project that looped — `2→3 · 3→2 · 2→3 · 3→4` — then walked through the `3→4` gate on stamps that answered the *previous* critique. `criticals_addressed` carried over from iteration 1 means nobody ever confirmed iteration 2's criticals: the gate was open on evidence about a different set of findings.

  The rule is now general and symmetric: on any backward transition, every phase from the target up to the one being left is reset, since all of them will be redone against the new design. For the `3→2` loop that clears Phases 2 and 3.

  `start_iteration` needs no equivalent — it only increments the counter and never changes phase, so the redo always passes through `advancePhase`, where the reset lives.

79 tests, exit 0. Verified end to end on the full scenario: Phase 3 answered in iteration 1, loop back, Phase 2 redone, `3→4` **blocks** until Phase 3 is answered again, then advances. Ported from Versus Claude 0.13.1.

### Data consequence
Any project already run that looped and passed `3→4` under the old behaviour carries iteration-1 stamps on Phase 3 — whether to discard it is a batch decision, as was done with T21 on the Claude side.

## [0.7.1] - 2026-08-08

### Fixed
- **The permission block was identified by a comment, in a file the host rewrites.** Kimi re-serializes `config.toml` on its own — it expands the rules into `[[permission.rules]]` blocks and drops every comment on the way — so the `# >>> versus-kimi (managed) >>>` marker vanished the first time a setting was changed. The extension then saw a `[permission]` section it could not recognise as its own and warned, on every activation, that the rules had not been added — while all six were in force. A false alarm, but the same blindness would have stopped a future release from ever *updating* the rules: it would have found the file foreign and given up.

  Ownership is now decided by content: a config carrying a rule for `mcp__versus-kimi__*` is ours, however it has been re-serialized. Missing rules are appended as `[[permission.rules]]` blocks — the shape Kimi itself writes, so a later rewrite is a no-op — or spliced into an existing `rules = [...]` array when the config still uses that form. A permission section without our rule is still never touched.

  Marker comments are still written on a fresh install as a courtesy to anyone reading the file; nothing depends on them surviving.

77 tests, exit 0, covering both shapes. Verified against a copy of a real config that Kimi had already rewritten: `already-present`, file unchanged byte for byte.

### Note
The first attempt at this fix handled only `[permission]` + `rules = [...]`, the shape this extension used to write — and would have appended a conflicting `[permission]` table to the real file, which uses array-of-tables. Caught by testing against a copy of the actual config instead of the shape I assumed.

## [0.7.0] - 2026-08-08

### Added
- **Cross-check: a finding's module must exist in the architecture — checked against the UNION of all versions.** Advancing 2→3 now blocks when the coverage matrix cites a module that appears in no `## V(N)` section of `specs/technical/architecture.md`. Name drift is caught with the session still open, instead of the analysis discovering afterwards that findings point at modules no artifact records: in the discarded batch, 11 findings named modules that never existed, silently.

  The union is what makes this safe. A module removed between versions keeps its earlier findings legitimate and is tolerated; only a name that was never a module blocks. This is the same item deferred in 0.6.0 — it returns with the correct rule. The version I had written then compared against the *last* version alone, which would have blocked every project whose architecture evolved, the normal case rather than the exception.

### Changed
- **Three conditional-lens triggers rewritten (0.12.9).** Each was activating in 0/7 pilots or diverging, because the trigger was narrower than the lens's own central question.
  - **UI/UX** — from "User-facing interface" to any surface a *person* operates, CLIs and operational tooling included.
  - **Sustainability / Proportionality** — from a list of examples (AI/ML, data processing, cloud-native) to the property itself: the system decides, allocates or consumes a resource whose cost grows with use. Apply the central question, do not match the examples.
  - **Governance / Accountability** — from "multiple teams, data domains, or compliance" to a *system* property: it records or decides something someone will later need to audit, attribute or answer for. A single-operator project activates it when the system has that property.

  ⚠ **The Governance change alters the taxonomy the paper defends.** From here the batch measures the corrected taxonomy, not the published one. That is a protocol/paper matter rather than an extension one, recorded here so the trail stays honest.

76 tests, exit 0, including drift-blocks, removed-module-tolerated and MEC- (a lens finding, not the reserved module prefix). Verified end to end: a matrix citing `health-prober` blocks naming the module; the same matrix on `auth` advances. Ported from Versus Claude 0.13.0.

## [0.6.1] - 2026-08-06

### Fixed
- **The Phase 2 reset was wired to a hook that never fires, and reset only one criterion.** Two defects in one place, both now closed.

  RO3 item 1 was implemented in `startIteration(phase)`, guarded by `phase === 2`. But `start_iteration` takes the **current** phase, and in the 2↔3 loop the model calls it from Phase 3 — so the guard never matched and nothing was ever reset. Verified against the real sequence (`start_iteration(3)` → `advance_phase(2)`): Phase 2 came back with all five criteria still marked. The reset now lives on the `3 → 2` transition in `advancePhase`, which is the unambiguous moment the loop closes.

  And it now clears **every** Phase 2 criterion, not just `activated_lenses_recorded`. Re-entering Phase 2 is a fresh critique of V(N+1) — lenses re-declared, findings re-produced, criticals and concentration re-analysed. Leaving the other four marked let the gate accept a critique of V(1) as if it were of the new design, and showed Phase 2 as nearly complete on re-entry.

  Criteria of other phases are untouched (`ec.phase === 2` filter), and the artifact gates still require the files, which persist across iterations — what resets is the `met` boolean, forcing a re-mark after the round is genuinely redone.

Ported from Versus Claude 0.12.8, whose implementation had the correct hook from the start. 73 tests, exit 0. Verified end to end: after `start_iteration(3)` + `advance_phase(2)`, all five Phase 2 criteria read `met: false` in `state.json` while the 18 marked in other phases survive.

## [0.6.0] - 2026-08-06

### Removed
- **The cross-check `matrix.module ⊆ architecture.modules` (RO3 item 6) is deferred.** It shipped in 0.5.0 because the request document specified it in full; the item was in fact meant to be held back, so that no project of the batch is blocked by a rule the analysis side is not yet ready to consume. Gone: `crossCheckMatrixModules()`, `architectureModules()`, their two tests and the `writeArchVersions` helper. The RO3 parser already validates this, so nothing is left unchecked — only unenforced.
- Removing it is reversible: the implementation, including the `quota-limiter` tolerance case that made earlier iterations pass, is in the 0.5.0 commit.

### Kept
- **Item 5's gate stays.** The two lived in one method; only the module comparison was taken out. From iteration 2 on, a matrix with no `## Iteração N` header still blocks — that failure is silent otherwise, with every finding read as iteration 1.
- Items 1, 2, 3, 4, 5 and 7 are untouched.

72 tests, exit 0. Verified: a matrix naming a module absent from the architecture table now advances.

## [0.5.1] - 2026-08-06

### Changed
- **Item 7's wording aligned to the canonical text.** The rule shipped in 0.5.0 said the same thing in different words; it now reads exactly as specified, naming why it matters — a lens double-counting one defect inflates its own exclusive contribution, which is the quantity the study measures. Keeps the four builds convergent on the sentence, with the `duplica` token literal.

No behaviour change; 74 tests, exit 0.

## [0.5.0] - 2026-08-06

Implements the seven corrections requested in `RO3/CORRECOES-EXTENSAO.md` — a contract written by the consumer of this data (the RO3 analysis scripts), not a port of an upstream patch. **This build now diverges from Versus Claude 0.12.5**; `engine.ts`, `phases.ts` and `types.ts` can no longer be copied wholesale from it without diffing.

### Added
- **Lens declarations are per iteration, not accumulated (item 1).** Re-entering Phase 2 clears `activated_lenses_recorded`, so each turn of the 2↔3 loop must declare its own lens set. Each round critiques a *different* architecture; with one accumulated declaration there was no way to say which lenses were active when a given finding was produced, and any validation had to fall back on the union of all iterations — erasing the very signal.
- **The declaration names its iteration and architecture version (item 2).** Guidance requires a first line like `ACTIVATED LENSES — iteration 2, against V(2)`, matchable by `itera[cç][aã]o\s*(\d+)` and `V\s*\(?(\d+)\)?`. Previously the pairing had to be inferred from timestamps against phase transitions.
- **`projectSpec` entries carry phase and instant (item 4).** `stack`, `outOfScope`, `patterns` and `constraints` are now written as `{ value, phase, at }`. Bare strings are still read, so older projects stay valid — `specValue()` and `getProjectSpecValues()` flatten both. This makes "which entries existed when Phase 2 declared its lenses in iteration N?" answerable; it was not, which is why an external re-estimation had to exclude `projectSpec` entirely.
- **Cross-check: every module a finding names must exist in the architecture (item 6).** Checked **only against the current iteration and the version in force** — earlier iterations are deliberately tolerated, because the 2↔3 loop means a finding from iteration 1 legitimately names a module V(2) removed (the `quota-limiter` case). A naive check here would block every project whose design evolved, which is the normal case.
- **From iteration 2 on, the matrix must carry an iteration section header (item 5).** Guidance requires `## Iteração N — V(N)`; the gate enforces it once the project is past iteration 1, because without the header every finding is silently read as iteration 1 and the link to the architecture it was made against is lost. Section header, not a new column: a column before the id would break `artifactRows`, the frozen finding format and the adversarial fixtures.

### Changed
- **Activation is by project signal alone (item 3).** Guidance now states that another lens appearing to cover the same class of failure is not a reason to skip one, and that "redundant with <other lens>" is not a valid justification. Lenses that overlap must still run together — otherwise the overlap is unobservable by construction and the measurement studies an artifact of the skipping.
- **`duplica` applies within a single lens too (item 7).** One lens recording the same defect under two ids inflates its exclusive contribution with a bookkeeping artifact.

### Answers to the two questions in the request
- **Item 5 shape:** section header, exactly as preferred — `## Iteração N — V(N)`, matchable by `itera[cç][aã]o\s*(\d+)`, with the `V(N)` present so it ties to item 2. Nothing before the id column changed.
- **Item 1 shape:** one decision **per iteration**. The criterion is cleared on re-entry, so the gate asks again and each round produces its own `record_decision(phase=2, category='architecture')`.

74 tests, exit 0 — including the `quota-limiter` tolerance case and a bare-string `projectSpec` read.

## [0.4.3] - 2026-08-05

### Changed
- **Phase 3 appends `## V(N+1)` to the architecture doc instead of overwriting it.** The Phase 2↔3 loop critiques a different architecture each round, so a finding recorded in iteration 1 can name a module that V(2) removed. Overwriting the module table left that finding pointing at a module no artifact records any more — the per-module traceability the coverage matrix exists to provide broke exactly where the design changed most. Every version is kept now; the last section is the current one. Observed for real in pilot T01 (`quota-limiter`).

Guidance only — no engine change, no gate, no test count change (67, exit 0). Ported from Versus Claude 0.12.5.

## [0.4.2] - 2026-08-05

### Fixed
- **The coverage-matrix gate accepted module rows as findings.** Making Phase 1 write `M-01` module ids opened a hole in Phase 2: the matrix pattern `[A-Za-z]{1,4}-\d+` matches `M-01`, because `M` fits in `{1,4}`. A matrix that was nothing but an echo of the architecture table — zero findings — therefore passed the gate, and with `count: 1` a single copied `| M-01 | … |` row was enough. A findings table with no finding is precisely the case the gate exists to reject. The pattern now carries a negative lookahead, `(?!M-)`: `P-01`, `A-03` and `MEC-01` still match, only `M-\d+` is excluded.
- **`M-` is reserved for modules in the guidance.** The lookahead alone sets a trap: Mechanical Engineering is one of the 19 lenses, and a model picking `M-` as its prefix would have its findings silently dropped from the count — and, downstream, be indistinguishable from modules. Phase 2's rules paragraph now states the reservation and points that lens at `MEC-`.

Two builds' features interacting, not either one alone — the kind of defect that only appears once both are installed. Ported from Versus Claude 0.12.4. Verified end to end: a matrix that echoes the module table blocks; a `MEC-01` finding releases. 67 tests, exit 0.

## [0.4.1] - 2026-08-05

### Fixed
- **The structural gate showed the wrong artifact's example.** One message served every criterion with `artifactRows`, and it was written in findings-table terms — so a missing **module** table in `architecture.md` told the model to write `'P-01 | auth | Security | 🔴 | …'`, a findings row, into the architecture file. Obeying the message would have produced the wrong artifact. `artifactRows` gained an `example` field, each criterion carries the example of its own format, and the shared wording is now neutral ("structured form", "table row(s) with an id"). Phase 1 failures cite `M-01 | rate-limiter | …`; Phase 2 failures cite `P-01 | auth | Security | …`.

This was the wart declared in 0.4.0's release note rather than papered over, and it is now fixed upstream (Versus Claude 0.12.3) instead of locally — so this build stays byte-convergent with the reference. 67 tests, exit 0; two ported tests still asserted the old message text and failed on the first run, caught by the exit code.

## [0.4.0] - 2026-08-05

### Changed
- **`architecture.md` is a module table, and the gate requires it.** Phase 1 asked for a ~2k-token prose document, so the canonical module list — the thing Phase 2's matrix and Phase 5's implementation are supposed to key off — was only readable by a human. It is now one row per module (`M-01 | module | responsibility | interface | depends-on`), and `architecture_doc` carries `artifactRows` with the `M-\d+` pattern, so `advance_phase()` to Phase 2 stays shut until at least one module row exists. A prose doc no longer passes. The id exists only to make the row machine-recognizable; the stable key across phases is the module **name** in column 2.
- The same `artifactRows` machinery already installed for the coverage matrix serves this — the loop in `advancePhase` is generic, so nothing new was needed in the engine beyond taking Claude's updated wording.

### Known limit, declared
The gate checks that a module table exists, not that Phase 2 and Phase 5 actually reused those names. Drift (Phase 1 `rate-limiter` → Phase 2 `quota`) is now **detectable** — both artifacts are machine-readable and diffable — but not prevented; no gate cross-checks `matrix.module ∈ architecture.modules`.

### Note on the denial message
The engine's structural-gate message is shared by both artifacts and reads in findings-table terms, so a missing **module** table is reported with a findings example (`P-01 | auth | Security | 🔴 | …`). The artifact path in the same sentence is correct and Phase 1's guidance shows the module-table format, but the example points at the wrong shape. Kept as-is to stay byte-convergent with Versus Claude 0.12.2, whose implementation this is; the fix belongs upstream, where the example can be keyed to the criterion.

Ported from Versus Claude 0.12.2. `phases.ts` and `engine.ts` diffed clean and were taken wholesale; the Phase 1 guidance block and the test helper were replaced by hand. 67 tests, exit 0.

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
