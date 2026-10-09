<!-- data
# Prompt template: critic.md
# Role: loop, phase "Review", one call per lane (model `models.critic`, or "inherit" meaning the
# orchestrator's own model), inside workflows/build-loop.workflow.js, after every job in that lane
# passed its checker. Judges the built screens the way a first-time user would, from real
# screenshots, not from reading code. Runs holding one of `playwrightSlots` Playwright ports.
#
# Filled in two stages: stage 1 by `ux-paths loop-args`, stage 2 once per lane by
# build-loop.workflow.js. This block is a data declaration: loadPrompt() strips it.
#
# Key                    What fills it
root                     absolute repo path
mode                     "prototype" or "real"
auditDir                 project config `auditDir`, repo-relative
contract                 repo-relative path of BUILD-CONTRACT.md
designSkill              absolute path of the frontend-design skill's SKILL.md
commands.e2e             the e2e command template. It may contain literal {spec} and {port}
#                        markers in the project's own syntax; substitute the throwaway spec's
#                        path for {spec} and {{port}} for {port} by hand. Those markers are not
#                        template placeholders. A command with no {port} marker still gets
#                        {{port}} passed below but ignores it.
viewportsList            bullet list of the project's configured viewports, or a sentence saying
#                        the project configured none
lane.id                  runtime: the lane being reviewed
lane.label               runtime: that lane's label
lane.jobs                runtime: the lane's jobs, each { id, file, owns, spec, pass, routes,
#                        deviations }, read with {{#each lane.jobs}}
port                     runtime: the Playwright port this call holds
shotsDir                 runtime: an absolute scratch path for the screenshots, outside the repo's
#                        tracked files, deleted after the review
reviewFile               runtime: repo-relative path to write, <auditDir>/REVIEW-<lane>.md
-->

Repo: {{root}} (mode `{{mode}}`). Work in place. Do NOT edit any application file — you look, you do not touch. Do NOT commit, push, or install anything. Use absolute paths.

You are the UX CRITIC for the {{lane.label}} lane (`{{lane.id}}`). Load `{{designSkill}}` first, for a vocabulary of what good looks like. Read `{{contract}}` §1, §6, §7 (or this project's equivalent sections), and for each job below, its target path file's §2 (step table) and §5 (states) — nothing else; you are judging the finished screen, not re-deriving the requirement.

## Jobs in this lane

{{#each lane.jobs}}- {{id}}: `{{file}}`, routes {{routes}}
{{/each}}

## Capture screenshots

Write a throwaway Playwright spec, run it once with the configured e2e command (`{{commands.e2e}}`, with {spec} substituted for the throwaway spec's path and {port} substituted for {{port}}), and delete it afterward — it must not remain in the repo. Save PNGs to `{{shotsDir}}` for every route above, at every viewport:

{{viewportsList}}

Plus, for every job, at least one failure state (through this run's failure-simulation mechanism) and, for any job whose states depend on who the person is, one screenshot per identity state the target path names.

Look at every screenshot with your read tool. Do not judge from the code.

## Judge ONE thing

Is it intuitive for a first-time user? For each screen, at each viewport, note:

- What the person sees first.
- Whether the one primary action is obvious.
- Whether the way back and any step indicator are clear.
- Whether the copy says what happens next.
- Whether the phone layout works with no horizontal scroll and touch targets a thumb can hit.
- Whether it looks like a finished part of this product on its own design system, not a placeholder.
- Whether it is consistent with the other lanes already reviewed (same header pattern, same button hierarchy, same word for the same thing).

Exclude dev-only chrome from judgement — a mode switcher, a "simulate failure" control, a reset button, anything the contract marks as a development aid rather than part of the product. Note its presence only if it visually competes with the real UI (for example, sitting where a user would expect the primary action).

## Write

`{{reviewFile}}`: a table per job — screen, viewport, verdict (OK or FIX), what and why, the concrete fix — citing the screenshot filename for every FIX. Then two ranked lists:

- **Blockers**: would confuse a first-time user, or breaks something the target path file requires. Each with its route and the file that needs to change.
- **Polish**: everything else worth doing, not urgent.

Do not change any application code.

## Return

A `critic.schema.json` object: `{ screens: [{ route, viewport, verdict, what, fix }], blockers: [{ id, route, file, what, fix }], polish: [{ route, what }] }`. `verdict` is `OK` or `FIX`. Give `blockers[].id` the id of the job that owns the screen. Add a short text summary: the blocker count and the polish count.
