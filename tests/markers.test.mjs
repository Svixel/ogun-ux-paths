import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKERS,
  completeness,
  cutAt,
  extractBetween,
  extractPathFile,
  extractRulecheck,
  parseRuleIds,
  parseRulecheck,
  rowCells,
  rulecheckStatus,
} from "../scripts/lib/markers.mjs";

const LAWS = [
  "1 Hick", "2 Fitts", "3 Jakob", "4 Miller", "5 Postel", "6 Tesler", "7 Peak-end",
  "8 Zeigarnik", "9 Von Restorff", "10 Serial position", "11 Aesthetic-usability",
  "12 Doherty", "13 Goal-gradient", "14 Occam", "15 Pareto", "16 Parkinson",
  "17 Selective attention", "18 Åsikt om fel", "19 Chunking", "20 Flow",
];

/** A path file that satisfies every completeness rule, so tests can break one. */
function pathFile({ id = "K1", sections = 8, laws = 20, mermaid = true, findings = true, verification = false } = {}) {
  const parts = [`# ${id} — Log in`, ""];
  for (let i = 1; i <= sections; i += 1) {
    parts.push(`## ${i}. Section ${i}`, "");
    if (i === 1 && mermaid) parts.push("```mermaid", "flowchart TD", "  a --> b", "```", "");
    if (i === 5) {
      parts.push("| ID | Law | Severity | Status | Where | What is wrong | Evidence | Fix direction |");
      parts.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
      if (findings) {
        parts.push(`| ${id}-01 | 6 Tesler | S2 | CONFIRMED | /a | The code is silent | file.ts:10 | Say so |`);
        parts.push(`| ${id}-02 | 1 Hick | S3 | DROPPED | /a | Taste, not a defect | file.ts:11 | none |`);
      }
      parts.push("");
    }
    if (i === 6) {
      parts.push("| Law | Result |", "| --- | --- |");
      for (const law of LAWS.slice(0, laws)) parts.push(`| ${law} | ${findings && law.startsWith("6") ? `FINDING ${id}-01` : "PASS"} |`);
      parts.push("");
    }
  }
  if (verification) parts.push("## 9. Verification", "");
  return parts.join("\n");
}

/* ------------------------------------------------------------ markers */

test("extraction ignores everything before the markers", () => {
  const reply = `I will now read the code.\n\nHere it is.\n${MARKERS.path.start}\n# K1\n${MARKERS.path.end}`;
  assert.equal(extractPathFile(reply), "# K1\n");
});

test("extraction takes the last pair, so a quoted marker cannot fool it", () => {
  const reply = [
    `My reply must end between ${MARKERS.path.start} and ${MARKERS.path.end}, understood.`,
    MARKERS.path.start,
    "# real file",
    MARKERS.path.end,
  ].join("\n");
  assert.equal(extractPathFile(reply), "# real file\n");
});

test("missing, inverted and empty markers give null", () => {
  assert.equal(extractPathFile("no markers at all"), null);
  assert.equal(extractPathFile(`${MARKERS.path.start}\n# K1\n`), null);
  assert.equal(extractPathFile(`${MARKERS.path.end}\n# K1\n${MARKERS.path.start}`), null);
  assert.equal(extractBetween("", "a", "b"), null);
  assert.equal(extractBetween(null, "a", "b"), null);
});

test("the rulecheck markers are their own pair", () => {
  const reply = `chatter\n${MARKERS.rulecheck.start}\n| R1 | PASS | ok |\n${MARKERS.rulecheck.end}`;
  assert.equal(extractRulecheck(reply), "| R1 | PASS | ok |\n");
  assert.equal(extractPathFile(reply), null);
});

/* ------------------------------------------------------- completeness */

test("a complete path file has no gaps", () => {
  assert.deepEqual(completeness(pathFile(), { mode: "audit", pathId: "K1" }), []);
});

test("verify also needs section 9", () => {
  assert.deepEqual(completeness(pathFile({ verification: true }), { mode: "verify", pathId: "K1" }), []);
  assert.deepEqual(completeness(pathFile(), { mode: "verify", pathId: "K1" }), ["section 9 (verification) missing"]);
});

