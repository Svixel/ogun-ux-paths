---
name: ux-paths
description: "Project-agnostic, agent-agnostic UX programme in four steps: audit the as-built product per user path (cheap engine, verified in a fresh context, S1–S4 severity), simplify into target paths with owner decisions and before/after metrics, then build with a foundation→builder→checker→fixer loop under deterministic gates and a per-lane critic. Paths not screens; method files on disk before any agent runs; synthesis is a script. Use for 'audit the UX', 'simplify the flows', 'build the UI properly', 'prototype the target flows', or any redesign that must be measured."
---

# ux-paths

A UX programme that treats a product as a set of **paths** (jobs a person finishes), never as screens. Every artefact is keyed by a path ID. Method files are written to disk before the first agent runs. Synthesis is a script. The cheap engine does volume and never designs. The owner decides few things, early.

`PLAN.md` in this folder is the binding design: layout, config, engines, templates, loop, CLI, tests. `reference/METHOD.md` is the distilled method with its 17 heuristics and gotchas. Read both before running a step for the first time on a project.

## Use when

- The owner asks to audit, simplify, or rebuild a product's UX, or asks "why is this hard to use".
- A UI has grown (many doors, dead ends, silent states) or has been built backend-first and is thin.
- Before wiring a redesign into real code, and as the build loop for that redesign.

Do not use for a single screen polish; `autoreview-ui` covers that. `ux-paths` composes with it: the capture command reuses its Playwright driver and auth block, and its critic can be run after the loop.

## The four steps

| Step | Question | Thinking | Volume | Gate before the next step |
|---|---|---|---|---|
| 0 Inputs | What exists, and where does a person start? | orchestrator | `init`, `capture`, `usage` | `paths.json` complete; every route captured logged-out and per identity |
| 1 Audit | Where does each path fail? | cheap engine per path; strong model spot-checks every S1 and writes causes and rules | `audit`, `verify`, `synthesize` | every path audited and verified; S1 spot-checked; `CROSS-PATH.md` and `REDESIGN-RULES.md` written; owner has seen `FINDINGS.md` |
| 2 Simplify | What should each path be? | strong model designs; cheap engine rule-checks | `rulecheck`, `synthesize-target` | one target per surviving job; zero dead/silent/repeat nodes or a written reason; zero unmapped live S1/S2; FAIL rows fixed or recorded as standing deviations; owner has answered §1 of `DECISIONS.md` |
| 3 Build | Does it work and feel right? | strong model writes the contract and orchestrates; mid model builds, checks, fixes; strong model critiques | `loop-args` + the Workflow | every job passes its checker or is listed as not passed; blockers FIXED or LEFT with reason; final gate green; owner clicks through |

