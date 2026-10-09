// synthesize.mjs — step 1 aggregation: every path file -> FINDINGS.md and
// METRICS.md.
//
//   ux-paths synthesize --project <name> [--root <dir>]
//
// Reads every `<auditDir>/paths/**/*.md`, parses the findings table
// (section 5) and the metrics table (section 4) with scripts/lib/md.mjs,
// and writes:
//   <auditDir>/FINDINGS.md   every live finding, most severe first, with
//                            counts by severity, status, law, path
//   <auditDir>/METRICS.md    one row per path with all metrics
//
// Deterministic and repeatable: rerun after any path file changes. No model
// call, no network, no write outside <auditDir>.
//
// Exports: async function main(argv, ctx)
//   ctx = { skillDir, loadProject(nameOrPath, options), log }, the same
//   contract lib/commands/status.mjs and audit.mjs use — see PLAN.md §9.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { UsageError, parseFlags } from "../config.mjs";
import { section, tableRows, parseFindingRow, parseMetricsRows } from "../md.mjs";

export const FLAG_SPEC = { string: ["project", "config", "root"], boolean: ["help"] };
const USAGE = `ux-paths synthesize --project <name> [--root <dir>]

Reads every <auditDir>/paths/**/*.md and writes <auditDir>/FINDINGS.md and
<auditDir>/METRICS.md. Deterministic; rerun after any path file changes.`;

const METRIC_KEYS = [
  "entry_points",
  "ways_to_finish",
  "screens",
  "steps",
  "decisions",
  "fields",
  "repeated_fields",
  "dead_ends",
  "silent_states",
  "feedback_gaps",
  "test_coverage",
];

// Fallback law names, verbatim from reference/PATH-TEMPLATE.md §6 (the same
// twenty laws in reference/UX-LAWS-PACK.md §1). Used only when the project
// has not rendered its own laws pack yet.
const DEFAULT_LAW_NAMES = {
  1: "Hick",
  2: "Fitts",
  3: "Jakob",
  4: "Proximity",
  5: "Miller",
  6: "Doherty",
  7: "Von Restorff",
  8: "Target distance",
  9: "Serial position",
  10: "Peak-end",
  11: "Zeigarnik",
  12: "Prägnanz",
  13: "Similarity",
  14: "Uniform connectedness",
  15: "Tesler",
  16: "Postel",
  17: "Common region / Goal gradient",
  18: "Parkinson",
  19: "Occam",
  20: "Pareto",
};

// ------------------------------------------------------------------ utils --

/** A parse error: this file, this section, this problem. Exit 2, the same
 * code UsageError carries, but not a UsageError itself — this is a defect
 * in the audited data (a malformed path file), not in how the command was
 * invoked. scripts/ux-paths's dispatcher treats any thrown error whose
 * `.exitCode` is a number the same way it treats UsageError. */
function parseError(file, sectionLabel, message) {
  const err = new Error(`${file} ${sectionLabel}: ${message}`);
  err.exitCode = 2;
  return err;
}

/**
 * The regular expression that matches a valid as-built path ID for this
 * project (this command only reads `paths/`, never `target/paths/`). Prefers
 * `cfg.asBuiltIdRe`, the property `loadProject` in lib/config.mjs computes
 * from `cfg.lanes[].asBuiltPrefix` (`^(alternation)(\d+)$`); falls back to
 * deriving the same pattern from `cfg.lanes[].asBuiltPrefix` directly (for a
 * caller whose `ctx.loadProject` is a smaller test double), which
 * project.schema.json guarantees exist and are `^[A-Z][A-Z0-9]{0,2}$`.
 */
function asBuiltIdRegex(cfg) {
  if (cfg.asBuiltIdRe instanceof RegExp) return cfg.asBuiltIdRe;
  const prefixes = (cfg.lanes ?? []).map((l) => l.asBuiltPrefix).filter(Boolean);
  if (!prefixes.length) throw new Error("project config has no lanes with an asBuiltPrefix");
  return new RegExp(`^(${prefixes.join("|")})\\d+$`);
}

function esc(s) {
  return String(s).replace(/\|/g, "\\|");
}

