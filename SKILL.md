# IACDM — Interactive Adversarial Convergence Development Methodology v3.11

Created by Jasmine Moreira. Rigorous development methodology in 8 phases (0-7) with meta-iteration and scope preservation. Do not advance phases without meeting all exit criteria.

---

## GLOBAL RULES

**R1 — Consult before coding.** If user requested code/feature: evaluate triggers → if triggered, start Phase 0. Never skip to implementation.

**R6 — Phase transition.** After any advance_phase() that succeeds → YOUR NEXT TOOL CALL is get_phase_guidance() for the new phase. Do NOT write "advancing to phase X" as text — execute the tool call immediately and begin the first step.

**R7 — FLOW (continuous execution).** Within each phase, proceed step-by-step without announcing what you're about to do. Do NOT write "I will now do X" as text and stop — just do X. Only stop for: actual decisions requiring user input (AskUserQuestion), blockers, or phase gates.

**R2 — Clickable menus.** Every user decision uses `AskUserQuestion`. ALWAYS provide suggested options (single or multi-select) — never send questions without options. Group up to 4 questions per call. `multiSelect: true` for non-exclusive choices. Recommended option first with "(Recommended)". "Other" is automatic. Never list options A/B/C in text.

**R4 — `specs/` folder.** Domain knowledge and references deposited BEFORE coding. Structure:
```
specs/
├── references/    # Papers, articles, standards
├── domain/        # Glossary, business rules
├── technical/     # Algorithm specs, APIs, formulas
├── examples/      # Reference code
├── design/        # Wireframes, mockups
├── models/        # Diagrams, flows, schemas
├── datasets/      # Ground truth, test samples
├── validation/    # Acceptance criteria, benchmarks
└── competitors/   # Analysis of existing solutions
```

When to populate: Phase 0 → refs, domain, competitors | Phase 1 → technical, models, examples | Phase 5 → consult examples, datasets | Phase 6 → use datasets/validation | Phase 7 → record lessons. Never implement algorithms without reference in specs/.

---

## FUNDAMENTAL PRINCIPLE

**Generative Invariance:** The methodology does NOT improve the model — it improves the PROCESS. The same LLM operates with or without methodology. The difference is external verification at each gate.

**Adoption criterion (risk asymmetry):** Cost of applying to simple project ≈ 20 min. Cost of NOT applying to complex project ≈ hours/days of rework. Apply when C_overhead < P(error) × C_error.

---

## ACTIVATION TRIGGERS

Before proposing implementation, evaluate in sequence:

| # | Condition | Result |
|---|-----------|--------|
| 1 | Does not involve creating/modifying code | Answer directly |
| 2 | Requirement has vague words ("fancy", "scalable") | **USE METHODOLOGY** |
| 3 | Involves architectural decision | **USE METHODOLOGY** |
| 4 | User mentioned methodology | **MANDATORY** |
| 5 | Signs of hidden complexity (below) | **USE METHODOLOGY** |

**Complexity signals (just 1 is enough):** multiple domains/contexts, external integrations, request doesn't fit in 1 sentence, AI can't visualize complete solution, uncertainty about complexity. Golden rule: if you can't assert it's simple, it's not simple.

**When activating**, announce: detected triggers, observed signals, phases 0-7 summarized, declare that no code will be written until passing through Phases 0-4.

---

## PHASE OVERVIEW

```
Phase 0 — Problem Discovery (HSA 5-level exploration, score ≥90/100)
  ↓
Phase 1 — Architecture (modules + interfaces)
  ↓
┌ Phase 2 — Adversarial Critique ┐
│ Phase 3 — Simplification       │ loop until convergence
└────────────────────────────────┘
  ↓
Phase 4 — Convergence Gate
  ↓
Phase 5 — Code Implementation (1 file/response)
  ↓
Phase 6 — Tests (100% passing + manual test)
  ↓
Phase 7 — Post-Review (lessons + meta-iteration)
```

Multiple 2-3 iterations are expected: small 1-2, medium 2-3, large 3-5. Prefer iterating when in doubt.

### Verification type per gate:

| Phase | Gate | Primary VA | What it verifies |
|-------|------|-----------|------------------|
| 0 | G₀ | VA-human | Problem understanding |
| 1 | G₁ | VA-human | Adequacy, completeness |
| 2 | G₂ | VA-human + GA (lenses) | Critique complete; criticals recorded for Phase 3; decision for importants |
| 3 | G₃ | VA-human | Complexity ≤ previous version |
| 4 | G₄ | VA-human | Rigorous exit criteria |
| 5 | G₅ | VA-automatic | Syntax, types, style |
| 6 | G₆ | VA-automatic + human | Functional correctness + UX |
| 7 | G₇ | VA-human | Lessons + method evolution |

---

## Phase 0 — Problem Discovery Loop

**Entry:** Methodology activated.
**Verification:** VA-human (operator validates synthesis and teach-back).

### Loop: EXPLORE (HSA) → SYNTHESIZE → VALIDATE → EVALUATE

**Step 0:** Read ALL content from `specs/` before asking questions. Build on what already exists.

