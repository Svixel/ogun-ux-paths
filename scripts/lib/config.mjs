/**
 * config.mjs — project configuration, validation, path resolution, templates.
 *
 * The skill has no dependencies on purpose: a UX programme that reads other
 * people's repositories should be auditable in one sitting. The JSON Schema
 * files under schemas/ stay the portable contract; `validate` here enforces
 * the subset those files use (type, required, properties, additionalProperties,
 * enum, const, oneOf, items, minItems, pattern). Cross-field rules the subset
 * cannot express live in `crossChecks` and name the key they reject.
 *
 * Exports (the seam the command modules code against):
 *   loadProject(nameOrPath, options) -> cfg
 *   loadPaths(cfg)                   -> path inventory, validated
 *   resolveSkillPath(p)              -> absolute path inside this skill
 *   resolveProjectPath(cfg, p)       -> absolute path inside the product repo
 *   renderTemplate(text, data, opts) -> string
 *   validate(schemaName, value)      -> { valid, errors }
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCHEMA_DIR = join(SKILL_DIR, "schemas");

/** Thrown for anything the caller can fix by typing a different command. Exit 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

/* ------------------------------------------------------------------ *
 * Argument parsing
 * ------------------------------------------------------------------ */

/**
 * Minimal, strict flag parser. Unknown flags are an error, not a shrug: a
 * misspelled --concurrency silently running twenty engines is the failure we
 * are avoiding.
 *
 *   parseFlags(argv, { string: ["project"], boolean: ["dry-run"], alias: { p: "project" } })
 *     -> { flags: { project: "x", "dry-run": true }, positional: [] }
 */
export function parseFlags(argv, spec = {}) {
  const strings = new Set(spec.string || []);
  const booleans = new Set(spec.boolean || []);
  const alias = spec.alias || {};
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    let name = arg.replace(/^--?/, "");
    let inlineValue = null;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (alias[name]) name = alias[name];
    if (booleans.has(name)) {
      if (inlineValue !== null) throw new UsageError(`--${name} is a flag and takes no value`);
      flags[name] = true;
      continue;
    }
    if (strings.has(name)) {
      const value = inlineValue !== null ? inlineValue : argv[++i];
      if (value === undefined || (typeof value === "string" && value.startsWith("--"))) {
        throw new UsageError(`--${name} needs a value`);
      }
      flags[name] = value;
      continue;
    }
    throw new UsageError(`unknown option --${name}`);
  }
  return { flags, positional };
}

/** Comma or space separated list flag, e.g. --only A1,W2. */
export function listFlag(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Validation — the JSON Schema subset the schemas/ files use
 * ------------------------------------------------------------------ */

const SCHEMA_CACHE = new Map();

function schemaFor(name) {
  if (SCHEMA_CACHE.has(name)) return SCHEMA_CACHE.get(name);
  const file = join(SCHEMA_DIR, `${name}.schema.json`);
  if (!existsSync(file)) throw new UsageError(`no schema named ${name} at ${file}`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  SCHEMA_CACHE.set(name, parsed);
  return parsed;
}

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(expected, value) {
  const kind = kindOf(value);
  if (expected === kind) return true;
  if (expected === "number" && kind === "integer") return true;
  return false;
}

function checkNode(schema, value, path, errors) {
  if (schema === true || schema === undefined) return;
  if ("const" in schema && !deepEqual(schema.const, value)) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => typeMatches(t, value))) {
      errors.push(`${path}: must be ${allowed.join(" or ")}, got ${kindOf(value)}`);
      return;
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((option) => deepEqual(option, value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}`);
  }
  if (schema.oneOf !== undefined) {
    const passes = schema.oneOf.filter((branch) => {
      const branchErrors = [];
      checkNode(branch, value, path, branchErrors);
      return branchErrors.length === 0;
    });
    if (passes.length !== 1) {
      errors.push(`${path}: must match exactly one of the allowed shapes (matched ${passes.length})`);
    }
  }
  if (typeof value === "string" && schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: must have at least ${schema.minItems} item(s)`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => checkNode(schema.items, item, `${path}[${index}]`, errors));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: is required`);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key}: is not a known key`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) checkNode(sub, value[key], `${path}.${key}`, errors);
    }
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/** validate("project", cfg) -> { valid, errors }. Every error names its key path. */
export function validate(schemaName, value) {
  const errors = [];
  checkNode(schemaFor(schemaName), value, schemaName, errors);
  return { valid: errors.length === 0, errors };
}

