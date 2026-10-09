// capture.mjs — screenshot sweep for a ux-paths project.
//
// Builds a run.json for autoreview-ui's shoot.mjs (a sibling, read-only,
// global skill) covering every distinct route in <auditDir>/paths.json, for
// every configured identity, at every configured viewport. Spawns shoot.mjs
// as a child process (never imports it — it is project code from this
// skill's point of view), then moves its PNGs into
// <auditDir>/screens/<identity>__<routeLabel>__<width>.png and writes
// <auditDir>/screens/CAPTURE-LOG.md.
//
// Exports: async function main(argv, ctx)
//   ctx = { skillDir, loadProject(nameOrPath), log }  — see PLAN.md §9.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { UsageError, routeToName as routeLabel } from "../config.mjs";

const USAGE =
  "usage: ux-paths capture --project <name> | --config <path> [--root <dir>] [--identity <id>] [--wait-for <selector>] [--param <key=value> ...] [--dry-run]";

// ---------------------------------------------------------------- helpers --

function parseArgs(argv) {
  const args = {
    project: null,
    root: null,
    identity: null,
    waitFor: "body",
    params: [],
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" || a === "--config") args.project = argv[++i] ?? null;
    else if (a === "--root") args.root = argv[++i] ?? null;
    else if (a === "--identity") args.identity = argv[++i] ?? null;
    else if (a === "--wait-for") args.waitFor = argv[++i] ?? "body";
    else if (a === "--param") args.params.push(argv[++i] ?? "");
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument "${a}"\n${USAGE}`);
  }
  return args;
}

function fail(log, message, code = 2) {
  const error = new UsageError(message);
  error.exitCode = code;
  throw error;
}

function bracketTokens(route) {
  return [...String(route).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
}

function resolveDynamicRoute(route, paramsMap) {
  const tokens = bracketTokens(route);
  if (tokens.length === 0) return { route, missing: [] };
  const missing = [];
  const resolved = route.replace(/\[([^\]]+)\]/g, (_, name) => {
    const value = paramsMap[name] ?? paramsMap[`[${name}]`];
    if (value === undefined) {
      missing.push(name);
      return `[${name}]`;
    }
    return value;
  });
  return { route: resolved, missing };
}

function composeUrl(baseUrl, route) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(route).replace(/^\/+/, "")}`;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * A refused connection fails at once, so the timeout only bounds a SLOW answer,
 * and a slow answer still means the server is up: a dev server compiling the
 * base route on its first request (Next.js webpack dev: 20-90 s) must not be
 * reported as down.
 */
const SERVER_PROBE_TIMEOUT_MS = 120_000;

async function serverIsUp(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, { signal: controller.signal, redirect: "follow" });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** shoot.mjs's manifest carries no HTTP status / final URL (only shots and
 * errors), so capture.mjs makes its own best-effort, unauthenticated fetch
 * per target purely to fill those two CAPTURE-LOG columns. This will read as
 * a redirect-to-login for gated routes even though the shot itself was taken
 * while authenticated — noted in the report as a known limitation, not a bug
 * in the shot. */
async function probeUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    return { status: String(res.status), finalUrl: res.url || url };
  } catch (err) {
    return { status: "-", finalUrl: `- (${err.message})` };
  } finally {
    clearTimeout(timer);
  }
}

function mdEscape(value) {
  return String(value).replace(/\|/g, "/");
}

function run(cmd, args, opts) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 0));
  });
}

// -------------------------------------------------------------------- main --

