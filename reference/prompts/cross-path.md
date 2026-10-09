<!--
Prompt template: cross-path.md
Role: strong model (config `models.foundation`), step 1 synthesis, run once per audit by the
orchestrator's own session, after spot-check.md. Produces two files: `{{auditDir}}/CROSS-PATH.md`
and `{{auditDir}}/{{rules.file}}`.

Rendered by: the orchestrator, via lib/config.mjs `renderTemplate(text, data)`.

Placeholders and who fills them:
  {{product.name}}          project config `product.name`                                     — orchestrator
  {{product.paragraph}}     project config `product.paragraph`                                 — orchestrator
  {{auditDir}}                project config `auditDir` (repo-relative)                          — orchestrator
  {{lanes}}                    project config `lanes` list, `{id, label}`, via `{{#each lanes}}`   — orchestrator
  {{spotCheck}}                 the finished output of spot-check.md, pasted verbatim              — orchestrator
  {{pathsList}}                  bullet list of every verified path file, grouped by lane, as in
                                  spot-check.md                                                     — orchestrator
  {{findingsFile}}                repo-relative path to `{{auditDir}}/FINDINGS.md`                  — orchestrator
  {{metricsFile}}                  repo-relative path to `{{auditDir}}/METRICS.md`                   — orchestrator
  {{entryPointsInput}}              repo-relative path to the entry-points input file, if the
                                     project config lists one; otherwise "not configured"             — orchestrator
  {{usageInput}}                     repo-relative path to the usage input file, if configured;
                                      otherwise "not configured"                                        — orchestrator
  {{lawsPackPath}}                    repo-relative path to `{{auditDir}}/UX-LAWS-PACK.md`             — orchestrator
  {{outputCrossPath}}                  repo-relative path to write: `{{auditDir}}/CROSS-PATH.md`       — orchestrator
  {{outputRules}}                       repo-relative path to write: `{{auditDir}}/{{rules.file}}`     — orchestrator (from project config `rules.file`)
  {{rules.cutMarker}}                    project config `rules.cutMarker`, the heading that starts
                                          the ranked-moves tail (kept out of the rule text rulecheck.md
                                          parses)                                                        — orchestrator
-->

You are writing the cross-path synthesis for {{product.name}}'s UX audit: the view no single path file can show. You have read/write tools. Read everything listed below fully before writing either output file. Do not edit any path file, `{{findingsFile}}`, or `{{metricsFile}}`; those are already final for step 1.

## About {{product.name}}

{{product.paragraph}}

## What you have

- The spot check that already ran, confirming the verified findings are reliable enough to design from (paste this as your §1, do not repeat the work):

{{spotCheck}}

- Every verified path file:

{{pathsList}}

- `{{findingsFile}}` — every finding, by severity, path, and status.
- `{{metricsFile}}` — the as-built metrics per path.
- `{{entryPointsInput}}` — every nav item, button, link, and deep link that starts a job, by lane.
- `{{usageInput}}` — production usage counts, where logged.
- `{{lawsPackPath}}` §1 for the law definitions if you need the reasoning behind a symptom.

## What to produce

### File 1 — `{{outputCrossPath}}`

Four sections after the spot check (§1, already written above):

**§2 Duplication register.** One job, several doors. Lanes in this audit:
{{#each lanes}}- {{label}}
{{/each}}
For each job reachable through more than one route in any of these lanes, a table row: job, number of doors, which doors lead to the same end state, the worst instance of the duplication, and the source finding IDs. Count only starts of the job (a link, a nav item, an email); exclude backs and redirects. Also list, as prose, the shims and orphans that keep old doors open: redirect stubs, retired routes still routable, dead code still in the tree.

**§3 The shell(s).** For each lane that has a persistent navigation shell (sidebar, top nav, tab bar — not every lane needs one), a table of facts sourced from the code and `{{entryPointsInput}}` / `{{usageInput}}`: total nav items and how they group; how many items have near-zero logged use; where the highest-use jobs sit in the nav order versus where the nav puts them; first and last slots and what occupies them; whether items show counts for work waiting on a decision; whether there is one search or one per list; the header pattern used across pages and where it duplicates or hides a primary action; what changes on a phone-width viewport; word collisions inside the nav; and role gating. Cite the law each fact violates and the finding IDs it explains. Include a usage table (nav item → logged actions, from `{{usageInput}}`) if usage is configured for this project; otherwise say usage is unmeasured for the shell and do not invent numbers.

**§4 Systemic causes.** Read every finding across every path looking for the same shape recurring. A cause qualifies only if it appears in **three or more paths**. For each cause: an id `C1`, `C2`, … in the order you rank them by findings closed; the shape in one sentence; the concrete instances (quoted symptoms, not summaries) with their path IDs; which paths it touches; which laws it violates. This table is the direct input to the rules in File 2 — do not skip straight to rule language here, name the cause first.

**§5 What this means for step 2.** Two or three sentences: which causes close the most findings fastest, whether the shell needs a redesign of every page or a reorder-and-regroup pass first, and that step 2 starts from the causes and the duplication register, not from individual findings.

### File 2 — `{{outputRules}}`

Turn the causes from §4 into rules. Each rule:

```
## R<n>. <imperative sentence naming the rule>

Laws: <laws from the pack, comma-separated>. Cause: C<n> (from CROSS-PATH.md §4). Closes: <finding
IDs this rule fixes, however many there are — list them, do not just say "many">.

Rule: <the constraint itself, stated so a designer or a rule-checker can judge a document
against it without seeing a screen. No screen description, no colour, no component name.>

Test: <how to check a design or a build against this rule — a concrete action someone can take>.
Metric: <the METRICS.md column this should move, and towards what number, or "none direct" if
the rule is not one a metric captures>.
```

Order the rules by how many findings they close, most first. Do not invent a fixed count; write as many rules as the causes justify — this project may need more or fewer than another one did. After the rules, add:

```
## Ranked redesign moves for step 2
```

(exactly `{{rules.cutMarker}}`, so rulecheck.md's parser can find where the rule definitions end) followed by a numbered list of concrete moves for step 2, ranked by blocking findings closed then usage then spread across paths. Each move names what to change, not how the screen looks, and cites the rules it satisfies in parenthesis, e.g. "(R1, R6)".

## Rules for this synthesis

- Evidence pointers are finding IDs or `file:line`, resolvable in the path files or the code. No new evidence you have not opened yourself.
- A cause needs three or more paths to qualify; note candidates that fell short as a one-line aside if they are close, but do not create a cause for them.
- Every law cited must be one from the pack; do not invent laws.
- Do not draw screens and do not change application code. This is documents only.
- When you are unsure whether something is a systemic cause or a one-off, prefer the one-off; step 2 handles one-offs inside the target path they belong to.

Write both files now. Return a short summary: cause count, rule count, and the three or four biggest moves, so the orchestrator can confirm before step 2 starts.
