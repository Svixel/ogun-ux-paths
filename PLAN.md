# ux-paths — design plan (binding for builders)

Written 2026-09-03. Source method: `<private project path>` and the files it names (read-only; never edit that repo). Reference packaging: `~/.agents/skills/autoreview-ui/` (global skill, project config, never writes into the repo except where the project owner asked for artefacts).

## 0. What the skill is

A project-agnostic, agent-agnostic UX programme in four steps. The unit of work is a **path** (a job a person finishes), never a screen.

| Step | Name | Thinking | Volume | Output in the repo under `<auditDir>` |
|---|---|---|---|---|
| 0 | Inputs | orchestrator | scripts | `paths.json`, `inputs/*.md`, `screens/*.png`, `screens/CAPTURE-LOG.md`, tracker `README.md` |
| 1 | Audit | cheap engine per path, strong model spot-checks S1 and writes causes | scripts | `paths/<lane>/<ID>-<slug>.md`, `FINDINGS.md`, `METRICS.md`, `MAP-<lane>.md`, `CROSS-PATH.md`, `REDESIGN-RULES.md` |
| 2 | Simplify | strong model designs, cheap engine rule-checks | scripts | `target/paths/<TID>-<slug>.md`, `target/MAP-<lane>.md`, `target/DECISIONS.md`, `target/finding-map.json`, `target/METRICS.md`, `target/RULE-CHECK.md` |
| 3 | Build | strong model writes the contract and orchestrates; mid model builds, checks, fixes; strong model critiques | Workflow | `BUILD-CONTRACT.md`, `BUILD-LOG.md`, `REVIEW-<n>.md`, code inside the contract's allowed paths |

Step 3 has two modes. `prototype`: fixtures, session store, dev bar, routes under a proto prefix, production `notFound()` guard (the the reference project shape). `real`: real routes against the project's own seeded test database and its dev-login; no fixtures, no dev bar. The loop is identical; only the contract template differs.

Model split is a **config value**, never a hard-coded string in a prompt or a script. Engines for volume work are pluggable: `codex` and `claude`, each optionally wrapped by `ori` (OpenRouter routing). The cheap engine is read-only and never designs.

## 1. Layout

```
~/.agents/skills/ux-paths/            (symlink: ~/.claude/skills/ux-paths -> ../../.agents/skills/ux-paths)
  SKILL.md                            when to use, the four steps, gates, model split, DoD per step  [orchestrator writes]
  PLAN.md                             this file
  package.json                        {"name":"ux-paths","private":true,"type":"module","scripts":{"test":"node --test \"tests/**/*.test.mjs\""}}; NO dependencies (Node 24 rejects a bare directory after --test)
  reference/
    METHOD.md                         17 heuristics + gotchas, de-projectified
    UX-LAWS-PACK.md                   20 laws, auditor rules, severity, labels, notation, metrics, quality bar; product/lane text via placeholders
    PATH-TEMPLATE.md                  as-built path, 8 sections + §9 verification
    TARGET-TEMPLATE.md                target path, 7 sections
    MAP-TEMPLATE.md                   lane map (as-built and target variants)
    DECISIONS-TEMPLATE.md             owner decisions first, then rules→decisions, path decisions, removed, word map, nav order, generated §, observed §
    TRACKER-TEMPLATE.md               <auditDir>/README.md tracker
    BUILD-CONTRACT-TEMPLATE.md        step 3 contract, both modes; ownership table; per-job DoD; allowed commands; known-failure checklist
    prompts/
      audit.md  verify.md  rulecheck.md                     cheap-engine prompts (markers, completeness rules)
      spot-check.md  cross-path.md                          strong-model prompts for step 1 synthesis
      target.md  decisions.md                               strong-model prompts for step 2
      foundation.md  builder.md  checker.md  fixer.md  critic.md  blocker-fixer.md  final-checker.md   loop role prompts
  schemas/
    project.schema.json  paths.schema.json  finding-map.schema.json  check.schema.json  build.schema.json  critic.schema.json  loop-args.schema.json
  scripts/
    ux-paths                          executable node ESM entry; dispatch to lib/commands/*.mjs
    lib/config.mjs                    load, validate (hand-rolled, no deps), resolve `skill:` and repo-relative paths, render templates
    lib/engines.mjs                   runEngine() adapters; read-only enforcement; git-status guard
    lib/markers.mjs                   marker extraction; completeness checks; verdict-table parsing
    lib/md.mjs                        markdown table/section parsing shared by synthesizers
    lib/commands/init.mjs  capture.mjs  audit.mjs  verify.mjs  rulecheck.mjs  synthesize.mjs  synthesize-target.mjs  usage.mjs  status.mjs  loop-args.mjs
  workflows/
    build-loop.workflow.js            the loop; parameterised by args (see §6)  [orchestrator writes]
  projects/
    README.md  example.json           per-project config lives here (like autoreview-ui)
  tests/
    fixtures/                         real the reference project outputs copied verbatim: 3 as-built path files (one per lane at least), 3 target path files, FINDINGS.md, METRICS.md, target/METRICS.md, one rulecheck log, DECISIONS.md, a run summary
    *.test.mjs                        node:test, no deps
```

