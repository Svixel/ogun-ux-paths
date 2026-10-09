import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SKILL_DIR, loadProject, loadPrompt, validate } from "../scripts/lib/config.mjs";
import {
  PROMPT_FILES,
  RUNTIME_PLACEHOLDER_ROOTS,
  buildLoopArgs,
  globsIn,
  loadLoopPrompts,
  loopPromptData,
  markdownTables,
  parseContract,
} from "../scripts/lib/commands/loop-args.mjs";

const scratch = mkdtempSync(join(tmpdir(), "ux-paths-loop-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a throw, got none");
}

/* Words from the source project this skill was generalised out of. None of
   them may survive into a rendered prompt. */
const BORROWED_WORDS = [/\bmembers\b/i, /proto:v1/, /\bTA0\b/, /\bTB0\b/];

const CONTRACT = `# Build contract

## Foundation

- Id: F0
- Brief: Build the shell every job links into: frame, navigation, empty and
  error states, and the one-primary-action rule.
- Owns: \`src/ui/templates/**\`, \`src/app/layout.tsx\`
- Spec: tests/e2e/shell.spec.ts

## Ownership

| Job | Lane | Owns (may create or edit) | Must link to, never create | Spec | Model |
| --- | --- | --- | --- | --- | --- |
| TK2 find the case | konto | \`src/app/(konto)/arenden/**\` (the list and the record) | \`src/ui/**\` | tests/e2e/k2.spec.ts | — |
| TP1 read the offer | publik | \`src/app/(publik)/erbjudande/**\` | — | tests/e2e/p1.spec.ts | opus |
| Totals | — | — | — | — | — |

Every job also owns its row in BUILD-LOG.md.
`;

const RULES = `# Redesign rules

## R1. One door per job

Rule: one way in.

## R2. Carry the next step

Rule: never lose the destination.

## Ranked redesign moves

1. Do the first one first.
`;

/** A minimal prompt per loop role, in the shape the real ones will have. */
const PROMPT_BODIES = {
  foundation: `<!-- data
mode
commands.lint
foundation.brief (runtime)
-->
You build the foundation of {{product.name}} in {{mode}} mode.
Brief: {{foundation.brief}}
Run {{commands.lint}} and {{commands.types}}.
`,
  builder: `You build one job of {{product.name}}. Contract: {{contract}}.
Job {{job.id}} owns {{#each job.owns}}\`{{this}}\` {{/each}}.
Target file: {{auditDir}}/{{job.file}}. Rules: {{rules.count}}.
`,
  checker: `Check job {{job.id}} of {{product.name}}. Round {{round}} of {{maxRounds}}.
Commands: {{commands.lint}}, {{commands.types}}, {{commands.full}}, {{commands.e2e}}.
Extra: {{#each commands.extra}}{{this}}; {{/each}}
`,
  fixer: `Fix what the checker found on {{job.id}}. Never widen {{job.owns}}.
`,
  critic: `Critique lane {{lane.label}} of {{product.name}} against {{houseDocs}}.
Design skill: {{designSkill}}. Viewports:
{{viewportsList}}
Jobs: {{#each lane.jobs}}{{id}} {{/each}}
`,
  blockerFixer: `Fix the blockers in {{lane.id}}. Log to {{log}}.
`,
  finalChecker: `Run every command over {{jobCount}} job(s) in {{root}} and audit ownership.
Lanes: {{#each lanes}}{{label}} {{/each}}
`,
};

function fixture(name, { contract = CONTRACT, targets = ["TK2-find-the-case.md", "TP1-read-the-offer.md"] } = {}) {
  const root = join(scratch, name);
  const auditPath = join(root, "docs/ux/2026-09");
  mkdirSync(join(auditPath, "target", "paths"), { recursive: true });
  for (const file of targets) writeFileSync(join(auditPath, "target", "paths", file), `# ${file.split("-")[0]} — a target path\n`);
  writeFileSync(join(auditPath, "REDESIGN-RULES.md"), RULES);
  const contractPath = join(auditPath, "BUILD-CONTRACT.md");
  writeFileSync(contractPath, contract);

  const promptsDir = join(root, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  const prompts = {};
  for (const [role, file] of Object.entries(PROMPT_FILES)) {
    const path = join(promptsDir, file);
    writeFileSync(path, PROMPT_BODIES[role]);
    prompts[role] = loadPrompt(path);
  }
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });
  return { root, cfg, contractPath, prompts };
}

/* ------------------------------------------------------------- parsing */

test("markdownTables finds the tables and skips the prose", () => {
  const tables = markdownTables(CONTRACT);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].header[0], "Job");
  assert.equal(tables[0].rows.length, 3);
});

