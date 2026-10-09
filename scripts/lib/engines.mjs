/**
 * engines.mjs — read-only engine adapters for the volume work.
 *
 * The cheap engine reads code and writes markdown into its own reply. It never
 * edits a file and never runs a command. Two things enforce that:
 *
 *   1. flags — a tool allowlist (claude) or a sandbox mode (codex);
 *   2. the git guard — `git status --porcelain` before and after every run.
 *      A line that appears outside <auditDir> aborts the run with exit 2 and
 *      prints the diff. Flags can be wrong; the working tree cannot lie.
 *
 * Nothing here writes a file except the codex last-message file, which lives
 * in the temp directory.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ENGINES = ["codex", "claude"];
export const WRAPPERS = ["ori"];
/** ori launches the codex and claude harnesses; it has no run mode of its own. */
export const WRAPPABLE = { ori: ["codex", "claude"] };
export const DEFAULT_TIMEOUT_MS = 1_800_000;
export const MAX_BUFFER = 64 * 1024 * 1024;

export class EngineError extends Error {
  constructor(message) {
    super(message);
    this.name = "EngineError";
    this.exitCode = 2;
  }
}

/** Thrown when the working tree changed outside <auditDir> during a run. */
export class GitGuardError extends Error {
  constructor(message, changed, result) {
    super(message);
    this.name = "GitGuardError";
    this.exitCode = 2;
    this.changed = changed;
    this.result = result || null;
  }
}

function sanitize(label) {
  return String(label || "run").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * The command line for one engine run. Pure: no spawn, no file written, so
 * `--dry-run` prints exactly what a real run would execute.
 *
 * Returns { command, args, stdin, env, outFile }. `stdin` is "prompt" when the
 * engine reads the prompt from stdin.
 */
export function buildCommand({
  engine,
  model,
  effort,
  promptFile,
  cwd,
  wrapper = null,
  outFile = null,
  label = "run",
}) {
  if (!ENGINES.includes(engine)) {
    throw new EngineError(`unknown engine "${engine}"; use one of ${ENGINES.join(", ")}`);
  }
  if (wrapper !== null && wrapper !== undefined) {
    if (!WRAPPERS.includes(wrapper)) {
      throw new EngineError(`unknown wrapper "${wrapper}"; use one of ${WRAPPERS.join(", ")}`);
    }
    if (!WRAPPABLE[wrapper].includes(engine)) {
      throw new EngineError(`wrapper ${wrapper} runs ${WRAPPABLE[wrapper].join(" and ")} only, not ${engine}`);
    }
  }
  if (!model) throw new EngineError(`engine ${engine} needs a model`);

  let plan;
  if (engine === "codex") {
    const last = outFile || join(tmpdir(), `ux-paths-${sanitize(label)}-${process.pid}.last-message.md`);
    const args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "-C", cwd,
      "-s", "read-only",
      "-m", model,
      ...(effort ? ["-c", `model_reasoning_effort=${effort}`] : []),
      "--output-last-message", last,
      "-",
    ];
    plan = { command: "codex", args, stdin: "prompt", env: {}, outFile: last };
  } else {
    const args = [
      "--print",
      "--model", model,
      ...(effort ? ["--effort", String(effort)] : []),
      "--no-session-persistence",
      "--output-format", "json",
      "--strict-mcp-config",
      "--allowedTools", "Read", "Grep", "Glob", "LS",
      "--disallowedTools", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent",
    ];
    plan = { command: "claude", args, stdin: "prompt", env: {}, outFile: null };
  }

  if (wrapper) {
    plan = { ...plan, command: wrapper, args: [plan.command, ...plan.args] };
  }
  return plan;
}