Rules: ESM (`.mjs`) only. Node built-ins only. Playwright is **not** a dependency; `capture` resolves `@playwright/test` from `~/.agents/skills/autoreview-ui/node_modules` (the `shoot.mjs` driver there is invoked as a child process; we never import project code). Nothing in this skill writes outside `<root>/<auditDir>` except the loop's agents inside the contract's allowed paths.

## 2. Project config — `projects/<name>.json`

```jsonc
{
  "configVersion": 1,
  "name": "second-project",
  "root": "~/Documents/CODE/a second project",
  "auditDir": "docs/ux/2026-09",                      // repo-relative; everything the skill writes goes here
  "product": {
    "name": "a second project",
    "paragraph": "one paragraph: what it is, who uses it, login model, language, cadence",  // fills {{product.paragraph}} in the laws pack
    "language": "sv",                                 // UI copy language; auditors quote copy as shown
    "copyGlobs": ["src/lib/messages/**"],             // where UI strings live; may be empty
    "clientDocs": []                                  // docs whose rows are CLIENT-ASKED; may be empty
  },
  "lanes": [
    { "id": "public",     "label": "Public",     "asBuiltPrefix": "P", "targetPrefix": "TP", "actors": ["visitor"] },
    { "id": "candidate",  "label": "Candidate",  "asBuiltPrefix": "C", "targetPrefix": "TC", "actors": ["candidate"] },
    { "id": "caseworker", "label": "Caseworker", "asBuiltPrefix": "W", "targetPrefix": "TW", "actors": ["caseworker"] },
    { "id": "admin",      "label": "Admin",      "asBuiltPrefix": "A", "targetPrefix": "TA", "actors": ["admin"] }
  ],
  "inputs": ["inputs/routes.md", "inputs/entry-points.md", "inputs/functionality-map.md", "inputs/usage.md", "inputs/prior-research.md"],  // relative to auditDir; the audit prompt lists those that exist
  "screens": {
    "baseUrl": "http://127.0.0.1:3100",
    "viewports": [ { "name": "desktop", "width": 1440, "height": 900 }, { "name": "phone", "width": 390, "height": 844 } ],
    "auth": { "mode": "none" },                       // exactly the autoreview-ui auth block (none | devLogin {endpoint, header, secretFile, secretEnv, handleField})
    "identities": [ { "id": "public", "role": null }, { "id": "candidate", "role": "candidate" } ]   // role = handle posted to devLogin
  },
  "engines": {
    "cheap": { "engine": "claude", "model": "sonnet", "effort": "high", "concurrency": 6, "wrapper": null }
  },
  "models": { "foundation": "opus", "builder": "sonnet", "checker": "sonnet", "fixer": "sonnet", "critic": "inherit", "blockerFixer": "sonnet", "finalChecker": "sonnet" },
  "commands": {
    "lint": "npm run lint",
    "types": "npm run typecheck",
    "extra": ["npm run check:ui"],                     // builders may run lint, types, extra; nothing else
    "full": "npm run check",                           // checkers add this
    "e2e": "npm run test:e2e -- {spec}",               // checkers run the job's spec; {spec} substituted
    "usage": null                                      // optional: a shell command printing CSV `action,entity,created_at`
  },
  "loop": { "maxRounds": 3, "playwrightSlots": 1, "mode": "real" },
  "rules": { "file": "REDESIGN-RULES.md", "cutMarker": "## Ranked redesign moves" }   // relative to auditDir; rule count is derived by parsing `## R<n>.` headings
}
```

`paths.json` (in `<auditDir>`) — the inventory, hand-maintained, validated by `paths.schema.json`:

```jsonc
[{ "id": "W2", "lane": "caseworker", "slug": "search-to-result", "name": "Search to result", "actor": "caseworker",
   "job": "Find a vetted person who fits the case", "routes": ["/handlaggare/sok", "/handlaggare/profiler/[id]"],
   "refs": [], "specs": ["tests/e2e/s12-search.spec.ts", "tests/e2e/s13-profile-detail.spec.ts"], "group": "core" }]