### Step 0.5 — Delivery Target (MANDATORY FIRST QUESTION — before starting HSA):
Before any analysis, ask via AskUserQuestion: "What is the delivery target for this project?"
- Option 1: "Complete product" — all requirements delivered in a single cycle. No scope splitting unless a technical blocker exists.
- Option 2: "MVP first, then iterate" — minimal viable product, with deferred features planned for future cycles.
- Option 3: "Prototype / proof of concept" — disposable, for validation only.

Record the answer immediately: record_decision(category='scope', content='DELIVERY TARGET: ...').
This answer frames the ENTIRE HSA: depth of research, scope boundaries, and feasibility thresholds depend on it.
Do NOT begin Level 1 without this decision recorded.

### HIERARCHICAL SEMANTIC ANALYSIS (HSA) — 5-level exploration:
Explore the problem systematically from the broadest context (Domain) to the concrete deliverable (Product). Each level builds on the previous. Use AskUserQuestion (R2) at every level.

#### Level 1 — DOMAIN (Context & Vocabulary)
Establish the semantic universe of the problem before diving into specifics.

| Sub-area | Key Questions |
|----------|--------------|
| Vocabulary | Key terms and definitions. Synonyms to avoid? |
| Vague Terms | Clarify: "fancy"→concrete, "scalable"→N users, "fast"→ms |
| Theoretical Field | What discipline(s) does this belong to? What foundational knowledge applies? |
| Methodologies | Are there established methodologies or standards in this domain? |
| Tools & Ecosystem | What tools, platforms, and libraries define this domain's landscape? |

**Technical AND scientific research (mandatory for specialized domains):** If project involves DSP, ML, bioinformatics, engineering, sciences etc., research BEFORE architecture:
- **Scientific:** Peer-reviewed reference papers, theoretical domain foundations, applicable mathematical/physical models, literature-validated constants and parameters
- **Technical:** Candidate algorithms with trade-offs, reference implementations, published benchmarks, mature tools and libs
- **Competitive:** Competing solutions, state of the art, known gaps
- Deposit EVERYTHING in specs/ (references, technical, competitors)
- Each numerical parameter MUST have a cited source (paper, standard, specification)
- Rule: "Don't implement algorithm without verifiable bibliographic reference"

#### Level 2 — PROBLEM (5W1H)
Define the problem precisely using the 5W1H framework.

| Sub-area | Key Questions |
|----------|--------------|
| Why (Motivation) | Why is it needed? What happens without it? What pain does it solve? |
| Who (Actors) | Who are the users? Who are the stakeholders? Who is affected? |
| What (Scope) | What exactly needs to be done? What is the core capability? |
| When (Timing) | When is it needed? Are there temporal constraints, deadlines, sequences? |
| Where (Context) | Where does it run? What environment, platform, infrastructure? |
| How (Approach) | How should it work at a high level? Any mandatory approach or constraint? |

#### Level 3 — ELEMENTS (Parts & Constraints)
Identify the concrete components, entities, and constraints of the system.

| Sub-area | Key Questions |
|----------|--------------|
| Components | What are the main parts/modules of the system? |
| Entities | What data entities, models, or domain objects exist? |
| Resources | What external resources are needed (APIs, DBs, services, files)? |
| Actors | What human or system actors interact with each component? |
| Constraints | Technical limitations, resource constraints. Assumed premises? |

#### Level 4 — PROCESSES (Flows & Feasibility)
Map the dynamic behavior: how components interact, transform, and communicate.

| Sub-area | Key Questions |
|----------|--------------|
| Use Cases | 3-5 main scenarios (actor/objective/flow). Edge cases? |
| Relationships | How do components relate? What are the dependencies? |
| Transformations | What data transformations occur? What are the inputs/outputs? |
| Flows | What are the main execution flows? What triggers them? |
| Events | What events does the system react to? What does it emit? |
| Tech Feasibility | Does the target platform support the fundamental mechanisms? |

**Tech Feasibility (MANDATORY VERIFICATION):**
**LESSON LEARNED:** Target platform tech feasibility must be VERIFIED, not assumed. In porting/migration projects, confirm BEFORE advancing:
- Does the destination platform support the fundamental mechanisms? (APIs, protocols, extensibility)
- Which capabilities are ESSENTIAL vs. DESIRABLE? Any essential one missing → BLOCKER.
Don't cut scope to fit the technology. Compare alternatives with table (requirements × techs, LOC, libs, platform). Ask user via R2.

#### Level 5 — PRODUCT (Deliverables & Criteria)
Define what "done" looks like — the expected output and how to measure success.

| Sub-area | Key Questions |
|----------|--------------|
| Desired Result | What is the final deliverable? What does the user get? |
| Deliverables | Concrete artifacts: files, APIs, interfaces, documentation? |
| Success Criteria | How do we measure success? (measurable and verifiable) |
| Acceptance Criteria | What must be true for the user to accept the result? |
| Out of Scope (YAGNI) | What NOT to do, with cost/benefit justification |

Note: Delivery Target was already recorded in Step 0.5 — use get_decisions(category='scope') to confirm before defining Out of Scope (YAGNI).

#### Cross-cutting — Documentation & Research (all levels):
- **Documentation:** Specs, RFCs, legacy code, issues. Content in specs/?
- **Web Research:** If specs/ has critical gaps, ask user permission (via R2) to research and deposit. Options: research and deposit / research and present / don't research. Cite source/URL in all deposited material.

### SYNTHESIS (Teach-Back) — Template:

