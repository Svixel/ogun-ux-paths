<!--
Prompt template: spot-check.md
Role: strong model (config `models.foundation`, e.g. "opus"), step 1 synthesis, run once per audit
by the orchestrator's own session — not dispatched through lib/engines.mjs. It has normal
read/write tools but must not edit any file except the one this prompt asks it to produce.
It is the first half of the work that becomes CROSS-PATH.md §1; cross-path.md consumes its
output verbatim as {{spotCheck}}.

Rendered by: the orchestrator, via lib/config.mjs `renderTemplate(text, data)`, when starting
step 1 synthesis (after every path has been audited and verified). See SKILL.md for when to run
this in the four-step sequence.

Placeholders and who fills them:
  {{product.name}}          project config `product.name`                                     — orchestrator
  {{auditDir}}                project config `auditDir` (repo-relative)                          — orchestrator
  {{lanes}}                    project config `lanes` list, each `{id, label}`, expanded with
                                `{{#each lanes}}`                                                  — orchestrator
  {{pathsList}}                 bullet list of every verified path file, grouped by lane, each
                                  line `<lane label>: <ID> — <name> (\`{{auditDir}}/paths/<lane>/<file>\`)` — orchestrator (reads paths.json + the paths/ tree)
  {{findingsFile}}               repo-relative path to `{{auditDir}}/FINDINGS.md`                   — orchestrator
  {{screensDir}}                  repo-relative path to `{{auditDir}}/screens/`                      — orchestrator
  {{s1.count}}                     the number of severity-S1 findings in FINDINGS.md                 — orchestrator (counts rows before rendering)
  {{s1.ids}}                        every S1 finding id, comma-separated                             — orchestrator
  {{s2Sample.seed}}                  the seed used for the random draw (record it so the draw is
                                      reproducible)                                                    — orchestrator
  {{s2Sample.totalS2}}               the total number of severity-S2 findings                          — orchestrator
  {{s2Sample.count}}                  how many S2 findings were drawn (about a third, at least 5)       — orchestrator
  {{s2Sample.ids}}                    the drawn S2 finding ids, comma-separated                          — orchestrator
-->

You are the independent spot check on the verified findings for {{product.name}}'s UX audit. The cheap engine already ran audit and verify on every path; the verifier's own confirmation rate needs an outside check before anyone designs from it. You have read tools; you may open code, screenshots, and every path file. Do not edit any path file, `{{findingsFile}}`, or any file under `{{auditDir}}` except the one you are asked to write.

## What to check

1. **Every severity-S1 finding.** Count: {{s1.count}}. IDs: {{s1.ids}}.
2. **A seeded random sample of severity-S2 findings.** Total S2 findings: {{s2Sample.totalS2}}. Drawn with seed `{{s2Sample.seed}}`: {{s2Sample.count}} of them. IDs: {{s2Sample.ids}}.

Do not re-audit the paths and do not re-open findings outside this list. If you notice something new while you are in the code, do not add it here — note it for the "Observed" list that decisions.md collects later, and move on.

## Path files

{{pathsList}}

Findings live in `{{findingsFile}}`; each row cites its path file and its evidence. Screenshots, where the finding cites one, are under `{{screensDir}}`.

## Procedure

For each finding on your list:

1. Open the path file's finding row and read the cited evidence: `file:line`, a screenshot filename, or a spec name and test.
2. Open that evidence yourself, with your own reasoning, not the verifier's. If it is `file:line`, read the file at that line and confirm it says what the finding claims. If it is a screenshot, look at the image. If it is a spec, read the assertion.
3. Record **held** (the evidence proves the claim as stated), **conditional** (the evidence proves it only under a condition — state the condition, for example a seed-data gap that may not exist in production), or **not held** (the evidence does not prove the claim; say what it actually shows).
4. Quote the one or two words or lines that prove your verdict, the same discipline the findings themselves use.

## Output

Write a section with two tables, in this shape (this becomes CROSS-PATH.md §1; write it so it can be pasted there unchanged):

```
## 1. Spot check of the verified findings

The verifier confirmed <N> of <M> findings and dropped <D>. [one sentence on whether that
confirmation rate needed an independent check, and why]

| Set | Checked | Held | Notes |
| --- | --- | --- | --- |
| Every S1 finding | {{s1.count}} | <held count> | [one line pointer to the table below] |
| Random sample of S2 (seed {{s2Sample.seed}}) | {{s2Sample.count}} of {{s2Sample.totalS2}} drawn | <held count> | <comma-separated ids drawn> |

S1 re-check record (evidence opened directly, not taken from the verifier):

| ID | Held | Note |
| --- | --- | --- |
| <finding id(s), grouped when they share one root cause> | yes / no / conditional | <the quoted proof or the gap, in one line, with file:line> |

Conclusion: [one or two sentences: are the verified files reliable enough to design from; any
downgrade with a reason; whether synthesis should proceed on the files as they stand].
```

Group finding IDs on one row when several share exactly the same evidence and the same verdict, as the source material does; do not pad the table with a repeated identical line per ID.

Return the finished section as your final answer.
