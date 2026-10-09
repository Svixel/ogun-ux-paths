# Project configs

One JSON file per product: `projects/<name>.json`, selected with
`ux-paths <command> --project <name>`. An absolute path works too:
`--config /somewhere/else.json`.

`example.json` is a complete, valid config for a made-up product. Copy it,
change the values, keep the shape. Its `root` is a placeholder, so run the
example with `--root <dir>` pointing at a real checkout.

The file is validated against `schemas/project.schema.json` before anything
runs. Every error names the key it rejects.

## Keys

| Key | Type | What it does |
|---|---|---|
| `configVersion` | 1 | Bumped when a key changes meaning. |
| `name` | string | Must match the file name. Lower case, digits, hyphens. |
| `root` | absolute path | The product checkout. Read-only for every command except the build loop. |
| `auditDir` | repo-relative path | Everything the skill writes goes here, and nowhere else. |
| `product.name` | string | Shown in prompts and in `status`. |
| `product.paragraph` | string | One paragraph: what it is, who uses it, the login model, the language, the release cadence. Fills `{{product.paragraph}}` in the laws pack and in every prompt. |
| `product.language` | string | The language of the UI copy. Auditors quote copy as shown, never translated. |
| `product.copyGlobs` | string[] | Where the UI strings live. May be empty. |
| `product.clientDocs` | string[] | Documents whose rows count as asked-for by the client. May be empty. |
| `lanes[].id` | slug | Lane key. Path files live under `<auditDir>/paths/<lane.id>/`. |
| `lanes[].label` | string | Human name, used in headings. |
| `lanes[].asBuiltPrefix` | 1–3 upper-case | Id prefix for as-built paths: `P1`, `P2`, … Finding ids are `<pathId>-<nn>`. |
| `lanes[].targetPrefix` | 1–3 upper-case | Id prefix for target paths: `TP1`, … Must differ from `asBuiltPrefix`, and be unique across lanes. |
| `lanes[].actors` | string[] | Who works in this lane. |
| `inputs` | string[] | Input documents, relative to `auditDir`. Prompts list the ones that exist and say which are missing. |
| `screens.baseUrl` | url | The running dev server. Use `127.0.0.1`, not `localhost`. |
| `screens.viewports[]` | name/width/height | One screenshot per viewport per route. |
| `screens.auth` | object | Passed to the capture driver unchanged. `{"mode":"none"}`, or `{"mode":"devLogin","endpoint","header","secretFile","secretEnv","handleField"}`. `devLogin` needs `endpoint` and one of `secretFile` / `secretEnv`. |
| `screens.capture` | object, optional | Playwright waits passed to the capture driver: `navigationTimeoutMs` (page load and dev-login request, default 30000) and `waitForTimeoutMs` (the `--wait-for` selector, default 15000). Raise them when the dev server compiles routes on first request (Next.js dev). |
| `screens.identities[]` | id/role | Who to capture as. `role` is the handle posted to the dev-login endpoint, or `null` for logged out. A non-null role needs `auth.mode` `devLogin`. |
| `engines.cheap` | object | The read-only engine that does the volume work. See below. |
| `models.*` | string | Model per loop role: `foundation`, `builder`, `checker`, `fixer`, `critic`, `blockerFixer`, `finalChecker`. `inherit` keeps the calling model. Never hard-code a model in a prompt. |
| `commands.lint` / `.types` / `.extra[]` | string | The only commands a builder may run. |
| `commands.full` | string | The whole check suite. Checkers add it. |
| `commands.e2e` | string | `{spec}` is replaced with the job's spec. May also carry a `{port}` marker, replaced with the Playwright port the loop assigned for that call. A command with no `{port}` marker still gets a port passed to it (via `loop.portBase`); it simply ignores it. Neither marker is a template placeholder — the loop prompts substitute both by hand and never name a port env var themselves, so the project's own convention (an env var, a CLI flag, whatever the project's test runner expects) lives entirely inside `commands.e2e`. |
| `commands.usage` | string or null | Optional. Prints CSV `action,entity,created_at` for `ux-paths usage`. |
| `loop.maxRounds` | integer | How many check→fix rounds a job gets before the loop records it as unfinished. |
| `loop.playwrightSlots` | integer | How many checkers may drive a browser at once. Builders get none. |
| `loop.mode` | `prototype` \| `real` | `prototype` builds against fixtures behind a prefix; `real` builds real routes against the seeded test database. |
| `loop.specTemplate` | string or null | Used when the build contract's ownership table has no Spec column. `{id}`, `{lane}` and `{slug}` are substituted. |
| `loop.ownsBase` | string or null | Prefix prepended to every `owns` / link-only glob in the contract that does not already start with it. |
| `loop.portBase` | integer or null | Base port for the Playwright slots. Each slot's port is `portBase + slot`. Default `3200` when omitted. Fills the `{port}` marker in `commands.e2e`. |
| `rules.file` | path in `auditDir` | The redesign rules. Rule ids are the `## R<n>.` headings. |
| `rules.cutMarker` | string | Everything from this heading on is ignored, so a ranked-moves appendix is not read as rules. |
| `build.designSkill` | path or null | The design skill the builders read. `skill:<relative>` resolves inside this skill; a bare path resolves inside `root`. |
| `build.houseDocs` | string[] | Repo-relative documents that state the house UI rules. |
| `build.foundation` | object or null | Fallback foundation job (`id`, `brief`, `owns[]`, `spec`) when the build contract has no `## Foundation` section. |

## `engines.cheap`

| Key | Type | What it does |
|---|---|---|
| `engine` | `codex` \| `claude` | Which CLI runs the volume work. |
| `model` | string | Model id for that CLI. Check the live catalogue; never quote one from memory. |
| `effort` | string or null | Reasoning effort, when the CLI takes one. |
| `maxTurns` | integer or null | Accepted so old configs load. Ignored: `codex` and `claude` take no turn cap. |
| `concurrency` | integer | How many paths run at once. |
| `wrapper` | `ori` or null | Routes the harness through OpenRouter. `ori` launches `codex` and `claude` only. |
| `timeoutMs` | integer | Per-run timeout. Default 1 800 000 (30 minutes). |

The cheap engine is read-only twice over: by its own flags, and by a
`git status --porcelain` snapshot taken before and after every run. A line
that appears outside `auditDir` aborts the run with exit 2 and prints the
diff.

## The build contract

`ux-paths loop-args --contract <path>` reads two things out of the contract:

1. **The ownership table.** A markdown table whose header has a `Job` (or
   `Id` / `TID`) column and an `Owns` column. Optional columns: `Lane`,
   `File`, `Link-only` (also spelled `Must link to, never create`), `Spec`,
   `Model`, `Name`. The `Job` cell may carry a name after the id. Globs are
   read from the backticks in a cell, so prose around them is ignored; a cell
   with no backticks is split on commas. A row whose first token is not a
   target id is skipped, so a table may carry a totals row.
2. **An optional `## Foundation` section** with `Id:`, `Brief:`, `Owns:` and
   `Spec:` lines. Without one, `--foundation` falls back to
   `build.foundation`, and fails if that is null too.