test("globs come from the backticks, so prose in the cell is ignored", () => {
  assert.deepEqual(globsIn("`a/**` (the list), `b/**`"), ["a/**", "b/**"]);
  assert.deepEqual(globsIn("a/**, b/**"), ["a/**", "b/**"]);
  assert.deepEqual(globsIn("—"), []);
  assert.deepEqual(globsIn(""), []);
});

test("the ownership table becomes jobs, and rows that are not jobs are skipped", () => {
  const { cfg } = fixture("parse");
  const parsed = parseContract(CONTRACT, cfg, "BUILD-CONTRACT.md");
  assert.deepEqual(parsed.jobs.map((j) => j.id), ["TK2", "TP1"]);
  assert.equal(parsed.jobs[0].name, "find the case");
  assert.deepEqual(parsed.jobs[0].owns, ["src/app/(konto)/arenden/**"]);
  assert.deepEqual(parsed.jobs[0].linkOnly, ["src/ui/**"]);
  assert.equal(parsed.jobs[0].model, null, "an em dash in the Model cell means: use the default");
  assert.equal(parsed.jobs[1].model, "opus");
  assert.equal(parsed.foundation.id, "F0");
  assert.deepEqual(parsed.foundation.owns, ["src/ui/templates/**", "src/app/layout.tsx"]);
  assert.match(parsed.foundation.brief, /one-primary-action rule\.$/, "a wrapped Brief line is joined");
});

test("a contract with no ownership table is refused by name", () => {
  const { cfg } = fixture("no-table");
  const error = thrown(() => parseContract("# Contract\n\nProse only.\n", cfg, "BUILD-CONTRACT.md"));
  assert.match(error.message, /BUILD-CONTRACT\.md/);
  assert.match(error.message, /"Owns" column/);
});

/* ---------------------------------------------------------------- args */

test("the args validate against loop-args.schema.json", () => {
  const { cfg, contractPath, prompts, root } = fixture("args");
  const args = buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, withFoundation: true });

  assert.deepEqual(validate("loop-args", args), { valid: true, errors: [] });
  assert.equal(args.root, root);
  assert.equal(args.contract, "docs/ux/2026-09/BUILD-CONTRACT.md");
  assert.equal(args.log, "docs/ux/2026-09/BUILD-LOG.md");
  assert.equal(args.mode, "real");
  assert.equal(args.maxRounds, 3);
  assert.equal(args.playwrightSlots, 1);
  assert.equal(args.skillDir, SKILL_DIR);
  assert.deepEqual(args.lanes, [{ id: "publik", label: "Publik" }, { id: "konto", label: "Konto" }]);
  assert.equal(args.foundation.id, "F0");
  assert.deepEqual(args.commands.extra, ["npm run check:ui"]);

  const job = args.jobs.find((j) => j.id === "TK2");
  assert.equal(job.lane, "konto", "the lane comes from the target prefix when the column is absent");
  assert.equal(job.file, "target/paths/TK2-find-the-case.md");
  assert.equal(job.spec, "tests/e2e/k2.spec.ts");
  assert.deepEqual(job.owns, ["src/app/(konto)/arenden/**"]);
  assert.equal(job.model, null);
});

test("--jobs selects a subset in the order given, and an unknown id is refused", () => {
  const { cfg, contractPath, prompts } = fixture("subset");
  const args = buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, jobIds: ["TP1"] });
  assert.deepEqual(args.jobs.map((j) => j.id), ["TP1"]);
  assert.deepEqual(args.lanes, [{ id: "publik", label: "Publik" }], "only the lanes of the chosen jobs get a critic");
  assert.equal(args.foundation, null);

  const error = thrown(() => buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, jobIds: ["TK9"] }));
  assert.match(error.message, /TK9/);
});

test("a missing target path file is refused by job id", () => {
  const { cfg, contractPath, prompts } = fixture("missing-target", { targets: ["TP1-read-the-offer.md"] });
  const error = thrown(() => buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts }));
  assert.match(error.message, /TK2/);
  assert.match(error.message, /target\/paths/);
});

test("--foundation without a foundation anywhere is refused", () => {
  const withoutFoundation = CONTRACT.slice(CONTRACT.indexOf("## Ownership"));
  const { cfg, contractPath, prompts } = fixture("no-foundation");
  cfg.build.foundation = null;
  const error = thrown(() =>
    buildLoopArgs({ cfg, contractPath, contractText: withoutFoundation, prompts, withFoundation: true }),
  );
  assert.match(error.message, /Foundation/);

  const fallback = buildLoopArgs({
    cfg: { ...cfg, build: { ...cfg.build, foundation: { id: "F1", brief: "b", owns: ["src/**"], spec: null } } },
    contractPath,
    contractText: withoutFoundation,
    prompts,
    withFoundation: true,
  });
  assert.equal(fallback.foundation.id, "F1", "the config is the fallback when the contract has no block");
});