```markdown
# My Understanding (Iteration N)

## Level 1 — Domain
### Vocabulary (term | understanding | example)
### Domain Context (field, methodologies, relevant standards)

## Level 2 — Problem
### Summary in 3 Sentences (problem, not solution)
### 5W1H (Why | Who | What | When | Where | How)

## Level 3 — Elements
### Components & Entities identified
### Constraints & Assumptions

## Level 4 — Processes
### Main Use Cases (actor/objective/flow/concrete example)
### Key Flows & Relationships

## Level 5 — Product
### Deliverables & Success Criteria (measurable and verifiable)
### Out of Scope (item | reason)

## Remaining Ambiguities
## Questions for Next Iteration
```

### VALIDATION — via R2: correct/almost/incomplete/wrong
**BEWARE AP1:** The human evaluates the WRITTEN SYNTHESIS — don't ask the AI if it's correct.

### CONVERGENCE ASSESSMENT (0-100):

| Criterion | Weight | HSA Level |
|-----------|--------|-----------|
| Problem Clarity | 10 | Level 2 (Problem) |
| Complete Use Cases (top 3-5 with actors/goals/flows) | 15 | Level 4 (Processes) |
| Defined Vocabulary | 10 | Level 1 (Domain) |
| Resolved Ambiguities | 15 | Cross-cutting |
| Explicit Out of Scope | 10 | Level 5 (Product) |
| Measurable Success Criteria | 10 | Level 5 (Product) |
| Validated Assumptions | 10 | Level 3 (Elements) |
| Research (technical+scientific) + specs/ populated | 5 | Cross-cutting |
| User Confirmed | 10 | Cross-cutting |
| AI Confident (can answer "why?" for every scope, assumption, and decision) | 5 | Cross-cutting |

≥90 → Phase 1 | 70-89 → 1 more iteration | <70 → multiple iterations.
**If score < 90:** call start_iteration() and continue HSA focusing on the lowest-scoring criteria. Do NOT offer to advance to Phase 1.
**If score ≥ 90:** call advance_phase() to advance to Phase 1. Inform the user.

### Exit Criteria Phase 0:
- Score ≥90/100 + user confirmed
- Ambiguities = 0 (or accepted)
- Use cases complete, vocabulary agreed, out of scope clear
- Tech feasibility: if initial doesn't meet 100%, alternatives explored
- Implementation feasibility: algorithmic components evaluated Tier 1/2/3. If Tier 3 in complex domain → PoC before Phase 1
- specs/ populated with technical AND scientific references, parameters, validation criteria
- If specialized domain: complete technical AND scientific research (Level 1)

---

## Phase 1 — Architecture

**Entry:** Phase 0 score ≥90/100.
**Verification:** VA-human (operator validates adequacy and completeness).

### Step 0: Consult and populate specs/
Read specs/technical, examples, models, design. If critical technical/scientific material is missing, research and deposit BEFORE defining modules.

### The 4 questions architecture MUST answer:
1. **Decomposition.** What are the modules? What are their responsibilities? Where are the boundaries?
2. **Interfaces.** How do modules communicate? What are the contracts?
3. **Assumptions.** What does the system assume as true? Implicit assumptions are the most common source of failures.
4. **Negative scope.** What does the system deliberately NOT do?

### Granularity principle (E = I₀/C):
Each module must be comprehensible by the AI in a SINGLE interaction. If it doesn't fit in context with its dependencies, it needs to be decomposed. Interfaces work as "executable summaries".

### Step 1: Pattern and Principle Collection (via R2)

Group into 2 AskUserQuestion calls:

**Call 1 (up to 4 questions):**
1. **Architectural Pattern** (single): Clean Architecture / Layered / Hexagonal / Modular Monolith
2. **Cross-cutting Principles** (multi): SOLID / KISS+YAGNI / DDD / Composition over Inheritance. Additional via Other: DRY, LoD, CoC, Separation of Concerns, Fail Fast
3. **Concurrency** (single): Single-threaded / Actor Model / Message Queue / N/A

**Call 2 (up to 4 questions):**
4. **Relevant GoF** (multi): select most pertinent to the project + "None specific" option
5. **Fowler Patterns** — Domain (single): Domain Model / Transaction Script / Table Module
6. **Fowler Patterns** — Data (single): Repository+Data Mapper / Active Record / Table Data Gateway. Others: Unit of Work, Identity Map, Lazy Load, Service Layer, DTO

Present summary of choices in table, confirm via R2.

### Technology Validation
If there's more than one tech option: comparative table (requirements × techs, LOC, dependencies, LLM context consumption). Assumptions verified with evidence (specs/technical), not assumed. If tech forces scope reduction → wrong tech. Prefer techs that minimize artifacts.

### Progressive Scope
**FIRST:** Check Phase 0 delivery target (get_decisions, category='scope', look for 'DELIVERY TARGET').
- "Complete product" → do NOT offer v1.0/v2.0 split. Only split if there is an explicit TECHNICAL BLOCKER (missing platform capability, immature dependency, infeasible Tier 3 without PoC). If splitting is forced by a blocker, document it with record_decision().
- "MVP first" or "Prototype" → offer progressive scope as below.

