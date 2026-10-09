// synthesize-target.mjs — step 2 aggregation: every target path file ->
// target/METRICS.md, plus target/DECISIONS.md section 7 regenerated from
// target/finding-map.json.
//
//   ux-paths synthesize-target --project <name> [--root <dir>]
//
//  1. Reads every `<auditDir>/target/paths/*.md`, parses the "## 4. Metrics,
//     as-built -> target" table (columns "<ID> as-built" ... "Target" |
//     "Note"), and writes `<auditDir>/target/METRICS.md`: one row per
//     target path with as-built -> target per metric, plus lane and total
//     rows against the as-built aggregate in `<auditDir>/METRICS.md`.
//  2. Regenerates everything after the `<!-- generated:findings -->` marker
//     in `<auditDir>/target/DECISIONS.md` from `<auditDir>/target/finding-
//     map.json`: every live S1 and S2 finding in `<auditDir>/FINDINGS.md`
//     mapped to one or more decision IDs. Throws (exit 1) if a live S1/S2
//     finding is unmapped, or a finding-map entry names an ID that is not a
//     live finding, listing every offending ID.
//
// Deterministic and repeatable. No model call, no network, no write outside
// <auditDir>.
//
// Exports: async function main(argv, ctx)
//   ctx = { skillDir, loadProject(nameOrPath, options), log }, the same
//   contract lib/commands/status.mjs and audit.mjs use — see PLAN.md §9.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { UsageError, laneForId, parseFlags } from "../config.mjs";
import { section, tableRows } from "../md.mjs";

export const FLAG_SPEC = { string: ["project", "config", "root"], boolean: ["help"] };
const USAGE = `ux-paths synthesize-target --project <name> [--root <dir>]

Reads every <auditDir>/target/paths/*.md and writes <auditDir>/target/
METRICS.md; regenerates <auditDir>/target/DECISIONS.md section 7 from
<auditDir>/target/finding-map.json. Deterministic; rerun after any target
path file or finding-map.json changes.`;

