# UX laws pack — definitions, heuristics, and rules for the path audit

Version 1. This pack is injected verbatim into every audit agent. Read all of
it before auditing. Apply all twenty laws to every path and record the result
of each law, including passes, in the path file's law-by-law table.

The pack has seven parts: the twenty laws (§1), rules for auditors (§2),
severity (§3), status labels (§4), mermaid notation (§5), metrics (§6), and
the quality bar for a finding (§7).

**Placeholders this file expects**, rendered by `lib/config.mjs` from the
project config before an agent ever sees it:

| Placeholder | Source | Meaning |
| --- | --- | --- |
| `{{product.paragraph}}` | `product.paragraph` | One paragraph: what the product is, who uses it, the login model, the UI language, how often people return |
| `{{product.language}}` | `product.language` | The UI copy language, for example `sv` or `en` |
| `{{product.copyGlobs}}` | `product.copyGlobs` | Where UI strings live in the repo, for auditors quoting copy with its message key |
| `{{#each lanes}} {{label}};{{/each}}` | `lanes[].label` | The project's lane labels, for the "apply per lane" instruction under every law. The renderer has no join helper, so the separator lives inside the block. |

The product context: {{product.paragraph}}

---

## §1 The twenty laws

Every law below has one definition, one symptom list, one heuristics
paragraph that applies to any lane, and a mechanical "apply per lane" line.
Run every heuristic once for each of this project's lanes:{{#each lanes}} {{label}};{{/each}}

### 1. Hick's law

**Definition.** Hick (1952) and Hyman (1953) measured that the time a person
needs to make a decision grows with the logarithm of the number of equally
likely choices: T = b · log2(n + 1). The mechanism is that the person must
scan, categorise, and compare the options before acting. Each extra option
adds scanning time, raises the chance of a wrong pick, and past a point causes
no pick at all (choice paralysis). Unfamiliar or ambiguous options cost far
more than familiar ones, so the law is about the complexity of the choice, not
only the count. It applies at every decision point: navigation, toolbars,
row actions, menus, "create new" pickers, filters, and form choices.

**Symptoms.** Two or more controls that lead to the same result. A navigation
with fifteen or more peers. A row or toolbar with eight actions of which two
are used. A "new" picker that lists every type at once. All filters shown at
once. An entry screen that asks the person to choose between several near-
identical starting doors without telling them which applies.

**Heuristics.** Count top-level navigation entries. Count actions per table
row, per toolbar, per overflow menu. Count the distinct ways to start each
job (entry points). Count the options in every create picker and status
dropdown. Check whether one action is visibly primary. Check whether rare
options sit at the same level as frequent ones. On a public-facing lane,
count the choices on the entry screen and at the end of each flow; check
whether the person must decide which flow applies to them (returning,
prospective, guest, invited) without help from the system; count the
branching questions inside any multi-step form.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Counts with `file:line` for the nav config, menu components, and
pickers. Screenshot paths. **Metrics:** entry_points, decisions.

### 2. Fitts's law

**Definition.** Fitts (1954) showed that the time to move to and hit a target
is a function of the distance to the target and the size of the target:
MT = a + b · log2(2D / W). Big, near targets are fast; small, far targets are
slow and error-prone. On a screen the edges and corners act as very large
targets because the pointer stops there. On touch, a fingertip needs roughly
44 by 44 CSS pixels to hit reliably. The law also governs sequences: the
distance between one step's control and the next step's control is part of
the cost of the flow.

**Symptoms.** Icon-only row actions under 32 pixels. A save button at the top
of a long form while the last field is at the bottom. A close control of 16
pixels. A confirm dialog whose buttons sit far from the control that opened
it. A primary action floating in a wide empty area. Phone layouts where the
call to action is out of thumb reach.

