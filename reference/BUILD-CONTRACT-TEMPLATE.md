# Step 3 build — contract (plan of record)

This file is the contract every builder and checker works against. The
target paths in `target/paths/` say WHAT each screen does. This file says
HOW the build is done. If the two disagree, the target path wins on
behaviour and this file wins on structure. Written once per programme run by
the strong model (`models.foundation`) at the start of step 3, from this
template and the project config's `loop` block (`mode`, `maxRounds`,
`playwrightSlots`).

## 1. Purpose and mode

State the mode explicitly: **`prototype`** or **`real`**, taken from
`loop.mode` in the project config. One paragraph: what gets built (a
clickable, fillable prototype of the step 2 target paths; or, the real
target paths wired into the real product), where it runs (local only, or
the project's own dev/test environment), and what is explicitly not in
scope for this step (in `prototype` mode: the real backend, real auth, real
notifications, edits to existing non-prototype routes or domain code, new
dependencies; in `real` mode: anything the target path's §7 open questions
leaves for the owner, and any lane not named in this run's job list).

## 2. Routes rule

**`prototype` mode.** State the route prefix every prototype route sits
under (for example a fixed segment like `/proto`), and the mapping rule:
every prototype route is the corresponding target route with that prefix
added. State the guard that keeps the prefix out of a real deployment (a
`notFound()` or equivalent at the prefix's root layout, gated on the
project's own production check). Later wiring strips the prefix; that is a
later programme, not this one.

**`real` mode.** State that routes are the target routes as designed, no
prefix, built where the project's own routing convention puts them (see the
project's architecture doc for the folder-per-route convention, if one
exists). State how a not-yet-built target route behaves for a person who
reaches it before its job is built (an honest "not built yet" state, never a
silent 404 that looks like a bug).

## 3. Allowed and forbidden paths

Builders may create or edit files ONLY under the paths this run's job list
grants them (`loop-args`'s `jobs[].owns`), plus their own end-to-end spec
file and their own row in `BUILD-LOG.md`. List the shared, off-limits
surfaces explicitly — in most projects this includes at least: the design
system's shared component directory, the shared library/utility directory,
existing non-target routes, the project's copy or message files, any config
or dependency manifest, any database migration, and the project's own
compliance or gating documents. A checker fails the job if
`git status --porcelain` shows a path outside the job's `owns` list plus its
spec file.

Each job writes only inside its own folder(s) plus its own end-to-end spec.
Shared files (a fixture document, a state store, shared prototype-only
components, layouts) belong to the foundation job (§9), never to a build
job. A job that needs a shared change records it in `BUILD-LOG.md` under
"Wanted from foundation" (§13) and works around it locally inside its own
folder for this round.

## 4. Data

**`prototype` mode.** Name the fixture document's shape: one typed seed
export, one collection per domain entity the target paths reference, with a
row count per collection and a one-line note on what varies (states,
statuses, completeness) so every state named in every target path's §5 is
representable. State the determinism rule: no `Math.random`, no `Date.now()`
in fixtures; dates are literal ISO strings relative to one fixed "today";
IDs are short and stable (`m-001`, `a-001`). Name the account-state
fixtures: one fixed identity per state a target path's §5 names (unknown,
pending, complete, incomplete, blocked, and so on), with a fixed,
memorable identifier per state (for example `s1@example.test`) so a checker
or a critic can reach any state by picking it, not by reconstructing it.

**`real` mode.** Name the project's own seed script and what it seeds (state
the file path and the command that runs it). Name the project's own
dev-login mechanism (endpoint, header, how a role or identity is selected)
and the fixed test identities this run's jobs need, one per account or role
state a target path's §5 names, with their real seeded values (not
invented). State that no `Math.random` or wall-clock-relative logic may
appear in the seed data used for checking; a checker's assertions must be
reproducible against the same seed run twice.

## 5. State and results