```

ID rule: `<lane.asBuiltPrefix><n>` with n ≥ 1; finding IDs `<pathId>-<nn>`. Targets: `<lane.targetPrefix><n>`. Regexes are built from the config prefixes, never hard-coded.

## 3. Engines — `lib/engines.mjs`

```js
export async function runEngine({ engine, model, effort, promptFile, cwd, wrapper, label })
// -> { text, sessionId, costUsd, turns, stopReason, raw }   (fields null when the engine cannot report them)
```

| engine | command | read-only | text |
|---|---|---|---|
| `codex` | `codex exec --ignore-user-config --ignore-rules --ephemeral -C <cwd> -s read-only -m <m> -c model_reasoning_effort=<e> --output-last-message <tmp> -` with the prompt on stdin | sandbox flag | the tmp file |
| `claude` | `claude --print --model <m> --effort <e> --no-session-persistence --output-format json --strict-mcp-config --allowedTools Read Grep Glob LS --disallowedTools Write Edit MultiEdit NotebookEdit Bash Agent` with the prompt on stdin | tool allowlist | `JSON.parse(stdout).result` |
| wrapper `ori` | prefix `ori codex …` / `ori claude …` (routes the harness through OpenRouter). `ori` has no run mode of its own. | as above | as above |

Every run is followed by a `git status --porcelain` diff against a snapshot taken before; any tracked change outside `<auditDir>` aborts with exit 2 and the diff. Timeouts: `engines.cheap.timeoutMs` default 1_800_000. Logs go to `<auditDir>/logs/<id>.<mode>.{prompt.md,json,raw.txt,unextracted.md}` and `logs/RUN-<stamp>-<mode>.md` exactly like the source runner. `--dry-run` writes prompts and prints the command line it would run, per engine, without spawning.

## 4. Markers and templates

Cheap-engine outputs must end with `<<<PATH-FILE-START>>> … <<<PATH-FILE-END>>>` (audit, verify) or `<<<RULECHECK-START>>> … <<<RULECHECK-END>>>` (rulecheck). Extraction uses `lastIndexOf`. Completeness (audit/verify): `## 1.`–`## 8.` (+`## 9.` verify), one ```mermaid block, ≥20 law rows `^\| *\d{1,2} [A-ZÅÄÖ][^|]*\| *(PASS|FINDING|N/A)`, ≥1 finding ID for that path. Rulecheck: rows `| R<n> |` equal to the parsed rule count, verdicts `PASS|FAIL` only.

Templates use `{{placeholders}}` rendered by `lib/config.mjs` with a tiny renderer (`{{a.b}}` lookup, `{{#each lanes}}…{{/each}}` for lists, unknown placeholder = error). The laws pack keeps every law verbatim from the source, minus the reference project-specific references (product-specific ids and copy examples become generic examples). Lane-specific heuristic sub-blocks become "Heuristics by lane" lists that `{{#each lanes}}` expands only as labels; the law text itself is generic.

## 5. Synthesis (deterministic, no model)

`synthesize` parses every `paths/**/*.md`: §4 metrics rows, §5 findings rows (8 cells), §6 law rows; excludes `DROPPED` from live; writes `FINDINGS.md` and `METRICS.md` in the source shapes (headers verbatim from the fixtures). `synthesize-target` parses `target/paths/*.md` §4 (`Metric | <ID> as-built … | Target | Note`), joins `METRICS.md`, writes `target/METRICS.md`; and reads `target/finding-map.json` (`{ "defaults": {"W2": ["D-03"]}, "findings": {"W2-01": ["D-03"], "A1-04": ["OPEN", "D-12"]}, "observed": ["…"] }`) to regenerate everything after `<!-- generated:findings -->` in `target/DECISIONS.md`; throws on unmapped live S1/S2 or stale IDs. Both commands print counts and exit non-zero on a parse error, never silently skip a file.