**Heuristics.** Measure the primary button size and hit area on each screen.
Measure row actions. Measure the distance from the last form field to the
submit control. Check any off-canvas or drawer navigation for touch target
size. Check that destructive actions are not adjacent to primary ones. Assume
phone first on any public-facing lane: check every form control, any code or
token entry field, and the primary call to action for touch size and thumb
zone placement; check "resend" and "change" affordances, if any, for size and
placement.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Design-system classes or CSS with `file:line`, measured sizes
from screenshots (state the viewport width used). **Metric:** none direct;
record in findings.

### 3. Jakob's law

**Definition.** Nielsen (2000): users spend most of their time on other
products, so they expect yours to work like those. They bring mental models
from familiar tools — a mail client, a document editor, a notes app, a
banking app, and any product the organisation already used before this one.
Following convention lets them transfer what they know; breaking it forces
learning and causes errors. Novelty is a cost that must buy something. The
law does not forbid innovation; it says the default must be the convention
and every deviation must earn its place.

**Symptoms.** A custom table paradigm. Save semantics unlike anything the user
knows: autosave without an indicator, or manual save with a hidden button.
A verification flow that does not show the address it sent to, offers no
resend, and no "wrong address?" path. Missing breadcrumbs where every other
screen has them. Status vocabularies that mean something different from the
usual.

**Heuristics.** List every custom pattern on the path. For each, name the
convention the user would expect and the cost of the deviation. Check
list-to-detail, primary navigation placement, top-right primary action,
breadcrumbs, draft and publish states, toasts, and confirm dialogs against
convention. On a public-facing lane, compare any sign-in or sign-up flow with
the passwordless or single-sign-on flows people already know: is the
sent-to address shown, does resend exist, does change-address exist, does
"did not get it?" help exist, does code entry accept a pasted value. Compare
any application or intake form with common form conventions: progress, back,
review before submit.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshot plus a one-line statement of the expected convention.

### 4. Law of proximity

**Definition.** A Gestalt principle: objects that are near each other are
perceived as a group, and objects that are far apart are perceived as
separate. Spacing communicates relationship before any reading happens, and
proximity beats colour and shape as a grouping cue. In interface terms the
whitespace between elements is a statement about their relationship.

**Symptoms.** Unrelated actions clustered together. Related fields spread
across separate cards. A destructive action beside a safe one. A label far
from its input. Helper text nearer the next field than its own. A filter bar
far from the results it changes.

**Heuristics.** Check the spacing scale is consistent and meaningful. Check
destructive actions are separated from safe ones. Check filter controls sit
next to the results they change. Check each form group reads as one visual
group. Check error messages sit next to their field, and the call to action
sits next to the summary it acts on.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshot with region notes.

### 5. Miller's law

**Definition.** Miller (1956) reported that working memory holds about seven,
plus or minus two, chunks; modern estimates are closer to four. The design
consequence is chunking: group information into meaningful units so a person
can hold a task in mind. The law is often misread as "at most seven items on
a screen". The correct reading is "do not require the person to hold more
than a few things in working memory at once", and "organise long sets into
chunks". A thirty-row table is fine; a form that needs the user to recall a
value from three screens back is not.

**Symptoms.** A navigation with nineteen peers and no grouping. A form with
twenty-five visible fields and no sections. A table with fourteen default
columns. A wizard that needs the user to recall an earlier step's value. A
status vocabulary with ten states. A dashboard with eight widgets and no
hierarchy.

**Heuristics.** Count navigation peers and groups. Count default table
columns. Count visible fields per form section. Count status values. Count
filter controls visible by default. Check whether the user must carry a value
across screens. On any multi-step entry or intake flow, count fields per
screen, check for a step indicator, and check whether the person must recall
which identifier or address they used earlier.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Counts with `file:line`. **Metrics:** fields, screens.

### 6. Doherty threshold

**Definition.** Doherty and Thadani (IBM, 1982) found that when the system
responds in under 400 milliseconds, productivity rises sharply because the
person stays in flow; beyond that attention drifts and error rates rise. The
threshold is about perceived responsiveness: an immediate acknowledgement
such as a pending state, a skeleton, or an optimistic update counts even when
completion takes longer. The worst case is a response that never comes: the
user acted, nothing visible happened, and the user does not know whether the
system did anything.