test("every kind of gap is named", () => {
  assert.deepEqual(completeness(pathFile({ sections: 6 }), { mode: "audit", pathId: "K1" }), [
    "section 7 missing",
    "section 8 missing",
  ]);
  assert.deepEqual(completeness(pathFile({ mermaid: false }), { mode: "audit", pathId: "K1" }), ["no mermaid block"]);
  assert.deepEqual(completeness(pathFile({ laws: 18 }), { mode: "audit", pathId: "K1" }), [
    "law table has 18 filled rows, expected 20",
  ]);
  assert.deepEqual(completeness(pathFile({ findings: false }), { mode: "audit", pathId: "K1" }), [
    "no finding IDs (may be legitimate if the path is clean; check)",
  ]);
});

test("a finding id from another path does not count", () => {
  assert.deepEqual(completeness(pathFile({ id: "P3" }), { mode: "audit", pathId: "K1" }), [
    "no finding IDs (may be legitimate if the path is clean; check)",
  ]);
});

test("the law-row count is configurable and accepts Nordic law names", () => {
  const md = pathFile({ laws: 18 });
  assert.deepEqual(completeness(md, { mode: "audit", pathId: "K1", lawRowMin: 18 }), []);
  assert.ok(md.includes("| 18 Åsikt om fel | PASS |"));
});

/* ---------------------------------------------------------- rulecheck */

const RULES_DOC = `# Redesign rules

## R1. One door per job

Rule: there is one way in.

## R2. Carry the next step

Rule: never lose the destination.

## R3. No silent state

Rule: every branch ends somewhere named.

## Ranked redesign moves

## R9. Not a rule, this is an appendix heading
`;

test("rule ids come from the headings, cut at the marker", () => {
  const cut = cutAt(RULES_DOC, "## Ranked redesign moves");
  assert.deepEqual(parseRuleIds(cut), ["R1", "R2", "R3"]);
  assert.deepEqual(parseRuleIds(RULES_DOC), ["R1", "R2", "R3", "R9"]);
  assert.equal(cutAt(RULES_DOC, "## Nothing like this"), RULES_DOC);
});

test("a clean rulecheck table parses", () => {
  const md = [
    "| Rule | Result | Evidence |",
    "| --- | --- | --- |",
    "| R1 | PASS | §2 names one entry point. |",
    "| R2 | FAIL | §3 drops the ?next parameter. |",
    "| R3 | PASS | §5 names every end state. |",
    "| Notes | — | Nothing else to flag. |",
  ].join("\n");
  const parsed = parseRulecheck(md, ["R1", "R2", "R3"]);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.fails, 1);
  assert.equal(parsed.passes, 2);
  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.notes, "Nothing else to flag.");
  assert.equal(parsed.rows[1].evidence, "§3 drops the ?next parameter.");
  assert.equal(rulecheckStatus(parsed, ["R1", "R2", "R3"]), "ok, 1 FAIL");
});

test("a short table, a stray rule and a verdict that is not PASS or FAIL are all reported", () => {
  const md = [
    "| Rule | Result | Evidence |",
    "| --- | --- | --- |",
    "| R1 | **PASS** | bold verdicts still parse |",
    "| R2 | N/A | the checker refused to decide |",
    "| R7 | PASS | there is no R7 |",
  ].join("\n");
  const parsed = parseRulecheck(md, ["R1", "R2", "R3"]);
  assert.equal(parsed.passes, 2);
  assert.deepEqual(parsed.missing, ["R3"]);
  assert.deepEqual(parsed.unexpected, ["R7"]);
  assert.deepEqual(parsed.invalid, ["R2"]);
  assert.equal(parsed.complete, false);
  const status = rulecheckStatus(parsed, ["R1", "R2", "R3"]);
  assert.match(status, /missing R3/);
  assert.match(status, /unknown rule R7/);
  assert.match(status, /PASS or FAIL on R2/);
});

test("a repeated rule row is reported", () => {
  const md = "| R1 | PASS | a |\n| R1 | FAIL | b |\n";
  const parsed = parseRulecheck(md, ["R1"]);
  assert.deepEqual(parsed.duplicates, ["R1"]);
  assert.equal(parsed.complete, false);
});

test("rowCells splits a markdown row and ignores prose", () => {
  assert.deepEqual(rowCells("| a | b |"), ["a", "b"]);
  assert.deepEqual(rowCells("  | a |  b  |  "), ["a", "b"]);
  assert.equal(rowCells("not a row"), null);
});