export async function main(argv, ctx) {
  const log = ctx?.log ?? ((msg) => console.error(msg));
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return fail(log, err.message);
  }
  if (!args.project) return fail(log, USAGE);

  let config;
  try {
    config = await ctx.loadProject(args.project, args.root ? { root: args.root } : {});
  } catch (err) {
    return fail(log, `could not load project "${args.project}": ${err.message}`);
  }

  const root = config.root;
  const auditDir = config.auditDir;
  if (!root || !isAbsolute(root)) return fail(log, `project "${args.project}" has no absolute "root"`);
  if (!auditDir) return fail(log, `project "${args.project}" has no "auditDir"`);

  const auditRoot = join(root, auditDir);
  const screensDir = join(auditRoot, "screens");
  const screens = config.screens;
  if (!screens?.baseUrl) return fail(log, `project "${args.project}" has no "screens.baseUrl"`);
  const viewports = screens.viewports?.length ? screens.viewports : null;
  if (!viewports) return fail(log, `project "${args.project}" has no "screens.viewports"`);
  const identitiesAll = screens.identities?.length ? screens.identities : null;
  if (!identitiesAll) return fail(log, `project "${args.project}" has no "screens.identities"`);

  let identities = identitiesAll;
  if (args.identity) {
    identities = identitiesAll.filter((i) => i.id === args.identity);
    if (identities.length === 0) {
      return fail(
        log,
        `unknown identity "${args.identity}"; known: ${identitiesAll.map((i) => i.id).join(", ")}`,
      );
    }
  }

  // ---- paths.json --------------------------------------------------------
  const pathsFile = join(auditRoot, "paths.json");
  if (!existsSync(pathsFile)) return fail(log, `missing ${pathsFile}; run "ux-paths init" first`);
  let pathsJson;
  try {
    pathsJson = JSON.parse(readFileSync(pathsFile, "utf8"));
  } catch (err) {
    return fail(log, `could not parse ${pathsFile}: ${err.message}`);
  }
  const distinctRoutes = [...new Set(pathsJson.flatMap((p) => p.routes ?? []))];
  if (distinctRoutes.length === 0) return fail(log, `${pathsFile} has no routes yet`);

  // ---- params for [dynamic] routes --------------------------------------
  const paramsFile = join(auditRoot, "inputs", "params.json");
  let paramsMap = {};
  if (existsSync(paramsFile)) {
    try {
      paramsMap = JSON.parse(readFileSync(paramsFile, "utf8"));
    } catch (err) {
      return fail(log, `could not parse ${paramsFile}: ${err.message}`);
    }
  }
  for (const pair of args.params) {
    const eq = pair.indexOf("=");
    if (eq < 0) return fail(log, `--param must be key=value, got "${pair}"`);
    paramsMap[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const skippedRoutes = [];
  const resolvedRoutes = [];
  for (const route of distinctRoutes) {
    const { route: resolved, missing } = resolveDynamicRoute(route, paramsMap);
    if (missing.length > 0) {
      const reason = `missing param${missing.length > 1 ? "s" : ""} ${missing
        .map((m) => `[${m}]`)
        .join(", ")}`;
      log(`[capture] skipping "${route}": ${reason}`);
      skippedRoutes.push({ route, reason });
      continue;
    }
    resolvedRoutes.push({ pattern: route, resolved });
  }

  // ---- targets ------------------------------------------------------------
  const targets = [];
  const targetMeta = new Map(); // id -> { identity, routeLabel, requestedUrl }
  for (const identity of identities) {
    for (const { pattern, resolved } of resolvedRoutes) {
      const label = routeLabel(pattern);
      const id = `${identity.id}__${label}`;
      const requestedUrl = composeUrl(screens.baseUrl, resolved);
      targets.push({
        id,
        route: resolved,
        role: identity.role ?? null,
        waitFor: args.waitFor,
        fullPage: true,
        axe: true,
      });
      targetMeta.set(id, { identity: identity.id, routeLabel: label, requestedUrl });
    }
  }

  const runStamp = stamp();
  const outDir = join(screensDir, `.run-${runStamp}`);
  const runJsonPath = join(screensDir, `.run-${runStamp}.json`);
  const runJson = {
    root,
    baseUrl: screens.baseUrl,
    outDir,
    ...screens.capture,
    viewports,
    auth: screens.auth ?? { mode: "none" },
    targets,
  };

  const skillDir = ctx.skillDir ?? dirname(dirname(dirname(new URL(import.meta.url).pathname)));
  const autoreviewUiDir = resolve(skillDir, "..", "autoreview-ui");
  const shootScript = join(autoreviewUiDir, "scripts", "shoot.mjs");
  const command = `node ${shootScript} --run ${runJsonPath}`;

  if (args.dryRun) {
    mkdirSync(screensDir, { recursive: true });
    writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2));
    log(`[capture] wrote ${runJsonPath} (${targets.length} target(s), ${skippedRoutes.length} skipped route(s))`);
    log(`[capture] would run: ${command}`);
    console.log(command);
    return 0;
  }

  // ---- preconditions --------------------------------------------------------
  if (!existsSync(shootScript)) {
    return fail(
      log,
      `shoot.mjs not found at ${shootScript}. Bootstrap autoreview-ui first: cd ${autoreviewUiDir} && npm run bootstrap`,
    );
  }
  const up = await serverIsUp(screens.baseUrl);
  if (!up) {
    const hint = config.startHint ?? screens.startHint ?? `Start the project's dev server at ${screens.baseUrl}.`;
    return fail(
      log,
      `no server answering at ${screens.baseUrl} (< ${SERVER_PROBE_TIMEOUT_MS / 1000}s, status < 500). ${hint}`,
    );
  }

  mkdirSync(screensDir, { recursive: true });
  writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2));
  log(`[capture] wrote ${runJsonPath} (${targets.length} target(s), ${skippedRoutes.length} skipped route(s))`);
  log(`[capture] running: ${command}`);

  let shootExit;
  try {
    shootExit = await run("node", [shootScript, "--run", runJsonPath], { cwd: autoreviewUiDir });
  } catch (err) {
    return fail(log, `failed to spawn shoot.mjs: ${err.message}`);
  }
  if (shootExit > 1) {
    return fail(log, `shoot.mjs exited ${shootExit} (crashed); nothing to move. See its stderr above.`);
  }

  // ---- aggregate manifest --------------------------------------------------
  const aggregatePath = join(outDir, "manifest.json");
  if (!existsSync(aggregatePath)) {
    return fail(log, `shoot.mjs produced no manifest at ${aggregatePath}`);
  }
  let aggregate;
  try {
    aggregate = JSON.parse(readFileSync(aggregatePath, "utf8"));
  } catch (err) {
    return fail(log, `could not parse ${aggregatePath}: ${err.message}`);
  }
  const manifestById = new Map(aggregate.targets.map((m) => [m.id, m]));

  // ---- status / final URL probes (best-effort, unauthenticated) -----------
  const probes = new Map();
  await Promise.all(
    targets.map(async (t) => {
      const meta = targetMeta.get(t.id);
      probes.set(t.id, await probeUrl(meta.requestedUrl));
    }),
  );

  // ---- move shots, build CAPTURE-LOG rows ----------------------------------
  const rows = [];
  let movedCount = 0;
  let failCount = 0;
  for (const { route, reason } of skippedRoutes) {
    rows.push(
      `| ${mdEscape(routeLabel(route))} | ${mdEscape(route)} | - | - | - | - | - | SKIPPED (${mdEscape(reason)}) |`,
    );
  }
  for (const target of targets) {
    const meta = targetMeta.get(target.id);
    const tm = manifestById.get(target.id);
    const probe = probes.get(target.id);
    const axeCount = tm?.axe ? String(tm.axe.violations.length) : "-";
    for (const vp of viewports) {
      const src = join(outDir, `${target.id}.${vp.name}.full.png`);
      const shot = tm?.shots?.find((s) => s.viewport === vp.name);
      let result;
      if (shot && existsSync(src)) {
        const dest = join(screensDir, `${target.id}__${vp.width}.png`);
        renameSync(src, dest);
        movedCount++;
        result = "ok";
      } else {
        failCount++;
        const errs = tm?.errors?.length ? tm.errors.join("; ").slice(0, 140) : "no shot produced";
        result = `FAIL ${mdEscape(errs)}`;
      }
      rows.push(
        `| ${mdEscape(target.id)} | ${mdEscape(meta.requestedUrl)} | ${mdEscape(meta.identity)} | ${vp.width} | ${probe.status} | ${mdEscape(probe.finalUrl)} | ${axeCount} | ${result} |`,
      );
    }
  }

  const captureLog = `# Capture log

Generated ${new Date().toISOString()}. Base URL: ${screens.baseUrl}. Status and
final URL come from a separate, unauthenticated probe of the requested URL
(shoot.mjs's own manifest carries no HTTP status); a gated route will show its
login redirect here even though the shot beside it was taken while
authenticated.

| Label | Requested URL | Identity | Width | Status | Final URL | Axe violations | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
  const captureLogPath = join(screensDir, "CAPTURE-LOG.md");
  writeFileSync(captureLogPath, captureLog);

  // ---- cleanup temporary run dir + run.json --------------------------------
  try {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(runJsonPath, { force: true });
  } catch (err) {
    log(`[capture] could not clean up ${outDir}: ${err.message}`);
  }

  log(`[capture] wrote ${movedCount} screenshot(s) and ${captureLogPath}`);
  if (skippedRoutes.length > 0) log(`[capture] ${skippedRoutes.length} route(s) skipped for missing params`);
  if (failCount > 0) {
    log(`[capture] ${failCount} shot(s) failed; see ${captureLogPath}`);
    return 1;
  }
  return 0;
}

export default main;
