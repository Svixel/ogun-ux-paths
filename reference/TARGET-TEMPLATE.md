# <TID> — <Target path name>

Replaces: <as-built IDs this target path merges or succeeds>
Actor: <one or more actor labels>
Job: <one sentence>
Rules applied: <R1, R3, … from the project's rules doc, `rules.file` in the config>
Findings closed: <IDs>   Findings left open: <IDs, why>
Refs kept: <client-ask document row IDs this target still honours>
Decisions: <D-xx IDs from `target/DECISIONS.md` that shaped this path>

ID format: `<TARGET-PREFIX><n>`, for example `TW2` for the target path that
replaces as-built path `W2` in the `caseworker` lane. A target path may
replace more than one as-built path; a ranked-move number from the project's
rules doc may be cited alongside the rules applied line.

One short paragraph stating the root problem this target closes and the one
design move that closes it. Name the mechanism, not just the outcome: what
changed structurally so the same class of failure cannot recur.

## 1. Target path

One mermaid flowchart, `UX-LAWS-PACK.md` §5 notation, happy path top to
bottom, branches sideways. No node carries `dead`, `silent`, or `repeat`: a
target chart proves every branch ends on a screen that says what happened
and offers the next control. Where a design choice deliberately accepts a
`dead`, `silent`, or `repeat` node, do not draw it that way — state the
choice in prose above the chart and cite the decision ID that accepted it.

```mermaid
flowchart TD
```

## 2. Step table

| # | Screen | User sees | User does | System does | Feedback |
| --- | --- | --- | --- | --- | --- |

Numbered rows `1`, `2`, `3`, … cover the happy path, stated once at the top
of the section (which actor, which starting state, which entry point).
Rows labelled `B1`, `B2`, `B3`, … cover every other branch: other account
or object states, error and failure states, alternate entry points, and
alternate ways to finish. Every state named in section 5 must appear as a
`B`-row here or on the happy-path rows. A `B`-row may say "Same" in the
"User sees" or "User does" cell when it is identical to an earlier row;
it must still state what differs (system behaviour, feedback, or the
destination).

## 3. Entry points

| Entry point | Where | How the user gets there |
| --- | --- | --- |

One row per distinct door, target-state. State the total door count in one
line above the table (for example "One screen. N doors into it.") and
justify any count above one per job in `target/DECISIONS.md`.

## 4. Metrics, as-built → target

State the happy-path definition in one line above the table (actor, starting
state, entry point, end state) so the counts are reproducible.

| Metric | <ID1> as-built | <ID2> as-built | … | Target | Note |
| --- | --- | --- | --- | --- | --- |
| entry_points | | | | | |
| ways_to_finish | | | | | |
| screens | | | | | |
| steps | | | | | |
| decisions | | | | | |
| fields | | | | | |
| repeated_fields | | | | | |
| dead_ends | | | | | |
| silent_states | | | | | |
| feedback_gaps | | | | | |
| test_coverage | | | | | |

One column per as-built ID this target replaces (from the header's
`Replaces:` line), then one `Target` column. Every target-column number is
counted from this file's own chart and step table, never estimated.
`ux-paths synthesize-target` reads this table's header row literally
(`Metric | <ID> as-built … | Target | Note`) and joins it against
`<auditDir>/METRICS.md`.

## 5. States and outcomes

| State | What the person reads | Next control |
| --- | --- | --- |

One row per branch end state named in the chart and the step table,
including every failure and every account or object state. Every row must
name a control the person can still use, or the row is a `dead` node and
belongs back in section 1's design discussion, not here silently.

## 6. What the system must know or do

Engineering brief for step 3 and the build. Bullets, not prose. Cover, where
they apply to this path: the endpoints or actions this path needs and what
each one's typed result contract returns; detection, prefill, and derived
values (what the system must already know so the person does not re-enter
it); one redirect or continuation builder if more than one screen needs to
carry state forward; normalisation rules for input (Postel's law, R-numbered
if the project's rules doc has one); what gets removed (routes, shims, dead
code) as a consequence of this design, cross-referenced to the decision IDs
that authorise each removal; audit or logging events this path must emit;
the end-to-end coverage this path needs, one spec per state named in
section 5.

## 7. Open questions for the owner

Bullets. Each one names what would change if the owner answered differently,
so the question is decidable, not rhetorical.

Closing line, always present, verified by `ux-paths rulecheck` against the
project's rules: no node in this path's chart carries `dead`, `silent`, or
`repeat`. Every branch ends on a screen that says what happened and offers
the next control.