When maturity/risk is uneven across requirements: present maturity map (req | mature lib? | LOC | risk) and offer via R2: progressive scope (v1.0 mature, v2.0 rest) / everything in v1.0 / other grouping. Progressive scope ≠ cut: preserves 100%, distributes across versions. The AI must NEVER reduce scope by preference — only by documented technical necessity.

### Session planning (decoupled cycle):
- Design Session (Phases 0-4): context = domain + constraints → architecture + interfaces
- Code Session (Phase 5): context = architecture + module interface → 100% dedicated
- Test Session (Phase 6): context = interface + contract → no need for internal code
- Validation Session: CI/CD runs tests → AI only invoked for corrections

### Exit Criteria Phase 1:
- The 4 questions answered (Decomposition, Interfaces, Assumptions, Negative scope)
- Patterns/principles defined and confirmed
- Each module has clear and unique responsibility
- Interfaces defined (signatures, I/O types)
- Dependencies between modules explicit
- Assumptions listed
- Architecture doc fits in ~2k tokens
- Tech supports 100% of scope, tech assumptions verified
- Modules adherent to chosen patterns

### Next Step (MANDATORY after user confirms architecture):
Call advance_phase() to move to Phase 2. Then call get_phase_guidance() and begin Phase 2 immediately: record activated lenses and start the adversarial critique.

---

## Phase 2 — Adversarial Critique

**Purpose:** Attack architecture with specialized lenses, generating auditable coverage matrix.
**Verification:** VA-human + GA (7 universal + up to 12 conditional lenses as operationally distinct AVs).

### Critical-response asymmetry principle:
**Phase 2 = MULTIPLE agents to ATTACK** (lens diversity is value).
**Phase 3 = UNIFIED agent to RESPOND** (corrections integrated into the whole).
**Human operator = ARBITRATE trade-offs** (systemic view).

### Universal Lenses (ALL always applied — low cost in planning, high risk if omitted):

| Lens | Central Question | Exclusive failure class |
|------|-----------------|------------------------|
| Assumptions | What does this design assume as true without declaring? | Failures from hidden assumptions |
| Architectural | Can each module be replaced, removed, or tested in isolation? | Hidden coupling, SRP |
| Implementability | Can I code this module in a single session with available context? | Incomplete specs, insufficient granularity |
| Scientific | Does each value/formula/algorithm have a verifiable bibliographic reference? | Invented parameters, plausibility-based logic |
| Security | How would an attacker exploit with minimum effort? | Unanalyzed attack surface |
| Performance | Where are the bottlenecks? Asymptotic behavior? | Hidden bottlenecks, degradation at scale |
| Regulatory | Does each regulatory requirement have traceability to a module? | Regulatory non-compliance |

Selection principle: if removing this lens, is there a failure class that NO other detects? If yes → legitimate.

### Conditional Lenses (activate based on project context — 12 available):

**Situational lenses (8):**

| Lens | Activate when... | Exclusive failure class |
|------|-----------------|------------------------|
| Resilience | External dependencies (APIs, DBs, queues) | Cascading failures, retry storms |
| UI/UX | User-facing interface | Confusing flows, dead-end states, accessibility failures |
| Migration / Coexistence | Replacing or modifying existing production system | Data loss, regression vs. legacy, impossible rollback |
| Sustainability / Proportionality | Significant computational costs (AI/ML, data, cloud) | GPU where CPU suffices, infinite retention |
| Ethical / Human Impact | Automated decisions about people (scoring, moderation) | Algorithmic bias, no human recourse |
| Process / Workflow | Multi-actor flows, state machines, business processes | Orphaned states, missing actors, happy-path bias |
| Governance / Accountability | Multiple teams, data domains, compliance (SOC2, LGPD) | No data ownership, shadow data flows |
| Observability / Operability | Production systems with operational requirements | Opaque systems — nobody can diagnose failures |

**Domain Transfer Lenses (4) — activated by signal detection in problem/architecture:**

| Lens | Central Question | Exclusive Failure Class | Signal |
|------|-----------------|------------------------|--------|
| Control Engineering | Where does the system generate an error signal and correct it? Risk of oscillation or state drift? | Systems that react to events but don't regulate state — oscillation, drift, runaway feedback | State synchronization, runtime configuration affecting behavior, self-correcting or feedback-driven systems |
| Game Theory | Do system actors have aligned incentives? Where does the design assume cooperation and may encounter strategic defection? | Architectures that work under cooperation assumptions but collapse under adversarial or strategic behavior | Multiple independent actors, public API, external integrations, marketplace or platform design |
| Linguistics / Grammar | Is the interface contract unambiguous? Can two correct implementations of the same contract produce incompatible behaviors? | Protocol ambiguity — two correct implementations that are mutually incompatible | Inter-component communication, protocol definitions, message formats, interface contracts between independent teams |
| Mechanical Engineering | Where are the tolerances? Does the system tolerate variation or only work at exact specification? | Rigid coupling disguised as tolerance — failure from small deviations in dependency versions, environment, or load | Module maintenance, system evolution, long-lived systems with technical debt accumulation |

Selection principle: if removing this lens, is there a failure class that NO other detects? If yes → legitimate.
**Do NOT invent lens names** — only the 7 universal + 12 conditional listed above are valid. Use exact names from the tables.

