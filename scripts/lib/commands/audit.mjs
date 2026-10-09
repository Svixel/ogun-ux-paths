/**
 * audit.mjs — step 1 volume work: one cheap-engine run per path.
 *
 *   ux-paths audit  --project <name> [--only A1,W2] [--engine …] [--dry-run] [--force]
 *   ux-paths verify --project <name> [--only A1,W2] …
 *
 * Both modes share this module; verify.mjs calls runPathMode("verify", …).
 * audit writes the path file from scratch; verify re-reads the existing file
 * with fresh context and appends section 9.
 *
 * The prompt body belongs to reference/prompts/{audit,verify}.md. This module
 * only assembles the data those prompts declare, runs the engine, extracts the
 * file between the markers, and reports the gaps. Data the prompts may use:
 *
 *   mode, markers.start, markers.end
 *   project.{name,root,auditDir}, root, auditDir
 *   product.{name,paragraph,language,copyGlobs,clientDocs}
 *   lanes[].{id,label,asBuiltPrefix,targetPrefix,actors}, lane.<same>
 *   path.{id,name,lane,laneLabel,actor,job,slug,routes,refs,specs,group,file,existingContent}
 *   inputs[].{name,file,path,exists}, inputsMissing[], inputsList
 *   screens[], screensList, screensDir, screenNames[]
 *   clientDocs[], clientDocsList
 *   pack, template, existing
 *   engine.{engine,model,effort,wrapper,label}, tree.{head,date}
 *
 * The `*List` keys are pre-formatted bullet lists with a fallback sentence for
 * the empty case, because the renderer has no conditional.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  UsageError,
  listFlag,
  loadPaths,
  loadPrompt,
  parseFlags,
  renderPrompt,
  resolveSkillPath,
  routeToName,
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
import { completeness, extractPathFile, MARKERS } from "../markers.mjs";

export const FLAG_SPEC = {
  string: ["project", "config", "root", "only", "engine", "model", "effort", "concurrency", "timeout-ms", "prompt"],
  boolean: ["dry-run", "force", "help"],
};

function usage(mode) {
  return `ux-paths ${mode} --project <name> [--only A1,W2] [--engine codex|claude] [--model m]
                    [--effort e] [--concurrency n] [--timeout-ms n]
                    [--prompt <file>] [--dry-run] [--force] [--root <dir>]

Runs the cheap engine once per path and writes <auditDir>/paths/<lane>/<id>-<slug>.md.
${mode === "audit"
    ? "Without --force an existing path file is left alone."
    : "A path with no file yet is skipped; the reply must add section 9."}
--dry-run writes every prompt and prints the command line per path, and spawns nothing.`;
}

/** A timestamp usable in a file name: 2026-09-03T11-04-22. */
export function runStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** The run summary table, in the shape the source runner produced. */
export function renderRunSummary({ stamp, mode, engine, head, results, changed, dryRun }) {
  const totalCost = results.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
  const rows = results
    .map((r) => `| ${r.id} | ${r.status} | ${r.turns ?? ""} | ${r.seconds ?? ""} | ${r.cost !== undefined && r.cost !== null ? Number(r.cost).toFixed(3) : ""} |`)
    .join("\n");
  return `# Run ${stamp} — mode ${mode}, engine ${engine.label}${engine.effort ? `, effort ${engine.effort}` : ""}, tree ${head}${dryRun ? " (dry run)" : ""}

| Path | Status | Turns | Seconds | Cost USD |
| --- | --- | --- | --- | --- |
${rows}

Total cost USD: ${totalCost.toFixed(2)}

Tracked files changed outside the audit folder during the run: ${changed.length ? changed.join(", ") : "none"}
`;
}

function requireArtefact(file, cfg, what) {
  if (!existsSync(file)) {
    throw new UsageError(`${what} not found: ${file}\nRun \`ux-paths init --project ${cfg.name}\` first, or write it by hand.`);
  }
  return readFileSync(file, "utf8");
}

/**
 * Screenshot files under <auditDir>/screens whose route label matches one of
 * the path's routes, for every captured identity. `capture` names them
 * `<identity>__<routeLabel>__<width>.png`; the label and width are the last two
 * `__` segments, so an identity id is free to contain `__` itself.
 */
export function screensFor(cfg, p) {
  if (!existsSync(cfg.screensDir)) return [];
  const names = new Set(p.routes.map(routeToName));
  return readdirSync(cfg.screensDir)
    .filter((f) => {
      if (!f.endsWith(".png")) return false;
      const parts = f.slice(0, -".png".length).split("__");
      return parts.length >= 3 && /^\d+$/.test(parts.at(-1)) && names.has(parts.at(-2));
    })
    .sort();
}

