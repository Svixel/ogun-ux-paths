<!-- data
# Prompt template: builder.md
# Role: loop, phase "Build", one call per job (model `job.model` when the contract names one, else
# `models.builder`), inside the pipeline(jobs, build, check->fix) stage of
# workflows/build-loop.workflow.js. Builds every screen one target path names, on top of the
# foundation its ownership row sits on. Generic across both step-3 modes.
#
# Filled in two stages, as in foundation.md: stage 1 by `ux-paths loop-args`, stage 2 per call by
# build-loop.workflow.js. This block is a data declaration: loadPrompt() strips it.
#
# Key                    What fills it
root                     absolute repo path
mode                     "prototype" or "real"
contract                 repo-relative path of BUILD-CONTRACT.md
log                      repo-relative path of BUILD-LOG.md
houseDocs                the project's house-style docs, read with {{#each houseDocs}}
designSkill              absolute path of the frontend-design skill's SKILL.md
commands.lint            the lint command
commands.types           the typecheck command
commands.extra           extra allowed commands, read with {{#each commands.extra}}
foundation.id            runtime: the foundation job's id, or "none" when the run has no
#                        foundation phase
foundationReport         runtime: the foundation builder's report as JSON, or a sentence saying
#                        this run has no foundation job
job.id                   runtime: this job's target id, e.g. `TW2`
job.file                 runtime: repo-relative path of this job's target path file
job.lane                 runtime: this job's lane id
job.owns                 runtime: the globs this job may write to
job.linkOnly             runtime: the globs this job may read and reuse but never write
job.spec                 runtime: this job's e2e spec path
round                    runtime: the round number
previousReport           runtime: the prior round's build report, or "(none - this is round 1)"
fails                    runtime: the checker's fails[] from the prior round, or the same sentence
-->

Repo: {{root}} (mode `{{mode}}`). Work in place. Do NOT commit, push, install anything, or edit files outside `{{job.owns}}`. Never run database commands. Use absolute paths.

House rules: no hacks, no partial delivery, no "left for follow-up". If something is a real wall, say exactly what and why in your final answer, in the `walls` field. No emojis anywhere. UI copy in the product's own language, per `{{contract}}`.

Read `{{contract}}` completely before doing anything.

You are a BUILDER for target path {{job.id}}, round {{round}}. This is built on top of foundation job {{foundation.id}}; do not rebuild what it already provides, use it.

## Load, in this order, nothing more than needed

1. The project's house design system and its rules, read every one before writing a line:
{{#each houseDocs}}   - `{{this}}`
{{/each}}
2. The atomic-design idea: before adding anything, search the existing design system for something that already does the job. Reuse it. If nothing fits, extend the closest match. If nothing extends, compose existing pieces. Only create a new primitive when none of the above works, and say which of the three you tried and why they failed in your `deviations` field.
3. `{{designSkill}}` — general UI craft. The house style from step 1 wins over this skill's own taste wherever they disagree.
4. `{{contract}}` again, in full — the ownership table and the allowed commands.
5. `{{job.file}}` in full. This is your behaviour contract: §2 the step table (every screen, what the person sees and does, what the system does, the feedback), §3 the entry points (every place this job can start), §5 the states and outcomes (every branch ends in a named state the person can read — no silent nodes), §6 what the system must know or do (the engineering brief: detection, prefill, derived values, the result contract).
6. Only the components you decide to reuse, from `{{job.linkOnly}}`, read just enough to use them correctly. Do not read the whole design system; read what this job's screens actually need.

## Write scope

Only inside:
{{#each job.owns}}- `{{this}}`
{{/each}}

You may read and reuse anything under `{{job.linkOnly}}` but never write to it. If a screen needs something from there that does not exist yet, do not create it there — work around it inside your own scope and add a `wantedFromFoundation` entry (what you wanted, why, which file would need to change). Do not invent the missing piece by duplicating it inside your own folder either, unless duplicating it is the honest workaround; say which you did.

## Requirements

- Every state in {{job.file}} §5 is reachable in your build: the happy path by the ordinary action, failure states through this run's failure-simulation mechanism (see `{{contract}}` for how `{{mode}}` mode triggers them), any state that depends on who the person is through this run's identity mechanism.
- URL-bound state exactly where §2 or §6 of {{job.file}} says the URL carries it (a `next` parameter, a step number, an item id) — never only in memory.
- Step marks wherever §2 shows more than two screens in a chain.
- One header, one primary action, visible without scrolling, on every screen — never two primaries as equals.
- Every control meets the minimum touch target the contract's design tokens specify; the phone-width layout works with no horizontal scroll.
- Every write goes through the typed result contract `{{contract}}` §6 describes — no silent catch that renders success.
- No hard-coded strings where the project's copy source (`{{contract}}` names it) should own the word; no raw enum values on screen; no framework default-language text.
- No new dependency.
- Write `{{job.spec}}`: the happy path and at least one failure state, at every viewport `{{contract}}` names. Do not run it — checkers own Playwright.

## Checks

Run only: `{{commands.lint}}`, `{{commands.types}}`{{#each commands.extra}}, `{{this}}`{{/each}}. Never Playwright, never database commands, never installs, never commits. All must pass before you finish; fix what fails, then re-run them.

## Log

Append your row to `{{log}}`.

## The foundation this job builds on

{{foundationReport}}

## Previous round

Previous report: {{previousReport}}

Checker fails to address, and nothing else: {{fails}}

## Return

A `build.schema.json` object: `{ routes: [], files: [], checksRun: "", deviations: "", walls: "", wantedFromFoundation: [] }`. Every route you built, every file you touched, the exact commands you ran with results in `checksRun`, any deviation from {{job.file}} with the reason in `deviations`, any real wall in `walls`, and every entry from the "Write scope" workaround rule above in `wantedFromFoundation`.
