/**
 * loop-args.mjs — everything the build-loop workflow needs, as one JSON object.
 *
 *   ux-paths loop-args --project <name> --contract <path> [--jobs TW2,TC1] [--foundation]
 *
 * A Workflow script has no filesystem access: it cannot read the config, the
 * build contract, or a prompt file. So this command does all of it up front —
 * resolves every path to something the script can pass on, parses the jobs out
 * of the contract's ownership table, and renders the seven loop prompts — and
 * prints the args object that `loop-args.schema.json` describes.
 *
 * Runtime placeholders stay in the prompts. `{{job.id}}` cannot be filled here,
 * because the same builder prompt runs once per job inside the workflow. Every
 * placeholder whose first segment is in RUNTIME_PLACEHOLDER_ROOTS is copied
 * into the prompt text verbatim, for the script to substitute per call. Every
 * other placeholder must resolve now, or this command fails and names it.
 *
 * What the contract must contain
 * ------------------------------
 * 1. An ownership table. Its header has a "Job" (or "Id"/"TID") column and an
 *    "Owns" column; optional columns are Lane, File, Link-only (also spelled
 *    "Must link to, never create"), Spec, Model and Name. The Job cell may
 *    carry a name after the id ("TW2 search to result"). Globs are read from
 *    the backticks in a cell, so prose around them is ignored; a cell with no
 *    backticks is split on commas.
 * 2. Optionally a "## Foundation" section with `Id:`, `Brief:`, `Owns:` and
 *    `Spec:` lines. Without one, `--foundation` falls back to the config's
 *    build.foundation, and fails if that is null too.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  UsageError,
  assertValid,
  listFlag,
  loadPrompt,
  parseFlags,
  renderPrompt,
  resolveProjectPath,
  resolveSkillPath,
} from "../config.mjs";
import { cutAt, parseRuleIds, rowCells } from "../markers.mjs";

/**
 * Placeholder roots the workflow script fills at run time. Everything else in
 * a loop prompt is resolved here. Exported so the script and its tests can
 * assert the same list.
 *
 * Every name here is a key build-loop.workflow.js passes to its `fill()` for at
 * least one role, and every runtime token a prompt in reference/prompts uses
 * has its root here. tests/loop-args.test.mjs renders the shipped prompts and
 * asserts both halves of that, so a rename on either side fails the suite.
 */
export const RUNTIME_PLACEHOLDER_ROOTS = [
  // foundation phase and per-job build phase
  "job",
  "foundation",
  "foundationReport",
  "round",
  "previousReport",
  "fails",
  "build",
  "port",
  // review phase and closeout
  "lane",
  "blockers",
  "reviewFile",
  "shotsDir",
  "jobResults",
  "blockerFixerReports",
];

export const PROMPT_FILES = {
  foundation: "foundation.md",
  builder: "builder.md",
  checker: "checker.md",
  fixer: "fixer.md",
  critic: "critic.md",
  blockerFixer: "blocker-fixer.md",
  finalChecker: "final-checker.md",
};

const FLAG_SPEC = {
  string: ["project", "config", "root", "contract", "jobs", "prompts-dir"],
  boolean: ["foundation", "help"],
};

const USAGE = `ux-paths loop-args --project <name> --contract <path> [--jobs TW2,TC1] [--foundation]
                   [--prompts-dir <dir>] [--root <dir>]

Prints the Workflow args JSON for workflows/build-loop.workflow.js on stdout.
--jobs selects a subset of the contract's ownership table, in the order given.
--foundation includes the foundation job, so the loop runs its phase first.`;

/* ------------------------------------------------------------------ *
 * Contract parsing
 * ------------------------------------------------------------------ */

/** Every markdown table in a document, as { header, rows }. */
export function markdownTables(md) {
  const lines = String(md).split("\n");
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = rowCells(lines[i]);
    const divider = rowCells(lines[i + 1] || "");
    if (!header || !divider) continue;
    if (!divider.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const cells = rowCells(lines[j]);
      if (!cells) break;
      rows.push(cells);
    }
    tables.push({ header, rows });
    i = j;
  }
  return tables;
}

const COLUMNS = [
  [/^(job|id|tid)\b/i, "id"],
  [/^name\b/i, "name"],
  [/^lane\b/i, "lane"],
  [/^(target\s+)?file\b/i, "file"],
  [/^owns\b/i, "owns"],
  [/^(link[-\s]?only|must\s+link)/i, "linkOnly"],
  [/^specs?\b/i, "spec"],
  [/^model\b/i, "model"],
];

