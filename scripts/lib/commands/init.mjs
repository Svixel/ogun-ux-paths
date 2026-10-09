// init.mjs — scaffold <auditDir> for a new ux-paths programme.
//
//   ux-paths init --project <name> [--date YYYY-MM] [--root <dir>]
//
// Renders reference/{UX-LAWS-PACK,PATH-TEMPLATE,TARGET-TEMPLATE,
// TRACKER-TEMPLATE,DECISIONS-TEMPLATE}.md against the project config and
// writes: <auditDir>/README.md (the tracker, from TRACKER-TEMPLATE.md),
// <auditDir>/inputs/ (empty directory), <auditDir>/paths.json (an empty
// list — the path inventory is hand-maintained from here), <auditDir>/
// UX-LAWS-PACK.md, <auditDir>/PATH-TEMPLATE.md, <auditDir>/TARGET-
// TEMPLATE.md, and <auditDir>/target/DECISIONS.md (the decisions skeleton).
// Never overwrites a file that already exists; prints every file written or
// skipped.
//
// Exports: async function main(argv, ctx)
//   ctx = { skillDir, loadProject(nameOrPath, options), log }, the same
//   contract lib/commands/status.mjs and audit.mjs use — see PLAN.md §9.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UsageError, parseFlags, renderTemplate, resolveSkillPath } from "../config.mjs";

export const FLAG_SPEC = { string: ["project", "config", "root", "date"], boolean: ["help"] };
const USAGE = `ux-paths init --project <name> [--date YYYY-MM] [--root <dir>]

Scaffolds <auditDir>: README.md (tracker), inputs/, paths.json (empty list),
rendered UX-LAWS-PACK.md, PATH-TEMPLATE.md, TARGET-TEMPLATE.md, and
target/DECISIONS.md (skeleton). Never overwrites an existing file.`;

// -------------------------------------------------------------------- main --

export async function main(argv, ctx) {
  const { flags } = parseFlags(argv, FLAG_SPEC);
  if (flags.help) {
    ctx.log(USAGE);
    return 0;
  }
  const cfg = await ctx.loadProject(flags.config || flags.project, flags.root ? { root: flags.root } : {});

  const auditRoot = cfg.auditPath ?? join(cfg.root, cfg.auditDir);
  const refDir = resolveSkillPath("reference");

  // Optional array fields (project.schema.json) default to [] so a minimal
  // config does not turn "not provided" into a renderTemplate error.
  const data = {
    ...cfg,
    product: {
      ...cfg.product,
      copyGlobs: cfg.product?.copyGlobs ?? [],
      clientDocs: cfg.product?.clientDocs ?? [],
    },
  };

  const dateLabel = flags.date ?? new Date().toISOString().slice(0, 10);
  const productName = data.product?.name ?? data.name;

  const written = [];
  const skipped = [];

  function readTemplate(name) {
    const p = join(refDir, name);
    if (!existsSync(p)) throw new UsageError(`reference template not found: ${p} (is the skill installed correctly?)`);
    return readFileSync(p, "utf8");
  }

  function writeIfAbsent(relOutPath, content) {
    const outPath = join(auditRoot, relOutPath);
    if (existsSync(outPath)) {
      skipped.push(relOutPath);
      ctx.log(`[init] skip ${relOutPath} (already exists)`);
      return;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content);
    written.push(relOutPath);
    ctx.log(`[init] wrote ${relOutPath}`);
  }

  mkdirSync(cfg.inputsDir ?? join(auditRoot, "inputs"), { recursive: true });

  // The path inventory is hand-maintained from here; PLAN.md §2.
  writeIfAbsent("paths.json", "[]\n");

  writeIfAbsent("UX-LAWS-PACK.md", renderTemplate(readTemplate("UX-LAWS-PACK.md"), data, { label: "UX-LAWS-PACK.md" }));
  writeIfAbsent("PATH-TEMPLATE.md", renderTemplate(readTemplate("PATH-TEMPLATE.md"), data, { label: "PATH-TEMPLATE.md" }));
  writeIfAbsent("TARGET-TEMPLATE.md", renderTemplate(readTemplate("TARGET-TEMPLATE.md"), data, { label: "TARGET-TEMPLATE.md" }));

  let tracker = renderTemplate(readTemplate("TRACKER-TEMPLATE.md"), data, { label: "TRACKER-TEMPLATE.md" });
  // TRACKER-TEMPLATE.md's header line uses free-text angle-bracket
  // placeholders (`<project name>`, `<date>`), not the `{{a.b}}` mustache
  // syntax renderTemplate handles — every other angle-bracket placeholder
  // in the template (`<what happened>`, `<hash>`, and so on) is left for a
  // person to fill in by hand, so only these two literal, well-known
  // strings are substituted here.
  tracker = tracker.replace("<project name>", productName).replace("Updated: <date>.", `Updated: ${dateLabel}.`);
  writeIfAbsent("README.md", tracker);

  writeIfAbsent(
    join("target", "DECISIONS.md"),
    renderTemplate(readTemplate("DECISIONS-TEMPLATE.md"), data, { label: "DECISIONS-TEMPLATE.md" }),
  );

  ctx.log(`[init] scaffolded ${auditRoot}: ${written.length} file(s) written, ${skipped.length} skipped (already existed)`);
  return 0;
}

export default main;
