import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SKILL_DIR, loadProject } from "../scripts/lib/config.mjs";
import {
  EngineError,
  buildCommand,
  changedOutside,
  extractResult,
  formatCommand,
  gitHead,
  gitSnapshot,
  gitStatus,
  pool,
  resolveEngine,
  runEngine,
} from "../scripts/lib/engines.mjs";

const scratch = mkdtempSync(join(tmpdir(), "ux-paths-engines-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a throw, got none");
}

/** The index of a flag's value, so tests read the pairing and not the offset. */
function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const BASE = {
  model: "some-model",
  effort: "high",
  promptFile: "/abs/prompt.md",
  cwd: "/abs/repo",
  label: "K1.audit",
};

/* --------------------------------------------------------- dry-run lines */

test("codex runs in the read-only sandbox and ignores user config", () => {
  const plan = buildCommand({ ...BASE, engine: "codex" });
  assert.equal(plan.command, "codex");
  assert.equal(plan.args[0], "exec");
  assert.equal(plan.stdin, "prompt", "codex reads the prompt from stdin");
  assert.equal(plan.args.at(-1), "-", "the trailing - means read stdin");
  assert.equal(valueOf(plan.args, "-s"), "read-only");
  assert.equal(valueOf(plan.args, "-C"), "/abs/repo");
  assert.equal(valueOf(plan.args, "-m"), "some-model");
  assert.equal(valueOf(plan.args, "-c"), "model_reasoning_effort=high");
  assert.equal(valueOf(plan.args, "--output-last-message"), plan.outFile);
  assert.ok(plan.outFile.startsWith(tmpdir()), "the last message goes to a temp file, never into the repo");
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral"]) {
    assert.ok(plan.args.includes(flag), `${flag} missing`);
  }
});