test("a contract outside the checkout is refused", () => {
  const { cfg, prompts } = fixture("outside");
  const error = thrown(() =>
    buildLoopArgs({ cfg, contractPath: "/etc/hosts", contractText: CONTRACT, prompts }),
  );
  assert.match(error.message, /--contract/);
});

/* ------------------------------------------------------------- prompts */

test("prompts render now and keep only the runtime placeholders", () => {
  const { cfg, contractPath, prompts } = fixture("prompts");
  const args = buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, withFoundation: true });

  assert.deepEqual(Object.keys(args.prompts).sort(), Object.keys(PROMPT_FILES).sort());
  assert.match(args.prompts.foundation, /Exempelportal in real mode/);
  assert.match(args.prompts.foundation, /npm run lint and npm run typecheck/);
  assert.ok(args.prompts.foundation.includes("{{foundation.brief}}"), "foundation is filled by the script");
  assert.ok(args.prompts.builder.includes("{{job.id}}"), "the job is filled per call by the script");
  assert.ok(args.prompts.builder.includes("{{#each job.owns}}"), "an each over a runtime list survives whole");
  assert.match(args.prompts.builder, /Contract: docs\/ux\/2026-09\/BUILD-CONTRACT\.md/);
  assert.match(args.prompts.builder, /Rules: 2\./, "the ranked-moves appendix is not counted as a rule");
  assert.ok(args.prompts.checker.includes("{{round}}"));
  assert.match(args.prompts.checker, /Round \{\{round\}\} of 3/);
  assert.match(args.prompts.checker, /npm run check:ui;/);
  assert.ok(args.prompts.critic.includes("{{lane.label}}"));
  assert.ok(args.prompts.critic.includes("{{#each lane.jobs}}"), "the lane's jobs are only known per lane, at run time");
  assert.match(args.prompts.critic, /- desktop \(1440x900\)/, "the configured viewports are known at CLI time");
  assert.match(args.prompts.critic, /src\/ui\/README\.md, docs\/design-system\.md/);
  assert.match(args.prompts.finalChecker, /over 2 job\(s\)/, "jobCount is known at CLI time");
  assert.match(args.prompts.finalChecker, /Publik Konto/);
});

test("a prompt placeholder that is neither runtime nor known fails, and names itself", () => {
  const { cfg, contractPath, prompts, root } = fixture("bad-prompt");
  const file = join(root, "prompts", "builder.md");
  writeFileSync(file, "Build {{job.id}} with {{whatever.exists}}.\n");
  const error = thrown(() =>
    buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts: { ...prompts, builder: loadPrompt(file) } }),
  );
  assert.match(error.message, /whatever\.exists/);
});

test("no rendered prompt carries a word from the project this method came from", () => {
  const { cfg, contractPath, prompts } = fixture("words");
  const args = buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, withFoundation: true });
  for (const [role, text] of Object.entries(args.prompts)) {
    for (const word of BORROWED_WORDS) {
      assert.ok(!word.test(text), `${role} prompt contains ${word}`);
    }
  }
});

test("the shipped loop prompts, once written, carry none of those words either", () => {
  const dir = join(SKILL_DIR, "reference", "prompts");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  if (!files.length) {
    assert.ok(true, "reference/prompts is not written yet; the fixture test above covers the rule");
    return;
  }
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const word of BORROWED_WORDS) {
      assert.ok(!word.test(text), `reference/prompts/${file} contains ${word}`);
    }
  }
});

test("the runtime placeholder roots are the ones the workflow script fills", () => {
  assert.ok(RUNTIME_PLACEHOLDER_ROOTS.includes("job"));
  assert.ok(RUNTIME_PLACEHOLDER_ROOTS.includes("foundation"));
  assert.ok(RUNTIME_PLACEHOLDER_ROOTS.includes("round"));
  assert.ok(!RUNTIME_PLACEHOLDER_ROOTS.includes("product"), "config values must resolve now, not at run time");
});

/* ---------------------------------------------- the prompts that actually ship */

/**
 * The Workflow tool's script cannot import lib/config.mjs, so it carries its own
 * copy of the two template forms. The test runs that copy, sliced out of the
 * script by the markers around it, over the prompts the CLI really rendered.
 */
function stage2Filler() {
  const source = readFileSync(join(SKILL_DIR, "workflows", "build-loop.workflow.js"), "utf8");
  const start = source.indexOf("// >>> stage-2 renderer");
  const end = source.indexOf("// <<< stage-2 renderer");
  assert.ok(start !== -1 && end > start, "build-loop.workflow.js must keep its stage-2 renderer markers");
  const block = source.slice(source.indexOf("\n", start), end);
  return new Function(`${block};return fill;`)();
}

