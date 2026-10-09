# Method and heuristics for a path-based UX programme

Distilled from a completed four-step run on a real product, written for reuse
on any project through this skill. The files it names are this skill's own:
`reference/UX-LAWS-PACK.md`, `reference/PATH-TEMPLATE.md`,
`reference/TARGET-TEMPLATE.md`, `reference/MAP-TEMPLATE.md`,
`reference/DECISIONS-TEMPLATE.md`, `reference/TRACKER-TEMPLATE.md`,
`reference/BUILD-CONTRACT-TEMPLATE.md`, and the `ux-paths` CLI subcommands
(`init`, `capture`, `audit`, `verify`, `rulecheck`, `synthesize`,
`synthesize-target`, `usage`, `status`, `loop-args`).

## 0. The shape

Four steps, each with its own definition of done, each gated by the owner:

| Step | Question | Output | Who does the thinking |
| --- | --- | --- | --- |
| 0 Inputs | What routes, entry points, and prior research exist? | `paths.json`, `inputs/*.md`, screenshots, the tracker | The orchestrator, scripted |
| 1 Audit | What is built, and where does it fail? | One file per user path (as-built), verified findings with IDs and severities, metrics, lane maps, a rules doc | Cheap engine audits per path; a strong model spot-checks the S1 findings and writes the cross-path synthesis |
| 2 Simplify | What should the flows be? | One target path per surviving job, a decisions file (owner decisions first), before/after metrics, a rule check | Strong model designs; cheap engine checks the design against written rules |
| 3 Build | Does it work, and does it feel right? | A build contract, code inside the contract's allowed paths, a build log, critic reviews | Strong model writes the contract and orchestrates; a mid model builds, checks, and fixes; the strong model critiques |

Step 3 has two modes, set in the project config, never chosen ad hoc.
`prototype`: fixtures, a session-scoped store, a typed result contract, a
floating dev-tool bar, routes under a prototype prefix, a production
`notFound()` guard. `real`: real routes against the project's own seeded test
database and its own dev-login; no fixtures, no dev bar. The build loop
(foundation → build → review → fix → final check) is identical in both
modes; only the contract template's data and state sections differ.

After step 3: wire one job at a time to the real domain layer, then delete
the routes and functions the target replaced. Never before.

## 1. Heuristics that made it work

1. **Paths, not screens.** The unit of work is a job a person is trying to
   finish, not a page. Screens fall out of paths. Every file in every step is
   keyed by a path ID: `<lane-prefix><n>` as-built, `<target-prefix><n>`
   target, for example `W2` and `TW2`.
2. **Write the method to disk before the first agent runs.** The laws pack,
   the templates, the severity scale, the chart notation, the metric
   definitions all live in `reference/`. Agents read the files. Checkers
   measure against the files. Nothing lives only in a prompt.
3. **One fixed template per artefact, machine-parseable.** Metrics tables with
   a fixed header, finding IDs `<path>-<nn>`, verdict tables with a fixed row
   set. Synthesis is then a script, not a model: `ux-paths synthesize`,
   `ux-paths synthesize-target`. Deterministic, re-runnable, diffable.
4. **Cheap engine for volume, strong model for judgement.** The model split is
   a config value (`engines.cheap`, `models.*`), never hard-coded in a
   prompt. A cheap engine did dozens of audits and verifications and several
   rule-check passes for a few dollars total; a strong model wrote the laws
   pack, the synthesis, the target design, and the build contract. Never let
   the cheap engine make a design decision; only let it check output against
   written rules. It is read-only end to end.
5. **Verify in a fresh context.** A second pass re-reads every finding with no
   memory of writing it. On the reference run this added roughly ten percent
   more findings and dropped a few that did not hold up. Then the strong
   model spot-checked every S1 and a random sample against the code itself.
   Severity means something only after this pass.
6. **Every finding maps to a decision.** The target step's decisions file has
   a generated section: each S1/S2 finding ID maps to the decision that
   closes it, or is listed "left open" with a reason. `synthesize-target`
   builds this section from `target/finding-map.json` and throws on any
   unmapped S1 or S2. Zero unmapped findings is a definition of done, not a
   suggestion.
7. **Owner decisions first, and few.** A short table of yes/no items sits at
   the top of the decisions file, each with a one-line recommendation.
   Everything else is the designer's call, recorded, reversible.
