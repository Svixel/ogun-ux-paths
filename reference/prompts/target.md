<!--
Prompt template: target.md
Role: strong model (config `models.foundation`), step 2, one call per surviving target job,
run by the orchestrator's own session in ranked-move order. Produces one file:
`{{auditDir}}/target/paths/{{job.id}}-<slug>.md` and appends to the running
`{{auditDir}}/target/DECISIONS.md` as it goes (decisions.md later consolidates the whole file;
this prompt only asks for entries relevant to this one target path, appended, never rewritten).

Rendered by: the orchestrator, via lib/config.mjs `renderTemplate(text, data)`, once per job,
in the order the ranked moves in `{{rules.file}}` name.

Placeholders and who fills them:
  {{product.name}}          project config `product.name`                                     — orchestrator
  {{auditDir}}                project config `auditDir` (repo-relative)                          — orchestrator
  {{template}}                 full text of reference/TARGET-TEMPLATE.md                          — orchestrator
  {{job.id}}                    the target id to draw now, e.g. `TW2` (prefix from the lane's
                                 `targetPrefix`)                                                    — orchestrator
  {{job.replaces}}               the as-built path ids this target merges or replaces, comma-
                                  separated                                                          — orchestrator (from the ranked-moves entry / owner's plan)
  {{job.asBuiltFiles}}            backticked, comma-separated list of the as-built path files for
                                   `{{job.replaces}}`                                                  — orchestrator (looked up in paths.json)
  {{crossPath}}                    the full text of `{{auditDir}}/CROSS-PATH.md`                        — orchestrator
  {{rules}}                         the full text of `{{auditDir}}/{{rules.file}}`                       — orchestrator
  {{metricsFile}}                    the full text of `{{auditDir}}/METRICS.md`                          — orchestrator
  {{functionalityMapPath}}            repo-relative path to the functionality-map input, if
                                       configured; otherwise "not configured for this project"           — orchestrator
  {{usageInputPath}}                   repo-relative path to the usage input, if configured;
                                        otherwise "not configured"                                        — orchestrator
  {{mapFilesList}}                      backticked, comma-separated list of the as-built
                                         `{{auditDir}}/MAP-<lane>.md` files, for the doors this
                                         target path must either preserve or account for as removed    — orchestrator
  {{decisionsSoFar}}                     the running content of `{{auditDir}}/target/DECISIONS.md`
                                          written before this call (empty string on the first job)      — orchestrator
  {{outputTargetFile}}                    repo-relative path to write:
                                           `{{auditDir}}/target/paths/{{job.id}}-<slug>.md`             — orchestrator (model chooses the slug; this is where it writes)
  {{outputDecisions}}                      repo-relative path to append to:
                                            `{{auditDir}}/target/DECISIONS.md`                           — orchestrator
-->

You are drawing one target (to-be) path for {{product.name}}'s UX redesign: {{job.id}}, replacing {{job.replaces}}. You do **not** draw screens (that is step 3) and you do **not** change application code. Read the rules below as hard constraints, not suggestions.

## Read first, in this order

1. `{{crossPath}}` — the systemic causes and duplication register this path is drawn to fix. Design from causes, not from individual findings.

{{crossPath}}

2. `{{rules}}` — the rules with their tests and metric targets, and the ranked moves. Every rule that applies to this job's shape (a chain of screens, an entry gate, a list-to-detail job, a form, whatever this job is) is a hard constraint.

{{rules}}

3. The as-built path file(s) this target replaces, read fully now — not skimmed earlier, now: {{job.asBuiltFiles}}. Section 1 (as-built chart), 4 (metrics), 5 (findings), and 8 (simplification candidates) matter most.
4. `{{metricsFile}}` — the as-built numbers for {{job.replaces}}. Your target path must show the to-be numbers next to these.
5. The as-built maps ({{mapFilesList}}) — every door in them must either appear in a target map or be listed as removed in DECISIONS.md. If this job's as-built doors are not yet accounted for anywhere, account for them now.
6. `{{functionalityMapPath}}` — what this job must still do, and what is merely nice to have. A target path may not drop a capability the client asked for without a written decision.
7. `{{usageInputPath}}` — production usage counts. Entry-point choices and "the first screen does the job" are driven by these, not by guesswork.
8. `{{decisionsSoFar}}` — decisions already made for earlier jobs in this run. Stay consistent with them (the word map, the nav order, any removal that touches this job).

Do not re-audit. Do not add new findings. If you notice something new while drawing this path, add one line to the "Observed during step 2" list in your DECISIONS.md entry and move on.

## The template

{{template}}

## What to produce

Write `{{outputTargetFile}}` using the template above, filled completely for {{job.id}}.

Metrics in §4 must be counted from your own chart and step table, not carried over or estimated. `dead_ends` and `silent_states` are zero, or the file says in writing why not, per the rules.

Append to `{{outputDecisions}}` (do not rewrite what is already there): every decision this path required — removals (routes, shims, dead code) with the finding IDs they close and the functionality-map rows they touch, merges, renames added to the word map, nav-order choices, and anything that changes a client-asked behaviour, marked `OWNER-DECISION` with a one-line recommendation. If nothing new belongs in the word map or nav order for this job, say so in one line rather than omitting the section.

## Method

1. Draw the target path's mermaid chart first (pack notation, happy path top to bottom, branches sideways), then the step table, then the rest of the template in order.
2. Every branch ends in a named state the person can read. No silent nodes.
3. Count metrics from what you just drew, not from memory of the as-built numbers.
4. Write the DECISIONS.md entry as you go, not after. Every removal checks the functionality map for a client-asked capability it might drop.
5. Mark `OWNER-DECISION` inline, with a one-line recommendation, anywhere you are making a call that changes what the client asked for rather than how it is delivered.

Output the target path file and the DECISIONS.md entry. Return a short summary: the metric deltas versus the as-built numbers (entry points, screens, steps, dead ends, silent states), and the OWNER-DECISION list from this job, so the orchestrator can flag them.