/** validate, or throw a UsageError that lists every failing key. */
export function assertValid(schemaName, value, label) {
  const result = validate(schemaName, value);
  if (!result.valid) {
    throw new UsageError(`${label} is not valid:\n${result.errors.map((e) => `  → ${e}`).join("\n")}`);
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Template rendering
 * ------------------------------------------------------------------ */

const TAG_RE = /\{\{\s*([#/][a-zA-Z]+)?\s*([^{}]*?)\s*\}\}/g;

function rootOf(expression) {
  return String(expression).split(".")[0].replace(/^this$/, "this");
}

function lookup(expression, scopes) {
  const parts = String(expression).split(".").map((s) => s.trim());
  let value;
  let found = false;
  if (parts[0] === "this") {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      if (Object.prototype.hasOwnProperty.call(scopes[i], "__this__")) {
        value = scopes[i].__this__;
        found = true;
        break;
      }
    }
    if (!found) return { found: false };
    parts.shift();
  } else {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const scope = scopes[i];
      if (scope && typeof scope === "object" && Object.prototype.hasOwnProperty.call(scope, parts[0])) {
        value = scope[parts[0]];
        found = true;
        break;
      }
    }
    if (!found) return { found: false };
    parts.shift();
  }
  for (const part of parts) {
    if (value === null || value === undefined) return { found: false };
    if (typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}

function stringify(value, expression, label) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))) {
      return value.map((v) => (v === null ? "" : String(v))).join(", ");
    }
    throw new Error(`${label}: {{${expression}}} is a list of objects; use {{#each ${expression}}}…{{/each}}`);
  }
  throw new Error(`${label}: {{${expression}}} resolves to an object; render one of its leaf keys`);
}

/**
 * Render {{a.b}} lookups and {{#each list}}…{{/each}} blocks.
 *
 * Inside an each block `{{this}}` is the item and `{{field}}` reads the item's
 * fields, falling back to the enclosing scopes. An unknown placeholder throws
 * and the message names it. `options.preserve` lists placeholder roots that are
 * left in the output verbatim — the loop prompts keep `{{job.*}}` for the
 * workflow script to fill at run time.
 */
export function renderTemplate(text, data, options = {}) {
  const label = options.label || "template";
  const preserve = new Set(options.preserve || []);
  return renderScope(String(text), [data || {}], preserve, label);
}

function renderScope(text, scopes, preserve, label) {
  let out = "";
  let cursor = 0;
  // A fresh regex per call: renderScope recurses into each-block bodies and a
  // shared lastIndex would make the outer scan skip text.
  const tags = new RegExp(TAG_RE.source, "g");
  let match;
  while ((match = tags.exec(text)) !== null) {
    const [raw, keyword, expression] = match;
    out += text.slice(cursor, match.index);
    const kind = (keyword || "").trim();
    if (kind === "#each") {
      const block = matchBlock(text, match.index, raw.length, label);
      if (preserve.has(rootOf(expression))) {
        out += text.slice(match.index, block.end);
      } else {
        const found = lookup(expression, scopes);
        if (!found.found) throw new Error(`${label}: unknown placeholder {{#each ${expression}}}`);
        const list = found.value;
        if (list !== null && list !== undefined && !Array.isArray(list)) {
          throw new Error(`${label}: {{#each ${expression}}} needs a list, got ${kindOf(list)}`);
        }
        for (const item of list || []) {
          const itemScope = item !== null && typeof item === "object" && !Array.isArray(item) ? { ...item } : {};
          itemScope.__this__ = item;
          out += renderScope(block.body, [...scopes, itemScope], preserve, label);
        }
      }
      cursor = block.end;
      tags.lastIndex = block.end;
      continue;
    }
    if (kind === "/each") {
      throw new Error(`${label}: {{/each}} without a matching {{#each}}`);
    }
    if (kind) throw new Error(`${label}: unsupported block {{${kind} ${expression}}}`);
    if (preserve.has(rootOf(expression))) {
      out += raw;
    } else {
      const found = lookup(expression, scopes);
      if (!found.found) throw new Error(`${label}: unknown placeholder {{${expression}}}`);
      out += stringify(found.value, expression, label);
    }
    cursor = match.index + raw.length;
  }
  out += text.slice(cursor);
  return out;
}

/** Find the {{/each}} that closes the {{#each}} starting at `start`. */
function matchBlock(text, start, openLength, label) {
  const bodyStart = start + openLength;
  let depth = 1;
  const scanner = new RegExp(TAG_RE.source, "g");
  scanner.lastIndex = bodyStart;
  let hit;
  while ((hit = scanner.exec(text)) !== null) {
    const kind = (hit[1] || "").trim();
    if (kind === "#each") depth += 1;
    else if (kind === "/each") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(bodyStart, hit.index), end: hit.index + hit[0].length };
    }
  }
  throw new Error(`${label}: {{#each}} is never closed`);
}

