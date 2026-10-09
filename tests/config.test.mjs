import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import {
  SKILL_DIR,
  UsageError,
  listFlag,
  loadPaths,
  loadProject,
  loadPrompt,
  parseFlags,
  renderPrompt,
  renderTemplate,
  resolveSkillPath,
  routeToName,
  validate,
} from "../scripts/lib/config.mjs";

const scratch = mkdtempSync(join(tmpdir(), "ux-paths-config-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const EXAMPLE = JSON.parse(readFileSync(join(SKILL_DIR, "projects", "example.json"), "utf8"));

/** node:assert's throws() returns nothing, and these tests assert on the message. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a throw, got none");
}

function write(name, value) {
  const file = join(scratch, name);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}

function projectRoot(name) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  return root;
}

/* -------------------------------------------------------------- schema */

test("the example config validates", () => {
  const result = validate("project", EXAMPLE);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("a missing root is reported by key", () => {
  const broken = { ...EXAMPLE };
  delete broken.root;
  const result = validate("project", broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.startsWith("project.root:")), result.errors.join("\n"));
  assert.ok(result.errors.some((e) => e.includes("is required")));
});

test("an unknown key is rejected by name", () => {
  const result = validate("project", { ...EXAMPLE, mystery: 1 });
  assert.ok(result.errors.some((e) => e.includes("project.mystery")), result.errors.join("\n"));
});

test("a bad lane prefix names the lane and the key", () => {
  const file = write("bad-prefix.json", {
    ...EXAMPLE,
    lanes: [{ ...EXAMPLE.lanes[0], asBuiltPrefix: "p1" }, EXAMPLE.lanes[1]],
  });
  const error = thrown(() => loadProject(file, { requireRoot: false }));
  assert.match(error.message, /lanes\[0\]\.asBuiltPrefix/);
});

test("two lanes cannot share a prefix", () => {
  const file = write("dupe-prefix.json", {
    ...EXAMPLE,
    lanes: [EXAMPLE.lanes[0], { ...EXAMPLE.lanes[1], asBuiltPrefix: EXAMPLE.lanes[0].asBuiltPrefix }],
  });
  const error = thrown(() => loadProject(file, { requireRoot: false }));
  assert.match(error.message, /lanes\[1\]\.asBuiltPrefix/);
});

test("only codex and claude are engines, and ori wraps either", () => {
  const file = write("bad-engine.json", {
    ...EXAMPLE,
    engines: { cheap: { ...EXAMPLE.engines.cheap, engine: "grok", wrapper: "ori" } },
  });
  const error = thrown(() => loadProject(file, { requireRoot: false }));
  assert.match(error.message, /engines\.cheap\.engine/);

  for (const engine of ["codex", "claude"]) {
    const ok = write(`ori-${engine}.json`, {
      ...EXAMPLE,
      engines: { cheap: { ...EXAMPLE.engines.cheap, engine, wrapper: "ori" } },
    });
    assert.equal(loadProject(ok, { requireRoot: false }).engines.cheap.engine, engine);
  }
});

test("devLogin needs an endpoint and a secret", () => {
  const file = write("bad-auth.json", {
    ...EXAMPLE,
    screens: { ...EXAMPLE.screens, auth: { mode: "devLogin" } },
  });
  const error = thrown(() => loadProject(file, { requireRoot: false }));
  assert.match(error.message, /screens\.auth\.endpoint/);
  assert.match(error.message, /screens\.auth\.secretFile/);
});

test("screens.capture waits must be usable timer values", () => {
  const file = write("bad-capture.json", {
    ...EXAMPLE,
    screens: { ...EXAMPLE.screens, capture: { navigationTimeoutMs: 0, waitForTimeoutMs: 2_147_483_648 } },
  });
  const error = thrown(() => loadProject(file, { requireRoot: false }));
  assert.match(error.message, /screens\.capture\.navigationTimeoutMs/);
  assert.match(error.message, /screens\.capture\.waitForTimeoutMs/);

  const unknown = validate("project", { ...EXAMPLE, screens: { ...EXAMPLE.screens, capture: { settleMs: 1 } } });
  assert.equal(unknown.valid, false);

  const good = write("good-capture.json", {
    ...EXAMPLE,
    screens: { ...EXAMPLE.screens, capture: { navigationTimeoutMs: 90_000 } },
  });
  assert.equal(loadProject(good, { requireRoot: false }).screens.capture.navigationTimeoutMs, 90_000);
});

test("a missing checkout names root", () => {
  const file = write("ok.json", EXAMPLE);
  const error = thrown(() => loadProject(file, { root: join(scratch, "nope") }));
  assert.match(error.message, /^root: /);
});

/* ------------------------------------------------------------- loading */

test("loadProject resolves directories and derives the id regexes", () => {
  const root = projectRoot("app");
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });
  assert.equal(cfg.root, root);
  assert.equal(cfg.auditPath, join(root, "docs/ux/2026-09"));
  assert.equal(cfg.logsDir, join(root, "docs/ux/2026-09/logs"));
  assert.equal(cfg.targetPathsDir, join(root, "docs/ux/2026-09/target/paths"));

  assert.ok(cfg.asBuiltIdRe.test("P1"));
  assert.ok(cfg.asBuiltIdRe.test("K12"));
  assert.ok(!cfg.asBuiltIdRe.test("TP1"), "a target id is not an as-built id");
  assert.ok(cfg.targetIdRe.test("TP1"));
  assert.ok(cfg.findingIdRe.test("K12-03"));
  assert.ok(!cfg.findingIdRe.test("K12-3"));
  assert.ok(cfg.targetFileRe.test("TK2-signera.md"));
  assert.ok(!cfg.targetFileRe.test("K2-signera.md"));
  assert.deepEqual("Replaces: P1 and K12".match(cfg.asBuiltIdScanRe), ["P1", "K12"]);
  assert.equal(cfg.build.designSkill, "/abs/path/to/frontend-design/SKILL.md");
});

test("loadPaths validates the inventory against the lanes", () => {
  const root = projectRoot("inventory");
  const auditDir = join(root, "docs/ux/2026-09");
  mkdirSync(auditDir, { recursive: true });
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });

  const good = [
    { id: "K1", lane: "konto", slug: "logga-in", name: "Log in", actor: "account holder", job: "Get in", routes: ["/konto/logga-in"] },
  ];
  writeFileSync(cfg.pathsFile, JSON.stringify(good));
  const paths = loadPaths(cfg);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].relFile, "paths/konto/K1-logga-in.md");
  assert.deepEqual(paths[0].specs, []);

  writeFileSync(cfg.pathsFile, JSON.stringify([{ ...good[0], id: "P1" }]));
  const error = thrown(() => loadPaths(cfg));
  assert.match(error.message, /paths\[0\]\.id/);
  assert.match(error.message, /prefix "K"/);

  writeFileSync(cfg.pathsFile, JSON.stringify([{ ...good[0], lane: "nowhere" }]));
  assert.match(thrown(() => loadPaths(cfg)).message, /paths\[0\]\.lane/);

  writeFileSync(cfg.pathsFile, JSON.stringify([good[0], good[0]]));
  assert.match(thrown(() => loadPaths(cfg)).message, /used twice/);
});

