import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SKILL_DIR, loadProject } from "../scripts/lib/config.mjs";
import { main } from "../scripts/lib/commands/capture.mjs";

// capture writes run.json for autoreview-ui's shoot.mjs, which reads the
// Playwright waits from its top level. A project's screens.capture must reach
// that file, or every route that compiles on first request fails at 30 s.

const scratch = mkdtempSync(join(tmpdir(), "ux-paths-capture-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const EXAMPLE = JSON.parse(readFileSync(join(SKILL_DIR, "projects", "example.json"), "utf8"));

async function dryRun(name, screensOverride) {
  const root = join(scratch, name);
  mkdirSync(join(root, "ux"), { recursive: true });
  writeFileSync(join(root, "ux", "paths.json"), JSON.stringify([{ id: "P1", routes: ["/"] }]));
  const file = join(scratch, `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({ ...EXAMPLE, root, auditDir: "ux", screens: { ...EXAMPLE.screens, ...screensOverride } }),
  );
  const originalLog = console.log;
  console.log = () => {};
  try {
    const code = await main(["--config", file, "--dry-run"], { loadProject, log: () => {} });
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
  }
  const screensDir = join(root, "ux", "screens");
  const runFile = readdirSync(screensDir).find((f) => f.startsWith(".run-") && f.endsWith(".json"));
  return JSON.parse(readFileSync(join(screensDir, runFile), "utf8"));
}

test("screens.capture waits reach run.json", async () => {
  const run = await dryRun("with-capture", { capture: { navigationTimeoutMs: 90000, waitForTimeoutMs: 60000 } });
  assert.equal(run.navigationTimeoutMs, 90000);
  assert.equal(run.waitForTimeoutMs, 60000);
});

test("without screens.capture, run.json leaves the driver defaults in place", async () => {
  const run = await dryRun("without-capture", {});
  assert.equal("navigationTimeoutMs" in run, false);
  assert.equal("waitForTimeoutMs" in run, false);
});
