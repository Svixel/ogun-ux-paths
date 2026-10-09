/**
 * status.mjs — what is on disk right now.
 *
 *   ux-paths status --project <name>
 *
 * Counts only. It reads the artefacts and reports; it never repairs one and
 * never asserts, so it always exits 0. Everything it prints is derived from
 * files, so a stale summary cannot make a step look finished.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadPaths, parseFlags } from "../config.mjs";
import { parseRuleIds, parseRulecheck, rowCells } from "../markers.mjs";

const FLAG_SPEC = { string: ["project", "config", "root"], boolean: ["help"] };
const USAGE = `ux-paths status --project <name> [--root <dir>]

Counts on disk: paths audited and verified, findings by severity and status,
target paths, rulecheck FAIL rows, and jobs in BUILD-LOG.md.`;

function readIf(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Finding rows of a path file: | ID | Law | Severity | Status | … (8 cells). */
export function findingRows(md, findingIdRe) {
  const rows = [];
  for (const line of String(md).split("\n")) {
    const cells = rowCells(line);
    if (!cells || cells.length < 8) continue;
    if (!findingIdRe.test(cells[0])) continue;
    rows.push({ id: cells[0], law: cells[1], severity: cells[2], status: cells[3].toUpperCase() });
  }
  return rows;
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function line(label, value) {
  return `  ${label.padEnd(28)}${value}`;
}

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});
  const out = [`ux-paths status — ${cfg.product.name} (${cfg.name})`, `  ${cfg.auditPath}`, ""];

  // Step 1 — as-built paths.
  let inventory = [];
  let inventoryError = null;
  try {
    inventory = existsSync(cfg.pathsFile) ? loadPaths(cfg) : [];
  } catch (error) {
    inventoryError = error.message.split("\n")[0];
  }
  const audited = inventory.filter((p) => existsSync(p.file));
  const files = audited.map((p) => ({ p, md: readFileSync(p.file, "utf8") }));
  const verified = files.filter((f) => /^## 9\./m.test(f.md));
  out.push("Step 1 — audit");
  if (inventoryError) out.push(line("paths.json", `unreadable: ${inventoryError}`));
  out.push(line("paths in inventory", inventory.length));
  out.push(line("path files written", audited.length));
  out.push(line("verified (section 9)", verified.length));

  const findings = files.flatMap((f) => findingRows(f.md, cfg.findingIdRe));
  const live = findings.filter((f) => f.status !== "DROPPED");
  out.push(line("findings live / dropped", `${live.length} / ${findings.length - live.length}`));
  for (const [severity, count] of tally(live.map((f) => f.severity))) {
    out.push(line(`  severity ${severity}`, count));
  }
  for (const [status, count] of tally(live.map((f) => f.status).filter(Boolean))) {
    out.push(line(`  status ${status}`, count));
  }
  for (const name of ["FINDINGS.md", "METRICS.md", "CROSS-PATH.md", "REDESIGN-RULES.md"]) {
    if (existsSync(join(cfg.auditPath, name))) out.push(line(name, "present"));
  }

  // Step 2 — target paths and the rulecheck.
  out.push("", "Step 2 — simplify");
  const targets = existsSync(cfg.targetPathsDir)
    ? readdirSync(cfg.targetPathsDir).filter((f) => cfg.targetFileRe.test(f)).sort()
    : [];
  out.push(line("target path files", targets.length));
  const rulesText = readIf(join(cfg.auditPath, cfg.rules.file));
  const ruleIds = rulesText ? parseRuleIds(rulesText) : [];
  out.push(line("rules parsed", ruleIds.length ? ruleIds.join(", ") : `none (${cfg.rules.file} missing)`));

  const logs = existsSync(cfg.logsDir)
    ? readdirSync(cfg.logsDir).filter((f) => f.endsWith(".rulecheck.md")).sort()
    : [];
  let failRows = 0;
  const failing = [];
  for (const log of logs) {
    const parsed = parseRulecheck(readFileSync(join(cfg.logsDir, log), "utf8"), ruleIds);
    failRows += parsed.fails;
    if (parsed.fails) failing.push(`${log.replace(".rulecheck.md", "")} (${parsed.fails})`);
  }
  out.push(line("rulecheck logs", logs.length));
  out.push(line("rulecheck FAIL rows", failRows));
  if (failing.length) out.push(line("  failing targets", failing.join(", ")));
  for (const name of ["DECISIONS.md", "METRICS.md", "finding-map.json", "RULE-CHECK.md"]) {
    if (existsSync(join(cfg.targetDir, name))) out.push(line(`target/${name}`, "present"));
  }

  // Step 3 — the build loop.
  out.push("", "Step 3 — build");
  const contract = readIf(join(cfg.auditPath, "BUILD-CONTRACT.md"));
  out.push(line("BUILD-CONTRACT.md", contract ? "present" : "missing"));
  const buildLog = readIf(join(cfg.auditPath, "BUILD-LOG.md"));
  if (buildLog === null) {
    out.push(line("BUILD-LOG.md", "missing"));
  } else {
    const jobs = [];
    for (const l of buildLog.split("\n")) {
      const cells = rowCells(l);
      if (!cells || !cells.length) continue;
      const id = cells[0].split(/\s+/)[0];
      if (cfg.targetIdRe.test(id) && !jobs.includes(id)) jobs.push(id);
    }
    out.push(line("jobs in BUILD-LOG.md", `${jobs.length}${jobs.length ? ` (${jobs.join(", ")})` : ""}`));
  }
  const reviews = existsSync(cfg.auditPath)
    ? readdirSync(cfg.auditPath).filter((f) => /^REVIEW-\d+\.md$/.test(f)).sort()
    : [];
  out.push(line("review rounds", reviews.length ? reviews.join(", ") : 0));

  ctx.log(out.join("\n"));
  return 0;
}