/**
 * A markdown bullet list, or the fallback sentence when the list is empty.
 * The renderer has no `{{#if}}`, so a list that may be empty is pre-formatted
 * here and read by the prompt as one string.
 */
export function bulletList(items, empty) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

/** A backticked, comma-separated inline list, or "none" when it is empty. */
export function inlineList(items) {
  return items && items.length ? items.map((item) => `\`${item}\``).join(", ") : "none";
}

/** Everything the audit and verify prompts may read. */
export function pathPromptData(cfg, p, { mode, engine, head, pack, template, existing }) {
  const lane = cfg.laneById.get(p.lane);
  const inputs = cfg.inputs.map((file) => ({
    name: file.split("/").pop(),
    file,
    path: `${cfg.auditDir}/${file}`,
    exists: existsSync(join(cfg.auditPath, file)),
  }));
  const screens = screensFor(cfg, p);
  const present = inputs.filter((i) => i.exists);
  const clientDocs = cfg.product.clientDocs || [];
  return {
    mode,
    markers: MARKERS.path,
    root: cfg.root,
    auditDir: cfg.auditDir,
    project: { name: cfg.name, root: cfg.root, auditDir: cfg.auditDir },
    product: cfg.product,
    lanes: cfg.lanes,
    lane,
    path: {
      id: p.id,
      name: p.name,
      lane: p.lane,
      laneLabel: lane ? lane.label : p.lane,
      actor: p.actor,
      job: p.job,
      slug: p.slug,
      routes: p.routes,
      refs: p.refs,
      specs: p.specs,
      routesText: inlineList(p.routes),
      refsText: inlineList(p.refs),
      specsText: inlineList(p.specs),
      group: p.group,
      file: `${cfg.auditDir}/${p.relFile}`,
      existingContent:
        existing ||
        "(no path file exists for this path; report that in the verification section and produce nothing else)",
    },
    inputs: present,
    inputsMissing: inputs.filter((i) => !i.exists),
    inputsList: bulletList(
      present.map((i) => `\`${i.path}\``),
      "- none of the configured input files exist yet; say so in Open questions and work from the code alone",
    ),
    screens,
    screensList: bulletList(
      screens.map((f) => `\`${cfg.auditDir}/screens/${f}\``),
      "- none captured for these routes; rely on code and say so in Open questions",
    ),
    screenNames: p.routes.map(routeToName),
    screensDir: `${cfg.auditDir}/screens`,
    clientDocs,
    clientDocsList: bulletList(
      clientDocs.map((f) => `\`${f}\``),
      "- none configured for this project; skip this step and say so in the verification section",
    ),
    pack,
    template,
    existing,
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

export async function runPathMode(mode, argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(usage(mode));
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
  const force = Boolean(flags.force);

  const inventory = loadPaths(cfg);
  const only = listFlag(flags.only);
  const unknown = only.filter((id) => !inventory.some((p) => p.id === id));
  if (unknown.length) throw new UsageError(`--only: no such path id in paths.json: ${unknown.join(", ")}`);
  const selected = only.length ? inventory.filter((p) => only.includes(p.id)) : inventory;
  if (!selected.length) throw new UsageError("no paths selected");

  const pack = requireArtefact(join(cfg.auditPath, "UX-LAWS-PACK.md"), cfg, "the laws pack");
  const template = requireArtefact(join(cfg.auditPath, "PATH-TEMPLATE.md"), cfg, "the path template");
  const promptFile = flags.prompt ? resolveSkillPath(flags.prompt) : resolveSkillPath(`reference/prompts/${mode}.md`);
  const prompt = loadPrompt(promptFile);

  mkdirSync(cfg.logsDir, { recursive: true });
  const head = gitHead(cfg.root);
  const before = gitSnapshot(cfg.root);
  if (before === null) ctx.log(`warning: ${cfg.root} is not a git checkout, so the git guard is off`);

  const guardTrips = [];

  async function runOne(p) {
    const promptPath = join(cfg.logsDir, `${p.id}.${mode}.prompt.md`);
    const data = pathPromptData(cfg, p, {
      mode,
      engine,
      head,
      pack,
      template,
      existing: existsSync(p.file) ? readFileSync(p.file, "utf8") : "",
    });
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
      label: `${p.id}.${mode}`,
    };

    if (dryRun) {
      const plan = buildCommand(engineOptions);
      return {
        id: p.id,
        status: `dry-run, prompt ~${Math.round(body.length / 4)} tokens`,
        commandLine: formatCommand(plan),
      };
    }
    if (mode === "audit" && existsSync(p.file) && !force) {
      return { id: p.id, status: "skipped (exists; use --force)" };
    }
    if (mode === "verify" && !existsSync(p.file)) {
      return { id: p.id, status: "skipped (no path file to verify)" };
    }

    let result;
    try {
      result = await runEngine({
        ...engineOptions,
        guard: { root: cfg.root, auditDir: cfg.auditDir },
      });
    } catch (error) {
      if (error instanceof GitGuardError) {
        guardTrips.push(...error.changed);
        return { id: p.id, status: `git guard tripped: ${error.changed.join(", ")}`, seconds: error.result?.seconds };
      }
      throw error;
    }

    if (result.text === null) {
      writeFileSync(
        join(cfg.logsDir, `${p.id}.${mode}.raw.txt`),
        `${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
      const why = result.timedOut ? `timed out after ${engine.timeoutMs} ms` : result.parseError ? "no JSON on stdout" : "no output";
      return { id: p.id, status: `${engine.engine} exit ${result.exitCode}, ${why}`, seconds: result.seconds };
    }

    writeFileSync(
      join(cfg.logsDir, `${p.id}.${mode}.json`),
      `${JSON.stringify(
        {
          id: p.id,
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

    const md = extractPathFile(result.text);
    if (!md) {
      writeFileSync(join(cfg.logsDir, `${p.id}.${mode}.unextracted.md`), result.text);
      return {
        id: p.id,
        status: "no markers in output",
        seconds: result.seconds,
        cost: result.costUsd,
        turns: result.turns,
      };
    }

    mkdirSync(dirname(p.file), { recursive: true });
    writeFileSync(p.file, md);
    const problems = completeness(md, { mode, pathId: p.id });
    return {
      id: p.id,
      status: problems.length ? `written with gaps: ${problems.join("; ")}` : "ok",
      gaps: problems.length > 0,
      seconds: result.seconds,
      cost: result.costUsd,
      turns: result.turns,
      stop: result.stopReason,
      wrote: `${cfg.auditDir}/${p.relFile}`,
    };
  }

  ctx.log(`${mode}: ${selected.length} path(s), engine ${engine.label}, concurrency ${engine.concurrency}${dryRun ? ", dry run" : ""}`);
  const results = await pool(selected, engine.concurrency, runOne, (line) => ctx.log(`[${mode}] ${line}`));

  const after = gitSnapshot(cfg.root);
  const changed = [...new Set([...guardTrips, ...changedOutside(before, after, cfg.auditDir)])];
  const stamp = runStamp();
  const summary = renderRunSummary({ stamp, mode, engine, head, results, changed, dryRun });
  if (!dryRun) {
    writeFileSync(join(cfg.logsDir, `RUN-${stamp}-${mode}.md`), summary);
  }
  ctx.log(`\n${summary}`);
  if (dryRun) {
    for (const r of results) if (r.commandLine) ctx.log(`${r.id}: ${r.commandLine}`);
  }
  ctx.log(`wrote prompts to ${cfg.auditDir}/logs/*.${mode}.prompt.md`);
  const written = results.filter((r) => r.wrote);
  if (written.length) ctx.log(`wrote ${written.length} path file(s) under ${cfg.auditDir}/paths/`);
  if (!dryRun) ctx.log(`wrote ${cfg.auditDir}/logs/RUN-${stamp}-${mode}.md`);

  if (changed.length) {
    ctx.log("WARNING: files outside the audit folder changed during the run. Inspect before continuing.");
    return 2;
  }
  if (!dryRun) {
    const incomplete = incompletePathResults(results);
    if (incomplete.length) {
      ctx.log(`${incomplete.length} of ${results.length} path(s) have no complete ${mode} file: ${incomplete.map((r) => `${r.id} (${r.status})`).join("; ")}`);
      return 1;
    }
  }
  return 0;
}

/**
 * Paths whose run produced no usable file: the engine failed, timed out or
 * returned no markers, or the file it wrote misses required sections. Any of
 * them fails the step, so a gate never reads success from a run that did not
 * audit (or verify) every selected path.
 */
export function incompletePathResults(results) {
  return results.filter((r) => !r.wrote || r.gaps);
}

export async function main(argv, ctx) {
  return runPathMode("audit", argv, ctx);
}