**Symptoms.** A server action with no pending state. A page change with no
skeleton. A submit button that gives no feedback. A notification that never
arrives with no way to learn that. A long export behind a disabled button
with no label. A search that takes over a second on small data.

**Heuristics.** For each primary action on the path: is there visible
feedback within 400 milliseconds? Is there a completion signal? Record any
disabled-without-label state. Use prior measured timings where the project
has recorded them (`inputs/prior-research.md`, if present). On a
public-facing lane, after any "we will contact you" action: is the sent-to
address shown at once? Is there a "not received?" path, a resend, a
change-address path? Is the wait bounded? After a code or token entry: is
verification immediate and is failure explained?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Code: pending-state hooks, optimistic state, toast calls, with
`file:line`. Prior measured timings with their source. **Metric:**
feedback_gaps.

### 7. Von Restorff effect

**Definition.** Von Restorff (1933), the isolation effect: among a set of
similar items, the one that differs is the most likely to be noticed and
remembered. The design use is to make the primary action and the critical
status visually distinct. The effect depends on contrast with the set, so
overuse destroys it: when everything is highlighted, nothing is.

**Symptoms.** Three primary-coloured buttons on one screen. Every status badge
coloured. Destructive actions styled like primary actions. The real primary
action rendered as a text link. Attention-needed states that look like
neutral states.

**Heuristics.** One visually primary action per screen? Colour used for
meaning only? Is "needs action" the loudest status? Are destructive actions
distinct from everything else? On any public-facing lane, is the one thing to
do next the loudest element, and are success and error states distinct from
each other and from the neutral state?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshot plus a grep count of primary button variants per
page.

### 8. Minimize target distance

**Definition.** This is not a named law. It is a corollary of Fitts's law and
the principle of locality of action: the control for a thing should sit on or
beside that thing, and consecutive steps should be spatially and structurally
near each other. It cuts motor time, search time, and page changes. It is the
practical rule behind inline editing, row actions, and context menus.

**Symptoms.** Changing one row's status needs a visit to another page. Row
actions hidden behind a detail page. Save at the top of the form. Back only
through the browser. A "view as" or "impersonate" action buried in a menu on
a different screen.

**Heuristics.** For each frequent action on the path, count clicks, page
changes, and scrolls from seeing the object to finishing the action. Note
every detour to another page for a one-click job. On any public-facing lane,
check whether the primary call to action sits on the item it acts on, and
whether a resume link sits on the entry screen rather than one page away.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Step counts with routes. **Metric:** steps.

### 9. Serial position effect

**Definition.** Ebbinghaus observed that items at the start of a list
(primacy) and at the end (recency) are recalled best; the middle is
forgotten. In interfaces the first and last positions in a navigation, menu,
or form are the most valuable. Put the most used and most important items
there. Put the primary action at the end of a form, where the eye finishes.

**Symptoms.** A navigation ordered alphabetically or by build date. Settings
in position six of nineteen. The most used section buried mid-list. Table
columns with the identifier in the middle.

**Heuristics.** Compare the navigation order with usage counts from
`inputs/usage.md`. Check menu order. Check column order: identifier first,
actions last. On any multi-step form, check the order of fields: identity
first, consent last.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Nav config `file:line` plus usage data.

### 10. Peak-end rule

**Definition.** Kahneman and colleagues showed that people judge an
experience by its most intense moment (the peak) and by its end, not by the
sum or average of its moments. In interfaces the end of a flow decides how
the flow is remembered, and a single bad moment can define the whole product.
Make the end of every flow clear and satisfying, recover errors gracefully,
and make sure the peak is not the worst moment.

**Symptoms.** A flow that ends in a silent redirect. A success screen that
does not say what happens next. An error page as the last thing seen. A
"check your inbox" screen with no message behind it: the end is a void.

**Heuristics.** For every path, describe the last screen. Does it say what
happened, what happens next, and what the user can do now? Where is the
worst moment of the path, and does the user recover from it inside the
product?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshot of the end state; the redirect code with `file:line`.

