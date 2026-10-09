# Decisions — step 2 UX simplification

Written while the target maps and target paths are drawn, not after.
Decisions are numbered `D-01`, `D-02`, … in the order they are written; the
number is stable once assigned and is never reused even if a decision is
later dropped. Decisions marked **OWNER-DECISION** change a client-asked
behaviour or a material product choice and need the owner's yes before step
3 draws them; each one carries a one-line recommendation. Everything else is
a design call made under the rules in the project's rules document
(`rules.file` in the config, `## <cutMarker>` heading onward).

Every live finding from `<auditDir>/FINDINGS.md` is listed as closed or left
open in the header of one target path file under `target/paths/`. §7 below
maps every S1 and S2 finding to a decision.

## 1. Owner decisions (need a yes)

| ID | Decision | Recommendation | Refs |
| --- | --- | --- | --- |

One row per decision that needs the owner's yes before step 3 can draw it.
The `Refs` column cites the client-ask document row IDs the decision touches,
or the finding IDs it closes, whichever grounds the recommendation.

## 2. Cross-cutting rules turned into decisions

| ID | Decision | Rule | Closes |
| --- | --- | --- | --- |

Decisions that apply once, everywhere a rule applies, rather than to one
path: a shared result contract, a shared redirect or continuation builder,
a shared header pattern, the word map's governing principle, the navigation
order's governing principle, phone-first targets, logging and end-to-end
coverage. The `Rule` column cites the rule ID from the project's rules
document; `Closes` lists every finding ID this decision closes across every
path it touches.

## 3. Path decisions

| ID | Decision | Path | Closes | Refs |
| --- | --- | --- | --- | --- |

One row per target path that needed its own design decisions beyond the
cross-cutting ones in §2. `Path` is the target path ID (`TW2`, not the
as-built ID). `Closes` lists the finding IDs; `Refs` lists the client-ask
document rows this path decision touches, if any.

## 4. Removed routes, shims, and dead code

Every as-built door from the lane maps that does not appear on the
corresponding target map, per `MAP-TEMPLATE.md`'s target-variant rule.

| Removed | Kind | Decision | Closes |
| --- | --- | --- | --- |

`Kind` is one of: route, shim, dead branch, dead code, nav item, UI control.
Every row's `Decision` must exist in §1, §2, or §3.

## 5. Word map

One word per concept, in the product's own language
(`{{product.language}}`), sourced from `{{product.copyGlobs}}` plus one
status or state map per concept where the as-built product used more than
one word for the same thing.

| Concept | Word | Not | Where it changes |
| --- | --- | --- | --- |

`Not` lists every rejected synonym found in the as-built product, so a
builder in step 3 can grep for leftover uses of the wrong word.

## 6. Navigation order

| # | Item | Route | Group or tabs | Count |
| --- | --- | --- | --- | --- |

One table per lane that has its own navigation. State the as-built item
count and the target item count in one sentence above the table, and name
the source the order is derived from (`inputs/usage.md`).

## 7. S1 and S2 findings mapped to decisions

Everything from this point on is **generated** by
`ux-paths synthesize-target` from `target/finding-map.json`. Do not hand-edit
below `<!-- generated:findings -->`; edit `target/finding-map.json` instead
and re-run the command. The generator throws on any unmapped live S1 or S2
finding and on any finding ID in the map that no longer exists in
`<auditDir>/FINDINGS.md`, so this section can never silently fall behind the
findings it claims to cover.

`target/finding-map.json` shape:

```jsonc
{
  "defaults": { "W2": ["D-03"] },
  "findings": { "W2-01": ["D-03"], "A1-04": ["OPEN", "D-12"] },
  "observed": ["one bullet per note made while drawing, not a finding"]
}
```

`defaults` maps an as-built path ID to the decision IDs applied to every
finding on that path unless overridden per finding in `findings`. A finding
mapped to `"OPEN"` (alongside a decision ID or alone) is left open with the
reason recorded in the covering target path file's header
(`Findings left open:` field), not here.

<!-- generated:findings -->

| ID | Sev | Where | What is wrong (short) | Decision |
| --- | --- | --- | --- | --- |

S1 mapped: <count>. S2 mapped: <count>. Left open: <count> (path IDs and
reasons cited in their target path files).

## 8. Observed during step 2

Not findings. Notes made while drawing, for the build, sourced from
`target/finding-map.json`'s `observed` array. Nothing here needs a decision
ID or a finding ID; it is context a builder in step 3 should not have to
rediscover.