## 6. Loop workflow — `workflows/build-loop.workflow.js`

Scripts have no filesystem access, so `ux-paths loop-args --project <name> --contract <path> [--jobs a,b]` prints the full args JSON (validated by `loop-args.schema.json`) that the orchestrator passes to the Workflow tool:

```jsonc
{ "root": "/abs", "auditDir": "docs/ux/2026-09", "contract": "docs/ux/2026-09/BUILD-CONTRACT.md", "log": "docs/ux/2026-09/BUILD-LOG.md",
  "mode": "real", "maxRounds": 3, "playwrightSlots": 1, "models": { … }, "commands": { … }, "skillDir": "~/.agents/skills/ux-paths",
  "designSkill": "/abs/path/to/frontend-design/SKILL.md", "houseDocs": ["src/ui/README.md", "tasks/ui-plan/dos-and-donts.md"],
  "foundation": { "id": "F0", "brief": "…", "owns": ["src/ui/templates/**"], "spec": "tests/e2e/shell.spec.ts" } | null,
  "jobs": [ { "id": "TW2", "file": "target/paths/TW2-search-to-result.md", "lane": "caseworker", "owns": ["src/app/(caseworker)/handlaggare/sok/**"], "linkOnly": ["src/ui/**"], "spec": "tests/e2e/s12-search.spec.ts", "model": null } ],
  "prompts": { "foundation": "<rendered text>", "builder": "<rendered text with {{job.*}} left for the script>", … } }
```

Phases: `Foundation` (sequential; foundation builder → checker/fixer ≤ maxRounds) → `Build` (`pipeline(jobs, build, check→fix ≤ maxRounds)`; builders never touch Playwright; checkers take a slot from a semaphore of `playwrightSlots`) → `Review` (one critic per lane, typed `critic.schema.json` output: `screens[]`, `blockers[]`, `polish[]`) → `Blockers` (one fixer per lane, FIXED/LEFT with reason) → `Final` (final checker: all commands, all specs, ownership audit via `git status --porcelain`). Builders return `build.schema.json` = `{ routes[], files[], checksRun, deviations, walls, wantedFromFoundation[] }`. Checkers return `check.schema.json` = `{ pass, fails[{rule, evidence, fix}], checks{lint,types,extra,full,e2e,paths}, notes }`. The script `log()`s every round, every wall, and every job that hit maxRounds without passing; it never reports a job as passed that did not. Return value: per-job summary + critic + final + `wantedFromFoundation` union, for the orchestrator to act on between rounds.

## 7. CLI

```
ux-paths init --project <name> [--date YYYY-MM]        scaffold <auditDir>: README (tracker), inputs/, paths.json (empty list), rendered UX-LAWS-PACK.md, PATH-TEMPLATE.md, TARGET-TEMPLATE.md, DECISIONS.md skeleton; never overwrites
ux-paths capture --project <name> [--identity id] [--dry-run]     screens/*.png + CAPTURE-LOG.md via autoreview-ui's shoot.mjs (run.json built from paths.json routes × identities × viewports)
ux-paths audit|verify --project <name> [--only A1,W2] [--engine codex|claude] [--model m] [--concurrency n] [--dry-run] [--force]
ux-paths rulecheck --project <name> [--only TW2]
ux-paths synthesize --project <name>
ux-paths synthesize-target --project <name>
ux-paths usage --project <name>                          runs commands.usage, writes inputs/usage.md
ux-paths status --project <name>                         counts on disk: paths audited/verified, findings by severity, targets, FAIL rows, jobs in BUILD-LOG
ux-paths loop-args --project <name> --contract <p> [--jobs …] [--foundation]   prints Workflow args JSON
```

Exit codes: 0 ok, 1 findings/fails present where the command asserts (rulecheck with FAIL rows, synthesize-target with unmapped), 2 usage/precondition/guard tripped. Every command prints what it wrote.