Step 3 runs in one of two modes, set in the project config: `real` (real routes, the project's seeded test database and dev-login) or `prototype` (fixtures, session store, dev bar, routes under a proto prefix, production `notFound()` guard). Use `real` when the domain layer already exists. Use `prototype` when the flows must be felt before the backend is touched.

## Preconditions

1. `projects/<name>.json` exists and validates (`projects/README.md` explains every key; `projects/example.json` is complete). `auditDir` is repo-relative; everything the skill writes goes there.
2. A cheap engine CLI is installed and logged in: `codex` or `claude`. Optional `ori` wrapper routes `codex`/`claude` through OpenRouter. Engines run read-only; a git-status guard aborts on any tracked change outside `auditDir`.
3. For `capture` and the loop: the app runs at `screens.baseUrl`; `~/.agents/skills/autoreview-ui` is bootstrapped (`npm run bootstrap` there). Gated routes need the `devLogin` auth block, the same one `autoreview-ui` uses.
4. One dev server per checkout is the normal limit in modern frameworks. The loop's `playwrightSlots` is `1` unless the project proves more is safe.

## Commands

```
ux-paths init --project <name>                      scaffold <auditDir>: tracker, inputs/, paths.json, rendered laws pack and templates, DECISIONS skeleton
ux-paths capture --project <name> [--dry-run]       screens/<identity>__<route>__<width>.png + CAPTURE-LOG.md
ux-paths usage --project <name>                     inputs/usage.md from commands.usage (optional)
ux-paths audit --project <name> [--only ids] [--engine e] [--model m] [--dry-run] [--force]
ux-paths verify --project <name> [--only ids]       fresh-context re-read of every finding; never deletes rows
ux-paths synthesize --project <name>                FINDINGS.md, METRICS.md
ux-paths rulecheck --project <name> [--only tids]   PASS/FAIL per rule per target file
ux-paths synthesize-target --project <name>         target/METRICS.md, DECISIONS §generated from target/finding-map.json
ux-paths status --project <name>                    what is on disk, by step
ux-paths loop-args --project <name> --contract <p> [--jobs ids] [--foundation]   prints the Workflow args
```

Exit codes: `0` ok, `1` the command's assertion failed (FAIL rows, unmapped findings), `2` usage, precondition or guard.

## Step 0 — Inputs

1. `ux-paths init`. Fill `paths.json` by hand from the product's flows: one entry per job, with lane, actor, routes in order of first visit, refs, e2e specs. Merged jobs keep their ID.
2. Write `inputs/routes.md`, `inputs/entry-points.md`, `inputs/functionality-map.md` (which capabilities are asked for by a client or a document; those may never be dropped without a written decision), `inputs/prior-research.md`. `usage` when a log exists.
3. Start the app. `ux-paths capture`. Look at `CAPTURE-LOG.md`; fix identities or params until every route has a shot.
4. Update the tracker `README.md`: scope, inventory, log line.

## Step 1 — Audit

1. `ux-paths audit` (cheap engine, `concurrency` from config). Read `logs/RUN-*.md`. Re-run `--only` for paths with gaps.
2. `ux-paths verify`: same engine, fresh context, may add findings and set `DROPPED`, never deletes.
3. `ux-paths synthesize`. Then the strong model runs `reference/prompts/spot-check.md` on every S1 and a seeded random sample of S2, and `reference/prompts/cross-path.md` to write `CROSS-PATH.md` (causes, each in at least three paths) and `REDESIGN-RULES.md` (rules ordered by findings closed, each with Laws, Cause, Closes, Rule, Test, Metric, then ranked moves).
4. Lane maps `MAP-<lane>.md` from `reference/MAP-TEMPLATE.md`.
5. Commit in focused chunks: maps, paths, synthesis. Never push. Tracker log line with counts, cost, minutes.

Severity is real only after verification. Silent failure is at least S2. Each extra way to finish is at least S3.

## Step 2 — Simplify

1. Strong model, fresh session, briefed with `reference/prompts/target.md`: read the tracker, causes, rules, maps, metrics, the laws pack §5 and §6, the functionality map, usage; then each as-built path file only when drawing its target. Do not re-audit. New observations go to `DECISIONS.md §8`, not to findings.
2. One `target/paths/<TID>-<slug>.md` per surviving job from `reference/TARGET-TEMPLATE.md`. Metrics counted from the chart. Every removed door listed in `DECISIONS.md §4` with the finding IDs it closes.
3. `DECISIONS.md`: owner decisions first and few, each with a one-line recommendation. `target/finding-map.json` maps every live S1/S2 to a decision or `OPEN` with a reason.
4. `ux-paths rulecheck` until every FAIL is fixed or recorded as a standing deviation in `target/RULE-CHECK.md`. `ux-paths synthesize-target`.
5. Stop. The owner answers `DECISIONS.md §1`. Then commit: maps, paths, decisions and metrics, rule check.

## Step 3 — Build

1. Write `BUILD-CONTRACT.md` from `reference/BUILD-CONTRACT-TEMPLATE.md`: mode, allowed and forbidden paths, data, per-job definition of done, who may run what, ownership table (one row per job: owns, must link to and never create, spec), foundation scope, known failure classes. Prototype code before contract is forbidden.
2. Make sure one dev server is running on the configured port with the test database, and that no other server holds the framework's dev lock.
3. `ux-paths loop-args --project <name> --contract <path> --foundation` and pass the JSON as `args` to the Workflow tool with `scriptPath` = `workflows/build-loop.workflow.js` in this folder.
4. The loop: foundation builder (strong model, high effort), checker→fixer up to `maxRounds`; then one builder per job (mid model) in parallel, each with its own checker→fixer loop; builders run only lint, types and the configured extras, never Playwright or database commands; checkers take a Playwright slot and run the full check plus the job's spec plus `git status --porcelain` against the ownership row; then one critic per lane judges one thing only, is it intuitive for a first-time user, and returns typed blockers and polish; a blocker fixer marks each FIXED or LEFT with a reason; the final checker runs every gate. Almost every job fails check 1 and passes check 2; that is the loop working.
5. Read the return value. `notPassed` and `wantedFromFoundation` are yours to act on: extend the foundation, re-run `loop-args --jobs` for the affected jobs, and resume. Then verify yourself: run every spec, look at screenshots, fix the small things, log them in `BUILD-LOG.md`. Report failures as failures.
6. The owner clicks through. Only then commit, per gate. Never push.

## Model split and engines

| Role | Default | Config key |
|---|---|---|
| Orchestrator, contract, target design, causes and rules, spot-check, critic, final judgement | the session model | `models.critic` (`inherit`) |
| Foundation builder | `opus`, high effort | `models.foundation` |
| Builder, checker, fixer, blocker fixer, final checker | `sonnet`, medium effort | `models.builder`, `models.checker`, `models.fixer`, `models.blockerFixer`, `models.finalChecker` |
| Audit, verify, rulecheck | `engines.cheap` (`claude`, Sonnet high by default; run `rulecheck` with `--model opus --effort medium`) | `engines.cheap.engine`, `.model`, `.effort`, `.wrapper` |

Per-job overrides: `model`, `checkerModel`, `fixerModel` on a job in the loop args. Never let the cheap engine make a design decision. Never use the strongest model for volume.

## Rules that do not bend

- Paths, not screens. Every file keyed by a path ID. Merged IDs are kept.
- Method files on disk before the first agent runs. Checkers measure against the file.
- Evidence or nothing: `file:line`, a screenshot path, or `<spec>:<test>`. Taste in a vacuum is dropped. A client's ask or a comment saying "deliberate" is not a defence; it is a label.
- Verify in a fresh context before severity means anything.
- Every S1/S2 finding maps to a decision or is left open with a reason.
- Owner decisions first, and few. Everything else is recorded and reversible.
- Design from causes, not findings. Metrics are counted from the chart, never estimated.
- Contract before code. Builders write only inside their ownership row. One dev server per checkout means a semaphore.
- No hacks, no stubs, no scope cuts. A real wall is named, with the line. Reports say what failed.
- Commit in focused chunks after the owner's yes. Never push. Never edit another project's repo when it is used as a source.

## Final report

For each step: what was produced (counts, paths, files), cost and minutes, what the owner must decide or click through, and the exact command outputs of the gates. For step 3 add: jobs passed and not passed, blockers FIXED and LEFT, wanted-from-foundation items, and the screenshots the critic used.