### 11. Zeigarnik effect

**Definition.** Zeigarnik (1927) found that unfinished tasks are remembered
better than finished ones and create a tension that persists until the task
is completed. Two design uses follow. First, show unfinished work and let the
user resume it: drafts, pending items, incomplete profiles. Second, use
progress indicators to turn the tension into motivation. The failure mode is
the opposite: the system forgets the unfinished task, so the user must start
over or never learns it was unfinished.

**Symptoms.** An unfinished sign-up that cannot be resumed. Draft content
without a drafts surface. Items awaiting review with no badge or count. A
wizard with no step indicator. A person with an incomplete profile who is
never told.

**Heuristics.** Is there a "needs attention" surface for pending items,
drafts, scheduled sends, waitlists, and suggestions? Are there counts on the
navigation? Is there autosave with a visible draft state? On any public-
facing lane, can a person resume an unfinished sign-up by re-entering their
identifier? Does a "finish your registration" prompt go to the actual missing
questions? Is there a step indicator? Is a pending item's status visible to
the person who submitted it?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Queries for pending states with `file:line`; screenshots.

### 12. Law of Prägnanz

**Definition.** The Gestalt law of good figure: the mind perceives ambiguous
or complex images in the simplest form it can. People read simple, regular
layouts at a glance and struggle with irregular ones. Every new layout
pattern in a product is a new figure the user must learn; consistency across
pages is therefore a cognitive saving, not only an aesthetic one.

**Symptoms.** Every list page with its own layout. Four page-header styles.
Forms that look different per content type for no reason. Cards nested in
cards. Detail pages with different section orders.

**Heuristics.** Count distinct page templates across list, detail, and form
pages on the path. Count header variants. Note structural differences that
have no functional cause. On any public-facing lane, do sign-in, sign-up,
onboarding, and profile screens look like one flow — same header, same
width, same control placement?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Side-by-side screenshots; component usage grep.

### 13. Law of similarity

**Definition.** A Gestalt principle: elements that share visual traits
(colour, shape, size, typography) are perceived as related or as the same
kind of thing. The design rule is symmetrical: same function must look the
same; different function must look different. Violations cause two errors:
the user treats different things as the same, or fails to see that two
things are the same.

**Symptoms.** Links styled as buttons and buttons styled as links. Two
different actions with identical styling side by side. Status chips with the
same colour for different states. The same action styled differently on two
pages. Ad hoc button classes outside the design system.

