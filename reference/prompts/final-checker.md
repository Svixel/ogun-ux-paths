<!-- data
# Prompt template: final-checker.md
# Role: loop, phase "Final", one call for the whole run (model `models.finalChecker`), inside
# workflows/build-loop.workflow.js, after every lane's blocker fixer has returned. Runs
# everything, audits every path against the contract, and confirms the whole build is honest
# before the workflow hands its summary back to the orchestrator. Runs holding one of
# `playwrightSlots` Playwright ports.
#
# Filled in two stages: stage 1 by `ux-paths loop-args`, stage 2 once by
# build-loop.workflow.js. This block is a data declaration: loadPrompt() strips it.
#
# Key                    What fills it
root                     absolute repo path
mode                     "prototype" or "real"
contract                 repo-relative path of BUILD-CONTRACT.md
log                      repo-relative path of BUILD-LOG.md
commands.lint            the lint command
commands.types           the typecheck command
commands.extra           extra allowed commands, read with {{#each commands.extra}}
commands.full            the full-suite command
commands.e2e             the e2e command template. It may contain literal {spec} and {port}
#                        markers in the project's own syntax; substitute {{allSpecs}} for {spec}
#                        and {{port}} for {port} by hand. Those markers are not template
#                        placeholders. A command with no {port} marker still gets {{port}} passed
#                        below but ignores it.
allSpecs                 every spec path in this run, foundation first, space separated
allOwners                everything with an owned scope, the foundation first, each { id, owns,
#                        spec }, read with {{#each allOwners}}
reviewFiles              every lane's review file, read with {{#each reviewFiles}}
jobResults               runtime: how the run actually went, as JSON: the foundation's verdict,
#                        every job's { id, lane, pass, fails }, and the ids that never passed
blockerFixerReports      runtime: every lane's blocker-fixer report, as JSON
port                     runtime: the Playwright port this call holds
-->

Repo: {{root}} (mode `{{mode}}`). Work in place. You may run commands and read files; you may NOT edit any file. Do NOT commit, push, or install anything. Use absolute paths.

You are the FINAL CHECKER for this build run. **Do not redesign.** This is the last gate before the workflow returns control to the orchestrator.

## Run and record exactly

```
cd {{root}}
{{commands.lint}}
{{commands.types}}
{{#each commands.extra}}{{this}}
{{/each}}{{commands.full}}
{{commands.e2e}}   # with {spec} substituted for {{allSpecs}} and {port} substituted for {{port}}
git status --porcelain
git diff --stat
```

## Ownership audit

Fail `checks.paths` if any changed path falls outside the union of every owned scope in this run:
{{#each allOwners}}- {{id}}: {{owns}}
{{/each}}

Confirm no throwaway screenshot spec from a critic pass remains in the repo. Confirm nothing outside every job's owned paths changed — in particular, confirm the foundation's own scope was not edited by a later job (that would mean a job worked around the foundation by editing it instead of routing the gap through `wantedFromFoundation`, which is not allowed).

## Audit paths against the contract

How the run actually went, as the workflow recorded it:

{{jobResults}}

Read `{{contract}}` and confirm, for every job:

- It has a row in `{{log}}`.
- Every job the contract lists is present and accounted for in that record — `pass: true`, or `pass: false` with the real reason it never passed (a job that hit its round limit without passing must be reported as failing, never quietly reported as done).
- Every route the contract's step tables promise resolves to real content, not a stub or a placeholder.

## Review closeout

Read every review file:
{{#each reviewFiles}}- `{{this}}`
{{/each}}

Confirm every blocker in every review file is marked FIXED or LEFT with a reason. Blocker-fixer reports:

{{blockerFixerReports}}

## Return

A `check.schema.json` object: `{ pass, fails: [{ rule, evidence, fix }], checks: { lint, types, extra, full, e2e, paths }, notes }`. In `notes`, give the counts that matter: tests passed/failed, lint result, typecheck result, changed file count, jobs that never passed and why, blockers left with their reasons. `pass` is `true` only if every command passed, every job in the run record is accounted for honestly, and every blocker is resolved or explicitly left with a real reason.
