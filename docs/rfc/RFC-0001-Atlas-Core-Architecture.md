# RFC-0001: Atlas Core Architecture

- **Status:** Draft
- **Created:** 2026-07-08
- **Related:** [RFC-0002: Brain Pipeline](./RFC-0002-Brain-Pipeline.md), [RFC-0003: Skill System](./RFC-0003-Skill-System.md)

## 1. Summary

This RFC documents the target architecture of Atlas: the concepts that make
it up, how a request flows through the system end to end, and the product
rules that constrain every future architectural decision. It exists to get
the shape of the system written down and agreed on *before* the official
documentation is frozen, and before Skills and Modules are built out. Nothing
here is final — see [Decision Log](#12-decision-log) and
[Open Questions](#11-open-questions).

## 2. Core Concepts

| Concept | Definition |
| --- | --- |
| **Atlas** | The complete ecosystem — the product as a whole. |
| **Axis** | The structured representation of a user request. Not a module, not a domain, not a feature — the universal shape every request is normalized into before Atlas Brain reasons about it. |
| **Atlas Brain** | The intelligence layer: memory, context, reasoning, planning, routing, scoring, learning. Domain-agnostic by rule (see [§5](#5-product-rules)). |
| **Atlas State** | The current representation of the user's life and active situation — active domains, priorities, preferences, active projects, open work. Read and updated by Atlas Brain on every request. |
| **Skills** | Atomic, reusable capabilities. A Skill does one thing (e.g. "create a calendar event", "send a message", "extract a due date") and is not tied to a single module — the same Skill can be invoked by the Task module and the Document module alike. |
| **Skill Planner** | Selects and sequences which Skills a given Axis request requires, given Atlas Brain's routing/planning output. |
| **Skill Engine** | Executes the Skills the Skill Planner selected, in order, and reports outcomes back to Atlas Brain. |
| **Modules** | Thin, domain-specific plugins (Task, Document, Memory, Conversation, ...). They expose what capabilities they need as Skills and execute work through the Skill Engine — they don't contain reasoning. |
| **Interfaces** | The surfaces a user interacts with Atlas through: chat, dashboard, forms, mobile, browser extension, etc. Interfaces produce raw requests; they don't touch Atlas Brain directly (see [§3](#3-target-architecture)). |
| **Mission** | A long-running user objective (e.g. "Move to Montreal", "Buy a laptop"). The parent object for everything Atlas does toward that goal. See [§4](#4-mission-decision-and-verdict). |
| **Decision** | An atomic choice inside a Mission (e.g. "which bank?"). A Mission may contain one Decision or hundreds. See [§4](#4-mission-decision-and-verdict). |
| **Verdict** | The outcome Atlas produces for a Decision — a recommendation with reasoning and confidence (e.g. "RBC — because ..."). See [§4](#4-mission-decision-and-verdict). |
| **Evidence** | A single factual item attached to a Decision that a Verdict can point to (e.g. "Product A costs $899 at Best Buy", "User said budget is $25,000"). Evidence is what makes a Verdict a supported recommendation instead of an opinion. See [§4](#4-mission-decision-and-verdict). |
| **Normalized Value** | A structured value (numeric, currency, date, boolean, user-provided) derived deterministically from one Evidence item, always traceable back to it by id. Computed on read — not persisted, not a new model. See [§4](#4-mission-decision-and-verdict). |
| **Module Agent** | A specialized reasoning unit owned by one Module (e.g. a Flight Agent inside Travel). Domain-scoped intelligence Atlas Brain deliberately doesn't have. Acts only through Skills via the Skill Engine; never routes or reasons across Modules itself. See [RFC-0003 §7](./RFC-0003-Skill-System.md#7-modules-agents-and-cross-module-interconnection). |

## 3. Target Architecture

```
User
  → Interface            (chat, dashboard, forms, mobile, browser extension, ...)
  → Axis                 (raw request -> structured representation)
  → Atlas Brain           (intent, entity, context, state, routing, planning, scoring, learning)
  → Skill Planner          (Atlas Brain's plan -> ordered list of Skills)
  → Skill Engine             (executes the selected Skills)
  → Modules                    (domain logic the Skills operate against)
  → Response / Action / Memory update
```

A request always flows in this direction. Nothing downstream reaches back
upstream except through the learning signals Atlas Brain records — a Module
never calls Atlas Brain directly, and a Skill never re-runs Axis.

### Relationship to the current implementation

As of ATLAS-002, `src/brain/` implements the Atlas Brain stage in full
(intent, entity, context, state, routing, planning, scoring, memory,
learning engines — see [RFC-0002](./RFC-0002-Brain-Pipeline.md)), and its
Planning Engine already produces an `ExecutionPlan`. The Skill Planner and
Skill Engine stages in the diagram above **do not exist in code yet**. The
working assumption (open for revision — see [§11](#11-open-questions)) is
that the existing Planning Engine's `ExecutionPlan` is the *strategic* plan
("what needs to happen, in what order, at what module granularity"), and the
Skill Planner is a *tactical* translation of that plan into the concrete,
atomic Skills required to carry it out. Atlas Brain still decides *what*;
the Skill Planner decides *how*, in terms of reusable capabilities.

## 4. Mission, Decision, and Verdict

This section resolves an ambiguity between the current implementation (which
has a `Mission` model but no `Decision` or `Verdict`) and earlier product
conception work (which centered on a "Decision"/verdict object, scoped to
the Shopping module). The two are not competing models — they're different
levels of the same hierarchy, and Mission does not replace Decision.

```
Mission
  ├── Decision → Evidence(s) → Verdict
  ├── Decision → Evidence(s) → Verdict
  └── ...
```

- **Mission** is the objective the user is trying to accomplish. It answers
  "what am I trying to get done?" (e.g. "Move to Montreal", "Buy a gaming
  PC"). A Mission is what the current `missionService`/`Mission` model
  already implements: it orchestrates progress and groups everything done
  toward the goal.
- **Decision** is an atomic choice Atlas helps make *inside* a Mission. It
  answers "what's the best choice right now?" (e.g., inside "Move to
  Montreal": "which neighbourhood?", "which bank?", "which phone plan?").
  A Mission may resolve through a single Decision (e.g. "Buy a TV" might be
  one Decision from creation to close) or through many (e.g. "Start a
  business" might involve dozens).
- **Verdict** is the outcome Atlas produces for a Decision: a recommendation,
  its reasoning, and a confidence level (e.g. "RBC — chosen for lower fees
  and branch proximity to your new address, 87% confidence"). It answers
  "what does Atlas recommend, and why?"

**Missions orchestrate progress. Decisions orchestrate reasoning. Verdicts
communicate recommendations.**

### Evidence

A Verdict must never be an unsupported opinion. **Evidence** is the factual
foundation a Verdict is built on: a single factual item attached to a
Decision (e.g. "Product A costs $899 at Best Buy", "RBC offers newcomer
banking packages", "User said budget is $25,000", "The document expires on
2026-09-01"). A Decision can accumulate zero, one, or many Evidence items
over its lifetime. A Verdict without Evidence isn't a lesser Verdict — it
isn't a Verdict at all yet.

### Parsing confidence vs. recommendation confidence — never conflated

Atlas Brain's pipeline (`intentEngine`, `routingEngine`, `scoringEngine`)
already produces a `confidence`/`overallScore` value on every `AxisRequest`.
That number answers one question only: **did Atlas understand and route
this request correctly?** It says nothing about whether a recommended
product, bank, or option is actually good.

**A Verdict's confidence is a different concept and must never be computed
from, or reuse, `scoringEngine`'s `overallScore` or any other parsing-stage
confidence.** Verdict confidence must be derived only from the Evidence
attached to its Decision — and with zero Evidence, a Verdict has no
confidence to report at all. This is a product rule (see [§5](#5-product-rules)),
not an implementation detail, because reusing the wrong number here would
silently manufacture a false sense of precision — exactly what the
product's "never fake precision" doctrine exists to prevent.

### Evidence Normalization

Reasoning cannot honestly operate on free-text claims — a Reasoning Engine
that compares "Product A costs CAD 899" against another claim as raw text
isn't really comparing anything. **Evidence Normalization** is the
deliberately minimal, deterministic derivation of structured values
(numeric, currency, date, boolean, user-provided) from an Evidence item's
`claim`/`metadata`, always traceable back to exactly one Evidence by id.

This is a **derived concept, not a new persisted model**: normalization is
a pure function computed on read from the existing (immutable) Evidence
row, not a new table requiring migration or backfill. This keeps
normalization trivially revisable — extraction rules can improve without
migrating historical Evidence — and keeps Evidence itself untouched, per
this section's Evidence definition above. Normalization does this sprint
via hardcoded deterministic parsing only; no NLP, no LLM extraction. Scoped
for implementation in Sprint-005.

### Measure — what a normalized value represents

Sprint-006 exposed a gap: two normalized values can share `kind` and
`currency` while measuring entirely different things (a product's price
and a user's stated budget are both `currency`/`CAD`, but comparing them is
meaningless). **Measure** is an optional semantic hint on a Normalized
Value — a small, fixed vocabulary (`price`, `budget`, `rent`, `salary`,
`unknown`; extended only when a concrete case needs a new one, not
speculatively) describing what the value represents, read from
`Evidence.metadata` when present or inferred from a tiny set of obvious
keyword patterns in `claim` (e.g. "costs"/"price is" → `price`). Two
values are only ever comparable when they share `kind`, `currency` (if
applicable), **and** `measure`.

**A value with no recognized measure can never join a comparable group —
not even with another value that also has no recognized measure.**
"Unknown" is not itself a measure two things can share; it means Atlas
doesn't know what the value represents, and two unknowns are not
thereby known to be the same unknown. This closes a wording ambiguity
from Sprint-007's original proposal, which suggested unknown-measure
values might sometimes be "safely considered the same" — that would have
reintroduced exactly the guessing this section exists to prevent. Scoped
for implementation in Sprint-007.

### Structured Evidence input (Sprint-008)

Evidence has, since Sprint-004, always allowed an optional `metadata` blob;
Sprint-005/007's normalization already treats it as authoritative when
present and validly shaped, falling back to claim-parsing only otherwise.
Sprint-008 exposes this to users directly — an optional, collapsed-by-
default structured form alongside the default free-text input, writing
into the same `metadata` shape that already exists, with no new field
names and no schema change. Natural language remains the default and
sufficient path; structured input only ever improves precision for users
who choose it. An absent/blank measure in structured input is not an
error — it means "unknown," exactly as it already does when inferred from
claim-parsing (see "Measure" above). Only a measure value that doesn't
match the recognized vocabulary is rejected.

### Evidence acquisition — internal sources first (Sprint-009)

Evidence has so far only ever been typed by hand (Sprint-004 free text,
Sprint-008 structured input). The natural next source isn't external: it's
data Atlas already stores about the user — `Memory` and, later, `Document`
— which is just as much free text as a hand-typed claim, and crosses no
new trust boundary since the user already put it there themselves.

**Internal sources (Memory/Document) are not Skills and not Providers.**
A Skill with `sideEffects: "external"` (RFC-0003 §2) is the right shape
for a genuinely external source (web, third-party API) later — it isn't
needed here. Pulling in a Memory is a third Evidence *creation path*,
alongside Sprint-004's free text and Sprint-008's structured input, reusing
the same validation/persistence — not a new architectural concept.

**Always an explicit user gesture, never automatic.** Atlas must not
silently turn stored Memory/Documents into Evidence in the background —
the user picks what gets attached, the same discipline Sprint-008 used for
structured input ("never force, never surprise"). This also sidesteps
needing any relevance-ranking/search capability (RFC-0003 §9's speculative
`retrieve_memory` Skill implies a ranked `query` — that's not built here;
the user's own judgment substitutes for it).

**External sources remain deliberately out of reach.** Free-text web
content requires real language understanding to extract a clean claim,
which conflicts with the "no NLP, no LLM" discipline held since Sprint-005.
When an external source is eventually added, prefer one returning
already-structured data (typed API fields) over anything requiring reading
prose, to keep deferring that larger, separate product decision.

### Document-sourced Evidence — designed, deliberately not built yet

Reviewed 2026-07-10, before any Sprint-010 implementation. The design, for
whenever its prerequisite exists (see below): Document-sourced Evidence
attaches an **excerpt**, never a whole Document — `claim` stays "a single
factual item" (this section, above), and a multi-paragraph document dumped
into `claim` would break normalization's pattern-matching and the Evidence
list UI alike. The user selects/trims the excerpt themselves, verbatim —
no deterministic "pick the sentence with a number in it" heuristic and no
future extraction Skill; both would guess at relevance exactly like the
ranked-search this RFC already rejected for Memory (see above). A generous
length ceiling on the excerpt is a blunt shape guard against pasting a
whole document unedited, not a smart heuristic. Traceability: additive
`metadata.documentId` plus a denormalized `metadata.documentTitle` (so
display survives a later rename or deletion) — no `page`/`section` fields,
since `Document` has no such structure today (flat `title`/`content`) and
inventing one speculatively would be premature.

**Not scoped for Sprint-010.** Verified in code: no path anywhere creates
a `Document` row — `src/brain/planning/planningEngine.ts`'s `document`
case only produces a *description* of a "save document" step
(`planStep.saveDocument`); nothing executes it. This is the same
unimplemented gap RFC-0003 §9 already flagged for `create_task` ("Axis
currently produces a task-routed ExecutionPlan but no real Task rows are
created from a plan yet") — Document is in the identical situation.
Building a picker for Documents nothing can create would itself be a mild
form of fake work. Document-sourced Evidence should wait until the
Document module has a real, honest save path.

### Calendar Event Evidence — Path E (Sprint-016)

The first *external* Evidence creation path, once Google Calendar (RFC-0003
§8c, Sprint-015) gave Atlas somewhere real to read from. Same discipline as
every prior path: an explicit, visible user gesture (the user browses their
own upcoming events and picks one), never automatic, never a background
import. Evidence stores an **immutable snapshot** at attachment time — the
Google Calendar Provider stays the sole source of truth for the live event;
Atlas never re-syncs, never edits, and never creates a calendar event. If
the source event later changes or is deleted on Google's side, the
attached Evidence is unaffected — exactly the same relationship Document
Evidence (Path D) already has with a Document excerpt.

**No new persisted model, no new Provider concept.** `Evidence.metadata`
already exists and already carries `source*` traceability keys for Memory
(`sourceMemoryId`) and Document (`sourceDocumentId`/`sourceDocumentTitle`)
— Calendar adds `sourceProvider`/`calendarEventId`/`calendarEventTitle`/
`calendarCalendarId` to that same `Json?` column, no schema change.
`read_calendar` (RFC-0003 §8c) is reused exactly as built — this path adds
no Skill, no Provider method, and no change to `normalizeEvidence`,
`find_lowest_value`, or Verdict computation, which all operate on
`claim`/`metadata` the identical way regardless of which of the five paths
produced them.

**The server re-resolves the event by id — it never trusts client-supplied
event content.** The client only ever sends `calendarEventId`; the service
calls `read_calendar` again itself and looks up that id in the fresh
result, deriving `claim`/`observedAt`/`metadata` from that authoritative
re-fetch. This mirrors Path C/D exactly (`memoryId`/`documentId` are looked
up server-side; a client never gets to supply `claim` directly for an
internal-source path) and additionally guards against a stale client-held
event list, since Calendar has no persisted row to re-fetch by id the way
Memory/Document do.

### Relationship to Modules

Modules (Shopping, Travel, Finance, Documents, ...) do not own or manage
Missions — a Mission can span multiple modules. Each Module specializes in
producing high-quality Decisions of its kind: Shopping produces Decisions
about products, Travel about itineraries and documents, Finance about
budgeting and accounts. This is also what makes "Decision" a universal,
domain-agnostic concept rather than something scoped to Shopping — every
module produces the same shape of Decision → Verdict, just about different
things.

### Relationship to the current implementation

As of this RFC, `AxisRequest` (`src/brain/`, `prisma/schema.prisma`) is the
record of one pipeline run — one raw input parsed, scored, and planned.
**`Decision` is a new, coarser object, distinct from `AxisRequest`**: a
Decision groups one or more `AxisRequest`s that all address the same atomic
choice (e.g. three back-and-forth `AxisRequest`s while narrowing down "which
bank?" belong to one Decision), the same way a Mission groups `AxisRequest`s
across its whole lifetime today. The hierarchy is therefore:

```
Mission → Decision → AxisRequest (one or more) → Verdict (on the Decision)
```

`AxisRequest` itself is not renamed and does not gain a `Verdict` field —
`Verdict` belongs to `Decision`, computed once enough `AxisRequest`s under it
give Atlas Brain sufficient signal to recommend something.

No code or schema changes are implied by this section alone. It documents
the product decision so implementation (whenever it happens — likely a new
`Decision` Prisma model with a `missionId`, an ordered relation to
`AxisRequest`, and a `Verdict` field/relation) has a settled concept to
build against, per the product rule that architecture is not decided
implicitly through code drift.

### Decision Lifecycle

```
Open → Collecting information → Reasoning → Ready → Resolved → Archived
```

- **Open** — the Decision exists but Atlas hasn't started working it.
- **Collecting information** — Atlas Brain is gathering what it needs (this
  is where a blocked `AxisRequest`, per the current `MissionCurrentFocus`
  model, lives).
- **Reasoning** — enough information exists; Atlas Brain is evaluating
  options. No engine does this yet — today's deterministic mocks skip
  straight from "enough info" to producing a plan, not a reasoned Verdict.
- **Ready** — a Verdict could be produced but hasn't been confirmed/shown
  yet.
- **Resolved** — a Verdict exists and the Decision is considered answered.
- **Archived** — the Decision is no longer active (superseded, abandoned
  with the Mission, or the Mission itself completed/abandoned).

This lifecycle governs a single Decision's internal state. It does not by
itself say how or when a *new* Decision gets created within a Mission —
that remains an open question (see [§11](#11-open-questions)).

### Verdict Acceptance — Resolved means a user decision (Sprint-017)

This section's original wording ("Resolved — a Verdict exists and the
Decision is considered answered") reads as if a Verdict reaching
`PRODUCED` were itself enough to resolve the Decision. It is not, and
never has been by design — this note makes that explicit now that a real
UI exists for it.

**A produced Verdict is a recommendation. A resolved Decision is a user
decision. These are permanently different concepts, and a Verdict must
never automatically resolve a Decision.** `RESOLVED` is reached only
through an explicit user action: **accepting** Atlas's recommendation, or
recording that a **different** outcome happened instead. No timeout, no
inferred acceptance, no automation — the same "never force, never
surprise" discipline every Evidence-acquisition path has followed since
Sprint-008.

Declining does not trigger new reasoning. The Verdict that was produced
stays exactly as produced — Atlas's recommendation is a historical record
of what it once recommended, not a live value that revises itself. A
user's free-text account of what actually happened is stored as the
Decision's own resolution note, never fabricated into new Evidence and
never fed back into `find_lowest_value` or any other Skill.

**Schema consequence:** `Decision` gains two additive, nullable fields —
`resolutionOutcome` (`ACCEPTED` | `DECLINED`) and `resolutionNote`
(populated only for `DECLINED`) — set exactly once, when `RESOLVED` is
reached through this flow. This is a real, if small, schema change; it
is additive only (no existing column altered), consistent with every
other Evidence/Verdict-adjacent sprint's schema discipline.

**Timeline consequence:** the Mission Timeline (`DecisionTimelineEntry[]`,
`src/domain/decision.ts`) has always been a pure derivation from a
Decision's ordered `AxisRequest`s — there is no persisted "Timeline
event" concept to append a new kind into. Accepting/declining a Verdict
never runs the Axis pipeline, so it produces no `AxisRequest`. The
Timeline gains a second *kind* of derived entry: `buildDecisionSummary`
appends one synthetic final entry, built directly from the Decision row's
own `resolutionOutcome`/`resolutionNote`/`updatedAt`, when those fields
are set — not a new persisted event log, the same "derive on read, don't
persist an intermediate" discipline as Evidence Normalization.

### Sequential Multi-Decision Missions (Sprint-018)

Resolves the question left open since Sprint-003 ("Deciding when a Mission
needs a second/third Decision is deferred — it requires planning
capability Atlas Brain doesn't have yet") and sharpened by the Sprint-017
Architecture Review. Settles three things code review surfaced beyond the
review's own scope:

**`currentFocus` and `activeDecision` read from different data, on
purpose.** `activeDecision` is the Mission's open (not `RESOLVED`/
`ARCHIVED`) Decision — nullable, since between a resolution and the next
user update there is none. `currentFocus` is **not** simply "the active
Decision's focus, or a fallback when null" — it is derived from the
Mission's most recently created Decision *regardless of whether it's
still open*, so a just-resolved Decision's "Done — accepted" headline
(Sprint-017) keeps showing until the user's next message creates the
next Decision. Conflating these two into one nullable field would
regress Sprint-017's own resolved-state display the moment
`activeDecision` goes null.

**The Mission Timeline becomes Mission-scoped, not Decision-scoped.**
`MissionSummary.timeline` was `activeDecisionSummary.timeline` — a slice
of exactly one Decision. With more than one Decision per Mission, that
silently drops every earlier Decision's history the moment a new one
starts. The Timeline is now the concatenation of every one of the
Mission's Decisions' own (already-ordered) timelines, oldest Decision
first — each Decision's trailing resolution entry (Sprint-017) already
sits immediately before the next Decision's founding entry in that
stream, telling the transition without a synthetic "Decision created"
event.

**"No Decision exists yet" and "no Decision is currently open" are
different states, checked at the same call sites, not just inside one
renamed function.** Every read path that used to call
`ensureDecisionForMission` (`getMissionSummary`, `listMissionSummaries`,
not only `addMissionUpdate`) must tell apart a legacy Mission with zero
Decisions ever (the original Sprint-003 backfill case) from a Mission
that has Decisions but none currently open (the new, ordinary,
post-Sprint-017 state) — the latter is not an error and must not trigger
backfill logic.

### Mission Completion Semantics (Sprint-020)

**Decision resolution and Mission completion are permanently distinct
concepts — the same discipline Sprint-017 established for Verdict vs.
Decision, applied one level up.** A resolved Decision does not imply a
completed Mission; no number of resolved Decisions automatically proves
the Mission's objective was accomplished. `Mission.status` reaching
`COMPLETED` or `ABANDONED` is reached only through an explicit user
action — never inferred from Decision counts or Decision state.

**Completing or abandoning a Mission with an open Decision archives that
Decision — it never resolves it.** Before this sprint,
`missionService.setMissionStatus` marked the Mission's open Decision
`RESOLVED` on completion, as if the user had accepted a recommendation —
factually wrong, since nothing was necessarily decided. Both `COMPLETED`
and `ABANDONED` now transition an open Decision to `ARCHIVED` identically;
`resolutionOutcome`/`resolutionNote` are never set by this path — only
`decisionService.resolveDecision`'s explicit accept/decline flow
(Sprint-017) ever sets those. Verdicts and Evidence are never modified by
either transition, the same immutability precedent as declined Verdicts.

**Schema consequence:** `Mission` gains two additive, nullable fields —
`outcomeAt` (`DateTime?`) and `outcomeNote` (`String?`) — set once,
together, when the transition succeeds. No separate `completionOutcome`/
`abandonmentReason`: `MissionStatus`'s two terminal values already are the
outcome (unlike `Decision.status`, where `RESOLVED` alone doesn't
distinguish accepted from declined — a Mission's terminal states carry no
equivalent ambiguity, so no parallel enum is needed). The note is optional
for both transitions, never mandatory — unlike Sprint-017's declined-note
requirement, completing or abandoning a Mission doesn't contradict a
specific recommendation, so the "why" doesn't carry the same evidentiary
weight a decline's does; mandatory friction here risks Missions being left
stuck `ACTIVE` rather than honestly closed out.

**The transition itself is a single atomic conditional write, not a
read-then-write.** `missionRepository.transitionToTerminalStatus` performs
one `UPDATE ... WHERE status = 'ACTIVE'`; a second, concurrent, or late
call against an already-terminal Mission matches zero rows and reports
failure, without a transaction or elevated isolation level. This is
deliberately simpler than Sprint-018's Decision-creation race (a genuine
check-then-create across two statements) — a correctly-scoped `WHERE`
clause is sufficient for a single-statement transition, and reaching for
`Serializable` isolation here would be unjustified weight.

**A terminal Mission accepts no further updates.**
`missionService.addMissionUpdate` rejects any call against a
non-`ACTIVE` Mission before it ever looks at Decision state — closing a
gap that predates this sprint: nothing previously stopped a direct API
call from starting a new Decision (via the Sprint-018 "no Decision
open" branch) under an already-completed or already-abandoned Mission.

**Current Focus is overridden, not replaced, once a Mission is
terminal.** `decisionService.computeDecisionFocus` stays completely
unchanged — a Mission-level focus (a new headline, no detail) is computed
in `missionService.buildMissionSummary` and substituted only when
`mission.status !== "ACTIVE"`, the same "wrap the pure function, don't
modify it" pattern Sprint-019 used for `journeyStatus`/`number`. Otherwise
a just-archived Decision's own focus (e.g. "Archived") would display with
no explanation of why, decoupled from the Mission's actual, distinct
outcome.

**No new persisted Timeline event, and no extension of
`DecisionTimelineEntry`.** A `MissionEvent` model was considered and
rejected. A derived-on-read entry was kept — but not by extending
`DecisionTimelineEntry`'s union: since Sprint-019's Decision-grouped
rendering, `MissionSummary`'s flat `timeline` field is no longer rendered
by anything (only per-Decision slices, via `DecisionCard`, are) — a
"mission-outcome" member of that union would type-check but never reach
the screen. Instead, `MissionSummary` gains a separate
`outcomeEntry: MissionOutcomeEntry | null` field, synthesized in
`missionService.buildMissionSummary` only when the Mission is terminal
**and** `outcomeAt` is set (never fabricated for legacy terminal rows),
rendered by the Mission page as one small element after the Decision
Journey list — outside every `DecisionCard`, since a Mission-level fact
doesn't belong nested inside a Decision-scoped component. `outcomeAt`/
`outcomeNote` are also exposed as plain fields for the Hero's own,
separate terminal-status display.

**The Mission transition and the Decision archive share one Prisma
transaction — an existing codebase pattern, not a new one.**
`axisRequestRepository.saveAxisResult` already opens
`prisma.$transaction` and threads the resulting `tx` into
`atlasStateRepository`/`memoryRepository`/`learningRepository`; Sprint-020
reuses the identical shape (`missionService.setMissionStatus` opens the
transaction; `missionRepository.transitionToTerminalStatus` and
`decisionRepository.setDecisionStatus` each gain an optional trailing
`tx` parameter, defaulting to the module-level client). Repository
ownership stays exactly scoped — `missionRepository` only ever writes
`Mission`, `decisionRepository` only ever writes `Decision` — only the
orchestration spans both. The Decision-archive write inside that
transaction is conditional (`status NOT IN (RESOLVED, ARCHIVED)`), not a
blind update: it protects against a genuine race where the open Decision
is resolved via the ordinary accept/decline flow at nearly the moment the
Mission is being completed — in that case the already-`RESOLVED` Decision
is correctly left untouched, and the Mission still completes.

### Scope discipline for initial implementation

The first implementation of Decision (see Sprint-003) is intentionally
limited to **one Decision per Mission** — Decision as a thin, correctly-
shaped wrapper around what a Mission already does today (per Sprint-002),
not yet the multi-Decision breakdown shown in the example above. Nothing in
Atlas Brain today (deterministic, rule-based mocks — see
[RFC-0002](./RFC-0002-Brain-Pipeline.md)) can decompose a goal like "buy a
gaming PC" into a sequence of Decisions; that's a real planning capability
that doesn't exist yet, not a plumbing gap. The Decision *model* and
*persistence* should be shaped so a Mission can hold many Decisions without
a rewrite later (per [§11](#11-open-questions)), but the logic that decides
*when a second Decision should exist* is explicitly out of scope until
Atlas Brain can actually reason about it.

## 5. Product Rules

- **Axis is not a module.** It is the universal structured representation of
  any request, independent of domain.
- **Axis is not shopping.** Axis must never be conflated with, or scoped to,
  a specific vertical use case (e.g. a shopping module) — it is task-agnostic
  by construction.
- **Atlas Brain must remain domain-agnostic.** No module-specific business
  logic is allowed inside Atlas Brain engines.
- **Modules must stay thin on cross-cutting reasoning.** Which Module a
  request belongs to, the overall plan, and how automatable it is stay
  exclusively in Atlas Brain. Modules may own domain-scoped Module Agents
  for expertise Atlas Brain deliberately doesn't have (see [RFC-0003
  §7](./RFC-0003-Skill-System.md#7-modules-agents-and-cross-module-interconnection))
  — but those Agents still act only through Skills, never bypassing the
  Skill Engine or reasoning about other Modules.
- **Skills are reusable across modules.** A Skill is not owned by the module
  that first needed it.
- **Parsing confidence and recommendation confidence are never the same
  number.** `scoringEngine`'s `overallScore` measures whether Atlas
  understood and routed a request correctly. A Verdict's confidence
  measures how well-supported a recommendation is by Evidence. Reusing one
  for the other is a fake-precision bug, not a shortcut (see [§4](#4-mission-decision-and-verdict)).
- **Every interaction should create learning signals.** Requests, decisions,
  corrections, ignored recommendations, accepted recommendations, and
  abandoned workflows are all signals Atlas must record.
- **Atlas should optimize for real-life task completion, not just
  answering.** A correct answer that doesn't move the user's actual task
  forward is an incomplete result.

These rules restate and extend the permanent Atlas product doctrine
established before this RFC; where the two overlap, the doctrine is
authoritative.

## 6. Why This Architecture Exists

Atlas is meant to grow to cover many domains of everyday life without a
rewrite each time. Two failure modes drive this architecture:

1. **Intelligence leaking into modules.** If reasoning, routing, or planning
   logic lives inside a module, every new module has to re-implement it
   (or worse, diverges from it). Keeping intelligence exclusively in Atlas
   Brain means a new module only has to describe what it can do, not how to
   decide when to do it.
2. **Capabilities getting siloed per module.** Without a Skills layer,
   "extract a due date" or "send a notification" gets reimplemented inside
   every module that needs it. Skills exist so capability, not just
   intelligence, is shared.

The Interface layer is kept separate from Axis for the same reason: chat,
dashboard, forms, and future surfaces (mobile, browser extension) should all
produce the same structured request shape, so Atlas Brain never has to know
which surface a request came from.

## 7. What Belongs in Atlas Brain

- Intent classification, entity extraction (normalizing a request)
- Context assembly (Memory, Atlas State, Conversation, Task lookups relevant
  to the request)
- Atlas State transitions (what the request implies about the user's
  ongoing situation)
- Routing (which module should own this) and planning (what steps are
  required, what's missing, how automatable it is)
- Scoring (confidence at every stage of the above)
- Learning signal derivation (what this interaction teaches Atlas)

Nothing in this list should ever branch on "if module === X". Atlas Brain's
output is a decision *about* modules, never logic written *for* one.

## 8. What Belongs in Skills

- A single, well-named, reusable unit of capability (e.g. "create reminder",
  "parse a date range", "send a message", "summarize text").
- No awareness of which module invoked it — a Skill takes typed input and
  produces typed output.
- No reasoning about *whether* it should run — that's the Skill Planner's
  job. A Skill just does the thing it's asked to do.

## 9. What Belongs in Modules

- Domain-specific data (a Task's fields, a Document's fields).
- Declaring which Skills the module needs, and how a Skill's output maps
  onto the module's own data.
- Domain-specific presentation concerns (how a Task looks vs. how a
  Document looks), if any.
- Owning one or more Module Agents: domain-specialized reasoning scoped to
  that Module only, acting exclusively through Skills (see [RFC-0003
  §7](./RFC-0003-Skill-System.md#7-modules-agents-and-cross-module-interconnection)).

## 10. What Does NOT Belong in Modules

- Intent detection, routing, or planning logic — that's Atlas Brain's job.
- Duplicated implementations of capabilities that already exist as Skills.
- Direct reads/writes of another module's data.
- Anything that decides *whether* Atlas should act — modules execute
  decisions, they don't make them.

## 11. Open Questions

- Is the existing Planning Engine's `ExecutionPlan` (in `src/brain/planning/`)
  the same artifact the Skill Planner consumes, or does the Skill Planner
  produce its own separate plan? (See [§3](#3-target-architecture) for the
  current working assumption.)
- Where does a Skill's implementation physically live — inside Atlas Brain,
  inside a shared `src/skills/` tree, or inside the module that first
  needed it (with a registry exposing it to others)?
- How does the Skill Engine report partial failure back to Atlas Brain in a
  way that produces a useful learning signal?
- How do Interfaces other than the current web dashboard (mobile, browser
  extension) authenticate and produce Axis requests without duplicating
  Interface-side logic?
- Does Atlas State get updated before or after Skill execution completes,
  given execution can fail or be partial?
- What signal tells Atlas Brain that a new `AxisRequest` belongs to an
  *existing* open Decision versus starting a *new* Decision within the same
  Mission? (E.g. two follow-up messages about "which bank?" are the same
  Decision; a message about "which phone plan?" right after starts a new
  one.) This is a Context/Routing Engine concern once Decision exists.
  ([RFC-0003 §7](./RFC-0003-Skill-System.md#7-modules-agents-and-cross-module-interconnection)
  gives a conceptual answer for the multi-Module case — Module Agents
  surfacing as `SkillCall`s the Skill Planner sequences — but the exact
  signal for when to open a second Decision is still unresolved.)
- ~~How many Agents does each Module start with, and who reconciles
  conflicting input from multiple Agents contributing to the same Decision
  before a single Verdict is produced?~~ **Resolved 2026-07-13** for
  Shopping, the first real Module: four Agents at once (Price, Reviews,
  Quality, Brand — one per recognized comparison measure, none persisted),
  reconciled by a new deterministic Skill, `compare_options`. See [RFC-0003
  §7a](./RFC-0003-Skill-System.md#7a-first-real-module-shopping-sprint-029030).
  Whether every future Module follows this same "N measures, one
  reconciling Skill" shape, or some other Module needs a genuinely
  different reconciliation mechanism, remains open until a second Module
  exists to compare against.
- **Should Atlas Brain evolve from deterministic rule-based engines into a
  genuine learning/reasoning AI?** As of Sprint-029, every Atlas Brain
  engine (intent, entity, routing, planning, scoring, learning —
  [§7](#7-what-belongs-in-atlas-brain)) is deterministic and rule-based —
  no LLM, no inference, no guessing, a discipline held without exception
  since Sprint-002. The product vision (recorded 2026-07-13, from Romain)
  goes further: Atlas Brain should understand purchasing behavior — and
  user behavior generally — across every parameter of a user's life,
  retain and reason over that understanding, and function as a genuine
  standalone intelligence rather than a fixed rule set ("un cerveau à part
  entière"). This is not a small extension of the current architecture —
  it's a different reasoning substrate underneath the same responsibilities
  §7 already assigns Atlas Brain. Notably, the *data* this vision would
  reason over already exists and is already being collected: `AtlasState`
  (`activeDomains`, `priorities`, `preferences`, `activeProjects`) and
  `LearningSignal` (every interaction outcome, since Sprint-002) are both
  populated on every request today — nothing new needs to be built to
  start capturing the substrate. What's genuinely undecided is the
  reasoning layer on top of it, and how it would coexist with (or
  eventually replace) today's deterministic engines. RFC-0003 §10 already
  asks a version of this question from the Skill side ("How should
  LLM-backed Skills be tested deterministically, given Atlas Brain's own
  engines are deliberately deterministic mocks today?") — this is the
  Atlas-Brain-level version of the same fork. **Explicitly not in scope for
  Sprint-029/030** — Shopping's four Agents stay fully deterministic (RFC-0003
  §7a). Recorded here so the vision isn't lost, to be taken on as its own
  dedicated architecture review once the product is ready for it.
- ~~Is a Verdict always produced (with `not_enough_data` as a valid verdict,
  per earlier product exploration), or only once a Decision has enough
  signal to recommend something?~~ **Resolved 2026-07-09:** yes — a
  Decision's Verdict defaults to an explicit "insufficient evidence" state
  and only ever carries a real recommendation once Evidence exists. See
  [§4](#4-mission-decision-and-verdict) and Sprint-004.
- Do all modules produce Decisions the same way, or does this only apply
  once Shopping (the first module) is built, with the pattern generalized
  afterward?
- Can a Decision's Verdict change after it's been reached (e.g. a price
  drops, a recall happens), and if so, does that re-open the Decision or
  create a new one linked to it?

## 12. Decision Log

| Date | Decision | Status |
| --- | --- | --- |
| 2026-07-08 | RFC-0001 opened to document the target architecture ahead of freezing official docs. | Recorded |
| 2026-07-09 | Mission → Decision → Verdict adopted as the product hierarchy: Mission is the objective, Decision is an atomic choice within it, Verdict is Atlas's recommendation for a Decision. Mission does not replace Decision — it's the parent object. Documented in [§4](#4-mission-decision-and-verdict). | Recorded |
| 2026-07-09 | `Decision` is a new object distinct from `AxisRequest`, grouping one or more `AxisRequest`s that address the same atomic choice (`Mission → Decision → AxisRequest(s) → Verdict`). `AxisRequest` is not renamed and does not itself gain a `Verdict` field. | Recorded |
| 2026-07-09 | Decision Lifecycle adopted: Open → Collecting information → Reasoning → Ready → Resolved → Archived. Documented in [§4](#4-mission-decision-and-verdict). | Recorded |
| 2026-07-09 | First Decision implementation (Sprint-003) scoped to one Decision per Mission. Deciding when a Mission needs a second/third Decision is deferred — it requires planning capability Atlas Brain doesn't have yet, not just a schema/UI change. | Recorded |
| 2026-07-09 | Module Agents introduced: each Module may own one or more specialized Agents (domain-scoped reasoning Atlas Brain deliberately doesn't have), acting only through Skills. Cross-Module requests are coordinated by the Skill Planner sequencing `SkillCall`s across Agents — the conceptual mechanism for how a Mission could eventually span multiple Decisions across Modules. Documented in RFC-0003 §7. | Recorded |
| 2026-07-09 | Evidence introduced as a first-class concept between Decision and Verdict (`Mission → Decision → Evidence(s) → Verdict`). A Verdict must never be an unsupported opinion. Verdict confidence must be derived only from Evidence and must never reuse `scoringEngine`'s parsing-stage `overallScore` — these are declared permanently distinct concepts (see [§5](#5-product-rules)). Absent Evidence, a Decision's Verdict defaults to an explicit "insufficient evidence" state rather than a fabricated recommendation. Scoped for implementation in Sprint-004. | Recorded |
| 2026-07-09 | Evidence Normalization introduced as a derived concept (structured numeric/currency/date/boolean/user-provided values extracted deterministically from an Evidence item), explicitly NOT a new persisted model — a pure function computed on read, so extraction rules can evolve without migrating historical Evidence. Traceability back to the source Evidence is by id. Scoped for implementation in Sprint-005. | Recorded |
| 2026-07-09 | Measure introduced on Normalized Values (small fixed vocabulary: price/budget/rent/salary/unknown, extended only when a concrete case needs it). Comparability now requires matching kind + currency + measure. A value with no recognized measure can never join a comparable group, including with another unknown-measure value — no exception. Scoped for implementation in Sprint-007. | Recorded |
| 2026-07-09 | Structured Evidence input exposed to users (optional, collapsed by default) — writes into Evidence's existing `metadata` shape, no new field names, no schema change. An absent/blank measure stays a valid "unknown" state, not a validation error; only an unrecognized measure string is rejected. Scoped for implementation in Sprint-008. | Recorded |
| 2026-07-10 | Memory introduced as a third Evidence creation path (alongside free text and structured input) — an internal source, not a Skill or Provider, always via explicit user selection, never automatic. Document-sourced Evidence and any external (web/API) source are explicitly deferred. Scoped for implementation in Sprint-009. | Recorded |
| 2026-07-10 | Document-sourced Evidence designed (excerpt only, user-selected, verbatim, traced via `metadata.documentId`/`documentTitle`) but explicitly NOT scheduled for Sprint-010 — no code path anywhere creates a `Document` row yet (same unimplemented gap as `create_task`, RFC-0003 §9). Document-sourced Evidence waits until the Document module has a real save path. | Recorded |
| 2026-07-10 | Calendar Event Evidence (Path E) introduced as Atlas's first external Evidence source, built on Sprint-015's Google Calendar Provider. No new persisted model or schema change — reuses `Evidence.metadata`'s existing `Json?` column and `read_calendar` exactly as built. Evidence is an immutable snapshot; the client sends only `calendarEventId`, and the service re-resolves the event server-side via a fresh `read_calendar` call rather than trusting client-supplied event content — the same "server re-derives, never trusts the client for `claim`" discipline as Memory/Document Evidence. Documented above ("Calendar Event Evidence — Path E"). Scoped for implementation in Sprint-016. | Recorded |
| 2026-07-10 | Verdict Acceptance introduced: `RESOLVED` is reached only via explicit user action (accept the recommendation, or record a different outcome), never automatically when a Verdict becomes `PRODUCED` — clarifies the Decision Lifecycle's original "Resolved" wording. A declined Verdict is never revised, and a user's free-text account of what happened is never turned into Evidence or re-fed into any Skill. `Decision` gains additive `resolutionOutcome`/`resolutionNote` fields; the Mission Timeline gains a second, derived-not-persisted entry kind for the resolution. Documented above ("Verdict Acceptance — Resolved means a user decision"). Scoped for implementation in Sprint-017. | Recorded |
| 2026-07-10 | Sequential Multi-Decision Missions resolved: a Mission may hold many Decisions over time but at most one open (non-`RESOLVED`/`ARCHIVED`) at once; the sole trigger for the next Decision is an explicit user update arriving while none is open — never semantic decomposition, never automatic follow-up generation. No `Mission.activeDecisionId`; the active Decision is a repository query (newest non-closed). `currentFocus` (latest Decision, open or resolved) and `activeDecision` (open only, nullable) are deliberately different derived values. Mission Timeline becomes Mission-scoped (concatenated across all Decisions), not Decision-scoped. `ensureDecisionForMission`'s legacy backfill (zero Decisions ever) stays distinct from the new "has Decisions, none open" state at every call site, not only inside one function. Documented above ("Sequential Multi-Decision Missions"). Scoped for implementation in Sprint-018. | Recorded |
| 2026-07-11 | Mission Completion Semantics resolved: Decision resolution and Mission completion are permanently distinct; completing or abandoning a Mission archives its open Decision, never resolves it (fixes a live defect where completion incorrectly set `RESOLVED`). `Mission` gains additive `outcomeAt`/`outcomeNote` — no separate outcome enum, `MissionStatus` already carries it. The terminal transition is one atomic conditional `UPDATE` (`WHERE status = 'ACTIVE'`), not a transaction — sufficient without `Serializable` isolation. A terminal Mission rejects further updates (`addMissionUpdate` gains an explicit status guard, closing a gap that predated this sprint). Current Focus is overridden at the Mission level once terminal, without modifying `computeDecisionFocus` itself. No new Timeline event or persisted model — `outcomeAt`/`outcomeNote` surface as plain `MissionSummary` fields, since the flat Timeline is no longer rendered anywhere post-Sprint-019. Documented above ("Mission Completion Semantics"). Scoped for implementation in Sprint-020. | Recorded |

No decisions in this RFC have been formally accepted yet — this document
remains in **Draft** until the product owner marks it otherwise.
