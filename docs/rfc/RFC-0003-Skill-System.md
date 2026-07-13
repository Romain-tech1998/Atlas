# RFC-0003: Skill System

- **Status:** Draft
- **Created:** 2026-07-08
- **Updated:** 2026-07-09
- **Related:** [RFC-0001: Atlas Core Architecture](./RFC-0001-Atlas-Core-Architecture.md), [RFC-0002: Brain Pipeline](./RFC-0002-Brain-Pipeline.md)

## Summary

This RFC defines the Skill system precisely enough to implement it: what a
Skill is, its anatomy, the `SkillCall`/`SkillResult` contract, the initial
Skill categories, the rules Skills must follow, how Skills relate to Modules
and Atlas Brain, and a concrete MVP registry of 12 Skills. It also settles
the layering question RFC-0001 §11 left open:

> **Planning Engine is strategic — it decides *what* should be done.**
> **Skill Planner is tactical — it translates an `ExecutionPlan` into
> ordered `SkillCall`s.**
> **Skill Engine is execution — it runs `SkillCall`s and returns
> `SkillResult`s.**

This is the official decision for that layering (see [§11](#11-decision-log)).
It does **not** make this RFC Accepted — the sections below still carry open
questions, and no Skill or Skill Engine code exists yet. This remains
documentation only.

## 1. What Is a Skill?

A Skill is an **atomic, reusable capability that can be composed across
modules**. A Skill does exactly one thing, takes typed input, produces typed
output, and has no knowledge of which module or which request triggered it.

Examples:

- `extract_entities`
- `summarize`
- `compare_options`
- `draft_message`
- `create_checklist`
- `estimate_budget`
- `search_web`
- `classify_document`
- `rename_document`
- `create_task`
- `schedule_event`
- `ask_clarifying_question`
- `save_memory`
- `retrieve_memory`

Two of these (`extract_entities`, and its cousin `classify_intent` in the
MVP registry below) already exist as *engines inside Atlas Brain*
(`src/brain/entity/`, `src/brain/intent/`) that run once, automatically, on
every raw request as part of Axis parsing. Their Skill versions are not a
duplication — they're the same capability made independently callable, for
cases where something *other* than the initial Axis parse needs to extract
entities or classify intent (e.g. re-extracting entities from a retrieved
memory, or classifying the intent of a stored Conversation message). See the
per-skill notes in [§9](#9-mvp-skill-registry).

## 2. Skill Anatomy

Every Skill must declare:

| Field | Meaning |
| --- | --- |
| `id` | Stable, unique, machine-readable identifier (snake_case, e.g. `create_task`). Never reused for a different capability. |
| `name` | Human-readable name, for UI and logs. |
| `description` | One-paragraph explanation of what the Skill does and when it applies. |
| `version` | Semver string. A breaking change to `inputSchema`/`outputSchema` requires a version bump, not a silent change. |
| `category` | One of the categories in [§5](#5-skill-categories). |
| `inputSchema` | Schema describing valid input. Invalid input is rejected before execution, not during. |
| `outputSchema` | Schema describing the shape of a successful `SkillResult.output`. |
| `requiredPermissions` | List of permission scopes the caller must hold (e.g. `["memory:write"]`); empty for pure/read-only Skills. |
| `sideEffects` | Declared effect the Skill has on the world: `none`, `read`, `write`, or `external` (e.g. calling a third-party API). Never left implicit. |
| `timeout` | Maximum duration the Skill Engine allows before aborting the call and returning a timeout error. |
| `retryPolicy` | Whether/how many times a failed call is retried, and which failure classes are retryable (e.g. retry on timeout, don't retry on invalid input). |
| `observability events` | The lifecycle events this Skill emits (`started`, `progress`, `completed`, `failed`) so execution is traceable end to end. |
| `learning signals` | Which `LearningSignal` types this Skill's execution should contribute to (see [§8](#8-relationship-with-atlas-brain)). |

## 3. SkillCall

A `SkillCall` is a **planned invocation** of a Skill, produced by the Skill
Planner.

| Field | Meaning |
| --- | --- |
| `id` | Unique id for this specific call. |
| `skillId` | Which Skill (by `id`) this call invokes. |
| `input` | The input payload, matching that Skill's `inputSchema`. |
| `dependencies` | Other `SkillCall` ids this call depends on — it cannot run until they've produced a `SkillResult`. |
| `status` | `pending` \| `running` \| `succeeded` \| `failed` \| `skipped`. |
| `priority` | Relative ordering hint among calls with no dependency relationship. |
| `createdAt` | When the Skill Planner created this call. |

## 4. SkillResult

The output of a `SkillCall`, produced by the Skill Engine.

| Field | Meaning |
| --- | --- |
| `skillCallId` | The `SkillCall.id` this result belongs to. |
| `status` | `succeeded` \| `failed` \| `timed_out` \| `skipped`. |
| `output` | The result payload, matching the Skill's `outputSchema`, when `status` is `succeeded`. |
| `error` | A structured error (code + message), present when `status` is not `succeeded`. |
| `confidence` | How confident the Skill is in its own output, `0`–`1`. |
| `durationMs` | Execution time, for observability and timeout tuning. |
| `learningSignals` | The signals this specific execution produced (see [§8](#8-relationship-with-atlas-brain)). |

## 5. Skill Categories

Initial categories (a Skill has exactly one):

- `understanding` — extracting structure/meaning from input (e.g. `extract_entities`, `classify_intent`, `classify_document`).
- `reasoning` — comparing, deciding, or summarizing (e.g. `compare_options`, `summarize_context`).
- `communication` — producing or handling natural-language output (e.g. `draft_message`, `ask_clarifying_question`).
- `planning` — structuring work (e.g. `create_checklist`, `generate_execution_summary`).
- `memory` — reading or writing Atlas's memory store (e.g. `retrieve_memory`, `save_memory`).
- `documents` — document-specific operations (e.g. `classify_document`, `rename_document`).
- `web` — external web access (e.g. `search_web`).
- `calendar` — scheduling (e.g. `schedule_event`).
- `task` — task management (e.g. `create_task`).
- `commerce` — purchases, orders, price comparisons (e.g. `estimate_budget`).
- `finance` — budgeting, spending analysis.
- `system` — Atlas-internal operations not tied to a user-facing domain.

## 6. Execution Rules

- **Skills are atomic.** One Skill, one well-defined unit of work — no
  Skill should internally branch into "do several unrelated things."
- **Skills are composable.** Complex outcomes are built by chaining Skills,
  not by making one Skill do more.
- **Skills can depend on previous `SkillResult`s.** A `SkillCall`'s
  `dependencies` gate its execution until those results exist.
- **Skills must declare side effects.** `sideEffects` is mandatory, not
  inferred at call time.
- **Skills with side effects require explicit permission or trusted
  automation rules.** A `write`/`external` Skill only runs if the caller
  holds `requiredPermissions`, or the request's `ExecutionPlan` was already
  scored at an automation level that's been explicitly trusted for that
  action (see `automationLevel` on `ExecutionPlan`, `src/brain/planning/`).
- **Failed skills must return structured errors.** Never a bare exception —
  always a `SkillResult` with `status: "failed"` and a coded `error`.
- **Skill execution must be observable.** Every call emits its
  `observability events`; nothing runs silently.
- **Skills should be versioned.** See `version` in [§2](#2-skill-anatomy).
- **Skills should be domain-agnostic when possible.** A Skill that only
  makes sense for one module (e.g. `rename_document`) is fine; a Skill that
  *could* be generic (e.g. `summarize`) must not be narrowed to one module's
  needs.

## 7. Modules, Agents, and Cross-Module Interconnection

- Modules do not own cross-cutting intelligence (routing, planning — that
  stays in Atlas Brain).
- Modules orchestrate UX and domain-specific workflows.
- Modules may request `SkillCall`s but should not hardcode core reasoning.

A module's job is to know *what it needs* (e.g. "a Task module needs a
title, an optional due date, and a status") and to ask for it via Skills —
not to decide *whether* a title should be created in the first place. That
decision belongs upstream, in Atlas Brain and the Skill Planner.

### Module Agents

Each Module owns one or more **Module Agents**: specialized reasoning units
scoped to that Module's domain (e.g. the Travel module might own a Flight
Agent, a Hotel Agent, and an Itinerary Agent; Shopping might start with a
single Product Agent and grow more as the module matures). The number of
Agents per Module is not fixed by this RFC — it's expected to grow from one
toward many as a Module's domain gets more sophisticated.

An Agent:

- is scoped to exactly one Module — it never routes or reasons about which
  Module a request belongs to (that stays Atlas Brain's job, unchanged);
- has domain expertise Atlas Brain deliberately doesn't have (Atlas Brain
  stays domain-agnostic by rule — RFC-0001 §5) — e.g. a Flight Agent knows
  what makes one itinerary better than another, Atlas Brain does not;
- does its work by calling Skills through the Skill Engine, same as any
  other caller — an Agent is a specialized consumer of the Skill contract,
  not a shortcut around it;
- never directly touches another Module's data, and never calls another
  Module's Agent directly — cross-Module coordination happens only through
  `SkillCall`s and the Skill Planner (below), never ad hoc.

### Cross-Module interconnection

Some requests are transverse by nature — a general request, or a Mission
that spans multiple domains at once (e.g. "organize my move" touches
Maison, Budget, Documents, and Automobile together). For these, more than
one Module's Agent may need to contribute to the same Mission, or even the
same Decision.

This isn't a new architectural layer: it's the Skill Planner sequencing
`SkillCall`s across Agents from different Modules, exactly the way it
already sequences Skills within one Module — an Agent from Maison and an
Agent from Budget both surface as `SkillCall`s in the same `ExecutionPlan`,
coordinated through the same dependency mechanism as any other chain (see
[§3](#3-skillcall), `dependencies`). This is also the concrete answer to
[RFC-0001 §11](./RFC-0001-Atlas-Core-Architecture.md#11-open-questions)'s
open question about how Atlas would ever decompose a Mission into multiple
Decisions spanning modules — Agents give Atlas something real to decompose
*into*, rather than requiring the Planning Engine to invent multi-Decision
logic out of nothing.

### Relationship to "Modules must stay thin"

This refines, rather than contradicts, RFC-0001 §5. The distinction:

- **Cross-cutting reasoning** — which Module a request belongs to, what the
  overall plan is, how automatable it is — stays exclusively in Atlas
  Brain, never duplicated per Module.
- **Domain-scoped reasoning** — the actual expertise needed to do well
  *within* one Module (comparing flights, judging a neighbourhood, drafting
  a moving checklist) — is what Module Agents are for, and Atlas Brain is
  not expected to have this.

A Module still never decides *whether* Atlas should act ([RFC-0001
§10](./RFC-0001-Atlas-Core-Architecture.md#10-what-does-not-belong-in-modules))
— its Agents decide *how*, once Atlas Brain has already decided *that*
something in this Module's domain is needed.

### Status

This is documented target architecture only. No Agent implementation
exists in code, and none is planned for Sprint-003 or Sprint-004 — those
stay scoped to Decision and Verdict at the Mission level, per RFC-0001 §4's
scope discipline. Agents become relevant once a Module needs more than
trivial logic to produce good Decisions, and once the Skill Planner/Skill
Engine themselves exist in code (neither does yet).

## 7a. First Real Module: Shopping (Sprint-029/030)

Shopping is the first Module to move past "documented target architecture
only" (§7's own Status note). This section resolves §10's remaining open
questions about Agents concretely, against a real vertical, rather than
leaving them abstract.

**Shopping is a 5th `AxisModuleId`, not a new architectural layer.**
`intentEngine.ts`/`routingEngine.ts`/`planningEngine.ts` already implement
exactly the "which module owns this, what's the plan" machinery a Module
needs — extending that fixed, proven list (`task`, `document`, `memory`,
`conversation`, `unknown` → `+ "shopping"`) is "evolution over rewrite."
Inventing a parallel Module-routing layer above/beside Axis routing would
duplicate what already exists for no concrete gain.

**Shopping has four Agents at MVP: Price, Reviews, Quality, Brand.** None
of them are persisted objects or separate code modules with their own
runtime identity — resolving §10's "does an Agent have persisted
identity" question: no. An "Agent" here is a `NormalizedMeasure` plus the
UI/copy that lets a user attach Evidence under it. This is deliberately
the same minimalism `find_lowest_value` used for its own single
"criterion" (price) — four Agents means four recognized measures
(`price` — existing; `rating`, `quality`, `brand_score` — new), not four
new classes or files. If Shopping later needs real domain intelligence
per Agent (e.g. a Quality Agent that reads structured spec sheets, not
just a user-entered score), that's the sprint that gives an Agent its own
code — not this one.

**Reconciling multiple Agents into one Verdict is `compare_options`
(RFC-0003 §9), built for the first time.** This resolves §10's "who
reconciles conflicting recommendations" question: a Skill, the same way
every other reasoning capability in Atlas is a Skill — not a new
orchestration layer, not the Skill Planner. `compare_options` is
deterministic arithmetic (per-measure min-max normalization, direction
aware — see §9's revised entry below), never an LLM judgment call,
consistent with "No AI, no inference" holding everywhere else in this
codebase.

**Evidence needs one new field to support multi-option comparison:
`optionLabel`.** Every Evidence item Sprint-004 onward describes one
claim about one thing; `compare_options` needs to know *which thing* each
claim is about ("Nike Crew Neck" vs "Uniqlo U Crew"). `optionLabel` is a
free-text string in `Evidence.metadata` — same denormalized-string
pattern already established by `sourceDocumentTitle`/`calendarEventTitle`
(Sprint-011/016), no schema change, no new table. Evidence with no
`optionLabel` (everything before this sprint) is simply not eligible for
`compare_options` grouping — `find_lowest_value`'s own single-winner path
is completely unaffected and unchanged.

**Comparison first, discovery later — a deliberate two-sprint split.**
Sprint-029 builds the engine (new measures, `optionLabel`, `compare_options`,
Verdict's new `ranking` field) with zero UI and zero new Axis routing —
purely backend, purely testable in isolation. Sprint-030 adds the
`"shopping"` `AxisModuleId`/intent triggers/plan step and the Decision-page
UI for naming options and attaching Evidence to each. This mirrors the
Calendar Provider's own three-sprint rollout (registry/mock → real OAuth →
Evidence integration, Sprints 014/015/016) — each sprint is independently
reviewable and shippable, rather than one sprint touching routing, Evidence,
a new Skill, and UI simultaneously.

**Cross-module interconnection (§7's original concern — a Mission
spanning Shopping *and* another Module) is explicitly not this sprint.**
It depends on the Skill Planner, which still doesn't exist. Shopping's
Agents are designed Planner-ready by construction (they only ever act
through Skills — `compare_options`, `find_lowest_value` — never bypassing
the Skill Engine, per §7's own rule), but no cross-Module execution path
is built until the Skill Planner is. This is a sequencing decision, not a
scope cut: the same four Agents plug into a future Skill Planner
unchanged.

**Real market-wide product discovery ("recommend me a t-shirt" without
the user naming candidates) is bigger than this: it needs a real product
Provider**, and no free, keyless one exists the way Open-Meteo did for
weather/geocoding. Deferred to a later sprint once a concrete Provider is
chosen — Sprint-029/030 work on options the user already names, which
already delivers real value (comparing named products across price,
reviews, quality, and brand) without that external dependency.

**Addendum (Sprint-030): the actual split ran three sprints, not two.**
The paragraph above (written before Sprint-029 started) put `optionLabel`
and Verdict's `ranking` field in Sprint-029, and the Decision-page UI in
Sprint-030. In practice, Sprint-029 shipped strictly narrower than
planned — only the new measures, `MEASURE_DIRECTION`, and the
`compare_options` Skill itself, fully covered by pure unit tests with zero
database/pipeline involvement, matching `find_lowest_value`'s own original
Sprint-006 shape before anything called it from a real flow.
`optionLabel`, `Verdict.ranking`, the Verdict-branching logic in
`evidenceService.recomputeVerdict`, and the `"shopping"` `AxisModuleId`/
routing/plan-step all landed in *this* sprint (Sprint-030) instead — once
routing needed a way to reach `compare_options` at all, `optionLabel` and
the branching logic that decides between `compare_options` and
`find_lowest_value` came along with it, rather than sitting unused for a
sprint. The Decision-page UI itself is deferred one sprint further, to
Sprint-031, for the same reviewability reason Sprint-029/030 were already
split: this sprint alone touches Axis routing, Evidence, and the Verdict
schema, and adding a new UI on top would make it harder to review and
roll back independently. The branching rule itself — 2+ distinct
`optionLabel`s with comparable Evidence hands the Verdict to
`compare_options`, otherwise `find_lowest_value` runs unchanged — is
exactly what was originally planned; only the sprint boundaries moved.

## 8. Relationship with Atlas Brain

- **Atlas Brain creates `ExecutionPlan`s.** (`src/brain/planning/`, unchanged
  by this RFC.)
- **Skill Planner turns `ExecutionPlan`s into `SkillCall`s.**
- **Skill Engine executes `SkillCall`s.**
- **Learning Engine records outcomes.** Every `SkillResult` — success or
  failure — feeds back into `src/brain/learning/` as one or more learning
  signals, consistent with the product doctrine's "everything is a signal."

This is the same strategic → tactical → execution → learning chain stated
in the Summary, restated here as the four-stage handoff.

## 8a. First Executable Skill (Sprint-006)

Sprint-006 is the first sprint that writes real Skill/Skill Engine code,
via `find_lowest_value` ([§9](#9-mvp-skill-registry)). This resolves a
three-way architecture choice that came up when the sprint was proposed:
should the first reasoning capability live inside Atlas Brain, inside a new
standalone "Reasoning service," or become the first executable Skill?

**Decision: first executable Skill.** Reasons:

- Atlas Brain is reserved for domain-agnostic orchestration (which module,
  how automatable, how confident the parse was) — never for a specific
  comparison capability. Building it there would mean tearing it out and
  moving it once the Skill Engine exists anyway, violating "evolution over
  rewrite."
- A standalone "Reasoning service" alongside Atlas Brain/Skill
  Planner/Skill Engine/Modules would itself be a new architectural layer —
  exactly what every sprint since Sprint-002 has been instructed not to
  introduce. RFC-0001 §3 already has exactly one designated home for a
  reusable, domain-agnostic capability like this: Skills.
- This capability is about as minimal and low-risk as a Skill can be
  (pure, no side effects, one input shape) — a safe, cheap way to validate
  the Skill contract this RFC has specified since Draft, before it's relied
  on for anything bigger.

**Scope discipline:** this sprint builds the *minimal literal shape*
needed to run one Skill end to end — not general-purpose Skill Planner
infrastructure. Concretely: a `Skill` interface covering only the fields
this Skill actually needs (id, input/output types, `sideEffects: "none"`)
rather than every field in [§2](#2-skill-anatomy); a `skillEngine` that's a
single synchronous dispatch function (one entry, not a registry system);
and one explicit call site (in the Decision/Verdict service layer) that
builds the `SkillCall` input from `normalizeEvidence` output and invokes
it — not a general Skill Planner that decides *which* Skill to run. There
is only one Skill, so there's nothing to plan yet.

## 8b. Provider Architecture (Sprint-014)

Sprint-013 concluded Atlas has no concept of an authenticated external
connection, and recommended building that foundation before any real
external Evidence source. This section settles the shape, resolving forks
the original sprint proposal left open.

**Every external system sits behind exactly one abstraction: Provider.**
Skills consume Providers. Atlas Brain never talks to a Provider — it only
executes Skills, unchanged from [§8](#8-relationship-with-atlas-brain).
Modules and repositories never talk to Providers either. This is now
permanent architecture, same status as the Skill contract itself.

**`Provider` is data-only; capability-specific behavior lives in narrow
per-capability extensions, not one generic interface.** The base shape
(`id`, `name`, `capabilities: string[]`, `authType`, `status`) is what the
Registry and any UI operate on generically, without knowing what any given
Provider actually *does*. A Provider that can act (e.g. return calendar
events) implements a narrow capability interface that `extends Provider`
with exactly the methods that one capability needs (e.g. `CalendarProvider
extends Provider { getEvents(): CalendarEvent[] }`) — the same "narrow
contract, only fields actually needed today" discipline already used for
`Skill<TInput, TOutput>` ([§8a](#8a-first-executable-skill-sprint-006)) and
`ComparableValue` ([§9](#9-mvp-skill-registry)). A future Gmail or Banking
Provider gets its own narrow capability interface the same way — this
RFC does not attempt to anticipate every capability with one generic shape.

**A Skill obtains its Provider from the Registry, by id, inside its own
factory — never injected by a caller, never resolved by Atlas Brain.**
Mirrors the `save_document` factory-closure pattern
([§9](#9-mvp-skill-registry), Sprint-010): `createReadCalendarSkill(providerId:
string)` looks up the Provider via `getProvider<CalendarProvider>(providerId)`
inside its own module and closes over the result. "The Skill decides it
needs a Provider" (the original sprint framing) means literally that — the
lookup happens inside the Skill's own construction, not via dependency
injection or a Planner that hasn't been built yet.

**Registration is explicit and idempotent, not automatic or discovered.**
`registerDefaultProviders()` calls `registerProvider()` once per known
Provider; `registerProvider` overwrites by id (`Map.set`), so calling it
more than once is always safe. There is no plugin loading, no filesystem
discovery, no lifecycle beyond "registered." This mirrors the Skill Engine's
own restraint ([§8a](#8a-first-executable-skill-sprint-006)): a Registry
that only registers and looks up, nothing more, exactly as much as today's
one real Provider needs.

**`sideEffects: "external"` is used for the first time.** [§2](#2-skill-anatomy)
already named `external` as one of the four canonical `sideEffects` values;
`read_calendar` is the first Skill to actually use it, widening the
`sideEffects` union in `src/skills/skillEngine.ts` from `"none" | "write"`
to `"none" | "write" | "external"` — the same "widen only when a concrete
Skill needs it" discipline already used when `"write"` was added for
`save_document`.

**Provider `status` is static for now; there is no transition logic.**
`MockCalendarProvider.status` is a hardcoded `"connected"` — it never
actually connects to anything, so there is nothing to transition through.
The four-state vocabulary (`disconnected` / `connecting` / `connected` /
`unavailable`) exists so a real Provider has somewhere to report state once
one exists; building the transition logic itself is explicitly deferred
until a Provider that needs it is implemented.

**No persistence.** The Provider Registry is in-memory only, rebuilt from
`registerDefaultProviders()` on demand. This is safe because registration
is idempotent and Provider definitions are static code, not user data —
the same reasoning that kept the Skill Engine itself schema-free until a
Skill actually needed persisted `SkillCall`s ([§10](#10-open-questions),
still open).

## 8c. First Real Provider — Google Calendar, Read-Only (Sprint-015)

Sprint-014 proved the architecture with a mock. This section resolves the
forks the Sprint-015 proposal left open, before any code exists.

**`Provider.status` is amended: optional, and only meaningful for
providers with a single global state.** Sprint-014 made `status` a
required field on the base `Provider`, which fit `MockCalendarProvider`
(one static, global value) but does not fit an OAuth-backed provider —
connection status is inherently per-user, not a property of the provider
descriptor itself. `status` on `Provider` becomes `status?: ProviderStatus`:
present and static for providers like Mock, absent for providers whose
status must be resolved per-user. Google Calendar's registry entry is a
bare descriptor (`id`/`name`/`capabilities`/`authType`, no `status`, no
`getEvents`) — connection status for the current user is resolved
separately, per request, from `ExternalConnection` (below), never stored
in or read from the Registry.

**A new persisted model, `ExternalConnection`, not the existing `Account`
table.** Auth.js's `Account` model already exists in this schema, but it is
adapter-owned, tied to "Sign in with X" flows, and stores tokens in
plaintext — reusing it here would (a) conflate Atlas login with Provider
authorization, which this sprint explicitly keeps separate, and (b) violate
the no-plaintext-token requirement by writing pre-encrypted blobs into a
table NextAuth's own adapter also writes to. `ExternalConnection` is a new,
independent model: it records one Atlas user's authorization grant to one
external Provider. It has never stored calendar data, and it never will —
Provider capability data (events, in this sprint) stays request-scoped and
unpersisted, per Sprint-015 scope item 6.

**No PKCE.** Google's standard OAuth 2.0 web-server flow
(`https://accounts.google.com/o/oauth2/v2/auth` →
`https://oauth2.googleapis.com/token`) is designed for confidential
clients that can hold a `client_secret` server-side — which this Next.js
app is: the secret lives only in `GOOGLE_CALENDAR_CLIENT_SECRET`, read
server-side, never sent to the browser. PKCE exists for clients that
*can't* hold a secret (native/mobile/SPA). Adding it here would be
protecting against a threat model this architecture doesn't have.

**CSRF state: unsigned random value in a short-lived HttpOnly cookie, not
a signed token.** A signed token would need a dedicated signing secret;
a plain cryptographically random value stored server-side (via the
cookie) and compared for exact equality on callback is equally secure and
needs nothing new. Concretely: `state = randomBytes(32).toString("base64url")`,
set as the value of an `HttpOnly`, `SameSite=Lax`, `Secure`-outside-dev
cookie with a 10-minute `maxAge`; the same value is passed to Google as
the `state` query parameter. The callback route compares the query
parameter against the cookie value for an exact match, then immediately
clears the cookie — single-use by construction, since a cleared cookie
can't be replayed. The authenticated Atlas `userId` is never taken from
any client-supplied value (query parameter or state payload) — the
callback route re-derives it from its own `auth()` session check, matching
the "never trust a userId from a query parameter" requirement directly.

**`runSkill` needs no change.** Sprint-010's `save_document` already
demonstrated that `Skill<TInput, TOutput>` supports an async `run` by
simply instantiating `TOutput` as a `Promise` at that one call site —
`runSkill`'s generic signature (`skillEngine.ts`) already passes any
`TOutput`, including a `Promise`, straight through. `read_calendar`
becoming async (because `CalendarProvider.getEvents` becomes
`() => Promise<CalendarEvent[]>`) requires awaiting its call site, not
modifying `skillEngine.ts`.

**`read_calendar`'s factory takes a `CalendarProvider` instance, not a
registry id.** Sprint-014's `createReadCalendarSkill(providerId: string)`
resolved its Provider from the global Registry by id — correct for Mock (a
single, stateless, shareable instance) but wrong for Google, where the
runtime Provider must be bound to one authenticated user's decrypted
tokens and must never be cached in module-level/global state (a Provider
instance built for one user must never be reused by a request from
another). The factory signature changes to
`createReadCalendarSkill(provider: CalendarProvider)`; the caller
constructs the right instance — `mockCalendarProvider` directly for Mock,
or a fresh `createGoogleCalendarProvider(userId)` instance for Google —
and passes it in. The Registry stays exactly as data-only as Sprint-014
left it; it is never asked to hand back a user-bound instance.

**Structured provider errors, not a silent empty list.** `ReadCalendarOutput`
becomes a discriminated union
(`{ events: CalendarEvent[] } | { error: { code: "unauthorized" |
"unavailable" } }`), the same "typed non-exception failure" pattern
`find_lowest_value` already established with
`FindLowestValueSuccess | FindLowestValueInsufficient`. A `ProviderError`
class (`src/providers/provider.ts`) carries the `code`; `GoogleCalendarProvider`
throws it on a revoked/failed refresh, `read_calendar` catches it and maps
it into the error branch of its output — RFC-0003 §6's "failed skills must
return structured errors, never a bare exception" applies to a Skill's own
internal handling of a thrown Provider error, not only to the Skill Engine.

## 8d. Second Write Skill — `create_task` (Sprint-025)

`create_task` is the second Skill with `sideEffects: "write"`, closing the
gap RFC-0003 §9's own entry named from the start: a `task`-routed request
produced an `ExecutionPlan` and stopped, with nothing downstream ever
creating the `Task` row. Built as a **direct structural mirror of
`save_document`** (Sprint-010) — same factory-closure shape
(`createCreateTaskSkill(userId, axisRequestId)`), same permission gate
enforced by the caller before the Skill is constructed
(`plan.automationLevel === "automatic"`), same call-site position in
`atlasBrain.runPipeline` (after `saveAxisResult`, since the Skill needs the
saved `AxisRequest`'s real id). `taskRepository.ts` mirrors
`documentRepository.ts` the same way: one `createTask` function, nothing
else — no `listTasks`/`getTaskById`, since nothing calls them yet
(`documentRepository.listDocuments`/`getDocumentById` were both added
later, for the Documents UI and Evidence Path D respectively — genuinely
new needs, not something this sprint should anticipate).

**The one new piece: resolving a due-date keyword into a real `Date`.**
`entityEngine.extractEntities` extracts `dueDate` as one of 18 raw keyword
strings (`DATE_KEYWORDS` — `"today"`, `"tomorrow"`, weekday names, etc.),
but `Task.dueDate` in the schema is a real `DateTime?`. Nothing converted
one into the other before this sprint. `resolveDueDateKeyword`
(`src/domain/due-date.ts`) is a pure function — `now: Date` is always
passed in by the caller, never read internally, keeping it unit-testable
without mocking the clock, the same discipline every engine under
`src/brain/` already follows. It lives in `src/domain/`, not inside the
Skill and not inside `entityEngine`: the Skill only persists (mirrors
`save_document`'s "Skill only persists, caller resolves" split for
`content`), and `entityEngine` only extracts the raw keyword — resolving it
against wall-clock time is an orchestration concern, so it's called at the
`atlasBrain.ts` boundary, the one place already reading `new Date()` for
this pipeline. A same-weekday match (e.g. "monday" asked for on a Monday)
resolves 7 days ahead, never same-day — the safer default when the
phrasing is ambiguous, same reasoning `find_lowest_value` uses for
`insufficientEvidence` over guessing.

**Scope cuts made explicitly, not discovered later:**

- **No Tasks list/detail UI.** The only visible effect of this sprint today
  is indirect — a created Task appears in the next request's Context Bundle
  (`context.openTasks`, already rendered by `context-bundle-view.tsx`, no
  changes needed). `save_document`'s own UI (`/documents`,
  `/documents/[id]`) was a separate, later addition too, not part of
  Sprint-010 itself.
- **No `description`.** See the `create_task` §9 entry above.
- **No changes to `entityEngine.ts`/`routingEngine.ts`/`planningEngine.ts`.**
  The `task`-routing and automation-level gate already existed and already
  did the right thing (`draftStepsForModule`'s `task` case has computed
  `missingInfo: ["dueDate"]`/`[]` correctly since before this sprint) — this
  sprint only adds the execution step that was missing.

**A finding surfaced while writing this sprint's tests, worth recording
here rather than leaving implicit:** unlike `task`, `planningEngine.ts`'s
`document` branch always returns `missingInfo: []` — a document-routed
request's `automationLevel` is unconditionally `"automatic"`. There is no
reachable "assisted" state for `document` to test against, and none is
expected; `save_document`'s own write gate simply never has anything to be
gated against in practice today.

## 8e. Second Provider — Open-Meteo Weather (Sprint-026)

Skills closed with Sprint-025; this sprint asks a different question of the
architecture: does the `Provider` abstraction (§8b) actually generalize
past the one Provider it's ever had, or does it just fit Google Calendar
because it was designed around Google Calendar? Open-Meteo
(`open-meteo.com`) current-weather API was chosen specifically because it
sits at the opposite end of every axis that matters here: `authType:
"none"`, no API key, no OAuth, no per-user state, no `ExternalConnection`
row, nothing to connect or disconnect. Google is `"oauth"`; Mock is
`"none"` but hardcoded, never a real network call. No Provider before this
sprint had ever been both real *and* `authType: "none"`.

**The finding this sprint actually exists to produce: the abstraction held
with zero changes to `provider.ts` or `providerRegistry.ts`.** Neither file
was touched. `WeatherProvider extends Provider` the same way
`CalendarProvider` does; `openMeteoProvider` is registered with the same
`registerProvider` call, resolved with the same `getProvider<T>` call, and
appears in the Providers page's generic table with zero changes to that
table's rendering logic — it iterates `resolvedProviders` generically and
has never known what any specific Provider does. This is the answer to the
question this sprint opened with: the abstraction genuinely generalizes,
not just to a second OAuth-shaped Provider, but to something with a
completely different auth model. If it had needed a change, that would
have been this sprint's headline finding instead — it didn't.

**`read_weather` mirrors Sprint-014's original registry-id factory shape
(`createReadWeatherSkill(providerId: string)`, resolving via `getProvider`
inside itself), not Sprint-015's per-user-instance shape
(`createReadCalendarSkill(provider: CalendarProvider)`).** These are
genuinely two different correct shapes for two different situations, not
one shape that evolved and the other that's stale: Sprint-015's
instance-parameter shape exists *because* a Google-backed
`CalendarProvider` must be bound to one authenticated user's decrypted
tokens and must never be cached in module-level/global state. Open-Meteo
has no per-user identity at all — `openMeteoProvider` is one shareable,
stateless instance, exactly like `mockCalendarProvider` — so resolving it
by Registry id inside the Skill's own factory is not a regression to an
older pattern, it's the version of the pattern that actually matches this
Provider's shape. A future Provider picks whichever of the two shapes
matches its own statefulness, not whichever was used most recently.

**Fixed location (Paris), disclosed, not hidden.** Atlas has no per-user
location concept today (`User` has no location field) and this sprint does
not add one — building a location picker or schema field to demo a second
Provider would be scope creep unrelated to the actual question this sprint
answers. The limitation is visible directly in the Providers page copy
(`weather.fixedLocationNote`), the same honesty `MockCalendarProvider`'s
fixed, non-relative event dates already established: a known simplification
stated in the UI itself, never a silent shortcut discovered later.

**No Evidence integration this sprint ("Path F").** Calendar's own Evidence
path (§ RFC-0001 "Calendar Event Evidence") was a separate sprint
(Sprint-016) after Calendar's Provider and Skill already existed
(Sprint-014/015) — same split applies here. `read_weather` is not called
from `evidenceService.ts`; whether weather should ever feed into Evidence
is a product question for a later sprint, not an architecture question
this one needs to answer.

## 8f. User Location for the Weather Provider (Sprint-027)

Sprint-026 proved the Weather Provider was stateless and shareable; it also
left a hardcoded demo location (Paris) as an explicit, disclosed
limitation. This sprint replaces that with the first real piece of
user-owned context a Provider consumes — `Provider.getCurrentWeather` goes
from a zero-argument call reading module constants to
`getCurrentWeather(latitude, longitude)`, still fully stateless. Three
architecture questions came up in scoping this, each resolved as a
decision here rather than left to be re-litigated during implementation.

**Decision 1 — setting a location does not go through Atlas Brain/Axis.**
`AXIS_MODULES` (`src/domain/axis.ts`) is a small, deliberately fixed
vocabulary. Adding a `"location"` module would require new trigger phrases
in `intentEngine.ts`, a genuine place-name extractor in `entityEngine.ts`
(today's `extractKeywords` is a stopword filter, not a place-name parser,
and would mangle multi-word cities unpredictably), and changes to
`routingEngine.ts`/`planningEngine.ts` — real new inference for a feature
whose own doctrine is "no AI, no inference, no guessing." This codebase
already has a precedent for exactly this shape of action: Google Calendar
connect/disconnect (`src/app/api/providers/google-calendar/{connect,
disconnect}/route.ts`) — plain, auth-gated Next.js API routes calling a
service directly, no intent parsing, no `ExecutionPlan`, no learning
signal. Setting a location follows the identical shape
(`/api/user-location`, `POST`, a plain form with one text input) — a form
field is unambiguous where a sentence isn't, which is *more* aligned with
"no guessing," not a compromise of it.

**Decision 2 — location is not added to `ContextBundle`.** `ContextBundle`
is assembled once per `atlasBrain.runPipeline` call, for the Axis engines'
own use. The Providers page — the only consumer this sprint has — was
never part of that pipeline; it already reads `ExternalConnection`
directly via `externalConnectionRepository`, not through Context.
`userLocationRepository.getLocation(userId)` follows that same direct-read
shape. Nothing in `intentEngine`/`entityEngine`/`routingEngine`/
`planningEngine` reads location today, so there is no real consumer for a
Context Bundle field yet — adding one now would be speculative
infrastructure, the same restraint `documentRepository` followed by not
growing `listDocuments` until the Documents UI actually needed it. If a
future sprint routes a location-aware request through Axis, Context Bundle
is the right place for it *then*.

**Decision 3 — geocoding is a second capability on the existing Open-Meteo
Provider, not a new registered Provider.** RFC-0003 §8b's rule that every
external system sits behind a `Provider` is permanent, and geocoding a
city name is a real call to a different Open-Meteo endpoint
(`geocoding-api.open-meteo.com`) — so it must go through a Provider by that
same rule. It is not, however, a *second* Provider: `openMeteoProvider` now
satisfies both `WeatherProvider` and the new `GeocodingProvider`
simultaneously (`capabilities: ["weather:read", "geocoding:read"]`), same
vendor, same `authType: "none"`, same statelessness, no new registry entry,
no new connect/disconnect flow. This is exactly what §8b anticipated
("a future Gmail or Banking Provider gets its own narrow capability
interface the same way") — a Provider can carry more than one capability
interface without becoming a different kind of thing.

**A consequence of Decision 1/2 worth stating plainly:** `resolve_location`
and `set_user_location` are the first two Skills ever invoked from
somewhere other than `atlasBrain.runPipeline` or the Providers page's own
direct Skill calls — a plain API route now constructs and runs Skills
directly. `runSkill`/`skillEngine.ts` needed no change to support this: a
Skill has never actually required Atlas Brain as its caller, that was
simply the only caller that had existed until now. `set_user_location` also
has no `automationLevel` gate, unlike `create_task`/`save_document` — there
is no `ExecutionPlan` on this path to gate against, and none is needed: the
gate is the user having explicitly submitted the form, the same authority
an explicit Provider connect/disconnect action already carries.

## 9. MVP Skill Registry

The first 12 Skills. Four map directly onto capability that already exists
in Atlas Brain or is explicitly missing from it today (noted per skill) —
the rest are net-new.

### `extract_entities` — understanding

- **Purpose:** Extract structured entities (title, due date, keywords, ...)
  from a piece of text.
- **Input:** `{ text: string, hints?: string[] }`
- **Output:** `{ entities: Record<string, unknown>, confidence: number }`
- **Side effects:** none.
- **Example usage:** The Skill Planner calls this on a retrieved memory's
  content when a downstream Skill needs entities from it — the original raw
  request's entities already came from Atlas Brain's Entity Engine
  (`src/brain/entity/`) during Axis parsing.

### `classify_intent` — understanding

- **Purpose:** Classify the intent of a piece of text.
- **Input:** `{ text: string }`
- **Output:** `{ intent: string, module: string, confidence: number }`
- **Side effects:** none.
- **Example usage:** Re-classifying a stored Conversation message during
  follow-up planning. The original request's intent already came from
  Atlas Brain's Intent Engine (`src/brain/intent/`) during Axis parsing.

### `summarize_context` — reasoning

- **Purpose:** Produce a short, human-readable summary of a set of records
  (memories, tasks, a `ContextBundle`).
- **Input:** `{ items: string[], maxLength?: number }`
- **Output:** `{ summary: string }`
- **Side effects:** none.
- **Example usage:** Summarizing the `ContextBundle` Atlas Brain's Context
  Engine assembled, before it's shown to the user or fed into
  `draft_message`.

### `retrieve_memory` — memory

- **Purpose:** Fetch memories relevant to a query.
- **Input:** `{ userId: string, query: string, limit?: number }`
- **Output:** `{ memories: Array<{ id: string, content: string, relevance: number }> }`
- **Side effects:** none (read-only).
- **Example usage:** "What do I usually order for lunch?" — the Skill
  Planner sequences `retrieve_memory` before `draft_message`.

### `save_memory` — memory

- **Purpose:** Persist a new memory fact.
- **Input:** `{ userId: string, type: string, content: string, source: string }`
- **Output:** `{ memoryId: string }`
- **Side effects:** write.
- **Example usage:** For a `store_memory`-routed request, the Skill Engine
  calls `save_memory` to persist the fact — the Skill-ified form of what
  `src/brain/memory/` (`memoryEngine` + `memoryRepository`) already does
  inline in the current pipeline.

### `create_checklist` — planning

- **Purpose:** Structure a set of items into a checklist.
- **Input:** `{ title: string, items: string[] }`
- **Output:** `{ checklist: { title: string, items: Array<{ text: string, done: boolean }> } }`
- **Side effects:** none — this Skill only shapes data; persisting a
  checklist (if ever needed) is a separate, explicit write Skill.
- **Example usage:** "Help me pack for the trip" → `create_checklist` from a
  list of items `draft_message` or the user supplied.

### `draft_message` — communication

- **Purpose:** Draft a natural-language message or reply for a given goal.
- **Input:** `{ goal: string, context?: string, tone?: string }`
- **Output:** `{ draft: string }`
- **Side effects:** none (drafts only — it never sends anything).
- **Example usage:** Drafting a reply based on a retrieved preference
  memory ("I like oat milk" → draft a coffee-shop order note).

### `compare_options` — reasoning

- **Purpose:** Rank two or more named options against one or more shared
  criteria (RFC-0001 §4 "Measure"), using Evidence already tagged with
  which option it's about. Deliberately the multi-criteria sibling of
  `find_lowest_value` (single criterion, always "which is lowest") — built
  for the first time in Sprint-029, for the Shopping Module's four Agents
  (§7a): Price, Reviews, Quality, Brand each contribute one measure's
  worth of Evidence per option.
- **Input:** `{ values: Array<{ evidenceId: string; optionLabel: string; kind: "numeric" | "currency"; value: number; currency?: string; measure: string }> }`
  — already-normalized values (via `normalizeEvidence`), same discipline as
  `find_lowest_value`'s input; `optionLabel` is the new field, tracing each
  value to which option it describes (`Evidence.metadata.optionLabel`,
  §7a). `measure` is required here (not optional) — an unmeasured value
  can't contribute to any criterion, so it's filtered before this Skill
  ever sees it, same as `find_lowest_value`'s hard rule.
- **Scoring (deterministic, no AI, no inference):** for each `measure`
  present for 2+ options, min-max normalize that measure's values across
  those options to a 0–1 sub-score, direction-aware (`price`/`budget`/
  `rent`: lower raw value → higher sub-score; `salary`/`rating`/`quality`/
  `brand_score`: higher raw value → higher sub-score — see the
  `MEASURE_DIRECTION` map, `src/domain/evidence-normalization.ts`). An
  option's final score is the sum of its available sub-scores — options
  missing a given measure simply don't get that measure's sub-score,
  never a fabricated average. Ranking is by final score, descending; ties
  keep input order (same stable-tie-break discipline as
  `find_lowest_value`).
- **Output:** `{ ranking: Array<{ optionLabel: string; score: number; comparedEvidenceIds: string[] }> } | { insufficientEvidence: true }`
  — insufficient when fewer than two distinct `optionLabel`s have at least
  one comparable measure between them.
- **Side effects:** none.
- **Example usage:** "Nike Crew Neck ($30, 4.5★) vs Uniqlo U Crew ($25,
  4.2★)" — two options, two measures (`price`, `rating`) each shared by
  both — ranks both options by combined normalized score.

### `find_lowest_value` — reasoning

- **Purpose:** Given a set of normalized numeric/currency values derived
  from Evidence (see RFC-0001 §4 "Evidence Normalization"), determine which
  is smallest — nothing more. Deliberately narrower than `compare_options`
  above: no criteria, no weighting, no ranking of more than "which one is
  lowest." This is Atlas's first real reasoning capability (Sprint-006) and
  the first Skill actually implemented end to end — see "First Executable
  Skill" below.
- **Input:** `{ values: Array<{ evidenceId: string; kind: "numeric" | "currency"; value: number; currency?: string; measure?: string }> }`
  — the caller passes already-normalized values (via
  `normalizeEvidence`, `src/domain/evidence-normalization.ts`), never raw
  Evidence claims.
- **Output:** `{ evidenceId: string; value: number; comparedEvidenceIds: string[] } | { insufficientEvidence: true }`
  — the second shape when fewer than two compatible values exist, so the
  caller never has to guess whether a result is real.
- **Side effects:** none.
- **Compatibility rule (no guessing):** two values are only ever compared
  if they share the same `kind`, the same `currency` (for `currency`
  values), **and** the same `measure` (RFC-0001 §4 "Measure", added
  Sprint-007). No unit conversion, no cross-currency comparison, and no
  comparison across different measures (a price and a budget in the same
  currency are never compared). A value with no recognized `measure` can
  never join a comparable group — not even with another unknown-measure
  value.
- **Resolved Sprint-006 limitation:** earlier versions of this Skill had no
  way to tell "a product's price" apart from "a user's stated budget" when
  both normalized to the same kind/currency. Sprint-007's `measure` field
  closes this for the small vocabulary it covers; open-ended semantic
  understanding of arbitrary claims remains out of scope (see
  [§10](#10-open-questions)).

### `ask_clarifying_question` — communication

- **Purpose:** Produce a clarifying question when required information is
  missing.
- **Input:** `{ missingInfo: string[], context?: string }`
- **Output:** `{ question: string }`
- **Side effects:** none.
- **Example usage:** Today, `src/brain/routing/routingEngine.ts`'s
  `unknown`-module path returns the action `request_clarification` with no
  generated question text. This Skill is the natural home for actually
  producing that question once Skills exist.

### `create_task` — task

- **Purpose:** Create a Task record from structured input. Built in
  Sprint-025 as a direct structural mirror of `save_document` — see
  [§8d](#8d-second-write-skill--create_task-sprint-025) for the
  implementation narrative.
- **Input:** `{ title: string, dueDate?: Date }` — narrower than originally
  specified above (`userId`/`description` dropped). `userId` is a factory
  closure parameter, not part of the input/output contract, same as
  `save_document`'s `userId`/`axisRequestId`. `description` is deferred:
  nothing upstream (`entityEngine`) extracts one yet, and inventing a value
  would be exactly the unrequested NLP `find_lowest_value` and
  `save_document` both already avoid — the field stays on `TaskRow` (already
  nullable in the schema) but is always `null` until something produces one.
- **Output:** `{ taskId: string }`
- **Side effects:** write; gated by the caller
  (`atlasBrain.runPipeline`) on `plan.automationLevel === "automatic"`,
  before this Skill is ever constructed — never inside the Skill itself.
- **Example usage:** Closes the gap the ATLAS-002 README calls out
  explicitly — Axis currently produces a `task`-routed `ExecutionPlan` but
  "no real Task ... rows are created from a plan yet." This Skill is that
  missing execution step.

### `save_document` — documents

- **Purpose:** Persist a real `Document` row — the Skill-ified form of what
  `planningEngine.ts`'s `document`-routed `planStep.saveDocument` step has
  only ever described in text, never executed (Sprint-010 closes this,
  the same gap already noted for `create_task` above). Second Skill with a
  real side effect, after `find_lowest_value` (Sprint-006, `sideEffects:
  "none"`) — this is the first `"write"` one, exercising the permission
  gate RFC-0003 §6 already specified: a write Skill "only runs if... the
  request's `ExecutionPlan` was already scored at an automation level
  that's been explicitly trusted for that action" — concretely,
  `plan.automationLevel === "automatic"` (no missing info), the exact gate
  `planningEngine.ts` already computes and nothing has consumed until now.
- **Input:** `{ title: string, content: string }` — `content` is the raw
  request text, verbatim, never extracted or summarized (no NLP for this
  Skill, same discipline as `find_lowest_value`'s Evidence-only diet).
- **Output:** `{ documentId: string }`
- **Side effects:** write.
- **Example usage:** A `document`-routed `AxisRequest` with no missing
  info calls `save_document`, storing the new `Document`'s `axisRequestId`
  back to that request (`Document.axisRequestId` already exists in the
  schema for exactly this, unused until Sprint-010).

### `classify_document` — documents

- **Purpose:** Classify a document's type/category from its content.
- **Input:** `{ content: string }`
- **Output:** `{ category: string, confidence: number }`
- **Side effects:** none.
- **Example usage:** Tagging incoming Document-module content before it's
  stored.

### `generate_execution_summary` — planning

- **Purpose:** Produce a human-readable summary of an `ExecutionPlan` and
  the `SkillResult`s that came from executing it.
- **Input:** `{ plan: ExecutionPlan, skillResults: SkillResult[] }`
- **Output:** `{ summary: string }`
- **Side effects:** none.
- **Example usage:** A generalized successor to
  `src/brain/routing/routingEngine.ts`'s `buildSummary`, which today only
  summarizes the routing decision — this Skill summarizes the full plan and
  what actually happened when it ran.

## 10. Open Questions

- Should `SkillCall`s be persisted immediately in V1, or only `SkillResult`s
  once execution completes?
- ~~Should the Skill Engine be synchronous first (one call in, one result
  out, blocking), before any async/parallel execution is introduced?~~
  **Resolved 2026-07-09:** yes — Sprint-006's Skill Engine is synchronous
  only. Async/parallel execution stays an explicit future concern.
- ~~What tells Atlas that two normalized values measure the *same thing*
  (RFC-0001 §4's Evidence has no "what does this measure" field — a price
  and a budget in the same currency look identical to `find_lowest_value`
  today)?~~ **Partially resolved 2026-07-09:** RFC-0001 §4's "Measure"
  field (Sprint-007) covers a small, fixed vocabulary via metadata or
  obvious keyword patterns. Still open: arbitrary/open-ended claims with no
  recognized measure stay permanently non-comparable — there's no general
  solution, and none is planned.
- When do Skills require user confirmation, versus running under trusted
  automation rules, in concrete terms (not just "side effects require
  permission")?
- How should LLM-backed Skills be tested deterministically, given Atlas
  Brain's own engines are deliberately deterministic mocks today?
- Should Modules ever define their own Skills, or should Modules only ever
  consume Skills from a single global registry?
- ~~How many Agents does a Module start with at MVP — does Shopping launch
  with a single Agent, or several from day one?~~ **Resolved 2026-07-13:**
  four at once — Price, Reviews, Quality, Brand (§7a). Nothing about the
  architecture requires starting with one; a Module's Agent count is
  however many recognized measures its comparison actually needs.
- ~~Does an Agent have its own persisted identity/state (e.g. a `ModuleAgent`
  record), or is "Agent" purely a conceptual grouping of Skills plus a
  system prompt/config, with no independent runtime object?~~ **Resolved
  2026-07-13:** purely conceptual, no independent runtime object, no
  persisted record (§7a). An Agent is a recognized `NormalizedMeasure`
  plus the UI/copy around it, until a concrete case needs more.
- ~~When multiple Agents contribute to the same Decision, who reconciles
  conflicting recommendations before a single Verdict is produced?~~
  **Resolved 2026-07-13:** `compare_options` (§9), a Skill — deterministic
  per-measure normalization and summation, never an LLM judgment call
  (§7a).

## 11. Decision Log

| Date | Decision | Status |
| --- | --- | --- |
| 2026-07-08 | RFC-0001 opened to document the target architecture ahead of freezing official docs. | Recorded |
| 2026-07-09 | Planning Engine is strategic — it decides what should be done. | Accepted for this RFC |
| 2026-07-09 | Skill Planner is tactical — it translates an `ExecutionPlan` into ordered `SkillCall`s. | Accepted for this RFC |
| 2026-07-09 | Skill Engine is execution — it runs `SkillCall`s and returns `SkillResult`s. | Accepted for this RFC |
| 2026-07-09 | Skills are reusable capabilities, not modules. | Accepted for this RFC |
| 2026-07-09 | Module Agents introduced: each Module may own one or more specialized Agents (domain-scoped reasoning Atlas Brain deliberately doesn't have), acting only through Skills. Cross-Module requests are coordinated by the Skill Planner sequencing `SkillCall`s across Agents — not a new architectural layer. This is the conceptual mechanism for how a Mission could eventually span multiple Decisions across Modules. Documented in [§7](#7-modules-agents-and-cross-module-interconnection). | Recorded |
| 2026-07-09 | First executable Skill: `find_lowest_value` (reasoning). Built as a Skill, not inside Atlas Brain and not as a new standalone "Reasoning service" — both alternatives were considered and rejected (see [§8a](#8a-first-executable-skill-sprint-006)). Skill Engine is synchronous-only for this sprint. Scoped for implementation in Sprint-006. | Recorded |
| 2026-07-10 | Provider abstraction introduced: every external system sits behind a `Provider`, consumed only by Skills, never by Atlas Brain/Modules/repositories. `Provider` is data-only (`id`/`name`/`capabilities`/`authType`/`status`); capability-specific behavior lives in narrow per-capability extensions (e.g. `CalendarProvider`), not one generic interface. A Skill resolves its Provider from the Registry by id inside its own factory (mirrors `save_document`'s closure pattern), never via injection. `sideEffects: "external"` used for the first time. Registry is in-memory, idempotent, no discovery/lifecycle. Provider `status` is static until a real Provider needs transition logic. Documented in [§8b](#8b-provider-architecture-sprint-014). Scoped for implementation in Sprint-014 with one mock Provider (`MockCalendarProvider`) and one Skill (`read_calendar`). | Recorded |
| 2026-07-10 | First real Provider: Google Calendar, read-only (`calendar.events.readonly` scope). New `ExternalConnection` model (distinct from Auth.js's adapter-owned `Account`) persists one Atlas user's encrypted OAuth grant per Provider; Calendar events themselves are never persisted. `Provider.status` amended to optional — present/static for Mock, absent for OAuth Providers whose status is resolved per-user from `ExternalConnection` instead. No PKCE (confidential server-side client). CSRF state is an unsigned random value in a short-lived, single-use, HttpOnly cookie. `read_calendar`'s factory now takes a `CalendarProvider` instance rather than a Registry id, so a Google-backed instance can be user-bound without ever entering global state; the Registry itself stays data-only. `runSkill` required no change — `TOutput` already supports `Promise` per Sprint-010's precedent. `ReadCalendarOutput` becomes a typed success/error union rather than silently returning an empty list on failure. Documented in [§8c](#8c-first-real-provider--google-calendar-read-only-sprint-015). Scoped for implementation in Sprint-015. | Recorded |
| 2026-07-12 | Second `sideEffects: "write"` Skill: `create_task`, built as a direct structural mirror of `save_document` (same factory-closure shape, same caller-enforced `plan.automationLevel === "automatic"` gate, same post-`saveAxisResult` call-site position). `taskRepository.ts` mirrors `documentRepository.ts`: one `createTask` function, no `listTasks`/`getTaskById` until something needs them. New pure boundary function `resolveDueDateKeyword` (`src/domain/due-date.ts`) converts `entityEngine`'s 18 raw `DATE_KEYWORDS` strings into a real `Date`, relative to a caller-supplied `now` — called at the `atlasBrain.ts` orchestration boundary, not inside the Skill or inside `entityEngine`. `description` deferred (no upstream extractor exists); no Tasks UI this sprint (indirect visibility only, via the existing Context Bundle `openTasks` view); no changes to `entityEngine.ts`/`routingEngine.ts`/`planningEngine.ts` (the `task` gate already existed and was already correct). Documented in [§8d](#8d-second-write-skill--create_task-sprint-025). Implemented in Sprint-025. | Recorded |
| 2026-07-12 | Second Provider: Open-Meteo weather (`open-meteo.com`, keyless, `authType: "none"`), chosen specifically to test whether the Provider abstraction generalizes past Google Calendar's OAuth shape — **it did, with zero changes to `provider.ts` or `providerRegistry.ts`**. `read_weather`'s factory resolves its Provider from the Registry by id (Sprint-014's original shape), not by instance parameter (Sprint-015's shape) — correct because `openMeteoProvider`, like `mockCalendarProvider`, is one shareable stateless instance with no per-user identity, unlike Google's per-user-token-bound `CalendarProvider`. Fixed demo location (Paris) disclosed directly in the Providers page copy, not hidden; no per-user location field added. No Evidence integration this sprint (same Provider-then-Evidence split Calendar followed across Sprint-014/015 then Sprint-016). Documented in [§8e](#8e-second-provider--open-meteo-weather-sprint-026). Implemented in Sprint-026. | Recorded |
| 2026-07-13 | User-owned location for the Weather Provider: new `UserLocation` model (mirrors `AtlasState`'s one-row-per-user/upsert shape). Three corrections settled: (1) setting a location bypasses Atlas Brain/Axis entirely — a plain auth-gated API route (`/api/user-location`) mirroring the existing Google Calendar connect/disconnect precedent, not a new `"location"` Axis module; (2) location is not added to `ContextBundle` — nothing in the Axis pipeline consumes it yet, and the only consumer (Providers page) already reads context directly, same as `ExternalConnection`; (3) geocoding is a second capability (`geocoding:read`) on the existing `openMeteoProvider` instance, not a new registered Provider — satisfies RFC-0003 §8b's "every external system sits behind a Provider" rule without a new registry entry. `getCurrentWeather` becomes parameterized (`latitude`, `longitude`) instead of reading module constants. `resolve_location`/`set_user_location` are the first Skills ever invoked from outside `atlasBrain.runPipeline`; `runSkill` needed no change. Documented in [§8f](#8f-user-location-for-the-weather-provider-sprint-027). Implemented in Sprint-027. | Recorded |
| 2026-07-13 | First real Module: Shopping, as a 5th `AxisModuleId`, not a new architectural layer (extends `intentEngine`/`routingEngine`/`planningEngine`'s existing mechanism). Four Agents at MVP — Price, Reviews, Quality, Brand — none persisted or independently coded; each is a recognized `NormalizedMeasure` (`price` existing, `rating`/`quality`/`brand_score` new) plus its UI. Multi-Agent reconciliation is `compare_options` (§9), built for the first time: deterministic per-measure min-max normalization (direction-aware via a new `MEASURE_DIRECTION` map), summed per option, never an LLM judgment call. `Evidence.metadata.optionLabel` (new field, same denormalized-string pattern as `sourceDocumentTitle`) lets Evidence be grouped by which option it describes; `find_lowest_value`'s own path is unaffected. Resolves all three of §10's open Agent questions (Agent count, persisted identity, reconciliation). Split across two sprints, mirroring Calendar's own three-sprint rollout: Sprint-029 builds the comparison engine only (measures, `optionLabel`, `compare_options`, Verdict's new `ranking` field) with no new Axis routing or UI; Sprint-030 adds the `"shopping"` module/routing and the Decision-page UI. Cross-Module interconnection (Agents from *different* Modules on one Mission) stays deferred until the Skill Planner exists — Shopping's Agents are Planner-ready (act only through Skills) but no cross-Module execution path is built yet. Real market-wide product discovery (no named candidates) deferred until a real product-search Provider is chosen — no free/keyless one exists the way Open-Meteo did. Documented in [§7a](#7a-first-real-module-shopping-sprint-029030). Scoped for implementation in Sprint-029 (engine) and Sprint-030 (module/UI). | Recorded |
| 2026-07-13 | Correction to the row above, recorded once Sprint-029/030 actually shipped: the engine/UI split held, but the sprint *boundary* inside "engine" moved. Sprint-029 shipped narrower than planned — only the new measures, `MEASURE_DIRECTION`, and `compare_options` itself, with pure unit tests and zero database/pipeline involvement (matching `find_lowest_value`'s own original Sprint-006 shape). `optionLabel`, `Verdict.ranking`, the `find_lowest_value`/`compare_options` branching logic in `evidenceService.recomputeVerdict`, and the `"shopping"` `AxisModuleId`/`intentEngine`/`routingEngine`/`planningEngine` wiring all landed together in Sprint-030 instead, once routing needed a real path to `compare_options`. The Decision-page UI is deferred one sprint further still, to Sprint-031 — the same reviewability reasoning that split Sprint-029 from Sprint-030 (this sprint alone already touches Axis routing, Evidence, and the Verdict schema) applies again to adding a UI on top in the same sprint. The branching rule itself shipped exactly as designed: 2+ distinct `optionLabel`s with comparable Evidence routes the Verdict through `compare_options`; otherwise `find_lowest_value` runs unchanged. See [§7a](#7a-first-real-module-shopping-sprint-029030)'s addendum. Implemented in Sprint-030. | Recorded |

These four decisions resolve RFC-0001 §11's open question about the
relationship between the Planning Engine and the Skill Planner. They do not
change RFC-0001's own text (see RFC-0001 for the still-open items that
remain). This RFC as a whole remains **Draft** — no Skill or Skill Engine
implementation exists yet, and the open questions in [§10](#10-open-questions)
are unresolved.