/** The stage-2 data build-loop.workflow.js passes, per role, with stand-in values. */
function stage2Cases(args) {
  const foundation = args.foundation;
  const foundationJob = { id: foundation.id, file: "(the foundation sentence)", owns: foundation.owns, spec: foundation.spec, lane: "shared", linkOnly: [] };
  const job = args.jobs[0];
  const lane = {
    id: job.lane,
    label: "A lane",
    jobs: [{ id: job.id, file: job.file, owns: job.owns, spec: job.spec, pass: true, routes: ["/a"], deviations: "" }],
  };
  return {
    foundation: [args.prompts.foundation, { job: foundationJob, foundation, round: 1, previousReport: "(none)", fails: "(none)" }],
    builder: [args.prompts.builder, { job, foundation, foundationReport: "{}", round: 1, previousReport: "(none)", fails: "(none)" }],
    checker: [args.prompts.checker, { job, foundation, foundationReport: "{}", round: 2, build: "{}", port: 3201 }],
    fixer: [args.prompts.fixer, { job, foundation, foundationReport: "{}", round: 2, build: "{}", fails: "[]", port: 3201 }],
    critic: [args.prompts.critic, { lane, port: 3201, reviewFile: "docs/ux/2026-09/REVIEW-a.md", shotsDir: "/tmp/shots" }],
    blockerFixer: [args.prompts.blockerFixer, { lane, blockers: "[]", port: 3201, reviewFile: "docs/ux/2026-09/REVIEW-a.md" }],
    finalChecker: [args.prompts.finalChecker, { port: 3201, jobResults: "{}", blockerFixerReports: "[]" }],
  };
}

test("the shipped loop prompts render at CLI time against a real config", () => {
  const { cfg, contractPath } = fixture("shipped");
  const args = buildLoopArgs({
    cfg,
    contractPath,
    contractText: CONTRACT,
    prompts: loadLoopPrompts(join(SKILL_DIR, "reference", "prompts")),
    withFoundation: true,
  });
  assert.deepEqual(Object.keys(args.prompts).sort(), Object.keys(PROMPT_FILES).sort());
  for (const [role, text] of Object.entries(args.prompts)) {
    assert.ok(!text.includes("<!-- data"), `${role}: the data declaration must be stripped, not sent to the agent`);
    assert.ok(text.trim().length > 200, `${role}: rendered to almost nothing`);
  }
  assert.match(args.prompts.builder, /docs\/ux\/2026-09\/BUILD-CONTRACT\.md/);
  assert.match(args.prompts.critic, /- desktop \(1440x900\)/);
  assert.match(args.prompts.finalChecker, /tests\/e2e\/shell\.spec\.ts tests\/e2e\/k2\.spec\.ts/, "allSpecs puts the foundation first");
});

test("the workflow script fills every placeholder the shipped prompts kept for it", () => {
  const { cfg, contractPath } = fixture("shipped-stage2");
  const args = buildLoopArgs({
    cfg,
    contractPath,
    contractText: CONTRACT,
    prompts: loadLoopPrompts(join(SKILL_DIR, "reference", "prompts")),
    withFoundation: true,
  });
  const fill = stage2Filler();
  for (const [role, [text, data]] of Object.entries(stage2Cases(args))) {
    const filled = fill(text, data);
    const left = [...new Set([...filled.matchAll(/\{\{[^{}]*\}\}/g)].map((m) => m[0]))];
    assert.deepEqual(left, [], `${role} prompt still has ${left.join(", ")} after the workflow filled it`);
  }
});

test("every runtime root is a name the workflow script passes to fill", () => {
  const source = readFileSync(join(SKILL_DIR, "workflows", "build-loop.workflow.js"), "utf8");
  const calls = source.slice(source.indexOf("// <<< stage-2 renderer"));
  for (const root of RUNTIME_PLACEHOLDER_ROOTS) {
    assert.match(calls, new RegExp(`\\b${root}\\b`), `build-loop.workflow.js never mentions the runtime key ${root}`);
  }
});

test("no runtime root shadows a key the CLI already resolves", () => {
  const { cfg, contractPath, prompts } = fixture("shadow");
  const args = buildLoopArgs({ cfg, contractPath, contractText: CONTRACT, prompts, withFoundation: true });
  const resolved = Object.keys(loopPromptData(cfg, args, { file: "", text: "", ids: [], count: 0 }));
  for (const root of RUNTIME_PLACEHOLDER_ROOTS) {
    assert.ok(!resolved.includes(root), `${root} is both a CLI-time key and a runtime root; the CLI value would never be used`);
  }
});