**Heuristics.** Audit button and badge variants against the project's own
design-system reference (see `src/ui/README.md` or the project's equivalent).
Grep for ad hoc button and chip classes on the path. Check the status colour
map is one map. On any public-facing lane, does the primary call to action
look the same on every step, and is the error style one style?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Grep counts with `file:line`; screenshots.

### 14. Law of uniform connectedness

**Definition.** A Gestalt principle: elements that are visually connected by
a line, a shared background, or a common border are perceived as more
related than elements that are not connected, and this cue overrides
proximity and similarity. The design use is to connect controls to what they
control and to bind the parts of one thing together.

**Symptoms.** A filter bar visually detached from its table. Section headings
floating above unrelated content. Related actions split across two
containers. Tabs not connected to their panel. Decorative boxes around
unrelated content.

**Heuristics.** For every container on the path ask what relationship it
shows. Look for missing connectors between a control and its effect: filter
to results, tab to panel, toggle to the thing it toggles.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshots.

### 15. Tesler's law

**Definition.** Tesler's law of conservation of complexity: every application
has an irreducible amount of complexity, and the only question is who deals
with it, the user or the system. Good design absorbs complexity in the
system: defaults, derived values, automation, validation, detection. Bad
design pushes it onto the user as decisions, re-entry, and remembering. The
corollary matters too: do not remove necessary complexity, because then the
task cannot be done at all.

**Symptoms.** The user re-types data the system already has. The user picks a
category by hand that a rule could infer. Staff map one value to another
manually. A person must know their own status before choosing a flow.
Anti-enumeration is implemented as silence towards the user. The user must
copy an internal identifier.

**Heuristics.** List every field on the path the system could derive or
default. List every decision the user makes that a rule could make. List
every place staff must remember a value from elsewhere. On any public-facing
lane, is a known identifier (from a prior submission or a recognised source)
detected and explained rather than asked for again? Is data prefilled from a
pending submission or an existing record? Is a returning-versus-new state
detected rather than chosen? Is a "continue where I left off" parameter
carried without user effort?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Form schemas and server actions with `file:line`. **Metrics:**
repeated_fields, decisions.

### 16. Postel's law

**Definition.** Postel's robustness principle (RFC 761): be conservative in
what you send and liberal in what you accept. For interfaces: accept varied
input (formats, whitespace, case, pasted text, partial data) and normalise
it; produce strict, predictable output (identifiers, exports, status
values). It also covers error tolerance: the system should absorb user
mistakes with autosave, undo, and forgiving parsing rather than punish them.

**Symptoms.** Phone or postal formats rejected. Case-sensitive identifier
matching. A code field that fails on a pasted value with a space. A URL
rejected for a missing scheme prefix. Exports with inconsistent columns.
Imports that fail on one bad row.

**Heuristics.** Review the validation schemas on the path for tolerance.
Review export code for strictness and stability. Review import code for
row-level tolerance. On any public-facing lane, check code-entry
normalisation, check identifier trimming and case-folding on sign-in and
sign-up, and check that a repeated submit is not treated as an error.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Schema and normaliser code with `file:line`.

### 17. Law of common region, and goal-gradient effect

This slot combines two ideas that belong in one group: a Gestalt grouping
law, and one motivation law that matters for multi-step flows.

**Common region, definition.** Palmer (1992): elements inside the same
bounded region are perceived as grouped, and this is one of the strongest
grouping cues. One box means one group. Nesting means hierarchy. A box with
two unrelated things inside it tells a lie.

**Goal-gradient effect, definition.** Hull (1932): motivation and effort rise
as a person approaches a goal. Progress indicators, "2 of 4 done", and
endowed progress (the first step already ticked) increase completion.

**Symptoms.** A card that contains two unrelated things. A box drawn as
decoration. Page-level cards nested three deep. A four-step sign-up with no
progress shown. A completion percentage nobody can explain.

**Heuristics.** Every bounded region must name a single group. Count nesting
depth. Where staff have multi-step jobs, is progress shown? On any
public-facing lane, is progress shown across sign-up, verification,
onboarding, and any profile-completion gate? Is the first step credited?
Does the progression indicator explain itself?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshots; progress component code with `file:line`.

### 18. Parkinson's law

**Definition.** Parkinson (1955): work expands to fill the time available for
its completion. The interface reading is that when a task has no visible
bound, the user spends more time and effort than it needs and may abandon
it. Set expectations ("three steps, two minutes"), constrain scope, prefill,
autocomplete, and default, and offer a quick path beside the full path.

**Symptoms.** Forms with no step count or time hint. Open-ended profile
completion with no "done" signal. Jobs that need four pages when one would
do. No quick create beside the full editor. Long operations with no
expectation set.

**Heuristics.** Is there a quick create beside the full edit where the job is
frequent? Are defaults set? Is an expectation shown for long operations such
as export and import? On any public-facing lane, does sign-up show steps and
expected time? Does a profile-completion gate show exactly what is left and
stop when done?

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Screenshots; form config with `file:line`. **Metrics:** steps,
screens.

### 19. Occam's razor

**Definition.** Among competing explanations, prefer the one with the fewest
assumptions. The design reading: among designs that do the same job, prefer
the one with the fewest elements, and remove until removal hurts. Every
route, button, field, and option must justify its existence. Duplication is
the most common violation: two ways to do one thing doubles learning and
halves consistency.

**Symptoms.** Two routes for one concept. Three preview mechanisms. Two
import paths. Four "publish" flows that differ for no reason. Options nobody
uses.

**Heuristics.** For every route, control, and field on the path ask what
breaks if it is removed. Record every second way to reach the same end
state. The cross-path synthesis aggregates these into a duplication register.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** Routes and controls with `file:line`. **Metrics:**
ways_to_finish, entry_points.

### 20. Pareto principle

**Definition.** Pareto and Juran: roughly 80 percent of effects come from
roughly 20 percent of causes. In product work, a small share of tasks and
screens receives most of the use. Identify that share and optimise it first:
it gets the dashboard, the first navigation positions, the shortcuts, and the
fewest steps. The rest moves out of the way.

**Symptoms.** Rarely used sections at top level. Dashboard widgets nobody
reads. The most common task taking as many steps as a rare one. A frequent
action behind an overflow menu.

**Heuristics.** Rank the path's actions by `inputs/usage.md` and any owner
input. Compare the ranking with navigation position and step count. Flag
frequent actions that cost more steps than rare ones.

**Heuristics by lane.** Apply the above once per lane:{{#each lanes}} {{label}};{{/each}}

**Evidence.** `inputs/usage.md` plus step counts.

---

## §2 Rules for auditors

1. **Read-only.** You log; you never fix. Do not edit source, tests, config,
   or copy files. Write only your own path file under `<auditDir>/paths/`.
2. **Current tree.** Audit the working tree as it is, including uncommitted
   changes. Record `git rev-parse --short HEAD` in the path file header.
3. **Evidence or nothing.** Every finding cites `file:line`, a screenshot path
   under `screens/`, or `<spec file>:<test name>`. A claim you cannot ground
   goes to Open questions, not to Findings.
4. **Real defects only.** No taste notes, no restyling wishes, no scope creep.
   A finding names a law, a place, what is wrong, and why it costs the user.
5. **Client asks are function, not design.** If the project has client-ask
   documents (`{{product.clientDocs}}`), they say what the product must do,
   not how. If one of them asks for something that breaks a law, record it
   with status `CLIENT-ASKED`. Do not drop it.
6. **Design intent is not a defence.** A code comment that says a behaviour is
   deliberate does not remove the finding. Record `DESIGN-INTENT` and the
   user cost.
7. **Prior research is input.** If a finding was already recorded in
   `inputs/prior-research.md` or another research or gap-closure document
   the project names, still record it, add the pointer, and state whether it
   is still present. If it is already scheduled somewhere, add status
   `IN-PLAN` with the ID.
8. **Do not run the end-to-end suite.** Treat it as serial and shared unless
   the project says otherwise. Read the specs as evidence of steps. You may
   run `grep`, read files, and view screenshots.
9. **Every law, every path.** Fill the law-by-law table with `PASS`,
   `FINDING <ids>`, or `N/A <reason>`. Twenty rows, always.
10. **Chart the as-built truth.** The mermaid chart shows what the code does,
    not what the docs say. Where code and docs disagree, chart the code and
    record the disagreement as a finding or open question.
11. **Report exceptions.** If an input is missing or a screenshot is absent,
    say so in Open questions and continue with code evidence. Do not stop.
12. **Copy in the product's own language.** Quote UI copy as shown, in
    `{{product.language}}`, with the message key from `{{product.copyGlobs}}`
    when you can find it.

## §3 Severity

| Level | Meaning | Test |
| --- | --- | --- |
| S1 | Blocks the job or loses work silently | The user cannot finish, or finishes believing something false, or data is lost without a message |
| S2 | The job finishes but with a dead end, repeated work, or a wrong belief that needs a workaround | The user must guess, retry, ask staff, or re-enter known data |
| S3 | Friction | Extra steps, clicks, screens, or reading with no benefit |
| S4 | Polish | Inconsistency that costs little but adds up |

Silent failure is always at least S2. A path with more than one way to finish
is at least S3 per extra way.

## §4 Status labels

| Label | Meaning |
| --- | --- |
| `CONFIRMED` | Evidence at `file:line`, screenshot, or spec, checked by the verifier |
| `PLAUSIBLE` | Evidence points to it but a browser check is needed to be sure |
| `CLIENT-ASKED` | A client-ask document explicitly requested this behaviour; still a finding |
| `DESIGN-INTENT` | Code or docs say it is deliberate; still a finding with a user cost |
| `IN-PLAN` | Already scheduled in the project's own gap-closure or roadmap document; cite the ID |
| `DROPPED` | Verifier found no evidence or found it is not a defect; keep the row with the reason |

Auditors set `CONFIRMED` or `PLAUSIBLE` and may add `CLIENT-ASKED`,
`DESIGN-INTENT`, `IN-PLAN`. Verifiers may change any label and add `DROPPED`.

## §5 Notation for as-built charts

Use `flowchart TD`. One chart per path. Use these node shapes only.

```
[/route Screen title]        a screen the user sees; start with the route
{Decision?}                  a branch: user choice or system rule
[[System action]]            server work with no screen
((Notification: subject))    an out-of-app step, for example an email or SMS
([End: state])                a terminal state, name the state
```

Label every edge with the user action or the rule that fires:
`-->|Clicks Continue|` or `-->|no auth user|`.

Apply exactly these classes to nodes that need them:

```
classDef dead fill:#7f1d1d,color:#fff
classDef silent fill:#78350f,color:#fff
classDef repeat fill:#1e3a8a,color:#fff
```

- `dead`: the user cannot proceed from here inside the product.
- `silent`: the system did something (or nothing) and did not tell the user.
- `repeat`: the user enters data the system already has.

Assign with `class nodeId dead`. Node ids are short and stable: use the route
with slashes turned into underscores, for example `app_login`. Keep the
happy path top to bottom; branch sideways. If the same end state is reachable
by several routes, draw all of them in one chart.

Example fragment:

```mermaid
flowchart TD
  app_login[/app/login Sign in] -->|Sends request| api_request[[POST /api/auth/request]]
  api_request --> has_user{Auth user exists?}
  has_user -->|yes| notify((Notification: your sign-in link))
  has_user -->|no| sent_no_user[/app/login Check your inbox]
  class sent_no_user silent
  sent_no_user --> end_wait([End: user waits for an email that never comes])
  class end_wait dead
```

## §6 Metrics

All metrics are for the happy path unless stated. Count from the chart and
the step table so the two agree.

| Metric | Definition |
| --- | --- |
| entry_points | Distinct places a user can start the job: nav items, buttons, links, notifications, deep links |
| ways_to_finish | Distinct routes through the product to the same end state |
| screens | Distinct screens visited on the happy path |
| steps | User actions on the happy path: clicks, taps, submits, and each typed field counts as one |
| decisions | Choices the user must make, excluding data entry: which button, which type, which flow |
| fields | Fields typed or selected on the happy path |
| repeated_fields | Fields the system already held for this user at that moment |
| dead_ends | States with no way forward inside the product |
| silent_states | States where the system acted, or failed, without telling the user |
| feedback_gaps | User actions with no visible response within 400 ms, or no response at all |
| test_coverage | Steps exercised by an end-to-end spec divided by total steps, as `n/m` |

## §7 Quality bar for a finding

A good finding reads like this:

> **W2-01** · Law 15 Tesler, Law 10 Peak-end · S1 · `CONFIRMED`,
> `DESIGN-INTENT` · `/app/login` after submit · An unknown address gets the
> same "Check your inbox" screen as a known one and no email is sent, so a
> person with no account waits indefinitely · `src/app/api/auth/request/route.ts:146-161`
> returns `{ ok: true }` on `no_user`; copy key `login.check_inbox_title` in
> the project's copy file · Fix direction: detect the state and tell the user
> what to do next, or send an "you have no account, here is how to join"
> message.

A finding is dropped when it has no evidence, when it restates taste, when it
is about a surface outside the path, or when it proposes a design instead of
naming a defect. A finding is not dropped because a client-ask document
requested the behaviour or because a comment says it is deliberate.
