/**
 * markers.mjs — get the file out of the reply, then check it is complete.
 *
 * A cheap engine talks before it answers. The contract is that the reply ENDS
 * with the artefact between two markers and nothing follows the end marker, so
 * extraction uses lastIndexOf: chatter before the markers is ignored, and a
 * model that quotes the markers while explaining them cannot fool the parser.
 *
 * Completeness is a list of gaps, never a throw. A path file with nineteen law
 * rows is still worth keeping; the run summary says what is missing so a person
 * can decide to re-run it.
 */

export const MARKERS = {
  path: { start: "<<<PATH-FILE-START>>>", end: "<<<PATH-FILE-END>>>" },
  rulecheck: { start: "<<<RULECHECK-START>>>", end: "<<<RULECHECK-END>>>" },
};

/** Text between the LAST start marker and the LAST end marker, or null. */
export function extractBetween(text, start, end) {
  if (typeof text !== "string" || !text) return null;
  const s = text.lastIndexOf(start);
  const e = text.lastIndexOf(end);
  if (s === -1 || e === -1 || e < s) return null;
  return `${text.slice(s + start.length, e).trim()}\n`;
}

export function extractPathFile(text) {
  return extractBetween(text, MARKERS.path.start, MARKERS.path.end);
}

export function extractRulecheck(text) {
  return extractBetween(text, MARKERS.rulecheck.start, MARKERS.rulecheck.end);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Gaps in a path file. Returns [] when the file is complete.
 *
 *   completeness(md, { mode: "verify", pathId: "W2", lawRowMin: 20 })
 *
 * mode "verify" also requires the appended "## 9. Verification" section.
 * A law row is `| <n> <Law name> | PASS|FINDING|N/A`; the law name may start
 * with any upper-case letter, including the Nordic ones.
 */
export function completeness(md, { mode = "audit", pathId, lawRowMin = 20, sections = 8 } = {}) {
  const problems = [];
  const text = String(md || "");
  for (let i = 1; i <= sections; i += 1) {
    if (!new RegExp(`^## ${i}\\.`, "m").test(text)) problems.push(`section ${i} missing`);
  }
  if (mode === "verify" && !/^## 9\./m.test(text)) problems.push("section 9 (verification) missing");
  const mermaid = (text.match(/```mermaid/g) || []).length;
  if (mermaid === 0) problems.push("no mermaid block");
  const lawRows = (text.match(/^\| *(?:\d{1,2}) [A-ZÅÄÖ][^|]*\| *(?:PASS|FINDING|N\/A)/gim) || []).length;
  if (lawRows < lawRowMin) problems.push(`law table has ${lawRows} filled rows, expected ${lawRowMin}`);
  if (pathId) {
    const ids = text.match(new RegExp(`\\b${escapeRe(pathId)}-\\d{2}\\b`, "g")) || [];
    if (ids.length === 0) problems.push("no finding IDs (may be legitimate if the path is clean; check)");
  }
  return problems;
}

/** Cells of a markdown table row, without the leading and trailing pipes. */
export function rowCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

/** Rule ids from the '## R<n>.' headings of a rules document, in file order. */
export function parseRuleIds(text) {
  const ids = [];
  for (const match of String(text || "").matchAll(/^##\s+(R\d{1,3})\./gm)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

/** Everything before `cutMarker`, or the whole text when the marker is absent. */
export function cutAt(text, cutMarker) {
  if (!cutMarker) return String(text);
  const cut = String(text).indexOf(cutMarker);
  return cut > 0 ? String(text).slice(0, cut) : String(text);
}

/**
 * Parse a rulecheck table.
 *
 *   parseRulecheck(md, ["R1", "R2", ...])
 *     -> { rows, fails, passes, missing, unexpected, invalid, notes, complete }
 *
 * Only PASS and FAIL are verdicts. A row with anything else is reported in
 * `invalid` and is not counted as a pass, so a checker that answers "N/A" or
 * "PARTIAL" cannot quietly turn a gap into a green run.
 */
export function parseRulecheck(md, ruleIds = []) {
  const rows = [];
  let notes = null;
  for (const line of String(md || "").split("\n")) {
    const cells = rowCells(line);
    if (!cells || cells.length < 2) continue;
    const [first, second, ...rest] = cells;
    const evidence = rest.join(" | ").trim();
    if (/^R\d{1,3}$/.test(first)) {
      const verdict = second.replace(/\*+/g, "").trim().toUpperCase();
      rows.push({ rule: first, result: verdict, evidence });
      continue;
    }
    if (/^notes?$/i.test(first)) notes = evidence || second;
  }
  const seen = rows.map((r) => r.rule);
  const expected = ruleIds.length ? ruleIds : seen;
  return {
    rows,
    fails: rows.filter((r) => r.result === "FAIL").length,
    passes: rows.filter((r) => r.result === "PASS").length,
    invalid: rows.filter((r) => r.result !== "PASS" && r.result !== "FAIL").map((r) => r.rule),
    missing: expected.filter((id) => !seen.includes(id)),
    unexpected: seen.filter((id) => !expected.includes(id)),
    duplicates: seen.filter((id, i) => seen.indexOf(id) !== i),
    notes,
    complete: expected.length > 0 && expected.every((id) => seen.includes(id)) && seen.length === expected.length,
  };
}

/** One line describing a rulecheck result, for the run summary. */
export function rulecheckStatus(parsed, ruleIds) {
  const problems = [];
  if (parsed.missing.length) problems.push(`missing ${parsed.missing.join(", ")}`);
  if (parsed.unexpected.length) problems.push(`unknown rule ${parsed.unexpected.join(", ")}`);
  if (parsed.duplicates.length) problems.push(`repeated ${parsed.duplicates.join(", ")}`);
  if (parsed.invalid.length) problems.push(`verdict must be PASS or FAIL on ${parsed.invalid.join(", ")}`);
  const head = `${parsed.rows.length}/${ruleIds.length} rule rows, ${parsed.fails} FAIL`;
  return problems.length ? `${head}; ${problems.join("; ")}` : `ok, ${parsed.fails} FAIL`;
}