**`prototype` mode.** Name the store: a provider holding the fixture
document plus a small flag set (at minimum: a "simulate failure" toggle, an
account-state selector, a role selector), persisted to session-scoped
storage under one fixed key namespaced to this project and this scaffold's
version, for example `<project>-prototype-state-v1`. Name the typed result
contract used by every fake write: `Result<T> = { ok: true, data: T } |
{ ok: false, code: string, message: string }`. State the dev-tool bar's required controls: reset,
simulate-failure toggle, account-state picker, role picker, and (if the
target paths use more than one viewport meaningfully) a phone-width toggle
hint. State how a fake notification is represented so a checker or a person
clicking through can reach the next state without a real inbox (for example,
a "open the message" control inside the dev bar, never inside the page body
where a real user would see it).

**`real` mode.** No fixture document, no dev bar, no simulated failures. List
every real failure trigger this run's jobs need, one row per job, sourced
from that job's target path §5 states table: what real condition produces
each failure (a real validation error, a real conflict, a real network or
service failure the project can trigger deterministically in its test
environment), and how a checker reproduces it on demand. Every write in a
`real`-mode job still returns and renders a typed result; the contract does
not relax that rule, only the mechanism for producing failures.

## 6. Style rules

- The project's own design system wins over any generic design taste or
  skill default. Name the project's design-system reference document (for
  example `src/ui/README.md`) and require builders to check it before
  creating any new UI element.
- No new hex colour literals; no inline colour styles. Use the design
  system's tokens and utility classes only.
- No emoji anywhere in code or UI.
- Every user-facing string is in the product's configured language
  (`product.language`) and comes from the project's own copy source
  (`product.copyGlobs`) if the project centralises copy; no UI string in a
  language other than the product's configured one, and no internal job or
  path ID leaking into user-facing copy.
- Phone-first targets: 44 by 44 CSS pixel minimum touch targets, one column
  on narrow viewports, the primary action reachable without scrolling on
  the smallest configured viewport (`screens.viewports` in the project
  config).
- No native `alert()`, `confirm()`, or `prompt()`. Use the design system's
  own notice, dialog, or toast pattern.
- Do not edit shared design-system primitives from inside a job's own
  folder; if a job needs a new shared primitive, it is a "wanted from
  foundation" item (§13), not a local fork.

## 7. Per-job definition of done

A job (one target path file) is done when:

1. Every screen in the target path's §2 step table exists at its route and
   is reachable by clicking from the job's first screen.
2. Every state in the target path's §5 is reachable: happy states by
   clicking, failure states through the mode's failure mechanism (§5 above),
   account or role states through the mode's identity mechanism (§4 above).
3. Any continuation parameter and any step or progress mark the target path
   names match its §1 and §2 exactly.
4. One header per screen, one primary action, copy in the product's
   configured language, phone layout correct (§6 above).
5. The builder's own allowed checks pass (§8, builder row).
6. The job's end-to-end spec passes, walking the happy path and at least one
   failure state, at every configured viewport.
7. `BUILD-LOG.md` has a row for this job in the format §12 defines.

## 8. Deterministic checks and who may run what

Builders may run, and only run: `commands.lint`, `commands.types`, and each
entry in `commands.extra`. Builders never start a dev server and never run
an end-to-end spec themselves; they write the spec file, they do not run it.