/* ----------------------------------------------------------- templates */

test("renderTemplate reads dotted keys", () => {
  assert.equal(renderTemplate("{{a.b}} and {{n}}", { a: { b: "one" }, n: 2 }), "one and 2");
});

test("an unknown placeholder throws and names the key", () => {
  const error = thrown(() => renderTemplate("x {{product.tagline}} y", { product: { name: "P" } }));
  assert.match(error.message, /product\.tagline/);
});

test("null renders as nothing but a missing key still throws", () => {
  assert.equal(renderTemplate("[{{a}}]", { a: null }), "[]");
  assert.throws(() => renderTemplate("[{{b}}]", { a: null }), /\{\{b\}\}/);
});

test("each iterates objects and strings", () => {
  const out = renderTemplate("{{#each lanes}}- {{label}} ({{id}})\n{{/each}}", {
    lanes: [{ id: "publik", label: "Publik" }, { id: "konto", label: "Konto" }],
  });
  assert.equal(out, "- Publik (publik)\n- Konto (konto)\n");
  assert.equal(renderTemplate("{{#each r}}`{{this}}` {{/each}}", { r: ["/a", "/b"] }), "`/a` `/b` ");
});

test("each falls back to the enclosing scope and nests", () => {
  const out = renderTemplate("{{#each lanes}}{{product}}/{{id}}{{#each actors}} {{this}}{{/each}};{{/each}}", {
    product: "Ex",
    lanes: [{ id: "a", actors: ["one", "two"] }, { id: "b", actors: [] }],
  });
  assert.equal(out, "Ex/a one two;Ex/b;");
});

