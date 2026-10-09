import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { screensFor } from "../scripts/lib/commands/audit.mjs";

// screensFor must find exactly the files `capture` writes:
// <auditDir>/screens/<identity>__<routeLabel>__<width>.png

const dir = mkdtempSync(join(tmpdir(), "ux-paths-screens-"));
after(() => rmSync(dir, { recursive: true, force: true }));

for (const f of [
  "logged-out__root__375.png",
  "logged-out__advertise__375.png",
  "advertiser-approved__advertise__1440.png",
  "advertiser-approved__advertise_dashboard_ads_id__768.png",
  "admin__admin__1440.png",
  "admin__admin_ads__1440.png",
  "odd__identity__advertise__375.png",
  "advertise__375.png", // old, identity-less name: not a capture output
  "logged-out__advertise__375.txt",
  "CAPTURE-LOG.md",
]) {
  writeFileSync(join(dir, f), "");
}

const cfg = { screensDir: dir };

test("matches the route label for every captured identity", () => {
  assert.deepEqual(screensFor(cfg, { routes: ["/advertise"] }), [
    "advertiser-approved__advertise__1440.png",
    "logged-out__advertise__375.png",
    "odd__identity__advertise__375.png",
  ]);
});

test("matches dynamic and root routes by their pattern label", () => {
  assert.deepEqual(screensFor(cfg, { routes: ["/advertise/dashboard/ads/[id]", "/"] }), [
    "advertiser-approved__advertise_dashboard_ads_id__768.png",
    "logged-out__root__375.png",
  ]);
});

test("a route label never matches a longer label that shares its prefix", () => {
  assert.deepEqual(screensFor(cfg, { routes: ["/admin"] }), ["admin__admin__1440.png"]);
});

test("a missing screens dir yields no screenshots", () => {
  assert.deepEqual(screensFor({ screensDir: join(dir, "missing") }, { routes: ["/"] }), []);
});