8. **Design from causes, not findings.** Hundreds of findings collapse to a
   handful of systemic causes and a dozen or so rules. The target is drawn
   from the rules; the findings are then mapped back to prove coverage.
9. **Metrics before and after, counted from the chart.** Entry points, ways to
   finish, screens, steps, decisions, fields, repeated fields, dead ends,
   silent states, feedback gaps, test coverage. Counted by a script from the
   mermaid chart and the step table, never estimated by a model.
10. **Rule check loop until the FAILs are explained.** Run the cheap engine in
    rule-check mode on every target file; fix every FAIL or record why it
    stands as a deliberate deviation. Run it again. Each pass should shrink
    the FAIL count sharply; stop when the remainder is explained, not zero.
11. **Build contract before build code.** `BUILD-CONTRACT.md`, written from
    `reference/BUILD-CONTRACT-TEMPLATE.md`, fixes: where files go, allowed
    and forbidden paths, the data model for the chosen mode, the state store
    and result contract, style rules, per-job definition of done,
    deterministic checks, job order, and a folder-ownership table per job for
    parallel rounds. Checkers fail a job that writes outside its scope.
12. **Fixtures, session state, typed results, a dev-tool bar — prototype mode
    only.** No backend. `Result<T> = { ok: true, data: T } | { ok: false,
    code, message }` for every fake write. A floating dev bar with reset, a
    "simulate failure" toggle, an account-state picker, and a role picker, so
    every failure and every account state named in the target's states
    section is reachable by click. Real mode instead uses the project's own
    seeded test database and dev-login; the same result-contract discipline
    still applies to every real write.
13. **Build → check → fix, in a loop, with deterministic gates.** Builder
    (house design system wins over any generic design taste) → checker (runs
    lint, types, the job's end-to-end spec, path discipline, reads the code
    against the target path's step table and states) → fixer → re-check, up
    to a configured maximum rounds. A job failing its first check and passing
    the second is the loop working, not a problem.
14. **One dev server lock means a semaphore.** Builders run lint and types
    only; checkers take one slot from a small pool of reserved end-to-end
    ports (`loop.playwrightSlots`). Without this, parallel dev servers
    pre-empt each other and every run looks flaky.
15. **A critic that only judges intuitiveness.** Screenshots at a desktop and
    a phone viewport for every route and one failure state per job. A verdict
    per screen. Blockers get fixed by a separate fixer agent; polish is
    recorded and left. Then a final checker runs everything and audits every
    job's ownership.
16. **The orchestrator verifies too.** After the loop finishes: run every spec
    yourself, look at the screenshots yourself, fix the small things a
    checker can miss (a strict-mode selector collision, a phone overflow, a
    blocking native dialog), and log them. Report failures as failures, not
    as findings still pending review.
17. **Commit in focused chunks, never push, owner reviews.** Maps, then
    paths, then decisions and metrics, then the rule check, as separate
    commits. Build-mode output stays uncommitted until the owner has clicked
    through it, or until the project's own review gate says otherwise.

## 2. Gotchas

- Cheap-engine verdict tables need strict wording rules and start/end markers
  (see `reference/prompts/audit.md` and `lib/markers.mjs`), or the extractor
  gets prose back instead of a parseable table.
- A text selector that matches two controls on one screen (a duplicated
  label, an icon-only control next to a text one) breaks an end-to-end spec
  in a way that looks like a product bug; use an exact or scoped selector.
- Grid and flex items default to `min-width: auto`; long text overflows a
  phone-width viewport even when the layout "looks fine" on desktop. A
  `min-w-0` (or the design system's equivalent) on the item fixes it.
- A native `alert()` or a modal dialog outside the design system blocks
  automated checking and reads as unfinished even when the behaviour is
  correct. Use an inline notice instead.
- A framework's own dev-server lock allows one instance per checkout; kill
  any server you started yourself before a checker or the build loop starts
  its own.
- One-off patch scripts against source files: use an array of
  `[anchor, replacement]` pairs with a uniqueness assertion per anchor;
  template-literal object keys and blind string replacement both fail
  silently on a near-miss.
- Builders will still try to "verify" with whatever tooling they can reach;
  the contract must say exactly what they may and may not run, and the
  checker must be the one that runs anything stateful (a dev server, an
  end-to-end spec).