/** The command line as one copy-pasteable string. */
export function formatCommand(plan) {
  const quote = (s) => (/^[a-zA-Z0-9._:/=,+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);
  const env = Object.entries(plan.env || {}).map(([k, v]) => `${k}=${quote(v)} `).join("");
  const stdin = plan.stdin === "prompt" ? " < <prompt>" : "";
  return `${env}${plan.command} ${plan.args.map(quote).join(" ")}${stdin}`;
}

function spawnCollect(plan, cwd, timeoutMs, promptText) {
  return new Promise((done) => {
    const child = spawn(plan.command, plan.args, {
      cwd,
      env: { ...process.env, ...(plan.env || {}) },
      stdio: [plan.stdin === "prompt" ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let out = "";
    let err = "";
    let spawnError = null;
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      done({ code, signal, out, err, spawnError });
    });
    if (plan.stdin === "prompt") {
      child.stdin.on("error", () => {});
      child.stdin.end(promptText);
    }
  });
}

/** Per-engine result extraction. Fields the engine cannot report stay null. */
export function extractResult(engine, { out, outFile }) {
  if (engine === "codex") {
    const text = outFile && existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    return { text, sessionId: null, costUsd: null, turns: null, stopReason: null, raw: null, parseError: null };
  }
  let json;
  try {
    json = JSON.parse(out);
  } catch (error) {
    return { text: null, sessionId: null, costUsd: null, turns: null, stopReason: null, raw: null, parseError: error.message };
  }
  // `claude --print --output-format json` prints one result object, but some
  // CLI versions and settings (verbose) print the whole message list instead,
  // with the result object last. Read the result from either shape.
  if (Array.isArray(json)) {
    json = json.findLast((message) => message?.type === "result") ?? {};
  }
  return {
    text: json.result ?? null,
    sessionId: json.session_id ?? null,
    costUsd: json.total_cost_usd ?? null,
    turns: json.num_turns ?? null,
    stopReason: json.subtype ?? null,
    raw: json,
    parseError: null,
  };
}

/* ------------------------------------------------------------------ *
 * The git guard
 * ------------------------------------------------------------------ */

/**
 * `git status --porcelain -uall`, or null when root is not a git checkout.
 *
 * -uall lists untracked files one by one. Without it git collapses a wholly
 * untracked directory to a single `?? docs/` line, and a new file two levels
 * down inside the audit folder would then look like a change outside it.
 */
export function gitStatus(root) {
  try {
    return execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/** Short HEAD, or "unknown" outside a checkout. Used to label the audited tree. */
export function gitHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "unknown";
  }
}

/** `git diff --numstat HEAD`: how many lines each tracked file has changed. */
function gitNumstat(root) {
  try {
    return execFileSync("git", ["diff", "--numstat", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

/**
 * The two readings the guard compares: the porcelain list, and the per-file
 * change counts.
 *
 * The porcelain list alone is not enough. A file that was already modified
 * before the run keeps the same ` M path` line however much an engine adds to
 * it, so a dirty checkout would hide exactly the edit we are watching for. The
 * numstat catches that, because the counts move.
 */
export function gitSnapshot(root) {
  const porcelain = gitStatus(root);
  if (porcelain === null) return null;
  return { porcelain, numstat: gitNumstat(root) };
}

function asSnapshot(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? { porcelain: value, numstat: "" } : value;
}

/** ` M src/a.ts` -> `src/a.ts`; a rename line keeps the destination. */
function porcelainPath(line) {
  const path = line.slice(3).trim();
  const arrow = path.indexOf(" -> ");
  return arrow === -1 ? path : path.slice(arrow + 4);
}

function numstatMap(text) {
  const map = new Map();
  for (const line of String(text).split("\n").filter(Boolean)) {
    const [added, deleted, ...rest] = line.split("\t");
    if (!rest.length) continue;
    map.set(rest.join("\t"), `${added}/${deleted}`);
  }
  return map;
}

/**
 * Everything that changed after `before` and is not inside auditDir. Returns []
 * when either snapshot is null, which is what "root is not a checkout" means:
 * the guard is off, and the caller says so.
 */
export function changedOutside(before, after, auditDir) {
  const b = asSnapshot(before);
  const a = asSnapshot(after);
  if (!b || !a) return [];
  const inside = auditDir.endsWith("/") ? auditDir : `${auditDir}/`;
  const known = new Set(b.porcelain.split("\n").filter(Boolean));
  const found = new Map();
  for (const line of a.porcelain.split("\n").filter(Boolean)) {
    if (known.has(line)) continue;
    const path = porcelainPath(line);
    if (path.startsWith(inside)) continue;
    found.set(path, line);
  }
  const beforeCounts = numstatMap(b.numstat);
  const afterCounts = numstatMap(a.numstat);
  for (const [path, counts] of afterCounts) {
    if (path.startsWith(inside) || found.has(path)) continue;
    if (beforeCounts.get(path) !== counts) found.set(path, ` M ${path} (${counts} lines changed during the run)`);
  }
  return [...found.values()];
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * Run one engine over one prompt file.
 *
 *   runEngine({ engine, model, effort, promptFile, cwd, wrapper, label })
 *     -> { text, sessionId, costUsd, turns, stopReason, raw, ... }
 *
 * options.dryRun      returns { command, args } and spawns nothing
 * options.guard       { root, auditDir } turns the git guard on
 */
export async function runEngine(options) {
  const {
    engine,
    model,
    effort = null,
    promptFile,
    cwd,
    wrapper = null,
    label = "run",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    dryRun = false,
    guard = null,
  } = options;

  const plan = buildCommand({ engine, model, effort, promptFile, cwd, wrapper, label });

  if (dryRun) {
    return {
      dryRun: true,
      command: plan.command,
      args: plan.args,
      env: plan.env,
      stdin: plan.stdin,
      commandLine: formatCommand(plan),
      text: null,
      sessionId: null,
      costUsd: null,
      turns: null,
      stopReason: null,
      raw: null,
      seconds: 0,
      exitCode: null,
      stderr: "",
      stdout: "",
      timedOut: false,
      parseError: null,
      changedOutside: [],
    };
  }

  if (!existsSync(promptFile)) throw new EngineError(`prompt file not found: ${promptFile}`);
  const promptText = plan.stdin === "prompt" ? readFileSync(promptFile, "utf8") : null;
  const before = guard ? gitSnapshot(guard.root) : null;
  const started = Date.now();
  const { code, signal, out, err, spawnError } = await spawnCollect(plan, cwd, timeoutMs, promptText);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (spawnError && spawnError.code === "ENOENT") {
    throw new EngineError(`${plan.command} is not installed or not on PATH (engine ${engine})`);
  }
  const timedOut = signal === "SIGKILL" && seconds * 1000 >= timeoutMs;
  const extracted = extractResult(engine, { out, err, code, outFile: plan.outFile });

  const result = {
    dryRun: false,
    command: plan.command,
    args: plan.args,
    env: plan.env,
    commandLine: formatCommand(plan),
    ...extracted,
    seconds,
    exitCode: code,
    signal,
    timedOut,
    stdout: out,
    stderr: err,
    changedOutside: [],
  };

  if (guard) {
    const after = gitSnapshot(guard.root);
    const changed = changedOutside(before, after, guard.auditDir);
    result.changedOutside = changed;
    result.guardActive = before !== null && after !== null;
    if (changed.length && guard.abort !== false) {
      throw new GitGuardError(
        `${label}: the working tree changed outside ${guard.auditDir} during the run:\n${changed.map((l) => `  ${l}`).join("\n")}`,
        changed,
        result,
      );
    }
  }
  return result;
}

/**
 * Run `fn` over `items`, `n` at a time, logging start and finish. Results come
 * back sorted by id so a run summary reads the same on every run.
 */
export async function pool(items, n, fn, log = () => {}) {
  const results = [];
  let index = 0;
  const width = Math.max(1, Math.min(n, items.length));
  const workers = Array.from({ length: width }, async () => {
    while (index < items.length) {
      const item = items[index++];
      log(`start ${item.id}`);
      const result = await fn(item);
      log(`done  ${result.id}: ${result.status}`);
      results.push(result);
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Merge engines.cheap with the CLI overrides, and check the wrapper pairing. */
export function resolveEngine(cfg, overrides = {}) {
  // `maxTurns` stays valid in config so old configs load, but codex and claude take no turn cap, so it is ignored.
  const base = cfg.engines.cheap;
  const engine = overrides.engine || base.engine;
  const wrapper = overrides.wrapper !== undefined ? overrides.wrapper : (base.wrapper ?? null);
  const resolved = {
    engine,
    model: overrides.model || base.model,
    effort: overrides.effort || base.effort || null,
    concurrency: Number(overrides.concurrency ?? base.concurrency ?? 1),
    wrapper,
    timeoutMs: Number(overrides.timeoutMs ?? base.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  if (!ENGINES.includes(resolved.engine)) {
    throw new EngineError(`unknown engine "${resolved.engine}"; use one of ${ENGINES.join(", ")}`);
  }
  if (resolved.wrapper && !WRAPPABLE[resolved.wrapper]?.includes(resolved.engine)) {
    throw new EngineError(`wrapper ${resolved.wrapper} runs ${(WRAPPABLE[resolved.wrapper] || []).join(" and ")} only, not ${resolved.engine}`);
  }
  if (!Number.isInteger(resolved.concurrency) || resolved.concurrency < 1) {
    throw new EngineError(`concurrency must be a whole number of 1 or more, got ${resolved.concurrency}`);
  }
  resolved.label = `${resolved.wrapper ? `${resolved.wrapper}/` : ""}${resolved.engine}/${resolved.model}`;
  return resolved;
}