### Protocol per lens:
1. Apply central question to EACH module
2. Classify findings: 🔴 Critical (blocks) | 🟡 Important (degrades) | 🟢 Suggestion
3. Finding = concrete evidence, not opinion
4. Passes are independent (one lens at a time)

**GENERATION MODE:** Phase 2 operates in generative mode — produce failure scenarios, not quality judgments. "How does this module fail?" generates new content (no confirmation bias anchor). "Is this design good?" asks the AI to evaluate what it produced (confirmation bias activated). The lens central questions are already in generative mode — follow them as written.

### Coverage Matrix:
Table modules × lenses with severities.

### Concentration analysis (mandatory after the matrix):
- **Concentration by module:** Module with findings in ALL lenses → poorly conceived → requires REDESIGN, not patch.
- **Concentration by lens:** Lens with findings in ALL modules → SYSTEMIC failure.
- Document patterns with record_decision().

### Phase 2 Exit Gate:
- 🔴 Criticals → will be addressed in Phase 3. Do NOT block advancement — Phase 3 exists precisely to resolve criticals.
- 🟡 Important → Phase 3 addresses them or records explicit acceptance (record_decision with justification)
- 🟢 Suggestions → can be deferred to v2.0 (record_decision)
- Zero findings → offer via R2: advance to Phase 3 (optional refinement) OR skip to Phase 4

### Next Step (MANDATORY after displaying gate summary):
Phase 3 always follows Phase 2 when findings exist. Do NOT stop and wait.
- If any findings (🔴/🟡/🟢): call advance_phase() → Phase 3. Inform: "Advancing to Phase 3 to address [N 🔴, N 🟡]."
- If zero findings: offer via R2: "Advance to Phase 3 (optional)" or "Advance to Phase 4 directly".
Do NOT block on 🔴 count — criticals are addressed IN Phase 3, not before entering it.

### Module Boundary Rule (during critique):
Apply lenses to ONLY the modules defined in P1 — do NOT propose new module boundaries or restructure decomposition during Phase 2. If module granularity is insufficient, flag it as a finding (🟡 or 🔴) for Phase 3 to resolve.
P1 negative scope items CANNOT become implementation proposals — if they appear during critique, flag as out-of-scope.

### Boundary Rule: Scope vs Architecture

Phase 2-3 **CAN:** change libs/patterns/communication, simplify modules, add technical mechanisms.

Phase 2-3 **CANNOT:** cut requirements, add features, change target audience/use cases.

Test: "Does this change WHAT the system does?" or "WHO it serves?" → SCOPE → return to Phase 0 with options via R2.

---

## Phase 3 — Simplification

**Purpose:** Simplify V(N) → V(N+1), eliminating complexity.
**Verification:** VA-human (operator validates that complexity decreased and scope preserved).

### Asymmetry principle (continuation from Phase 2):
Phase 2 attacked with MULTIPLE lenses. Phase 3 responds with UNIFIED VISION.
Individually correct corrections can be systemically contradictory.
Trade-offs resolved by the HUMAN OPERATOR (S2: stopping criterion belongs to the user).

### Exit Criteria:
- Phase 2 issues addressed
- Architecture simpler than previous version
- **S1:** No bugs introduced (features maintained)
- **S5:** Phase 0 scope preserved
- No new features (only architectural changes)
- If LOC increased >10%, documented justification

**Distinction:** Adding Worker/cache/fallback = architecture (OK). Adding tutorial/button/animation = feature (prohibited).

### Post-cycle 2-3 decision (⚠️ MUST DISPLAY — the AI computes, the user confirms):
**The user CANNOT know the structural change % — only the AI can compute it.** Do NOT ask the user to choose a percentage range. Instead:

**Step 1 — Compute (AI does this):**
- Compare V(N) architecture with V(N+1): count modules added, removed, or significantly restructured
- Structural change % = (modules changed / total modules) × 100
- Count remaining 🔴 criticals from Phase 2 matrix that were NOT resolved

**Step 2 — Present (⚠️ MUST DISPLAY in chat):**
Show computed values AND reference table:
```
Structural change: X% (Y of Z modules changed)
Remaining criticals: N
```
| Structural change | Critical | Action |
|---|---|---|
| <15% | 0 | → Phase 4 |
| 15-25% | 0-1 | 1 more iteration |
| >25% | 2+ | Multiple iterations |

**Recommended action: [action based on computed values]**

**Step 3 — Confirm (via AskUserQuestion):**
Present recommendation and ask: accept / override. The user validates the RECOMMENDATION, not the raw data.

**Step 4 — Execute the agreed action (do NOT stop after confirmation):**
- "→ Phase 4": call advance_phase(), then call get_phase_guidance() and begin Phase 4 convergence verification immediately.
- "1 more iteration" or "Multiple iterations": call start_iteration(), then return to Phase 2 critique with V(N+1). Announce: "Starting iteration N of the 2-3 loop. Returning to Phase 2 critique."

### Anti-Scope-Creep Checklist (mandatory before advancing — ⚠️ MUST DISPLAY ✅/❌):
1. ALL Phase 0 requirements covered
2. No unsolicited features added
3. What the system DOES hasn't changed (only HOW)
4. P1 negative scope is still negative — no item from P1 'NOT do' list was silently promoted

---

## SAFEGUARDS