Checkers additionally run: `commands.full`, and the job's own spec via
`commands.e2e` with `{spec}` substituted, inside one of `loop.playwrightSlots`
reserved slots (a small pool of ports or workers so parallel checkers do not
pre-empt each other's dev server). A checker also reads the code against the
target path's §2 step table and §5 states table directly, and runs the
ownership check (`git status --porcelain` against the job's `owns` list).

State the literal commands here, taken from the project config, so a builder
or checker never has to guess or invent one:

```
lint:  {{commands.lint}}
types: {{commands.types}}
extra: {{#each commands.extra}}{{this}} {{/each}}
full:  {{commands.full}}
e2e:   {{commands.e2e}}
```

## 9. Job order and foundation

State whether this run has a foundation job (`loop-args`'s `foundation`
block, non-null). A foundation job runs first, sequentially, alone: it owns
the shared scaffold (the fixture document and its types in `prototype`
mode; a shared layout, a shared navigation shell, a shared state provider,
or any other cross-job primitive named in its `owns` list) and nothing else.
Every later job's checker must confirm the foundation's spec still passes
before that job's own check counts.

State the job order in rounds, one round per line, naming which jobs run in
parallel within a round and which round waits on the owner's review of the
previous round's output before it starts. If the project's rules doc or
target inventory ranks moves, order rounds by that ranking; the highest-
ranked, most-isolated jobs go first so an early round proves the loop works
before committing later rounds' agent budget.

## 10. Ownership table

| Job | Owns | Must link to, never create | Spec |
| --- | --- | --- | --- |

One row per job in this run's job list (`loop-args`'s `jobs[]`). `Owns` is
that job's `owns` glob list, verbatim. `Must link to, never create` names
every route or surface another job owns that this job's screens link into;
a job that creates a duplicate of another job's surface fails its checker's
ownership audit even if `git status` shows no foreign-path writes, because
duplication is itself a target-path violation (Occam's razor, §1 of
`UX-LAWS-PACK.md`). `Spec` is the job's `commands.e2e` spec path.

## 11. Known failure classes for checkers

A checker should specifically look for these, because they recur across
projects and are easy for a builder to miss:

- Two primary actions on one screen where the target path names one.
- A selector that matches more than one element because the same control (or
  an icon-only twin of it) renders once per configured viewport in the
  document at once; Playwright's strict mode fails on this even when the
  screen looks correct. Scope the selector to the visible viewport's
  container.
- `min-width: auto` on a grid or flex item causing overflow at the smallest
  configured phone width, even when the desktop viewport looks fine.
- A hex colour literal or an inline `style` colour, in violation of §6.
- `window.alert`, `window.confirm`, or `window.prompt` anywhere in the diff.
- A string in the wrong language, or an internal job/path ID (like the
  literal ID this contract uses to name the job) leaking into user-facing
  copy.
- A UI primitive re-implemented locally that the design system already
  provides (duplicated atoms), in violation of §6.
- A dependency array on a data-fetching or side-effect hook that omits a
  flag the effect actually reads, causing stale behaviour under the
  simulate-failure or account-state flags.
- A header action that is only reachable after a scroll threshold, or
  hidden at rest, when the target path's §2 says it is visible on arrival.
- A toast, banner, or other transient element rendered with pointer events
  enabled over a control it visually overlaps, intercepting the click a
  spec or a real person aims at the control underneath.
- A `data-testid` (or the project's own test-hook attribute) set on a
  wrapper component but not forwarded to the actual DOM node, so a spec's
  selector cannot find it even though the attribute is "there" in source.

## 12. BUILD-LOG row format

One row per job, appended when the job's checker passes (or when it exhausts
`loop.maxRounds` without passing — log it either way, never silently):

```
| <job ID> | routes: <n> | files: <n> | checks: lint types extra full e2e | rounds: <n>/<maxRounds> | deviations: <one line or "none"> |
```

Also log, as free-text bullets under the table, anything the final checker
or the orchestrator's own manual pass fixed after the loop (per
`METHOD.md` §1 item 16): what it was, the route, and the fix in one line
each.

## 13. "Wanted from foundation" escape hatch

A build job that needs a shared change outside its own `owns` list does not
make that change itself. It records, in its own `BUILD-LOG.md` row or a
named subsection, exactly what shared primitive, fixture field, or layout
change it wanted and why, then works around the gap locally inside its own
folder for this round (a local duplicate, a local stub, a locally-scoped
type). The next foundation-extension round (or a dedicated follow-up job)
reads every "wanted from foundation" note across every job in the round,
makes the shared change once, deterministically, and the affected jobs'
local workarounds are then removed by their own checker-fixer pass, not by
the foundation job reaching into another job's folder.