const METRICS = [
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
const NUMERIC = METRICS.filter((m) => m !== "test_coverage");

// ------------------------------------------------------------------ utils --

/** A parse error: this file, this section, this problem. Exit 2, the same
 * code UsageError carries, but not a UsageError itself — this is a defect
 * in the drawn target, not in how the command was invoked. */
function parseError(file, sectionLabel, message) {
  const err = new Error(`${file} ${sectionLabel}: ${message}`);
  err.exitCode = 2;
  return err;
}

/** The regular expression matching any valid ID (as-built or target) for
 * this project. Used only to pick which files under `target/paths/` to
 * read — narrower, kind-specific patterns (below) drive everything else.
 * Falls back to deriving one from `cfg.lanes[].asBuiltPrefix` /
 * `.targetPrefix` for a caller whose `ctx.loadProject` is a smaller test
 * double. */
function idRegexOf(cfg, fallbackPattern) {
  if (fallbackPattern) return fallbackPattern instanceof RegExp ? fallbackPattern : new RegExp(fallbackPattern);
  const prefixes = (cfg.lanes ?? []).flatMap((l) => [l.asBuiltPrefix, l.targetPrefix]).filter(Boolean);
  if (!prefixes.length) throw new Error("project config has no lanes to derive an id pattern from");
  return new RegExp(`^(${prefixes.join("|")})\\d+$`);
}

function asBuiltPrefixAlt(cfg) {
  const prefixes = (cfg.lanes ?? []).map((l) => l.asBuiltPrefix).filter(Boolean);
  if (!prefixes.length) throw new Error("project config has no lanes with an asBuiltPrefix");
  return prefixes.join("|");
}

/** Full-string as-built path ID pattern, e.g. `^(?:A|B)\d+$`. Prefers the
 * real `cfg.asBuiltIdRe` lib/config.mjs's `loadProject` computes. */
function asBuiltIdRegex(cfg) {
  if (cfg.asBuiltIdRe instanceof RegExp) return cfg.asBuiltIdRe;
  return new RegExp(`^(?:${asBuiltPrefixAlt(cfg)})\\d+$`);
}

/** Finding ID pattern, e.g. `^(?:A|B)\d+-\d{2}$`. Prefers the real
 * `cfg.findingIdRe`. */
function findingIdRegex(cfg) {
  if (cfg.findingIdRe instanceof RegExp) return cfg.findingIdRe;
  return new RegExp(`^(?:${asBuiltPrefixAlt(cfg)})\\d+-\\d{2}$`);
}

/** Unanchored, global finding-ID scanner, for pulling IDs out of prose
 * (a "Findings left open:" header field). */
function findingIdScanRegex(cfg) {
  return new RegExp(`(?:${asBuiltPrefixAlt(cfg)})\\d+-\\d{2}`, "g");
}

/** Unanchored, global as-built-ID scanner, for pulling IDs out of a
 * "Replaces:" header field. Prefers the real `cfg.asBuiltIdScanRe`. */
function asBuiltIdScanRegex(cfg) {
  if (cfg.asBuiltIdScanRe instanceof RegExp) return cfg.asBuiltIdScanRe;
  return new RegExp(`\\b(?:${asBuiltPrefixAlt(cfg)})\\d+\\b`, "g");
}

/** The lane id a target path ID belongs to. Uses lib/config.mjs's
 * `laneForId(cfg, id, "target")` when it can resolve the id (the real
 * `cfg.targetIdRe` it relies on); falls back to a longest-prefix match
 * against `cfg.lanes[].targetPrefix` directly for a caller whose
 * `ctx.loadProject` is a smaller test double without `targetIdRe`. */
function laneOfTarget(cfg, targetId) {
  if (cfg.targetIdRe instanceof RegExp) {
    const lane = laneForId(cfg, targetId, "target");
    if (lane) return lane.id;
  }
  const letters = (String(targetId).match(/^[A-Za-z]+/) ?? [""])[0];
  const candidates = (cfg.lanes ?? [])
    .filter((l) => letters.startsWith(l.targetPrefix))
    .sort((a, b) => b.targetPrefix.length - a.targetPrefix.length);
  return candidates[0]?.id ?? letters;
}

function laneAsBuiltPrefix(cfg, laneId) {
  return (cfg.lanes ?? []).find((l) => l.id === laneId)?.asBuiltPrefix ?? "";
}

function pathIdOf(findingId) {
  const i = String(findingId).lastIndexOf("-");
  return i > 0 ? findingId.slice(0, i) : findingId;
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

function num(v) {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function coverage(v) {
  const m = String(v).match(/(\d+)\s*\/\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
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
  const targetDir = cfg.targetDir ?? join(auditRoot, "target");
  const pathsDir = cfg.targetPathsDir ?? join(targetDir, "paths");
  if (!existsSync(pathsDir)) {
    throw new UsageError(`missing ${pathsDir}; draw at least one target path first`);
  }

  const rxId = idRegexOf(cfg);
  const rxAsBuiltId = asBuiltIdRegex(cfg);
  const rxFindingId = findingIdRegex(cfg);
  const rxFindingIdScan = findingIdScanRegex(cfg);
  const rxReplaces = asBuiltIdScanRegex(cfg);

  // ---------------------------------------------------------- 1. Metrics --

  const files = readdirSync(pathsDir, { recursive: true })
    .filter((f) => f.endsWith(".md") && rxId.test(basename(f).split("-")[0]))
    .sort();
  if (files.length === 0) throw new UsageError(`${pathsDir} has no target path files yet`);

  const targets = [];
  for (const rel of files) {
    const f = join(pathsDir, rel);
    const relOut = relative(auditRoot, f).split("\\").join("/");
    const md = readFileSync(f, "utf8");
    const id = basename(f).split("-")[0];
    const title = (md.match(/^# \S+ — (.+)$/m) ?? [, ""])[1].trim();
    const replaces = (md.match(/^Replaces: (.+)$/m) ?? [, ""])[1].trim();
    const asBuiltIds = [...replaces.matchAll(rxReplaces)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i);

    const rows = tableRows(section(md, 4));
    if (rows.length < 2) throw parseError(relOut, "section 4", "no metrics table found");
    const head = rows[0];
    const targetIdx = head.findIndex((h) => /^target$/i.test(h));
    const asBuiltIdx = head.map((h, i) => (/as-built/i.test(h) ? i : -1)).filter((i) => i >= 0);
    if (targetIdx < 0 || asBuiltIdx.length === 0) {
      throw parseError(relOut, "section 4", `metrics header needs "<ID> as-built" and "Target" columns: ${head.join(" | ")}`);
    }
    const asBuiltLabels = asBuiltIdx.map((i) => head[i].replace(/\s*as-built$/i, "").trim());

    const m = {};
    for (const c of rows.slice(1)) {
      if (!METRICS.includes(c[0])) continue;
      m[c[0]] = { asBuilt: asBuiltIdx.map((i) => c[i]), target: c[targetIdx], note: c[c.length - 1] };
    }
    for (const k of METRICS) if (!m[k]) throw parseError(relOut, "section 4", `metric "${k}" missing`);

    targets.push({ id, title, replaces, asBuiltIds, asBuiltLabels, m, file: relOut, raw: md });
  }

  const metricsPath = join(auditRoot, "METRICS.md");
  if (!existsSync(metricsPath)) throw new UsageError(`missing ${metricsPath}; run \`ux-paths synthesize --project ${cfg.name}\` first`);
  const asBuiltAgg = new Map();
  for (const c of tableRows(readFileSync(metricsPath, "utf8"))) {
    if (c.length >= 2 + METRICS.length && rxAsBuiltId.test(c[0])) {
      asBuiltAgg.set(c[0], Object.fromEntries(METRICS.map((k, i) => [k, c[i + 2]])));
    }
  }

  const sumTargets = (list) => {
    const out = Object.fromEntries(NUMERIC.map((k) => [k, 0]));
    let cov = [0, 0];
    for (const t of list) {
      for (const k of NUMERIC) out[k] += num(t.m[k].target);
      const c = coverage(t.m.test_coverage.target);
      cov = [cov[0] + c[0], cov[1] + c[1]];
    }
    return { ...out, test_coverage: `${cov[0]}/${cov[1]}` };
  };
  const sumAsBuilt = (ids) => {
    const out = Object.fromEntries(NUMERIC.map((k) => [k, 0]));
    let cov = [0, 0];
    for (const id of ids) {
      const r = asBuiltAgg.get(id);
      if (!r) continue;
      for (const k of NUMERIC) out[k] += num(r[k]);
      const c = coverage(r.test_coverage);
      cov = [cov[0] + c[0], cov[1] + c[1]];
    }
    return { ...out, test_coverage: `${cov[0]}/${cov[1]}` };
  };

  const allAsBuiltIds = [...asBuiltAgg.keys()];
  const laneIds = (laneId) => {
    const prefix = laneAsBuiltPrefix(cfg, laneId);
    return allAsBuiltIds.filter((id) => id.startsWith(prefix));
  };

  const today = new Date().toISOString().slice(0, 10);
  const productName = cfg.product?.name ?? cfg.name ?? "the product";
  const perPathRows = targets.map((t) => [
    t.id,
    esc(t.title),
    t.asBuiltIds.join(", "),
    ...METRICS.map((k) => `${t.m[k].asBuilt.join(" / ")} → **${esc(t.m[k].target)}**`),
  ]);

  const totalsRows = [];
  for (const lane of cfg.lanes ?? []) {
    const tl = targets.filter((t) => laneOfTarget(cfg, t.id) === lane.id);
    const a = sumAsBuilt(laneIds(lane.id));
    const b = sumTargets(tl);
    totalsRows.push([`${lane.label} lane`, `${laneIds(lane.id).length} → ${tl.length} paths`, ...METRICS.map((k) => `${a[k]} → **${b[k]}**`)]);
  }
  const aAll = sumAsBuilt(allAsBuiltIds);
  const bAll = sumTargets(targets);
  totalsRows.push(["**both lanes**", `${allAsBuiltIds.length} → ${targets.length} paths`, ...METRICS.map((k) => `${aAll[k]} → **${bAll[k]}**`)]);

  const targetMetricsMd = `# Metrics — ${productName} step 2 target, as-built → target

Generated ${today} by \`ux-paths synthesize-target\` from the "## 4. Metrics"
table in every file under \`target/paths/\`. As-built values are the step 1
numbers from \`../METRICS.md\`; where a target path replaces several as-built
paths their values are shown side by side (\`a / b / c\`). Target values are
counted from each target chart and step table, for the happy path named in
that file. Definitions: \`../UX-LAWS-PACK.md\` §6.

## Per target path

${table(["Target", "Job", "Replaces", ...METRICS.map((k) => k.replace(/_/g, " "))], perPathRows)}

## Totals

Sums over paths. Sums of happy-path counts are a size signal, not a user
journey. \`test_coverage\` sums the fractions (covered steps / total steps);
target values are the coverage the design requires after step 3.

${table(["Scope", "Paths", ...METRICS.map((k) => k.replace(/_/g, " "))], totalsRows)}

## Reading guide

- \`entry_points\` falls because one screen now serves each job and shims are
  gone. \`ways_to_finish\` above 1 is justified in the path file (link and
  code; two devices for check-in; different end states).
- \`dead_ends\` and \`silent_states\` are 0 on every target path by rule R1
  and R2; each path file's §5 names the state every branch ends in.
- \`repeated_fields\` is 0 by rule R4.
- \`steps\` and \`screens\` fall most where the as-built chain crossed the
  most screens; see the per-path table above for exactly where.
`;
  writeFileSync(join(targetDir, "METRICS.md"), targetMetricsMd);

  // --------------------------------------------------- 2. Findings -> decisions --

  const findingsPath = join(auditRoot, "FINDINGS.md");
  if (!existsSync(findingsPath)) throw new UsageError(`missing ${findingsPath}; run \`ux-paths synthesize --project ${cfg.name}\` first`);
  const findingsMd = readFileSync(findingsPath, "utf8");

  const findingMapPath = join(targetDir, "finding-map.json");
  if (!existsSync(findingMapPath)) throw new UsageError(`missing ${findingMapPath}`);
  let findingMap;
  try {
    findingMap = JSON.parse(readFileSync(findingMapPath, "utf8"));
  } catch (err) {
    throw new UsageError(`could not parse ${findingMapPath}: ${err.message}`);
  }
  const defaults = findingMap.defaults ?? {};
  const findingOverrides = findingMap.findings ?? {};
  const observed = findingMap.observed ?? [];

  const liveRows = tableRows(findingsMd).filter(
    (c) => c.length === 9 && rxFindingId.test(c[0]) && /^S\d$/.test(c[1]),
  );
  const live = liveRows.map((c) => ({ id: c[0], sev: c[1], lane: c[2], where: c[5], what: c[6] }));
  const liveIds = new Set(live.map((x) => x.id));

  const staleIds = Object.keys(findingOverrides).filter((id) => !liveIds.has(id));
  const s12 = live.filter((x) => x.sev === "S1" || x.sev === "S2");
  const unmapped = [];
  for (const x of s12) {
    const decisions = findingOverrides[x.id] ?? defaults[pathIdOf(x.id)];
    if (!decisions) unmapped.push(x.id);
  }
  if (unmapped.length > 0 || staleIds.length > 0) {
    const parts = [];
    if (unmapped.length) parts.push(`unmapped live S1/S2 finding(s): ${unmapped.join(", ")}`);
    if (staleIds.length) parts.push(`finding-map.json names id(s) that are not a live finding: ${staleIds.join(", ")}`);
    const err = new Error(`${findingMapPath}: ${parts.join("; ")}`);
    err.exitCode = 1;
    throw err;
  }

  // Which target file names a given finding ID as left open (its header's
  // "Findings left open:" field), for the summary line below.
  const openIn = new Map();
  for (const t of targets) {
    const m = t.raw.match(/^Findings left open:\s*(.+)$/m);
    if (!m) continue;
    for (const idm of m[1].matchAll(rxFindingIdScan)) openIn.set(idm[0], t.id);
  }

  const rows = s12.map((x) => {
    const decisions = findingOverrides[x.id] ?? defaults[pathIdOf(x.id)];
    const open = decisions.includes("OPEN");
    const short = x.what.length > 140 ? x.what.slice(0, 137).replace(/\s+\S*$/, "") + "…" : x.what;
    return [x.id, x.sev, esc(x.where), esc(short), decisions.filter((d) => d !== "OPEN").join(", ") + (open ? " (left open)" : "")];
  });
  const bySev = { S1: rows.filter((r) => r[1] === "S1").length, S2: rows.filter((r) => r[1] === "S2").length };
  const openRows = rows.filter((r) => r[4].includes("left open"));
  const leftOpenLine =
    openRows.length === 0
      ? `Left open: 0.`
      : `Left open: ${openRows.length} (${openRows
          .map((r) => `${r[0]}${openIn.has(r[0]) ? `, reason in ${openIn.get(r[0])}` : ""}`)
          .join("; ")}).`;

  const observedMd = observed.length
    ? observed.map((line) => `- ${line}`).join("\n")
    : "None recorded.";

  const genTable = `${table(["ID", "Sev", "Where", "What is wrong (short)", "Decision"], rows)}

S1 mapped: ${bySev.S1}. S2 mapped: ${bySev.S2}. ${leftOpenLine}

## 8. Observed during step 2

Not findings. Notes made while drawing, for the build.

${observedMd}
`;

  const decisionsPath = join(targetDir, "DECISIONS.md");
  if (!existsSync(decisionsPath)) throw new UsageError(`missing ${decisionsPath}`);
  const decisionsMd = readFileSync(decisionsPath, "utf8");
  const marker = "<!-- generated:findings -->";
  const cut = decisionsMd.indexOf(marker);
  if (cut < 0) throw new UsageError(`${decisionsPath} is missing the ${marker} marker`);
  writeFileSync(decisionsPath, decisionsMd.slice(0, cut + marker.length) + "\n\n" + genTable);

  ctx.log(
    `[synthesize-target] target/METRICS.md: ${targets.length} target paths. DECISIONS.md §7: ${rows.length} S1/S2 rows (${bySev.S1} S1, ${bySev.S2} S2).`,
  );

  return 0;
}

export default main;