test("claude runs with a read-only tool allowlist and no session on disk", () => {
  const plan = buildCommand({ ...BASE, engine: "claude" });
  assert.equal(plan.command, "claude");
  assert.equal(plan.stdin, "prompt");
  assert.equal(valueOf(plan.args, "--model"), "some-model");
  assert.equal(valueOf(plan.args, "--effort"), "high");
  assert.equal(valueOf(plan.args, "--output-format"), "json");
  for (const flag of ["--print", "--no-session-persistence", "--strict-mcp-config"]) {
    assert.ok(plan.args.includes(flag), `${flag} missing`);
  }
  const allowed = plan.args.slice(plan.args.indexOf("--allowedTools") + 1, plan.args.indexOf("--disallowedTools"));
  assert.deepEqual(allowed, ["Read", "Grep", "Glob", "LS"]);
  const denied = plan.args.slice(plan.args.indexOf("--disallowedTools") + 1);
  assert.deepEqual(denied, ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent"]);
});

test("the ori wrapper prefixes the harness and refuses the ones it cannot launch", () => {
  const plan = buildCommand({ ...BASE, engine: "codex", wrapper: "ori" });
  assert.equal(plan.command, "ori");
  assert.equal(plan.args[0], "codex");
  assert.equal(plan.args[1], "exec");
  assert.equal(plan.stdin, "prompt");

  const claudePlan = buildCommand({ ...BASE, engine: "claude", wrapper: "ori" });
  assert.deepEqual(claudePlan.args.slice(0, 2), ["claude", "--print"]);

  assert.match(thrown(() => buildCommand({ ...BASE, engine: "grok", wrapper: "ori" })).message, /unknown engine/);
  assert.match(thrown(() => buildCommand({ ...BASE, engine: "claude", wrapper: "nope" })).message, /unknown wrapper/);
  assert.match(thrown(() => buildCommand({ ...BASE, engine: "nope" })).message, /unknown engine/);
  assert.match(thrown(() => buildCommand({ ...BASE, engine: "codex", model: null })).message, /needs a model/);
});

test("effort is left out when the config has none, and a turn cap is never passed", () => {
  for (const engine of ["codex", "claude"]) {
    const plan = buildCommand({ ...BASE, engine, effort: null, maxTurns: 120 });
    assert.ok(!plan.args.includes("--effort"));
    assert.ok(!plan.args.some((a) => /model_reasoning_effort/.test(a)));
    assert.ok(!plan.args.includes("--max-turns"));
  }
});

test("formatCommand quotes what a shell would eat", () => {
  const line = formatCommand(buildCommand({ ...BASE, engine: "codex", cwd: "/a b/repo" }));
  assert.match(line, /^codex exec /);
  assert.match(line, /'\/a b\/repo'/);
  assert.match(formatCommand(buildCommand({ ...BASE, engine: "claude" })), /^claude --print .* < <prompt>$/);
  assert.match(formatCommand(buildCommand({ ...BASE, engine: "codex" })), / < <prompt>$/);
});

test("a dry run spawns nothing and reports the command line", async () => {
  const promptFile = join(scratch, "does-not-exist.md");
  for (const [engine, wrapper, command, pattern] of [
    ["codex", null, "codex", /^codex exec .* -s read-only /],
    ["claude", null, "claude", /^claude --print /],
    ["codex", "ori", "ori", /^ori codex exec /],
    ["claude", "ori", "ori", /^ori claude --print /],
  ]) {
    const result = await runEngine({ ...BASE, engine, wrapper, promptFile, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.command, command);
    assert.equal(result.text, null);
    assert.match(result.commandLine, pattern);
  }
  assert.deepEqual(readdirSync(scratch).filter((f) => f.endsWith(".md")), [], "a dry run writes nothing");
});

/* ---------------------------------------------------------- extraction */

test("each engine's result is read from where that engine puts it", () => {
  const claude = extractResult("claude", {
    out: JSON.stringify({ result: "hello", session_id: "s-2", total_cost_usd: 1.5, num_turns: 3, subtype: "success" }),
  });
  assert.equal(claude.text, "hello");
  assert.equal(claude.sessionId, "s-2");
  assert.equal(claude.stopReason, "success");

  // Claude Code 2.1.283 prints the whole message list, result last.
  const claudeList = extractResult("claude", {
    out: JSON.stringify([
      { type: "system", subtype: "init", session_id: "s-3" },
      { type: "assistant", message: { content: [{ type: "text", text: "thinking out loud" }] } },
      { type: "result", subtype: "success", result: "final answer", session_id: "s-3", total_cost_usd: 2.29, num_turns: 48 },
    ]),
  });
  assert.equal(claudeList.text, "final answer");
  assert.equal(claudeList.sessionId, "s-3");
  assert.equal(claudeList.turns, 48);
  assert.equal(claudeList.stopReason, "success");

  const claudeNoResult = extractResult("claude", { out: JSON.stringify([{ type: "system", subtype: "init" }]) });
  assert.equal(claudeNoResult.text, null, "a list without a result object yields no text");

  const outFile = join(scratch, "last-message.md");
  writeFileSync(outFile, "the answer\n");
  const codex = extractResult("codex", { out: "events go here", outFile });
  assert.equal(codex.text, "the answer\n");
  assert.equal(codex.costUsd, null, "codex reports no cost, and we do not invent one");

  const broken = extractResult("claude", { out: "not json at all" });
  assert.equal(broken.text, null);
  assert.ok(broken.parseError);
});

/* ------------------------------------------------------------ git guard */

function newRepo(name) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# repo\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "first"], { cwd: root });
  return root;
}

test("the guard sees a change outside the audit folder and ignores one inside it", () => {
  const root = newRepo("guarded");
  const auditDir = "docs/ux/2026-09";
  mkdirSync(join(root, auditDir, "paths", "konto"), { recursive: true });

  const before = gitStatus(root);
  assert.equal(before, "", "a clean checkout has an empty porcelain status");

  writeFileSync(join(root, auditDir, "paths", "konto", "K1-logga-in.md"), "# K1\n");
  assert.deepEqual(changedOutside(before, gitStatus(root), auditDir), [], "writing inside the audit folder is the job");

  writeFileSync(join(root, "README.md"), "# repo\nedited by something that should not edit\n");
  const changed = changedOutside(before, gitStatus(root), auditDir);
  assert.equal(changed.length, 1);
  assert.match(changed[0], /README\.md/);

  writeFileSync(join(root, "src.ts"), "export const x = 1;\n");
  assert.equal(changedOutside(before, gitStatus(root), auditDir).length, 2, "a new file outside counts too");
});

test("the guard still sees an edit to a file that was already dirty", () => {
  const root = newRepo("already-dirty");
  const auditDir = "docs/ux/2026-09";
  mkdirSync(join(root, auditDir), { recursive: true });
  writeFileSync(join(root, "README.md"), "# repo\nedited before the run\n");

  // The porcelain line is ` M README.md` both before and after, so line
  // comparison alone would miss the second edit. The numstat does not.
  const before = gitSnapshot(root);
  writeFileSync(join(root, "README.md"), "# repo\nedited before the run\nand again during it\n");
  const changed = changedOutside(before, gitSnapshot(root), auditDir);
  assert.equal(changed.length, 1);
  assert.match(changed[0], /README\.md/);
  assert.match(changed[0], /during the run/);

  writeFileSync(join(root, auditDir, "FINDINGS.md"), "# findings\n");
  assert.equal(changedOutside(before, gitSnapshot(root), auditDir).length, 1, "the audit folder is still exempt");
});

test("the guard is off, not wrong, outside a checkout", () => {
  const plain = join(scratch, "not-a-repo");
  mkdirSync(plain, { recursive: true });
  assert.equal(gitStatus(plain), null);
  assert.equal(gitSnapshot(plain), null);
  assert.equal(gitHead(plain), "unknown");
  assert.deepEqual(changedOutside(null, null, "docs"), []);
});

test("gitHead reads the short sha", () => {
  const root = newRepo("head");
  assert.match(gitHead(root), /^[0-9a-f]{7,}$/);
});

/* -------------------------------------------------------------- config */

test("resolveEngine merges the config with the flags", () => {
  const root = mkdtempSync(join(tmpdir(), "ux-paths-root-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = loadProject(join(SKILL_DIR, "projects", "example.json"), { root });

  const fromConfig = resolveEngine(cfg, {});
  assert.equal(fromConfig.engine, "claude");
  assert.equal(fromConfig.concurrency, 6);
  assert.equal(fromConfig.label, "claude/sonnet");

  const overridden = resolveEngine(cfg, { engine: "codex", model: "m", concurrency: "2" });
  assert.equal(overridden.engine, "codex");
  assert.equal(overridden.model, "m");
  assert.equal(overridden.concurrency, 2);

  assert.match(thrown(() => resolveEngine(cfg, { concurrency: "0" })).message, /1 or more/);
  assert.match(thrown(() => resolveEngine(cfg, { engine: "nope" })).message, /unknown engine/);
  assert.ok(thrown(() => resolveEngine(cfg, { engine: "grok" })) instanceof EngineError);
});

test("the pool keeps to its width and sorts the results", async () => {
  const items = ["K3", "K1", "K2", "K4"].map((id) => ({ id }));
  let running = 0;
  let peak = 0;
  const results = await pool(items, 2, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return { id: item.id, status: "ok" };
  });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => r.id), ["K1", "K2", "K3", "K4"]);
});