**S0 — Problem Convergence.** Never advance to Phase 1 without ≥90/100. Relative cost: wrong problem 100×, wrong architecture 10×, bug 1×.

**S1 — Anti-Bug.** Simplification never introduces bugs. Features maintained after each Phase 3.

**S2 — Stopping Criterion.** Stopping criterion belongs to the USER, not the AI.

**S3 — Premature Convergence Cost.** Stopping early ≈ -400% to -600% ROI.

**S4 — Explicit Verification (mandatory VA-human).** VA-human is irreplaceable at each gate. Automated tests verify formalizable properties; semantic adequacy, usability, and domain correctness REQUIRE human judgment. Applies to: P0 (validate synthesis), P2 (arbitrate trade-offs), P4 (confirm convergence), P6 (manual test + execute and verify output).

**S5 — Scope Preservation.** Phase 2-3 operates WITHIN Phase 0 scope.
- **5.1** Scope belongs to the user. Phase 2-3 suggests, never decides scope change.
- **5.2** If not requested, don't add. If useful, document as v2.0 suggestion.
- **5.3** Detector: "If the user compared V(N) with Phase 0, would they say 'this isn't what I asked for'?" If yes → scope violated.

**S6 — Don't reimplement what already exists.** Assessment per module:
- **Tier 1:** Mature lib exists? → USE IT. New code = UI + integration + glue.
- **Tier 2:** Documented algorithm with reference implementation exists? → PORT literally. Protocol: find ref → deposit in specs/examples → read/understand → translate line by line (same structure, same names) → test against same inputs. Faithful translation first, optimization later.
- **Tier 3:** Neither of the above. If complex domain (solvers, crypto, DSP, ML) → mandatory isolated PoC (~2h max). If PoC failed → reconsider scope. Deposit logic in specs/technical before coding.

**Alarm signal (immediate STOP):** If during Phase 5-6 the AI is creating heuristics for problems with known solutions, debugging complex logic written from scratch, doing trial-and-error on something that should be deterministic, or spending >2 iterations on the same module → STOP, communicate, look for reference implementation (Tier 2).

**Loop detection — what trips it.** What S6 forbids is *blind* debugging: re-running the tests hoping something sticks, with no named cause. It does not forbid debugging, and it must never forbid verification — S4 requires the AI to execute the tests and see them pass, so a safeguard that blocks the green run makes S4 impossible to satisfy. The rule therefore counts *understanding*, not commands:

- Only a **failed** run counts. A passing run clears the counter.
- **3 consecutive failures with no diagnosis recorded between them** → the next test run is blocked.
- The escape is to name the cause: `record_decision(category='diagnosis', content='<root cause + the fix it implies>')`, which clears the counter at once.
- Fix a test, name why it broke, run again: that is the normal cycle and never accumulates. Four failures with four named causes is not a loop; four failures with no cause named is.

Record the diagnosis because it is the honest log of the debugging session, not to appease the counter. If you cannot state the root cause in one sentence, you do not have one — and that is exactly the moment S6 exists to catch. Go Tier 2: find a reference implementation, and record *that* as the diagnosis.

Checklist per module: mature lib? → if not, why? → documented algorithm? → portable implementation? → decision (use lib / port / implement from scratch + justification).

**S7 — Sequence Discipline.** After each file: mark completed, identify next, announce "X/N completed, next: Y", start immediately. Don't start tangential discussions (→ Phase 7). If interrupted: consult todo list → announce resumption → continue.

---

## ANTIPATTERNS TO AVOID

| # | Antipattern | Description | Antidote |
|---|------------|-------------|----------|
| AP1 | Validation theater | Asking the AI "is this design good?" — evaluation mode (judging what the AI produced) activates confirmation bias; generation mode (producing new content) does not | Operate in GENERATION mode: produce failure scenarios ("how does this fail?"), not quality judgments ("is this good?") |
| AP2 | Complexity as false solution | Adding components when critique reveals fragility | Each iteration must simplify |
| AP3 | Monolithic session | Design, code, and tests in one conversation | One session per phase, one phase per module |
| AP4 | Implicit assumption | Design works if unlisted conditions are true | Assumptions Lens P2 + P1 assumptions |
| AP5 | Absence of VA-human | Trusting only automated tests | S4 + mandatory manual testing |
| AP6 | Skip Phase 0 | Starting with architecture without understanding the problem (100×) | S0: Score ≥90 |
| AP7 | Code without reference | Implementing without consulting specs/ or literature | S6 + R4 |
| AP8 | Convergent perfectionism | Infinite cycles seeking perfection | <15% change + 0 critical → advance |
| AP9 | Silent scope creep | Adding features without approval | S5: scope belongs to the user |

---

## Phase Guardrails (DO/DON'T)

Each phase has explicit DO/DON'T boundaries injected into the AI's context via compact guidance. These prevent common flow deviations and are visible in the sidebar as phase hints.

| Phase | DO | DON'T |
|-------|-----|-------|
| P0 | Ask questions, explore, populate specs/ | Write code (even via terminal), jump to solutions |
| P1 | Define modules, interfaces, patterns | Write implementation code, create source files |
| P2 | Record activated/non-activated lenses first, apply every lens to every module | Cut/add requirements, skip any lens (even when no findings expected) |
| P3 | Simplify, address criticals, compute change % | Add features, increase complexity |
| P4 | Verify exit criteria, safeguards, specs/ | Skip verification, advance without confirming, display LLM Switch notification twice |
| P5 | Implement sequentially, consult specs/ | Run the application or tests — that is Phase 6 |
| P6 | Write spec-driven tests, manual testing | Skip manual testing, mark criteria without testing |
| P7 | Collect human feedback, update specs/ | Use init_project() instead of start_new_cycle() |

