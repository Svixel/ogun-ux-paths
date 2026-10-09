/**
 * verify.mjs — step 1, second pass: re-read each path file with fresh context.
 *
 *   ux-paths verify --project <name> [--only A1,W2] …
 *
 * Same runner as audit, one prompt and one completeness rule apart: the reply
 * must also carry "## 9. Verification". A verifier confirms, downgrades or
 * drops every finding against the evidence and never deletes a row, so the
 * audit keeps its own history.
 */

import { runPathMode } from "./audit.mjs";

export async function main(argv, ctx) {
  return runPathMode("verify", argv, ctx);
}