## 8. Tests (node:test, fixtures are real the reference project output)

- `markers.test.mjs`: extraction with chatter before markers, missing markers, inverted markers; completeness on a real path file; rulecheck table parse on a real log.
- `synthesize.test.mjs`: run on fixture path files; assert the finding count, severity counts and metric rows equal the numbers in the fixture `FINDINGS.md`/`METRICS.md` for those paths.
- `synthesize-target.test.mjs`: fixture target files + a `finding-map.json` derived from the fixture DECISIONS §7; assert the generated table matches; assert throw on an unmapped S1.
- `config.test.mjs`: example config validates; bad lane prefix, missing root, unknown placeholder all fail with a message naming the key.
- `engines.test.mjs`: `--dry-run` command lines for codex/claude/ori wrapper, and rejection of an unknown engine; git-guard trips on a synthetic change.
- `loop-args.test.mjs`: args validate against the schema; prompts contain no the reference project words (`members`, `proto:v1`, `TA0`, `TB0`).

## 9. Ownership for the build (parallel agents, one checkout, no worktrees)

| Agent | Owns | Reads |
|---|---|---|
| A reference-docs | `reference/METHOD.md`, `UX-LAWS-PACK.md`, `PATH-TEMPLATE.md`, `TARGET-TEMPLATE.md`, `MAP-TEMPLATE.md`, `DECISIONS-TEMPLATE.md`, `TRACKER-TEMPLATE.md`, `BUILD-CONTRACT-TEMPLATE.md` | the reference project docs |
| B prompts | `reference/prompts/*.md` | the the reference project path-runner script's prompt bodies, `STEP-2-PROMPT.md`, `workflows/*.js` prompts, a second project `tasks/goal-ui-base.md` (for the builder brief shape) |
| C engine core | `scripts/ux-paths`, `scripts/lib/config.mjs`, `lib/engines.mjs`, `lib/markers.mjs`, `lib/commands/{audit,verify,rulecheck,loop-args,status}.mjs`, `schemas/{project,paths,loop-args}.schema.json`, `package.json`, `projects/README.md`, `projects/example.json`, tests `config`, `engines`, `markers`, `loop-args` | the the reference project path-runner script, `paths.mjs`; autoreview-ui `ui-review` (arg parsing style), `schemas/validator.cjs` (validation style) |
| D synthesis | `scripts/lib/md.mjs`, `lib/commands/{synthesize,synthesize-target,usage,init}.mjs`, `schemas/finding-map.schema.json`, `tests/fixtures/**`, tests `synthesize`, `synthesize-target` | the reference project `synthesize*.mjs`, `usage-counts.mjs`, the output files |
| E capture | `scripts/lib/commands/capture.mjs`, `schemas/{check,build,critic}.schema.json` | autoreview-ui `shoot.mjs` header + `authenticate`, the reference project `capture-screens.spec.ts` |
| orchestrator | `SKILL.md`, `workflows/build-loop.workflow.js`, `PLAN.md` | everything |

Shared contract between C, D, E: every command module exports `export async function main(argv, ctx)` where `ctx = { skillDir, loadProject(name), log }`; `scripts/ux-paths` dispatches by subcommand name and passes `ctx`. `lib/config.mjs` exports `loadProject(nameOrPath)`, `resolveSkillPath(p)`, `renderTemplate(text, data)`, `validate(schemaName, value)`. `lib/md.mjs` exports `section(md, n)`, `tableRows(md)`, `parseFindingRow(cells)`. Agents that need a sibling's export before it exists write against this signature; the checker verifies the seams.

## 10. Definition of done for the skill

- `npm test` green in the skill dir (all six test files).
- `node --check` on every `.mjs`; `scripts/ux-paths --help` lists every subcommand.
- `ux-paths init --project example --root <tmp>` scaffolds; `ux-paths audit --project example --dry-run` writes prompts for every engine without spawning; `ux-paths capture --project example --dry-run` writes a valid run.json.
- No the reference project-specific string in `reference/`, `scripts/`, `workflows/`, `schemas/` (grep: `members`, `/admin/login`, `proto:v1`, `TA0`, `TB0`). Fixtures under `tests/fixtures` are exempt.
- No dependency in `package.json`.
- `~/.claude/skills/ux-paths` symlink exists.
