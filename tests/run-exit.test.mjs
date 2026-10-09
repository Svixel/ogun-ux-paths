import assert from "node:assert/strict";
import test from "node:test";
import { incompletePathResults } from "../scripts/lib/commands/audit.mjs";
import { targetsWithoutVerdict } from "../scripts/lib/commands/rulecheck.mjs";

// A step that did not produce a usable result for every selected target must
// fail, so a gate never reads success from work that was not done.

test("audit and verify fail on a path with no file or a file with gaps", () => {
  const results = [
    { id: "AV1", status: "ok", wrote: "docs/ux-paths/paths/AV1.md", gaps: false },
    { id: "AV2", status: "claude exit 1, timed out after 1800000 ms" },
    { id: "AV3", status: "no markers in output" },
    { id: "AV4", status: "written with gaps: missing ## 9. Verification", wrote: "docs/ux-paths/paths/AV4.md", gaps: true },
  ];
  assert.deepEqual(incompletePathResults(results).map((r) => r.id), ["AV2", "AV3", "AV4"]);
  assert.deepEqual(incompletePathResults([results[0]]), []);
});

test("rulecheck fails on a target with no parsed verdict", () => {
  const results = [
    { id: "TAV1", status: "12 PASS", verdict: true, fails: 0 },
    { id: "TAV2", status: "codex exit 1, no output" },
    { id: "TAV3", status: "no markers in output" },
  ];
  assert.deepEqual(targetsWithoutVerdict(results).map((r) => r.id), ["TAV2", "TAV3"]);
  assert.deepEqual(targetsWithoutVerdict([results[0]]), []);
});