When a DON'T action is requested, the AI should inform the user which phase handles that activity and offer to advance if appropriate.

---

## Phase 4 — Convergence Gate

**Verification:** VA-human (operator confirms convergence with rigorous criteria).

Validate complete convergence:
1. Exit criteria from Phases 2-3 verified
2. Safeguards S1-S5 met
3. The 4 P1 questions still answered (Decomposition, Interfaces, Assumptions, Negative scope)
4. Concentration analysis revealed no unresolved systemic failures
5. specs/ populated with technical and scientific references for Phase 5
6. Only advance if EVERYTHING OK

### LLM Switch Point:
Phase 4 is the natural boundary for switching LLMs to reduce cost. Phases 0-4 (design) require high reasoning — use the most capable model. Phases 5-7 (implementation, tests, review) can use a cheaper/faster model since architecture is validated and all decisions are persisted in `state.json` and `specs/`.

**Inform the user:** "The architecture is fully validated. From Phase 5 onward, you can switch to a faster/cheaper model — no context is lost."

### Next Step (MANDATORY when all items are ✅):
1. Display the LLM Switch Point notification to the user (mandatory before advancing).
2. Call advance_phase() to move to Phase 5.
3. Call get_phase_guidance() and begin Phase 5 implementation immediately: consult specs/ for the first module and start coding.

---

## Phase 5 — Code Implementation

**Purpose:** Implement final architecture.
**Verification:** VA-automatic (compile, lint, type check). Dedicated session per module.

### Decoupled session:
Each module implementable in independent session. Context: architecture (~2k tokens) + interface + specs/. If needs more → insufficient granularity (return to P1).

**If starting in a NEW SESSION** (LLM Switch or resumed project): the methodology is context-safe — all decisions persist in state.json, all specs in specs/. To recover context:
1. Call get_decisions() — all architecture, patterns, scope, and P3 decisions
2. Call check_specs_status() — which spec directories are populated
3. Read populated specs/ (specs/technical, specs/models, specs/design)
In a CONTINUOUS session (P0→P5 without interruption), conversation context already holds all decisions — proceed directly to modules.

### Binding Constraints from P1/P3 (MUST be respected before writing any code):
The technology stack, patterns, and negative scope decided in P1 (and revised in P3) are HARD CONSTRAINTS. Before coding any module, confirm:
- **Tech stack:** use ONLY the languages, runtimes, and frameworks explicitly selected in P1. If decision says "vanilla JS" → no Node.js. If "no framework" → none.
- **Patterns:** apply ONLY the architectural patterns chosen. Do not import new patterns.
- **Negative scope:** do NOT implement anything listed as out-of-scope.
If unsure, check get_decisions(phase=1) — never assume or default to a familiar tech.

Before each module, consult specs/technical (algorithm, formulas, params), specs/examples (ref code), specs/references (original paper), specs/datasets (test data). If numerical parameters without values in specs/ → STOP and research. Reference source in code.

Apply S6 (Tier 1/2/3) and S7 (sequence discipline) rigorously.

### S7 — Sequence Discipline (Adversarial Micro-Check):
After each module: run adversarial micro-check — ask "Where does this implementation DIVERGE from specs/?" Find differences, do NOT validate (AP1 risk: the agent wrote the code and is biased toward ✅). Fix any divergence before starting the next module.
Do NOT write text between modules — the next tool call must be the first tool call of module X+1. Do NOT ask permission between modules. Only stop for actual decisions (ambiguity, blocker, Tier choice).