function table(head, rows) {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function count(arr, keyFn) {
  const m = new Map();
  for (const x of arr) for (const k of [].concat(keyFn(x))) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function shortLawName(full) {
  let s = String(full).trim();
  s = s.replace(/^Law of\s+/i, "");
  s = s.replace(/^Minimize\s+/i, "");
  s = s.replace(/'s law$/i, "");
  s = s.replace(/\s+(law|principle|effect|rule|threshold|razor)$/i, "");
  s = s.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : full;
}

/**
 * Law names for the "By law" table. Tries the project's own rendered laws
 * pack (`<auditDir>/UX-LAWS-PACK.md`, reference/UX-LAWS-PACK.md §1 headings
 * `### <n>. <Name>`, or a `| <n> | <Name> |` law table) first; falls back
 * to DEFAULT_LAW_NAMES.
 */
function loadLawNames(auditRoot) {
  const packPath = join(auditRoot, "UX-LAWS-PACK.md");
  if (!existsSync(packPath)) return DEFAULT_LAW_NAMES;
  const text = readFileSync(packPath, "utf8");
  const names = {};
  for (const m of text.matchAll(/^###\s*Law\s+(\d{1,2})\s*[—:-]\s*(.+)$/gm)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) names[n] = shortLawName(m[2]);
  }
  if (Object.keys(names).length === 0) {
    for (const m of text.matchAll(/^###\s*(\d{1,2})\.\s*(.+)$/gm)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20) names[n] = shortLawName(m[2]);
    }
  }
  if (Object.keys(names).length === 0) {
    for (const m of text.matchAll(/^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|/gm)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20) names[n] = m[2].trim();
    }
  }
  return Object.keys(names).length ? { ...DEFAULT_LAW_NAMES, ...names } : DEFAULT_LAW_NAMES;
}

/** Best-effort path metadata (name, lane) for an as-built path ID: from
 * `<auditDir>/paths.json` when it has a matching row, else from the file's
 * immediate parent directory under `paths/` (the lane subfolder), else
 * empty strings. paths.json is optional context for name/lane only here —
 * loadPaths(cfg)'s stricter validation is audit/verify/capture's job, not
 * this read-only aggregator's. */
function loadPathMeta(cfg, auditRoot) {
  const p = cfg.pathsFile ?? join(auditRoot, "paths.json");
  const byId = new Map();
  if (existsSync(p)) {
    try {
      const list = JSON.parse(readFileSync(p, "utf8"));
      for (const row of list) if (row?.id) byId.set(row.id, row);
    } catch {
      // Malformed paths.json does not block synthesis; it just yields
      // blank name/lane metadata for every path.
    }
  }
  return byId;
}

// -------------------------------------------------------------------- main --

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = await ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});

  const auditRoot = cfg.auditPath ?? join(cfg.root, cfg.auditDir);
  const pathsDir = cfg.pathsDir ?? join(auditRoot, "paths");
  if (!existsSync(pathsDir)) {
    throw new UsageError(`missing ${pathsDir}; run \`ux-paths audit --project ${cfg.name}\` first`);
  }

  const rxId = asBuiltIdRegex(cfg);
  const pathMeta = loadPathMeta(cfg, auditRoot);

  const files = readdirSync(pathsDir, { recursive: true })
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(pathsDir, f))
    .sort();
  if (files.length === 0) throw new UsageError(`${pathsDir} has no path files yet`);

  const findings = [];
  const metrics = [];
  for (const f of files) {
    const md = readFileSync(f, "utf8");
    const relPath = relative(auditRoot, f).split("\\").join("/");
    const id = basename(f).split("-")[0];
    if (!rxId.test(id)) throw parseError(relPath, "filename", `id "${id}" does not match the configured path id pattern`);

    const meta = pathMeta.get(id);
    const lane = meta?.lane ?? basename(dirname(f)) ?? "";
    const pathName = meta?.name ?? "";

    const findingsSection = section(md, 5);
    if (!findingsSection) throw parseError(relPath, "section 5", "no \"## 5.\" findings section found");
    const idRx = new RegExp(`^\\| ${id}-\\d{2} \\|`);
    for (const line of findingsSection.split("\n")) {
      if (!idRx.test(line)) continue;
      const cells = tableRows(line)[0];
      const row = cells ? parseFindingRow(cells) : null;
      if (!row) throw parseError(relPath, "section 5", `malformed findings row: ${line.trim()}`);
      findings.push({
        id: row.id,
        path: id,
        pathName,
        lane,
        laws: row.laws,
        lawText: row.laws.join(", "),
        severity: row.severity,
        status: row.statuses.map((s) => `\`${s}\``).join(", "),
        statusLabels: row.statuses,
        where: row.where,
        what: row.what,
        evidence: row.evidence,
        fix: row.fix,
        file: relPath,
      });
    }

    const metricsSection = section(md, 4);
    if (!metricsSection) throw parseError(relPath, "section 4", "no \"## 4.\" metrics section found");
    const m = parseMetricsRows(metricsSection);
    for (const k of METRIC_KEYS) {
      if (m[k] === undefined) throw parseError(relPath, "section 4", `metric "${k}" missing`);
    }
    metrics.push({ id, name: pathName, lane, ...m, file: relPath });
  }

  const sevOrder = { S1: 0, S2: 1, S3: 2, S4: 3 };
  const live = findings.filter((x) => !x.statusLabels.includes("DROPPED"));
  const dropped = findings.filter((x) => x.statusLabels.includes("DROPPED"));
  live.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || a.id.localeCompare(b.id));

  const lawNames = loadLawNames(auditRoot);
  const bySev = count(live, (x) => x.severity);
  const byLaw = count(live, (x) => x.laws.map((n) => `${n} ${lawNames[n] ?? n}`));
  const byPath = count(live, (x) => x.path);
  const byLabel = count(live, (x) => x.statusLabels);
  const today = new Date().toISOString().slice(0, 10);
  const productName = cfg.product?.name ?? cfg.name ?? "the product";

  const findingsMd = `# Findings — ${productName} UX path audit (aggregate)

Generated ${today} by \`ux-paths synthesize\` from ${files.length} path files.
Source of truth is each path file; this file is a view. Rerun the command
after any path file changes. Status labels are from the verify pass plus any
owner-side spot check recorded in the tracker \`README.md\`.

Live findings: ${live.length}. Dropped: ${dropped.length}.

## Counts

By severity:

${table(["Severity", "Count"], bySev.map(([k, v]) => [k, v]))}

By law (a finding can cite several laws):

${table(["Law", "Count"], byLaw.map(([k, v]) => [k, v]))}

By path:

${table(
  ["Path", "Job", "Findings"],
  byPath.map(([k, v]) => [k, esc(pathMeta.get(k)?.name ?? ""), v]),
)}

By status label:

${table(["Label", "Count"], byLabel.map(([k, v]) => [`\`${k}\``, v]))}

