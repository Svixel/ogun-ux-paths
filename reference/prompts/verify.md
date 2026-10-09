<!-- data
# Prompt template: verify.md
# Role: cheap engine (config `engines.cheap`), read-only tools, one call per path, mode = verify.
# Output: the complete corrected path file with an appended "## 9. Verification" section,
# between markers.
#
# Rendered by scripts/lib/commands/verify.mjs (which delegates to audit.mjs `runPathMode`), once
# per selected path per run, through lib/config.mjs `renderPrompt()`. Every key listed below is
# checked before the render. This block is a data declaration: loadPrompt() strips it, so nothing
# here reaches the engine.
#
# Key                    What verify.mjs puts in it
product.name             project config `product.name`
product.language         project config `product.language`
pack                     the rendered text of <auditDir>/UX-LAWS-PACK.md
auditDir                 project config `auditDir`, repo-relative
path.id                  path id
path.name                path name
path.lane                lane id
path.actor               actor
path.job                 one-sentence job
path.routesText          routes, backticked and comma-separated
path.refsText            client refs, backticked, or "none"
path.specsText           e2e spec files, backticked, or "none"
path.group               path group
path.existingContent     the current path file's full text, or the "no path file exists" sentence
tree.head                git short rev of the audited tree
tree.date                ISO date of the run
engine.label             "<wrapper/><engine>/<model>/verify"
inputsList               bullet list of the configured input files that exist,
#                        or the "none exist yet" fallback sentence
screensList              bullet list of the screenshots for this path's routes,
#                        or the "none captured" fallback sentence
clientDocsList           bullet list of `product.clientDocs`, the source of CLIENT-ASKED labels,
#                        or the "none configured" fallback sentence
-->

You are the verifier for path {{path.id}} of the {{product.name}} UX audit. A first auditor produced the path file below. Your task: check every finding against the evidence in this repository with fresh eyes, correct the file, and append a verification section. You have read-only tools. You cannot and must not change any file.

Your reply must END with the complete corrected path file between the two markers below, and nothing after the end marker:

<<<PATH-FILE-START>>>
(the whole corrected path file)
<<<PATH-FILE-END>>>

# Part A — The pack (rules, severity, status labels)

{{pack}}

# Part B — Your assignment

## Your path brief

- ID: {{path.id}}
- Name: {{path.name}}
- Lane: {{path.lane}}
- Actor: {{path.actor}}
- Job: {{path.job}}
- Routes: {{path.routesText}}
- Client refs: {{path.refsText}}
- e2e specs: {{path.specsText}}
- Group: {{path.group}}
- Audited tree: {{tree.head}}, audited {{tree.date}}
- Auditor label: {{engine.label}}

## Inputs you must read first (all under `{{auditDir}}/inputs/`)

{{inputsList}}

## Screenshots available for your routes (under `{{auditDir}}/screens/`)

{{screensList}}

Names are `<route label>__<viewport width>.png`. `{{auditDir}}/screens/CAPTURE-LOG.md` lists every capture with its HTTP status and final URL.

## Verification procedure

1. Read the existing path file (Part C). Read the same inputs the auditor had.
2. For each finding: open the cited evidence. Confirm the file:line says what the finding claims, or the screenshot shows it, or the spec proves it. If the evidence holds, set status `CONFIRMED`. If the claim needs a browser to be sure, set `PLAUSIBLE` and say what would settle it. If the evidence does not support the claim, or it is taste rather than a defect, or it is outside the path, set `DROPPED` with the reason in the "What is wrong" cell. Keep every row; never delete a finding.
3. Check severity against the pack's table. Adjust with a reason if it is wrong.
4. Check the labels CLIENT-ASKED, DESIGN-INTENT, IN-PLAN (or this project's equivalent set from the pack) against the client-asked source documents, and add missing ones. The source documents are:

{{clientDocsList}}

5. Check the chart against the code: every edge must exist in the code. Fix wrong edges. Check the metrics against the chart and the step table; fix arithmetic.
6. Look for what the auditor missed on the happy path and the main branches. Add findings with new IDs continuing the sequence. Same evidence rule.
7. Append a section "## 9. Verification" with: the verifier label, a table of finding ID → old status → new status → reason, a list of chart or metric corrections, and a list of findings you added.
8. Output the corrected file between the markers.

# Part C — The path file to verify

{{path.existingContent}}