### Scope Inventory (MANDATORY before advance_phase — ⚠️ MUST DISPLAY ✅/❌):
After all modules are implemented, before calling advance_phase():
1. **P1 modules present?** List every module defined in the P1 decomposition — ✅ if present in codebase, ❌ if missing.
2. **specs/validation covered?** List every requirement in specs/validation — ✅ if covered by at least one module, ❌ if not.
Scope inventory = **presence/absence check only** (not quality — that is Phase 6's job).
If any ❌: implement the missing module/requirement before advancing.
**CAUTION AP1:** do NOT mark ✅ without checking — the goal is to find ❌s, not to confirm ✅s.

### Next Step (MANDATORY — do NOT stop after scope inventory):
When scope inventory is all ✅: call advance_phase() to move to Phase 6. Then call get_phase_guidance() and begin Phase 6 testing immediately.

---

## Phase 6 — Tests

**Purpose:** 100% tests passing + manual test + spec coverage verified.
**Verification:** VA-automatic (tests) + VA-human (manual exploratory testing).

**S4 — Explicit Verification.** NEVER assume tests passed. Execute and verify. VA-human is irreplaceable for semantic adequacy and UX.

### Step 1 — Spec-Driven Test Protocol (MANDATORY before writing any test):
Test against SPECS, not implementation. The code is suspect — specs are the source of truth.

**1.1. Recover scope:**
- `get_decisions(phase=0)` → list ALL use cases
- `get_decisions(phase=3)` → check for any scope revisions from Phase 3 simplification. Merge P0 and P3 scope — Phase 3 may have revised boundaries.
- Read `specs/validation` → list ALL validation criteria
- Read `specs/technical` → list ALL technical constraints

**1.2. Build the Test Map** (must display):
For each spec item, declare which test verifies it, HOW it verifies, and type (positive/negative).
- Every Phase 0 use case → ≥1 positive + ≥1 negative test
- Every `specs/validation` criterion → ≥1 test verifying the EXACT criterion
- Every `specs/technical` constraint → ≥1 test within documented ranges
- Minimum ratio: 1 negative test for every 2 positive tests

**1.3. Distinguish "test green" vs "spec met":**
A test only validates a spec if it verifies the EXACT criterion. False coverage examples:
- Spec "< 200ms" → test checks "returns results" (no timing) → NOT verified
- Spec "100 concurrent users" → test checks single user → NOT verified

### Step 2 — Write and Execute Tests:
**Binding Constraints:** Use ONLY the tech stack approved in P1 in test code (check get_decisions(phase=1) if unsure). Do NOT introduce test frameworks or runtimes not approved in P1.
- `specs/datasets` → test against ground truth (if empty, generate synthetic data)
- Execute ALL tests, verify output. Fix failures before proceeding.
- Run actual application and verify end-to-end behavior.

### Step 3 — Record Spec Coverage (MANDATORY):
`record_decision(phase=6, category='spec-coverage', content='SPEC COVERAGE REPORT: ...')`
Structure: COVERED (spec + test + result) / NOT COVERED (+ justification) / NEGATIVE TESTS (count + ratio) / GAPS (test exists but doesn't verify exact criterion).

### Step 4 — Manual Exploratory Testing (mandatory before Phase 7):
**Manual testing must be performed by the human user, not the AI.** After automated tests pass:
1. Present the test plan to the user: list Phase 0 use cases and edge cases to execute.
2. Record testing status with record_decision(category='testing') BEFORE the user leaves.
3. Wait for the user to return with results. Do NOT mark manual_testing met or advance before feedback.

What the user must test: start application, execute Phase 0 use cases as end user, test edge cases (rapid/double clicks, empty inputs, interruptions, timeouts), evaluate feedback quality, report issues.

Both (automated + manual) are mandatory gates. Neither replaces the other.

### Multi-session testing:
**BEFORE the user leaves to test (⚠️ MUST DISPLAY testing status in chat):**
`record_decision(phase=6, category='testing', content='TESTING STATUS: ...')`
Structure: TESTING STATUS / PASS / FAIL / NEXT

**WHEN the user returns with test feedback:**
1. Call get_decisions(phase=6) to recover all Phase 6 testing decisions
2. Read most recent testing-category decisions to reconstruct context
3. Record user's feedback as a new testing decision
4. Update exit criteria (mark_exit_criterion for manual_testing, edge_cases)
5. If issues found: fix them, then record updated status

**WHEN fixing issues from manual testing:**
After each fix, record a testing decision noting: what was fixed, what still needs retesting.

On return: `get_decisions(phase=6)` recovers full testing history.

### Next Step (MANDATORY when all testing is complete):
Both automated and manual testing must be done before advancing. When both gates are ✅: call advance_phase() to move to Phase 7. Then call get_phase_guidance() and begin Phase 7 post-review immediately.

---

## Phase 7 — Post-Review

**Verification:** VA-human (operator evaluates lessons and approves changes).

### Update specs/:
- specs/validation → actual results (expected vs obtained)
- specs/technical → final decisions, discarded algorithms and why
- specs/references → references discovered during correction

### Double-loop learning:
Single-loop: evaluate the PRODUCT (does the software work?).
Double-loop: evaluate the PROCESS (did the methodology work? Where was there friction?).

### Methodology Self-Improvement:

**Step 1 — Human collection (mandatory FIRST):** Ask via R2 if any part caused friction or failed. The human experienced the process and detects friction the AI doesn't perceive.

**Step 2 — AI self-assessment (complementary):** Phase that lacked checklist, missing safeguard, inadequate template, valueless rule, recurring pattern.

**Step 3 — Consolidate** into table (source [human/AI] | phase | proposal | justification).

**Step 4 — Apply** via R2: review one by one (recommended) / apply all / don't update. For each diff, show before/after and request approval.

**Step 5 — Increment version** of SKILL.md.

Limits: AI has agreement bias about itself. Human detects friction → AI proposes → human approves. Never modify SKILL.md without approval.

### Meta-iteration v1.0 → v2.0:
After completing all Phase 7 steps, offer start_new_cycle() via AskUserQuestion (R2).
start_new_cycle() resets to Phase 0 while PRESERVING decisions, projectSpec, history, and specs/.
Do NOT use init_project() for meta-iteration — it wipes all previous context.
- specs/ from v1.0 is BASELINE for v2.0 — knowledge is NOT lost between cycles
- Phase 0 of v2.0 starts from existing specs/ (doesn't restart from zero)
- Previous decisions (get_decisions) serve as context — what was discarded and why
- Negative scope from v1.0 can become scope of v2.0 (with operator approval)
- Phase 7 lessons from v1.0 feed the v2.0 process
