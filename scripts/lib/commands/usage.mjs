// usage.mjs — read-only usage counts, input for the path audit.
//
//   ux-paths usage --project <name> [--root <dir>]
//
// Runs `commands.usage` (a shell command that prints CSV `action,entity,
// created_at` with a header row) from the project root, aggregates locally,
// and writes `<auditDir>/inputs/usage.md`: four count tables (by entity type
// and action, by action, by entity type, by month). If `commands.usage` is
// null, prints that usage counts are not configured and exits 0 — usage
// counts are optional input, not a precondition for any other command.
//
// Exports: async function main(argv, ctx)
//   ctx = { skillDir, loadProject(nameOrPath, options), log }, the same
//   contract lib/commands/status.mjs and audit.mjs use — see PLAN.md §9.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError, parseFlags } from "../config.mjs";

export const FLAG_SPEC = { string: ["project", "config", "root"], boolean: ["help"] };
const USAGE = `ux-paths usage --project <name> [--root <dir>]

Runs commands.usage (a shell command printing CSV action,entity,created_at
with a header) and writes <auditDir>/inputs/usage.md. If commands.usage is
null, prints that usage counts are not configured and exits 0.`;

/** Minimal CSV line splitter: supports double-quoted fields (with ""
 * escaping a literal quote) so a shell command's CSV output does not need
 * to avoid commas inside a field. No external dependency. */
function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const rows = [];
  // First line is the header (`action,entity,created_at`); every command
  // configured in `commands.usage` is documented to print one.
  for (const line of lines.slice(1)) {
    const [action, entity, createdAt] = splitCsvLine(line);
    if (action === undefined) continue;
    rows.push({ action, entity: entity ?? "", created_at: createdAt ?? "" });
  }
  return rows;
}

function count(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function table(head, pairs) {
  return [`| ${head} | Count |`, "| --- | --- |", ...pairs.map(([k, c]) => `| \`${k}\` | ${c} |`)].join("\n");
}

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = await ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});

  const command = cfg.commands?.usage ?? null;
  if (!command) {
    ctx.log("[usage] usage counts are not configured (commands.usage is null in the project config)");
    return 0;
  }

  const auditRoot = cfg.auditPath ?? join(cfg.root, cfg.auditDir);
  let csvText;
  try {
    csvText = execSync(command, { cwd: cfg.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new UsageError(`commands.usage ("${command}") failed: ${err.message}`);
  }

  const rows = parseCsv(csvText);
  const first = rows[0]?.created_at?.slice(0, 10) ?? "n/a";
  const last = rows.at(-1)?.created_at?.slice(0, 10) ?? "n/a";
  const byAction = count(rows, (r) => r.action);
  const byEntity = count(rows, (r) => r.entity || "(none)");
  const byPair = count(rows, (r) => `${r.entity || "(none)"} · ${r.action}`);
  const byMonth = count(rows, (r) => (r.created_at ? r.created_at.slice(0, 7) : "(unknown)")).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  const md = `# Usage counts — input for the UX path audit

Generated ${new Date().toISOString().slice(0, 10)} from \`commands.usage\`
(\`${command}\`). Columns read: \`action\`, \`entity\`, \`created_at\`. Rows:
${rows.length}, from ${first} to ${last}.

This log records the actions the product's code chose to log. It does not
record page views, searches, or reads. Use it as a lower bound on how often a
job is done, not as a full picture. Jobs with no logged action are not
unused; they are unmeasured. Note that in each path file.

## By entity type and action

${table("Entity · action", byPair)}

## By action

${table("Action", byAction)}

## By entity type

${table("Entity type", byEntity)}

## By month

${table("Month", byMonth)}
`;

  const outDir = cfg.inputsDir ?? join(auditRoot, "inputs");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "usage.md");
  writeFileSync(outPath, md);
  ctx.log(`[usage] wrote ${outPath} (${rows.length} rows)`);
  return 0;
}

export default main;