## All live findings, most severe first

Evidence and the full text live in each path file (last column).

${table(
  ["ID", "Sev", "Lane", "Laws", "Status", "Where", "What is wrong", "Fix direction", "Path file"],
  live.map((x) => [x.id, x.severity, x.lane, esc(x.lawText), esc(x.status), esc(x.where), esc(x.what), esc(x.fix), `\`${x.file}\``]),
)}

## Dropped by the verifier

${dropped.length ? table(["ID", "Reason"], dropped.map((x) => [x.id, esc(x.what)])) : "None."}
`;

  const metricsMd = `# Metrics — ${productName} UX path audit (aggregate)

Generated ${today} by \`ux-paths synthesize\`. Definitions are in
\`UX-LAWS-PACK.md\` §6. Values are for the happy path as counted by the path
auditor and checked by the verifier. Use them to compare paths and, after the
redesign, to measure the change.

${table(
  ["Path", "Job", ...METRIC_KEYS.map((k) => k.replace(/_/g, " "))],
  metrics.map((m) => [m.id, esc(m.name), ...METRIC_KEYS.map((k) => esc(m[k] ?? "—"))]),
)}

Reading guide: entry points and ways to finish above 1 are duplication
signals (Hick, Occam). Repeated fields, dead ends, and silent states should be
zero (Tesler, Peak-end, Doherty). Test coverage below 1 means the redesign has
no regression net for that part of the path.
`;

  writeFileSync(join(auditRoot, "FINDINGS.md"), findingsMd);
  writeFileSync(join(auditRoot, "METRICS.md"), metricsMd);
  ctx.log(`[synthesize] FINDINGS.md: ${live.length} live, ${dropped.length} dropped. METRICS.md: ${metrics.length} paths.`);

  return 0;
}

export default main;
