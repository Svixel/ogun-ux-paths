# UX path programme — <project name> (plan of record and tracker)

Updated: <date>. This file is the live tracker for the programme. Update the
status tables below when a step or sub-step starts or ends. Do not record
target designs or build decisions here; those live in `target/DECISIONS.md`
and `BUILD-LOG.md`.

## Programme

| Step | Name | Output | Status |
| --- | --- | --- | --- |
| 0 | Inputs | `paths.json`, `inputs/*.md`, `screens/*.png`, this tracker | NOT STARTED |
| 1 | Audit | One as-built file per path, verified findings, metrics, lane maps | NOT STARTED |
| 2 | Simplify | Target paths, `target/DECISIONS.md`, before/after metrics, rule check | NOT STARTED |
| 3 | Build | `BUILD-CONTRACT.md`, code inside its allowed paths, `BUILD-LOG.md`, reviews | NOT STARTED |

Each status is one of: `NOT STARTED`, `IN PROGRESS <date>`,
`DONE <date>`, or `DONE <date>, WAITING on <owner> review of <file>`.

Sub-step table, one per step in progress. Repeat this table under a heading
per step (`### Step 1 sub-steps`, and so on) once that step starts.

| Sub-step | What | Status | Evidence |
| --- | --- | --- | --- |

## Why

One short paragraph: the owner's stated problem, in their own words where
possible, and the reported failures that motivated the programme, each with
a pointer to the code or document that first surfaced it. If a client-ask
document names the same failures, cite the row IDs here.

## Scope

State the lanes in scope, one bullet per lane, from the project config:
{{#each lanes}}
- Lane `{{id}}`, {{label}}: <what this lane covers, and what routes or
  actors it does not include>
{{/each}}

State what is explicitly out of scope, and whether the audit reads the
working tree (including uncommitted changes) or a specific ref, and whether
it audits a deployed environment at all.

## Method

- The unit of work is a **path**: one user job from entry to end state. Each
  path gets one file in `<auditDir>/paths/<lane>/<id>-<slug>.md`, built from
  `PATH-TEMPLATE.md`. Resolution is per path, never per area.
- Every audit and verify run carries `UX-LAWS-PACK.md` rendered in full. The
  pack holds the twenty laws, evidence rules, severity, status labels,
  mermaid notation, and metrics.
- Every path file has an as-built mermaid flowchart in the fixed notation so
  synthesis can stitch charts into one map per lane.
- Every finding cites evidence: `file:line`, a screenshot path, or an
  end-to-end spec and test name. No evidence, no finding.
- Audit and verify agents are read-only. They log; they never fix. They do
  not run the end-to-end suite; they read the specs as path evidence.
- Simplification is step 2. Path files may list raw simplification
  candidates in one short section, without designs.
- Prior research is input, not truth: whatever the project names in
  `inputs/prior-research.md`.

## Path inventory

One table per lane. `<PREFIX>` is that lane's `asBuiltPrefix` from the
project config. Client refs, where a project has client-ask documents, are
the row IDs from `product.clientDocs`.

### Lane `<id>`, <label>

| ID | Path (job) | Routes | Refs | e2e specs | Group |
| --- | --- | --- | --- | --- | --- |

`Group` is a free-text label for paths that share a build wave or a common
root cause; it has no fixed vocabulary.

Cross-cutting, not a path: shared chrome (nav, page header, search) common
to more than one path in a lane. The cross-path synthesis audits it using
every path file's entry points and the laws that apply to a whole surface
rather than one job: Hick, Miller, Serial position, Pareto, Occam, Jakob.

## Waves and engines

Record the model and engine split actually used, as a config-driven fact,
not a hard-coded choice:

| Wave | Runs | Engine | Input | Output |
| --- | --- | --- | --- | --- |
| 0 | scripted | orchestrator | routes, client docs, shell and link code | `inputs/*.md` |
| 1 | one run per path | `engines.cheap.engine`/`.model`, read-only tools | laws pack, template, inputs, screens, code, specs | one file per path under `paths/` |
| 2a | one run per path | `engines.cheap.engine`/`.model`, fresh context | the path file, code, screens | status on every finding, §9 verification |
| 2b | one session | `models.foundation` | every path file, nav code, usage counts | cross-path synthesis and spot check |
| 3 | one session | `models.foundation` | everything | `FINDINGS.md`, `METRICS.md`, `MAP-<lane>.md`, the rules document |

Runner: the `ux-paths` CLI (`audit`, `verify`, `rulecheck`, `--only`,
`--concurrency`, `--dry-run`). The cheap engine gets a read-only tool
allowlist only; the runner writes the outputs and checks `git status`
afterwards. Every run leaves its prompt, JSON result, and transcript under
`<auditDir>/logs/`. Screenshots come from `ux-paths capture`. Usage counts
come from `ux-paths usage` when `commands.usage` is configured.

## Files

```
<auditDir>/
  README.md              this file: plan, tracker, inventory, log
  UX-LAWS-PACK.md         rendered from reference/UX-LAWS-PACK.md
  PATH-TEMPLATE.md        rendered from reference/PATH-TEMPLATE.md
  paths.json              the path inventory as data
  inputs/                 step 0 inputs (committed)
  screens/                screenshots on seeded or test data (regenerate with `ux-paths capture`)
  logs/                   per-run prompt, JSON result, transcript, RUN summary
  paths/<lane>/           one file per as-built path, by lane
  FINDINGS.md METRICS.md MAP-<lane>.md CROSS-PATH.md REDESIGN-RULES.md   wave 3
  target/
    README.md paths/ MAP-<lane>.md DECISIONS.md finding-map.json METRICS.md RULE-CHECK.md
  BUILD-CONTRACT.md BUILD-LOG.md REVIEW-<n>.md   step 3
```

## Log

Dated bullets, most recent last, in the shape: what ran, the volume
(paths audited, findings found, target paths drawn, jobs built), the cost
and minutes if the engine reports them, the commit hashes for anything
committed, and one line starting "Next:" naming the next sub-step.

- <date>: <what happened>. Cost <n> USD, <n> min if applicable. Commits:
  `<hash>` <what>, `<hash>` <what>. Next: <the next sub-step>.
