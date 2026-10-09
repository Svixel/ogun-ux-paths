# ux-paths

A UX programme for any product, run by an AI coding agent. It treats a product as a set of paths (jobs a person finishes), not screens.

1. Audit the as-built product per path against 20 UX laws, severity S1 to S4, verified in a fresh context.
2. Simplify into target paths with a short list of owner decisions and before/after metrics.
3. Build the target flows with a foundation, builder, checker and fixer loop under deterministic gates.

Read `SKILL.md` first, then `PLAN.md` and `reference/METHOD.md`.

## Install

Clone into your agent's skills folder, for example:

```
git clone https://github.com/Svixel/ux-paths ~/.claude/skills/ux-paths
```

Copy `projects/example.json` to `projects/<your-product>.json` and fill it in (`projects/README.md` explains every key). Then run `node scripts/ux-paths init --project <your-product>`.

## Requirements

- Node 24 (tested; Node built-ins only, no npm dependencies).
- The `claude` or `codex` CLI, installed and logged in. The default engine is `claude` (Sonnet, high effort). Run `rulecheck` with `--model opus --effort medium`.
- For screenshots (`capture`): the `autoreview-ui` skill with Playwright installed. Its driver uses Chromium; any browser works if you adapt it.

## Tests

`npm test`. The synthesis tests that need real audit fixtures are not included in this public copy.

## Status

Personal tooling, shared as is. No licence is set yet, so ask before reusing it commercially.