test("each over a missing list throws, and an unclosed block throws", () => {
  assert.throws(() => renderTemplate("{{#each nope}}x{{/each}}", {}), /each nope/);
  assert.throws(() => renderTemplate("{{#each a}}x", { a: [] }), /never closed/);
  assert.throws(() => renderTemplate("{{#each a}}x{{/each}}", { a: 3 }), /needs a list/);
});

test("an object placeholder is refused, a list of strings is joined", () => {
  assert.throws(() => renderTemplate("{{a}}", { a: { b: 1 } }), /resolves to an object/);
  assert.equal(renderTemplate("{{a}}", { a: ["x", "y"] }), "x, y");
});

test("preserved roots stay in the output verbatim", () => {
  const source = "mode {{mode}} job {{job.id}} {{#each job.steps}}{{this}}{{/each}} end";
  assert.equal(
    renderTemplate(source, { mode: "real" }, { preserve: ["job"] }),
    "mode real job {{job.id}} {{#each job.steps}}{{this}}{{/each}} end",
  );
});

/* ------------------------------------------------------------- prompts */

test("a prompt declares the data it needs and the declaration is enforced", () => {
  const file = write("prompt.md", `<!-- data
path.id
- path.routes[]
job.id (filled by the workflow script)
-->
Path {{path.id}} at {{#each path.routes}}{{this}} {{/each}}for {{job.id}}.
`);
  const prompt = loadPrompt(file);
  assert.deepEqual(prompt.declared, ["path.id", "path.routes", "job.id"]);
  assert.ok(!prompt.text.startsWith("<!--"), "the declaration is stripped from the body");

  const out = renderPrompt(prompt, { path: { id: "K1", routes: ["/a"] } }, { preserve: ["job"] });
  assert.equal(out.trim(), "Path K1 at /a for {{job.id}}.");

  const error = thrown(() => renderPrompt(prompt, { path: { id: "K1" } }, { preserve: ["job"] }));
  assert.match(error.message, /path\.routes/);
});

test("a prompt without a declaration still renders", () => {
  const file = write("plain.md", "Hello {{name}}.\n");
  assert.equal(renderPrompt(loadPrompt(file), { name: "world" }), "Hello world.\n");
});

/* --------------------------------------------------------------- misc */

test("resolveSkillPath understands the skill prefix", () => {
  assert.equal(resolveSkillPath("skill:reference/METHOD.md"), join(SKILL_DIR, "reference/METHOD.md"));
  assert.equal(resolveSkillPath("/tmp/x.md"), "/tmp/x.md");
  assert.equal(resolveSkillPath("schemas/paths.schema.json"), join(SKILL_DIR, "schemas/paths.schema.json"));
});

test("routeToName is a stable screenshot label", () => {
  assert.equal(routeToName("/konto/arenden/[id]"), "konto_arenden_id");
  assert.equal(routeToName("/"), "root");
  assert.equal(routeToName("//a/b/"), "a_b");
  assert.equal(routeToName("/admin/ads?status=pending"), "admin_ads_status_pending");
});