/* ------------------------------------------------------------------ *
 * Prompt files
 * ------------------------------------------------------------------ */

const DECLARATION_RE = /^\s*<!--\s*data\b([\s\S]*?)-->\s*/;

/**
 * Read a prompt file and its data declaration. A prompt declares, at the very
 * top, the keys it expects, so a rename in the config fails loudly instead of
 * rendering a prompt with a hole in it:
 *
 *   <!-- data
 *   path.id
 *   path.routes[]
 *   job.id (runtime, filled by the workflow script)
 *   -->
 *
 * One key per line. A leading "- " is allowed; "[]" marks a list and is
 * stripped; everything after the first whitespace, ":" or "—" is a comment.
 * A prompt without the block still renders; nothing else is inferred from it.
 */
export function loadPrompt(file) {
  if (!existsSync(file)) throw new UsageError(`prompt file not found: ${file}`);
  const source = readFileSync(file, "utf8");
  const match = source.match(DECLARATION_RE);
  const declared = [];
  if (match) {
    for (const line of match[1].split("\n")) {
      const cleaned = line.trim().replace(/^-\s*/, "");
      if (!cleaned || cleaned.startsWith("#")) continue;
      const key = cleaned.split(/[\s:—(]/)[0].replace(/\[\]$/, "").trim();
      if (key) declared.push(key);
    }
  }
  return { file, text: match ? source.slice(match[0].length) : source, declared };
}

/** Render a prompt file, first checking every key it declares resolves. */
export function renderPrompt(prompt, data, options = {}) {
  const preserve = new Set(options.preserve || []);
  const missing = prompt.declared.filter((key) => {
    if (preserve.has(rootOf(key))) return false;
    return !lookup(key, [data]).found;
  });
  if (missing.length) {
    throw new UsageError(
      `${prompt.file} declares data the runner does not provide: ${missing.join(", ")}`,
    );
  }
  return renderTemplate(prompt.text, data, { ...options, label: prompt.file });
}

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

/** `skill:reference/x.md` and bare relative paths resolve inside this skill. */
export function resolveSkillPath(p) {
  const value = String(p);
  if (value.startsWith("skill:")) return join(SKILL_DIR, value.slice("skill:".length));
  if (isAbsolute(value)) return resolve(value);
  return join(SKILL_DIR, value);
}

/** Repo-relative paths resolve inside the product checkout; `skill:` still wins. */
export function resolveProjectPath(cfg, p) {
  const value = String(p);
  if (value.startsWith("skill:")) return resolveSkillPath(value);
  if (isAbsolute(value)) return resolve(value);
  return join(cfg.root, value);
}

/**
 * Stable screenshot label for a route PATTERN: `/a/[id]/b` -> `a_id_b`, `/` -> `root`.
 * Brackets keep their inner name, not a resolved value, so a dynamic route's
 * label does not depend on which concrete id was substituted for the shot.
 * The single source for `capture` (writes the label) and `audit` (matches it);
 * the label never contains `__`, which separates the screenshot name segments.
 */
export function routeToName(route) {
  const label = String(route)
    .replace(/^\/+/, "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+$/, "");
  return label || "root";
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest first, so a two-letter prefix is never eaten by a one-letter one. */
function alternation(prefixes) {
  return [...prefixes]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRe)
    .join("|");
}

/* ------------------------------------------------------------------ *
 * Project config
 * ------------------------------------------------------------------ */

function configPath(nameOrPath) {
  const value = String(nameOrPath);
  if (value.includes("/") || value.endsWith(".json")) return resolve(value);
  return join(SKILL_DIR, "projects", `${value}.json`);
}

const MAX_TIMER_MS = 2_147_483_647;

function crossChecks(raw, file) {
  const errors = [];
  const seenLane = new Set();
  const seenAsBuilt = new Map();
  const seenTarget = new Map();
  raw.lanes.forEach((lane, index) => {
    if (seenLane.has(lane.id)) errors.push(`lanes[${index}].id: "${lane.id}" is used twice`);
    seenLane.add(lane.id);
    if (seenAsBuilt.has(lane.asBuiltPrefix)) {
      errors.push(`lanes[${index}].asBuiltPrefix: "${lane.asBuiltPrefix}" is already used by lane "${seenAsBuilt.get(lane.asBuiltPrefix)}"`);
    }
    seenAsBuilt.set(lane.asBuiltPrefix, lane.id);
    if (seenTarget.has(lane.targetPrefix)) {
      errors.push(`lanes[${index}].targetPrefix: "${lane.targetPrefix}" is already used by lane "${seenTarget.get(lane.targetPrefix)}"`);
    }
    seenTarget.set(lane.targetPrefix, lane.id);
    if (lane.targetPrefix === lane.asBuiltPrefix) {
      errors.push(`lanes[${index}].targetPrefix: must differ from asBuiltPrefix "${lane.asBuiltPrefix}"`);
    }
  });
  const wrapper = raw.engines.cheap.wrapper;
  if (wrapper === "ori" && !["codex", "claude"].includes(raw.engines.cheap.engine)) {
    errors.push(`engines.cheap.wrapper: ori wraps codex and claude only, not "${raw.engines.cheap.engine}"`);
  }
  const auth = raw.screens && raw.screens.auth;
  if (auth && auth.mode === "devLogin") {
    if (!auth.endpoint) errors.push("screens.auth.endpoint: is required when mode is devLogin");
    if (!auth.secretFile && !auth.secretEnv) {
      errors.push("screens.auth.secretFile: one of secretFile or secretEnv is required when mode is devLogin");
    }
  }
  if (auth && auth.mode === "none") {
    for (const key of ["endpoint", "header", "secretFile", "secretEnv", "handleField"]) {
      if (auth[key] !== undefined) errors.push(`screens.auth.${key}: is not used when mode is none`);
    }
  }
  const capture = raw.screens && raw.screens.capture;
  if (capture) {
    // The driver rejects these too, but only after the sweep has started.
    // Node timers overflow above 2^31-1 ms and then fire after 1 ms.
    for (const [key, value] of Object.entries(capture)) {
      if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
        errors.push(`screens.capture.${key}: must be a positive integer of milliseconds no greater than ${MAX_TIMER_MS}`);
      }
    }
  }
  if (raw.screens) {
    const seenIdentity = new Set();
    raw.screens.identities.forEach((identity, index) => {
      if (seenIdentity.has(identity.id)) errors.push(`screens.identities[${index}].id: "${identity.id}" is used twice`);
      seenIdentity.add(identity.id);
      if (identity.role !== null && (!auth || auth.mode === "none")) {
        errors.push(`screens.identities[${index}].role: a role needs screens.auth.mode devLogin`);
      }
    });
  }
  if (errors.length) {
    throw new UsageError(`invalid project config ${file}:\n${errors.map((e) => `  → ${e}`).join("\n")}`);
  }
}

/**
 * Read and validate projects/<name>.json (or an absolute path) and resolve
 * everything a command needs: directories, lane lookup, id regexes.
 *
 * options.root       overrides cfg.root (used by `init --root <tmp>` and tests)
 * options.requireRoot set false to skip the "does the checkout exist" check
 */
export function loadProject(nameOrPath, options = {}) {
  if (!nameOrPath) throw new UsageError("--project <name> or --config <path> is required");
  const file = configPath(nameOrPath);
  if (!existsSync(file)) throw new UsageError(`project config not found: ${file}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UsageError(`project config is not valid JSON: ${file}: ${error.message}`);
  }
  assertValid("project", raw, `project config ${file}`);
  crossChecks(raw, file);

  const root = options.root ? resolve(options.root) : raw.root;
  if (options.requireRoot !== false) {
    if (!existsSync(root)) throw new UsageError(`root: the checkout does not exist: ${root}`);
    if (!statSync(root).isDirectory()) throw new UsageError(`root: is not a directory: ${root}`);
  }

  const auditPath = join(root, raw.auditDir);
  const asBuiltAlternation = alternation(raw.lanes.map((l) => l.asBuiltPrefix));
  const targetAlternation = alternation(raw.lanes.map((l) => l.targetPrefix));

  const cfg = {
    ...raw,
    root,
    configFile: file,
    skillDir: SKILL_DIR,
    inputs: raw.inputs || [],
    build: {
      designSkill: null,
      houseDocs: [],
      foundation: null,
      ...(raw.build || {}),
    },
    loop: { specTemplate: null, ownsBase: null, ...raw.loop },
    auditPath,
    inputsDir: join(auditPath, "inputs"),
    logsDir: join(auditPath, "logs"),
    pathsDir: join(auditPath, "paths"),
    screensDir: join(auditPath, "screens"),
    targetDir: join(auditPath, "target"),
    targetPathsDir: join(auditPath, "target", "paths"),
    pathsFile: join(auditPath, "paths.json"),
    laneById: new Map(raw.lanes.map((lane) => [lane.id, lane])),
    asBuiltIdRe: new RegExp(`^(${asBuiltAlternation})(\\d+)$`),
    targetIdRe: new RegExp(`^(${targetAlternation})(\\d+)$`),
    findingIdRe: new RegExp(`^(${asBuiltAlternation})\\d+-\\d{2}$`),
    asBuiltIdScanRe: new RegExp(`\\b(?:${asBuiltAlternation})\\d+\\b`, "g"),
    targetFileRe: new RegExp(`^(?:${targetAlternation})\\d+-.+\\.md$`),
  };
  return cfg;
}

/** The lane a path id belongs to. kind is "asBuilt" (default) or "target". */
export function laneForId(cfg, id, kind = "asBuilt") {
  const re = kind === "target" ? cfg.targetIdRe : cfg.asBuiltIdRe;
  const match = re.exec(String(id));
  if (!match) return null;
  const key = kind === "target" ? "targetPrefix" : "asBuiltPrefix";
  return cfg.lanes.find((lane) => lane[key] === match[1]) || null;
}

/** Read <auditDir>/paths.json, validate it, and resolve each path's file. */
export function loadPaths(cfg) {
  if (!existsSync(cfg.pathsFile)) {
    throw new UsageError(`path inventory not found: ${cfg.pathsFile} (run \`ux-paths init --project ${cfg.name}\` first)`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(cfg.pathsFile, "utf8"));
  } catch (error) {
    throw new UsageError(`paths.json is not valid JSON: ${cfg.pathsFile}: ${error.message}`);
  }
  assertValid("paths", raw, `path inventory ${cfg.pathsFile}`);
  const errors = [];
  const seen = new Set();
  raw.forEach((p, index) => {
    if (seen.has(p.id)) errors.push(`paths[${index}].id: "${p.id}" is used twice`);
    seen.add(p.id);
    const lane = cfg.laneById.get(p.lane);
    if (!lane) {
      errors.push(`paths[${index}].lane: "${p.lane}" is not a lane in ${cfg.configFile}`);
      return;
    }
    const match = cfg.asBuiltIdRe.exec(p.id);
    if (!match || match[1] !== lane.asBuiltPrefix) {
      errors.push(`paths[${index}].id: "${p.id}" must start with lane "${lane.id}" prefix "${lane.asBuiltPrefix}"`);
    }
  });
  if (errors.length) {
    throw new UsageError(`invalid path inventory ${cfg.pathsFile}:\n${errors.map((e) => `  → ${e}`).join("\n")}`);
  }
  return raw.map((p) => ({
    ...p,
    refs: p.refs || [],
    specs: p.specs || [],
    group: p.group || "",
    lane: p.lane,
    file: join(cfg.pathsDir, p.lane, `${p.id}-${p.slug}.md`),
    relFile: `paths/${p.lane}/${p.id}-${p.slug}.md`,
  }));
}
