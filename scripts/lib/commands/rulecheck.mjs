/**
 * rulecheck.mjs — step 2 gate: check each target path file against the rules.
 *
 *   ux-paths rulecheck --project <name> [--only TW2] [--dry-run]
 *
 * The cheap engine does not design here. It reads one target path file and the
 * redesign rules, and answers one table: rule -> PASS or FAIL, with the
 * evidence quoted from the file. Rule ids come from the '## R<n>.' headings of
 * <auditDir>/<rules.file>, cut at rules.cutMarker, so adding a rule changes the
 * expected row count with no code change.
 *
 * Exit 1 when any rule FAILs or a table is short: a failed rulecheck is a real
 * result, not an error.
 *
 * Data reference/prompts/rulecheck.md may read:
 *   mode, markers.start, markers.end
 *   project.*, root, auditDir, product.*, lanes[], lane.*
 *   target.{id,name,lane,laneLabel,file,path,replaces,replacesText,text,asBuiltFiles}
 *   rules.{text,ids,count,file}
 *   asBuilt[].{id,file}, asBuiltKnown[], inputs[]
 *   decisionsPath, lawsPackPath, functionalityMapPath
 *   engine.*, tree.*
 *
 * `target.file` is the repo-relative path of the target path file, `target.text`
 * is its content; the prompt hands the engine the text. `decisionsPath`,
 * `lawsPackPath` and `functionalityMapPath` are repo-relative paths, or a
 * sentence saying the project has no such file, because the renderer has no
 * conditional.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  UsageError,
  listFlag,
  loadPaths,
  loadPrompt,
  parseFlags,
  renderPrompt,
  resolveSkillPath,
} from "../config.mjs";
import {
  GitGuardError,
  buildCommand,
  changedOutside,
  formatCommand,
  gitHead,
  gitSnapshot,
  pool,
  resolveEngine,
  runEngine,
} from "../engines.mjs";
import { MARKERS, cutAt, extractRulecheck, parseRuleIds, parseRulecheck, rulecheckStatus } from "../markers.mjs";
import { renderRunSummary, runStamp } from "./audit.mjs";

const FLAG_SPEC = {
  string: ["project", "config", "root", "only", "engine", "model", "effort", "concurrency", "timeout-ms", "prompt"],
  boolean: ["dry-run", "help"],
};

const USAGE = `ux-paths rulecheck --project <name> [--only TW2,TA1] [--engine codex|claude]
                   [--model m] [--effort e] [--concurrency n] [--dry-run] [--root <dir>]

Checks every file in <auditDir>/target/paths/ against the redesign rules and writes
<auditDir>/logs/<TID>.rulecheck.md. Exits 1 when a rule FAILs.`;

/** One entry per target/paths/<TID>-<slug>.md. */
export function targetInventory(cfg) {
  if (!existsSync(cfg.targetPathsDir)) {
    throw new UsageError(`no target path files yet: ${cfg.targetPathsDir}`);
  }
  return readdirSync(cfg.targetPathsDir)
    .filter((f) => cfg.targetFileRe.test(f))
    .sort()
    .map((f) => {
      const path = join(cfg.targetPathsDir, f);
      const md = readFileSync(path, "utf8");
      const id = f.split("-")[0];
      const match = cfg.targetIdRe.exec(id);
      const lane = match ? cfg.lanes.find((l) => l.targetPrefix === match[1]) : null;
      return {
        id,
        name: (md.match(/^#\s+\S+\s+—\s+(.+)$/m) || [, f])[1].trim(),
        replaces: (md.match(/^Replaces:\s*(.+)$/m) || [, ""])[1].trim(),
        lane: lane ? lane.id : "",
        laneLabel: lane ? lane.label : "",
        fileName: f,
        file: `${cfg.auditDir}/target/paths/${f}`,
        path,
        text: md,
      };
    });
}

/** The rules document, cut at the marker, plus its rule ids. */
export function loadRules(cfg) {
  const file = join(cfg.auditPath, cfg.rules.file);
  if (!existsSync(file)) throw new UsageError(`rules file not found: ${file}`);
  const text = cutAt(readFileSync(file, "utf8"), cfg.rules.cutMarker);
  const ids = parseRuleIds(text);
  if (!ids.length) {
    throw new UsageError(`no rules found in ${file}: expected headings of the form "## R1. …" before "${cfg.rules.cutMarker}"`);
  }
  return { file: `${cfg.auditDir}/${cfg.rules.file}`, text, ids, count: ids.length };
}

/** The configured input whose name reads as the functionality map, if there is one. */
export function functionalityMapInput(cfg) {
  return cfg.inputs.find((file) => /functionality[-_ ]?map/i.test(file)) || null;
}

/** Everything the rulecheck prompt may read, for one target path file. */
export function rulecheckPromptData(cfg, t, { mode, engine, head, rules, asBuiltPaths, inputs }) {
  const asBuiltIds = [...new Set(t.replaces.match(cfg.asBuiltIdScanRe) || [])];
  const asBuilt = asBuiltIds.map((id) => {
    const p = asBuiltPaths.find((x) => x.id === id);
    return { id, file: p ? `${cfg.auditDir}/${p.relFile}` : "" };
  });
  const known = asBuilt.filter((a) => a.file);
  const decisionsFile = join(cfg.targetDir, "DECISIONS.md");
  const packFile = join(cfg.auditPath, "UX-LAWS-PACK.md");
  const map = functionalityMapInput(cfg);
  return {
    mode,
    markers: MARKERS.rulecheck,
    root: cfg.root,
    auditDir: cfg.auditDir,
    project: { name: cfg.name, root: cfg.root, auditDir: cfg.auditDir },
    product: cfg.product,
    lanes: cfg.lanes,
    lane: cfg.laneById.get(t.lane) || null,
    target: {
      ...t,
      replacesText: asBuiltIds.length ? asBuiltIds.join(", ") : "none listed",
      asBuiltFiles: known.length ? known.map((a) => `\`${a.file}\``).join(", ") : "none listed",
    },
    rules,
    asBuilt,
    asBuiltKnown: known,
    decisionsPath: existsSync(decisionsFile)
      ? `${cfg.auditDir}/target/DECISIONS.md`
      : "(this project has no target/DECISIONS.md yet; skip that reference)",
    lawsPackPath: existsSync(packFile)
      ? `${cfg.auditDir}/UX-LAWS-PACK.md`
      : "(this project has no UX-LAWS-PACK.md yet; skip that reference)",
    functionalityMapPath:
      map && existsSync(join(cfg.auditPath, map))
        ? `${cfg.auditDir}/${map}`
        : "(not configured for this project; skip that reference)",
    inputs,
    engine: {
      engine: engine.engine,
      model: engine.model,
      effort: engine.effort,
      wrapper: engine.wrapper,
      label: `${engine.label}/${mode}`,
    },
    tree: { head, date: new Date().toISOString().slice(0, 10) },
  };
}

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});
  const engine = resolveEngine(cfg, {
    engine: flags.engine,
    model: flags.model,
    effort: flags.effort,
    concurrency: flags.concurrency,
    timeoutMs: flags["timeout-ms"],
  });
  const dryRun = Boolean(flags["dry-run"]);
  const mode = "rulecheck";

  const rules = loadRules(cfg);
  const targets = targetInventory(cfg);
  const only = listFlag(flags.only);
  const unknown = only.filter((id) => !targets.some((t) => t.id === id));
  if (unknown.length) throw new UsageError(`--only: no such target id under ${cfg.targetPathsDir}: ${unknown.join(", ")}`);
  const selected = only.length ? targets.filter((t) => only.includes(t.id)) : targets;
  if (!selected.length) throw new UsageError("no target paths selected");

  const asBuiltPaths = existsSync(cfg.pathsFile) ? loadPaths(cfg) : [];
  const promptFile = flags.prompt ? resolveSkillPath(flags.prompt) : resolveSkillPath("reference/prompts/rulecheck.md");
  const prompt = loadPrompt(promptFile);

  mkdirSync(cfg.logsDir, { recursive: true });
  const head = gitHead(cfg.root);
  const before = gitSnapshot(cfg.root);
  if (before === null) ctx.log(`warning: ${cfg.root} is not a git checkout, so the git guard is off`);

  const inputs = cfg.inputs
    .map((file) => ({ name: file.split("/").pop(), file, path: `${cfg.auditDir}/${file}`, exists: existsSync(join(cfg.auditPath, file)) }))
    .filter((i) => i.exists);

  const guardTrips = [];
  let failTotal = 0;
  let shortTables = 0;

  async function runOne(t) {
    const data = rulecheckPromptData(cfg, t, { mode, engine, head, rules, asBuiltPaths, inputs });
    const promptPath = join(cfg.logsDir, `${t.id}.${mode}.prompt.md`);
    const body = renderPrompt(prompt, data);
    writeFileSync(promptPath, body);

    const engineOptions = {
      engine: engine.engine,
      model: engine.model,
      effort: engine.effort,
      wrapper: engine.wrapper,
      timeoutMs: engine.timeoutMs,
      promptFile: promptPath,
      cwd: cfg.root,
      label: `${t.id}.${mode}`,
    };
    if (dryRun) {
      return {
        id: t.id,
        status: `dry-run, prompt ~${Math.round(body.length / 4)} tokens`,
        commandLine: formatCommand(buildCommand(engineOptions)),
      };
    }

    // A verdict left by an earlier run must not stand in for this one.
    rmSync(join(cfg.logsDir, `${t.id}.${mode}.md`), { force: true });

    let result;
    try {
      result = await runEngine({
        ...engineOptions,
        guard: { root: cfg.root, auditDir: cfg.auditDir },
      });
    } catch (error) {
      if (error instanceof GitGuardError) {
        guardTrips.push(...error.changed);
        return { id: t.id, status: `git guard tripped: ${error.changed.join(", ")}` };
      }
      throw error;
    }

    if (result.text === null) {
      writeFileSync(join(cfg.logsDir, `${t.id}.${mode}.raw.txt`), `${result.stdout}\n--- stderr ---\n${result.stderr}`);
      const why = result.timedOut ? `timed out after ${engine.timeoutMs} ms` : result.parseError ? "no JSON on stdout" : "no output";
      return { id: t.id, status: `${engine.engine} exit ${result.exitCode}, ${why}`, seconds: result.seconds };
    }
    writeFileSync(
      join(cfg.logsDir, `${t.id}.${mode}.json`),
      `${JSON.stringify(
        {
          id: t.id,
          mode,
          engine: engine.engine,
          wrapper: engine.wrapper,
          model: engine.model,
          effort: engine.effort,
          sessionId: result.sessionId,
          costUsd: result.costUsd,
          turns: result.turns,
          stopReason: result.stopReason,
          seconds: result.seconds,
          exitCode: result.exitCode,
          raw: result.raw,
          text: result.raw ? undefined : result.text,
        },
        null,
        2,
      )}\n`,
    );

    const md = extractRulecheck(result.text);
    if (!md) {
      writeFileSync(join(cfg.logsDir, `${t.id}.${mode}.unextracted.md`), result.text);
      return { id: t.id, status: "no markers in output", seconds: result.seconds, cost: result.costUsd, turns: result.turns };
    }
    writeFileSync(join(cfg.logsDir, `${t.id}.${mode}.md`), md);
    const parsed = parseRulecheck(md, rules.ids);
    failTotal += parsed.fails;
    if (!parsed.complete || parsed.invalid.length) shortTables += 1;
    return {
      id: t.id,
      status: rulecheckStatus(parsed, rules.ids),
      verdict: true,
      fails: parsed.fails,
      seconds: result.seconds,
      cost: result.costUsd,
      turns: result.turns,
      stop: result.stopReason,
      wrote: `${cfg.auditDir}/logs/${t.id}.${mode}.md`,
    };
  }

  ctx.log(`${mode}: ${selected.length} target(s), ${rules.count} rules (${rules.ids.join(", ")}), engine ${engine.label}${dryRun ? ", dry run" : ""}`);
  const results = await pool(selected, engine.concurrency, runOne, (line) => ctx.log(`[${mode}] ${line}`));

  const after = gitSnapshot(cfg.root);
  const changed = [...new Set([...guardTrips, ...changedOutside(before, after, cfg.auditDir)])];
  const stamp = runStamp();
  const summary = renderRunSummary({ stamp, mode, engine, head, results, changed, dryRun });
  if (!dryRun) writeFileSync(join(cfg.logsDir, `RUN-${stamp}-${mode}.md`), summary);
  ctx.log(`\n${summary}`);
  if (dryRun) {
    for (const r of results) if (r.commandLine) ctx.log(`${r.id}: ${r.commandLine}`);
    return 0;
  }
  const wrote = results.filter((r) => r.wrote).length;
  ctx.log(`wrote ${wrote} rulecheck log(s) and ${cfg.auditDir}/logs/RUN-${stamp}-${mode}.md`);

  if (changed.length) {
    ctx.log("WARNING: files outside the audit folder changed during the run. Inspect before continuing.");
    return 2;
  }
  const missing = targetsWithoutVerdict(results);
  if (failTotal > 0 || shortTables > 0 || missing.length > 0) {
    ctx.log(`${failTotal} FAIL row(s) across ${results.length} target(s)${shortTables ? `, ${shortTables} table(s) short or with a verdict that is not PASS or FAIL` : ""}${missing.length ? `, ${missing.length} target(s) with no verdict: ${missing.map((r) => `${r.id} (${r.status})`).join("; ")}` : ""}.`);
    return 1;
  }
  return 0;
}

/**
 * Targets whose engine run produced no parsed verdict (failed, timed out, or
 * no markers). A rulecheck that checked nothing must not pass the gate.
 */
export function targetsWithoutVerdict(results) {
  return results.filter((r) => r.verdict !== true);
}