test("parseFlags is strict about unknown and empty flags", () => {
  const { flags, positional } = parseFlags(["--project", "example", "--dry-run", "keep"], {
    string: ["project"],
    boolean: ["dry-run"],
  });
  assert.equal(flags.project, "example");
  assert.equal(flags["dry-run"], true);
  assert.deepEqual(positional, ["keep"]);
  assert.equal(parseFlags(["--project=example"], { string: ["project"] }).flags.project, "example");
  assert.throws(() => parseFlags(["--nope"], {}), /unknown option --nope/);
  assert.throws(() => parseFlags(["--project"], { string: ["project"] }), /needs a value/);
  assert.deepEqual(listFlag("A1, K2 K3"), ["A1", "K2", "K3"]);
  assert.deepEqual(listFlag(undefined), []);
});

/* ------------------------------------------- the prompts the commands render */

/**
 * audit, verify and rulecheck render a prompt from reference/prompts against
 * data their own module assembles. The two halves are written by different
 * hands, so a key renamed on one side has to fail here rather than on the first
 * real run, after the engine was already paid for.
 */
test("the shipped audit and verify prompts render against the data audit.mjs assembles", async () => {
  const { pathPromptData } = await import("../scripts/lib/commands/audit.mjs");
  const root = projectRoot("prompt-audit");
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });
  const p = {
    id: "K2",
    lane: "konto",
    slug: "find-the-case",
    name: "Find the case",
    actor: "account holder",
    job: "Find my case and read its status",
    routes: ["/arenden", "/arenden/[id]"],
    refs: [],
    specs: ["tests/e2e/k2.spec.ts"],
    group: "core",
    file: join(cfg.pathsDir, "konto", "K2-find-the-case.md"),
    relFile: "paths/konto/K2-find-the-case.md",
  };
  const engine = { engine: "claude", model: "sonnet", effort: "high", wrapper: null, label: "claude/sonnet" };

  for (const mode of ["audit", "verify"]) {
    const data = pathPromptData(cfg, p, { mode, engine, head: "abc1234", pack: "PACK", template: "TEMPLATE", existing: "" });
    const prompt = loadPrompt(resolveSkillPath(`reference/prompts/${mode}.md`));
    const text = renderPrompt(prompt, data);
    assert.ok(!text.includes("{{"), `${mode}.md left a placeholder: ${(text.match(/\{\{[^}]*\}\}/) || [])[0]}`);
    assert.ok(!text.includes("<!-- data"), `${mode}.md must strip its data declaration`);
    assert.match(text, /K2/);
    assert.match(text, /none captured for these routes/, "an empty list renders its fallback sentence, not nothing");
  }
});

test("the shipped rulecheck prompt renders against the data rulecheck.mjs assembles", async () => {
  const { rulecheckPromptData } = await import("../scripts/lib/commands/rulecheck.mjs");
  const root = projectRoot("prompt-rulecheck");
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });
  const target = {
    id: "TK1",
    name: "Find the case",
    replaces: "K2",
    lane: "konto",
    laneLabel: "Konto",
    fileName: "TK1-find-the-case.md",
    file: "docs/ux/2026-09/target/paths/TK1-find-the-case.md",
    path: join(cfg.targetPathsDir, "TK1-find-the-case.md"),
    text: "# TK1 — Find the case\n\nReplaces: K2\n",
  };
  const rules = { file: "docs/ux/2026-09/REDESIGN-RULES.md", text: "## R1. One door\n", ids: ["R1"], count: 1 };
  const data = rulecheckPromptData(cfg, target, {
    mode: "rulecheck",
    engine: { engine: "claude", model: "sonnet", effort: "high", wrapper: null, label: "claude/sonnet" },
    head: "abc1234",
    rules,
    asBuiltPaths: [{ id: "K2", relFile: "paths/konto/K2-find-the-case.md" }],
    inputs: [],
  });
  const text = renderPrompt(loadPrompt(resolveSkillPath("reference/prompts/rulecheck.md")), data);
  assert.ok(!text.includes("{{"), `rulecheck.md left a placeholder: ${(text.match(/\{\{[^}]*\}\}/) || [])[0]}`);
  assert.ok(!text.includes("<!-- data"));
  assert.match(text, /Replaces: K2/, "part C carries the target file's text, not just its path");
  assert.match(text, /paths\/konto\/K2-find-the-case\.md/, "the as-built file it replaces is named");
  assert.match(text, /not configured for this project/, "a missing input renders its fallback sentence");
});
