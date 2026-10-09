// md.mjs — markdown table and section parsing shared by the synthesizers.
//
// Pure string functions, no filesystem access, no project knowledge. Every
// function here is generic across projects: nothing in this file may name a
// specific product, route, or law text.
//
// Exports: section(md, n), tableRows(md), parseFindingRow(cells),
// parseMetricsRows(sectionText).

/**
 * Return the text of numbered heading `n` (a top-level `## n.` section),
 * up to (not including) the next `## <digits>.` heading. Empty string if
 * the heading is not present.
 *
 * Matches `## 4.` and `## 4. Metrics, as-built → target` alike: only the
 * `## <n>.` prefix is significant, the rest of the heading line is free
 * text and is included in the returned body.
 */
export function section(md, n) {
  const after = String(md).split(new RegExp(`^## ${n}\\.`, "m"))[1];
  return after ? after.split(/^## \d+\./m)[0] : "";
}

/**
 * Every pipe-table row in `md`, in document order, as arrays of trimmed
 * cell strings. Separator rows (`| --- | --- |`) are dropped. Header rows
 * are kept — callers that need to skip a header do so themselves (some
 * callers, such as the target metrics table, need the header row to find
 * column indexes by name).
 */
export function tableRows(md) {
  const rows = [];
  for (const line of String(md).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) continue;
    const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  return rows;
}

/**
 * Parse one row of a "## 5. Findings" table (the 8-column shape from
 * PATH-TEMPLATE.md: ID | Law | Severity | Status | Where | What is wrong |
 * Evidence | Fix direction) into a structured finding. Returns null if
 * `cells` does not have at least 8 columns.
 *
 * `laws` is every number 1-20 cited in the Law cell (a finding can cite
 * several). `statuses` is every backtick-quoted label in the Status cell
 * (for example `CONFIRMED`, `DROPPED`, `CLIENT-ASKED`).
 */
export function parseFindingRow(cells) {
  if (!Array.isArray(cells) || cells.length < 8) return null;
  const laws = [...cells[1].matchAll(/\b(\d{1,2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 20);
  const statuses = [...cells[3].matchAll(/`([A-Z-]+)`/g)].map((m) => m[1]);
  return {
    id: cells[0],
    laws,
    severity: cells[2],
    statuses,
    where: cells[4],
    what: cells[5],
    evidence: cells[6],
    fix: cells[7],
  };
}

/**
 * Parse a "## 4. Metrics" section (the as-built shape: Metric | Value |
 * Note) into a plain object keyed by metric name (`entry_points`,
 * `ways_to_finish`, and so on — every row whose first cell is
 * `^[a-z_]+$`). Only the Value column (the second cell) is kept; the Note
 * column is dropped. Rows that do not look like a metric key (for example
 * a stray prose line that happens to contain a pipe) are ignored.
 */
export function parseMetricsRows(sectionText) {
  const map = {};
  for (const cells of tableRows(sectionText)) {
    if (cells.length >= 2 && /^[a-z_]+$/.test(cells[0])) map[cells[0]] = cells[1];
  }
  return map;
}