function columnMap(header) {
  const map = {};
  header.forEach((cell, index) => {
    const hit = COLUMNS.find(([re]) => re.test(cell.replace(/\*/g, "").trim()));
    if (hit && map[hit[1]] === undefined) map[hit[1]] = index;
  });
  return map;
}

const EMPTY_CELL = /^(—|-|–|none|n\/a|inherit)$/i;

/** Globs in a cell: the backticked ones, or the comma-separated ones. */
export function globsIn(cell) {
  const value = String(cell || "").trim();
  if (!value || EMPTY_CELL.test(value)) return [];
  const ticked = [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (ticked.length) return ticked;
  return value
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter((part) => part && !EMPTY_CELL.test(part) && /[/*]/.test(part));
}

function plainCell(cell) {
  const value = String(cell || "").replace(/`/g, "").trim();
  return !value || EMPTY_CELL.test(value) ? null : value;
}

function applyBase(globs, base) {
  if (!base) return globs;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return globs.map((g) => (isAbsolute(g) || g.startsWith(prefix) ? g : `${prefix}${g}`));
}

function foundationBlock(md) {
  const lines = String(md).split("\n");
  const start = lines.findIndex((l) => /^#{2,4}\s+Foundation\b/i.test(l));
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) || ["##"])[0].length;
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = lines[i].match(/^(#+)\s/);
    if (heading && heading[1].length <= level) break;
    block.push(lines[i]);
  }
  const fields = {};
  let current = null;
  for (const raw of block) {
    const field = raw.match(/^\s*[-*]?\s*(Id|Brief|Owns|Spec)\s*:\s*(.*)$/i);
    if (field) {
      current = field[1].toLowerCase();
      fields[current] = field[2].trim();
      continue;
    }
    if (current && raw.trim() && !/^#{1,6}\s/.test(raw)) fields[current] = `${fields[current]} ${raw.trim()}`.trim();
    else if (!raw.trim()) current = null;
  }
  if (!fields.id && !fields.brief) return null;
  return {
    id: plainCell(fields.id) || "F0",
    brief: (fields.brief || "").replace(/`/g, "").trim(),
    owns: globsIn(fields.owns || ""),
    spec: plainCell(fields.spec),
  };
}

/**
 * Read the ownership table and the optional foundation block out of a build
 * contract. Everything is returned raw; buildLoopArgs resolves defaults.
 */
export function parseContract(text, cfg, contractLabel) {
  const table = markdownTables(text)
    .map((t) => ({ ...t, columns: columnMap(t.header) }))
    .find((t) => t.columns.id !== undefined && t.columns.owns !== undefined);
  if (!table) {
    throw new UsageError(
      `${contractLabel}: no ownership table found. The loop needs a markdown table whose header has a "Job" column and an "Owns" column.`,
    );
  }
  const jobs = [];
  const errors = [];
  for (const cells of table.rows) {
    const cell = (key) => (table.columns[key] === undefined ? "" : cells[table.columns[key]] || "");
    const idCell = String(cell("id")).replace(/[`*]/g, "").trim();
    if (!idCell) continue;
    const [id, ...nameWords] = idCell.split(/\s+/);
    if (!cfg.targetIdRe.test(id)) continue;
    const owns = applyBase(globsIn(cell("owns")), cfg.loop.ownsBase);
    if (!owns.length) errors.push(`${id}: the Owns cell names no path`);
    jobs.push({
      id,
      name: plainCell(cell("name")) || nameWords.join(" ") || id,
      lane: plainCell(cell("lane")),
      file: plainCell(cell("file")),
      owns,
      linkOnly: applyBase(globsIn(cell("linkOnly")), cfg.loop.ownsBase),
      spec: table.columns.spec === undefined ? undefined : plainCell(cell("spec")),
      model: plainCell(cell("model")),
    });
  }
  if (!jobs.length) {
    throw new UsageError(
      `${contractLabel}: the ownership table has no row whose first cell is a target id (${cfg.lanes.map((l) => `${l.targetPrefix}<n>`).join(", ")}).`,
    );
  }
  const duplicates = jobs.map((j) => j.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicates.length) errors.push(`the ownership table lists ${[...new Set(duplicates)].join(", ")} twice`);
  if (errors.length) {
    throw new UsageError(`${contractLabel} is not usable:\n${errors.map((e) => `  → ${e}`).join("\n")}`);
  }
  return { jobs, foundation: foundationBlock(text) };
}

/* ------------------------------------------------------------------ *
 * Args
 * ------------------------------------------------------------------ */

function repoRelative(cfg, p, label) {
  const absolute = isAbsolute(p) ? resolve(p) : resolve(cfg.root, p);
  const rel = relative(cfg.root, absolute);
  if (!rel || rel.startsWith("..")) {
    throw new UsageError(`${label}: must be inside ${cfg.root}, got ${absolute}`);
  }
  return rel.split("\\").join("/");
}

function targetFileFor(cfg, job) {
  if (job.file) return job.file.replace(new RegExp(`^${cfg.auditDir}/`), "");
  if (!existsSync(cfg.targetPathsDir)) {
    throw new UsageError(`${job.id}: no File column in the contract and no ${cfg.auditDir}/target/paths to look in`);
  }
  const hit = readdirSync(cfg.targetPathsDir).find((f) => f.startsWith(`${job.id}-`) && f.endsWith(".md"));
  if (!hit) {
    throw new UsageError(`${job.id}: no target path file ${cfg.auditDir}/target/paths/${job.id}-<slug>.md, and the contract has no File column`);
  }
  return `target/paths/${hit}`;
}

function specFor(cfg, job, file) {
  // A Spec column wins, and an empty cell there means "this job has no spec".
  // No Spec column at all falls back to loop.specTemplate.
  if (job.spec !== undefined) return job.spec;
  if (!cfg.loop.specTemplate) {
    throw new UsageError(
      `${job.id}: the contract's ownership table has no Spec column and loop.specTemplate is not set in ${cfg.configFile}. A checker with no spec cannot verify the job.`,
    );
  }
  const slug = (file.split("/").pop() || "").replace(/^.*?-/, "").replace(/\.md$/, "");
  return cfg.loop.specTemplate
    .split("{id}").join(job.id)
    .split("{lane}").join(job.lane || "")
    .split("{slug}").join(slug);
}

function laneFor(cfg, job) {
  if (job.lane) {
    if (!cfg.laneById.has(job.lane)) throw new UsageError(`${job.id}: lane "${job.lane}" is not a lane in ${cfg.configFile}`);
    return job.lane;
  }
  const match = cfg.targetIdRe.exec(job.id);
  const lane = match ? cfg.lanes.find((l) => l.targetPrefix === match[1]) : null;
  if (!lane) throw new UsageError(`${job.id}: no lane has target prefix "${match ? match[1] : job.id}"`);
  return lane.id;
}

/** The data every loop prompt may read, minus the runtime placeholders. */
export function loopPromptData(cfg, args, rules) {
  const specs = [args.foundation && args.foundation.spec, ...args.jobs.map((j) => j.spec)].filter(Boolean);
  const screens = cfg.screens || { baseUrl: null, viewports: [], auth: { mode: "none" }, identities: [] };
  const viewports = screens.viewports || [];
  return {
    mode: args.mode,
    root: args.root,
    auditDir: args.auditDir,
    contract: args.contract,
    log: args.log,
    skillDir: args.skillDir,
    designSkill: args.designSkill,
    houseDocs: args.houseDocs,
    maxRounds: args.maxRounds,
    playwrightSlots: args.playwrightSlots,
    models: args.models,
    commands: args.commands,
    product: cfg.product,
    lanes: args.lanes,
    jobs: args.jobs,
    jobCount: args.jobs.length,
    // Everything with an owned scope, the foundation first: what the final checker audits.
    allOwners: [
      ...(args.foundation ? [{ id: args.foundation.id, owns: args.foundation.owns, spec: args.foundation.spec }] : []),
      ...args.jobs.map((j) => ({ id: j.id, owns: j.owns, spec: j.spec })),
    ],
    // The foundation's spec first, then one per job: the final checker runs them in one pass.
    allSpecs: [...new Set(specs)].join(" "),
    // One review file per lane in this run; the critic writes it, the final checker reads it.
    reviewFiles: args.lanes.map((l) => `${cfg.auditDir}/REVIEW-${l.id}.md`),
    screens,
    // Pre-formatted, because the renderer has no conditional and a project may
    // configure no screens block at all.
    viewportsList: viewports.length
      ? viewports.map((v) => `- ${v.name} (${v.width}x${v.height})`).join("\n")
      : "- the project config has no screens.viewports; capture one desktop width and one phone width, and say which you used",
    rules,
    dirs: {
      audit: cfg.auditDir,
      paths: `${cfg.auditDir}/paths`,
      target: `${cfg.auditDir}/target`,
      targetPaths: `${cfg.auditDir}/target/paths`,
      screens: `${cfg.auditDir}/screens`,
      logs: `${cfg.auditDir}/logs`,
    },
  };
}

/** Build (and validate) the args object. `prompts` maps role -> loaded prompt. */
export function buildLoopArgs({ cfg, contractPath, contractText, jobIds = [], withFoundation = false, prompts }) {
  const contract = repoRelative(cfg, contractPath, "--contract");
  const parsed = parseContract(contractText, cfg, contract);

  const unknown = jobIds.filter((id) => !parsed.jobs.some((j) => j.id === id));
  if (unknown.length) throw new UsageError(`--jobs: not in the contract's ownership table: ${unknown.join(", ")}`);
  const chosen = jobIds.length ? jobIds.map((id) => parsed.jobs.find((j) => j.id === id)) : parsed.jobs;

  const jobs = chosen.map((job) => {
    const lane = laneFor(cfg, job);
    const file = targetFileFor(cfg, { ...job, lane });
    return {
      id: job.id,
      name: job.name,
      file,
      lane,
      owns: job.owns,
      linkOnly: job.linkOnly,
      spec: specFor(cfg, { ...job, lane }, file),
      model: job.model,
    };
  });

  let foundation = null;
  if (withFoundation) {
    foundation = parsed.foundation || cfg.build.foundation;
    if (!foundation) {
      throw new UsageError(
        `--foundation: ${contract} has no "## Foundation" section and build.foundation is null in ${cfg.configFile}`,
      );
    }
    foundation = {
      id: foundation.id,
      brief: foundation.brief,
      owns: applyBase(foundation.owns, cfg.loop.ownsBase),
      spec: foundation.spec ?? null,
    };
    if (!foundation.owns.length) throw new UsageError(`--foundation: the foundation job owns no path`);
    if (!foundation.brief) throw new UsageError(`--foundation: the foundation job has no brief`);
  }

  const laneIds = new Set(jobs.map((j) => j.lane));
  const rulesFile = join(cfg.auditPath, cfg.rules.file);
  const rulesText = existsSync(rulesFile) ? cutAt(readFileSync(rulesFile, "utf8"), cfg.rules.cutMarker) : "";
  const rules = {
    file: `${cfg.auditDir}/${cfg.rules.file}`,
    text: rulesText,
    ids: parseRuleIds(rulesText),
    count: parseRuleIds(rulesText).length,
  };

  const args = {
    root: cfg.root,
    auditDir: cfg.auditDir,
    contract,
    log: `${cfg.auditDir}/BUILD-LOG.md`,
    mode: cfg.loop.mode,
    maxRounds: cfg.loop.maxRounds,
    playwrightSlots: cfg.loop.playwrightSlots,
    portBase: cfg.loop.portBase ?? 3200,
    models: cfg.models,
    commands: { ...cfg.commands, usage: cfg.commands.usage ?? null },
    skillDir: cfg.skillDir,
    designSkill: cfg.build.designSkill ? resolveProjectPath(cfg, cfg.build.designSkill) : null,
    houseDocs: cfg.build.houseDocs,
    lanes: cfg.lanes.filter((l) => laneIds.has(l.id)).map((l) => ({ id: l.id, label: l.label })),
    foundation,
    jobs,
    prompts: {},
  };

  const data = loopPromptData(cfg, args, rules);
  for (const [role, prompt] of Object.entries(prompts)) {
    args.prompts[role] = renderPrompt(prompt, data, { preserve: RUNTIME_PLACEHOLDER_ROOTS });
  }

  assertValid("loop-args", args, "loop args");
  return args;
}

export function loadLoopPrompts(dir) {
  const prompts = {};
  const missing = [];
  for (const [role, file] of Object.entries(PROMPT_FILES)) {
    const path = join(dir, file);
    if (!existsSync(path)) missing.push(file);
    else prompts[role] = loadPrompt(path);
  }
  if (missing.length) throw new UsageError(`missing loop prompt(s) in ${dir}: ${missing.join(", ")}`);
  return prompts;
}

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});
  if (!flags.contract) throw new UsageError("--contract <path> is required");
  const contractPath = isAbsolute(flags.contract) ? flags.contract : join(cfg.root, flags.contract);
  if (!existsSync(contractPath)) throw new UsageError(`build contract not found: ${contractPath}`);

  const promptsDir = flags["prompts-dir"] ? resolveSkillPath(flags["prompts-dir"]) : resolveSkillPath("reference/prompts");
  const args = buildLoopArgs({
    cfg,
    contractPath,
    contractText: readFileSync(contractPath, "utf8"),
    jobIds: listFlag(flags.jobs),
    withFoundation: Boolean(flags.foundation),
    prompts: loadLoopPrompts(promptsDir),
  });
  ctx.log(JSON.stringify(args, null, 2));
  return 0;
}
