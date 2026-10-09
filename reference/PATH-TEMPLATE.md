# <ID> — <Path name>

Lane: <one of the project's configured lanes>
Actor: <actor for this lane, from the project config>
Job: <one sentence: what the person wants to get done>
Refs: <client-ask document rows, or "none">
e2e coverage: <spec names, or "none">
Routes: <every route on the path, in order of first visit>
Audited tree: <git rev-parse --short HEAD> plus uncommitted changes, <date>
Auditor: <agent label>

ID format: `<LANE-PREFIX><n>`, for example `W2` for the second path in the
`caseworker` lane whose config prefix is `W`.

## 1. As-built path

One mermaid flowchart using the notation in `UX-LAWS-PACK.md` §5. Every node
is a screen, decision, system action, out-of-app step, or end state. Every
edge is labelled with the user action or the rule that fires. Mark dead
ends, silent states, and repeated data entry with the class names.

```mermaid
flowchart TD
```

If the job has several distinct routes to the same end state, draw them all in
the same chart. That is the "ways to finish" count.

## 2. Step table

| # | Screen or route | User sees | User does | System does | Feedback | Evidence |
| --- | --- | --- | --- | --- | --- | --- |

Feedback: what the user sees within 400 ms of the action, or "none".
Evidence: `file:line`, `screens/<file>.png`, or `<spec>:<test name>`.

## 3. Entry points

| Entry point | Where | How the user gets there | Evidence |
| --- | --- | --- | --- |

Include nav items, buttons, links, notifications, and deep links. Every
distinct starting point counts.

## 4. Metrics

| Metric | Value | Note |
| --- | --- | --- |
| entry_points | | |
| ways_to_finish | | |
| screens | | happy path |
| steps | | user actions on the happy path |
| decisions | | choices excluding data entry |
| fields | | typed or selected on the happy path |
| repeated_fields | | fields the system already knew |
| dead_ends | | |
| silent_states | | |
| feedback_gaps | | actions with no response within 400 ms or no response at all |
| test_coverage | | steps exercised by e2e / total steps |

Definitions are in `UX-LAWS-PACK.md` §6.

## 5. Findings

One row per real defect. Opinion without evidence is not a finding.

| ID | Law | Severity | Status | Where | What is wrong | Evidence | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- |

ID format: `<path>-<nn>`, for example `W2-03`.
Severity and status labels: `UX-LAWS-PACK.md` §3, §4.
Fix direction is one sentence, not a design.

## 6. Law-by-law pass

For each of the twenty laws, one line: `PASS`, `FINDING <ids>`, or `N/A
<why>`. This proves every law was applied, including the ones that passed.

| Law | Result |
| --- | --- |
| 1 Hick | |
| 2 Fitts | |
| 3 Jakob | |
| 4 Proximity | |
| 5 Miller | |
| 6 Doherty | |
| 7 Von Restorff | |
| 8 Target distance | |
| 9 Serial position | |
| 10 Peak-end | |
| 11 Zeigarnik | |
| 12 Prägnanz | |
| 13 Similarity | |
| 14 Uniform connectedness | |
| 15 Tesler | |
| 16 Postel | |
| 17 Common region / Goal gradient | |
| 18 Parkinson | |
| 19 Occam | |
| 20 Pareto | |

## 7. Open questions

Things the auditor could not verify from code, screenshots, or specs, and
what would settle each one.

## 8. Simplification candidates

Raw notes for step 2. Bullets only. No designs, no screens.

## 9. Verification

Appended by the verify pass (`ux-paths verify`), in a fresh context with no
memory of the audit pass that wrote sections 1–8. Verifiers may change any
status label in section 5 and may add `DROPPED`; they may add rows for
findings the audit pass missed; they may correct the chart or a metric.

Verifier: <engine/model/mode label>. Working tree read <date>. Auditor
recorded `<git rev>`. This pass <could / could not> run `git rev-parse`.
Cited files, screens, and specs were opened and checked.

| ID | Old status | New status | Reason |
| --- | --- | --- | --- |

Chart or metric corrections:

- <one bullet per correction, or "none">

Findings added:

- <one bullet per new finding ID with a one-line reason, or "none">
