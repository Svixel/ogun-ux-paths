# ux-paths

![Ogun, Yoruba orisha of iron and the open road, in a terracotta relief tablet](docs/banner.jpg)

**Ogun clears the road.** A skill for AI coding agents that finds what is hard in a product, cuts it away, and builds the clearer version.

Most UX reviews look at screens. `ux-paths` looks at **paths**: the jobs a person is trying to finish, like "find my next step" or "hand in my work". Every file, finding and decision is tied to a path, so you can measure whether a redesign made the journey shorter and clearer.

## The four steps

| Step | Question | What you get |
|---|---|---|
| 0 Inputs | What exists, and where does a person start? | A list of paths, every route captured as screenshots, the capabilities that must never be dropped |
| 1 Audit | Where does each path fail? | One file per path, findings checked against 20 UX laws and rated S1 to S4, verified in a fresh context |
| 2 Simplify | What should each path be? | One target path per job, a short list of owner decisions, before and after metrics, a rule check |
| 3 Build | Does it work and feel right? | The target flows built by a foundation, builder, checker and fixer loop under automatic gates |

## What makes it different

- **Paths, not screens.** The unit of work is a job, so duplicated lists, contradicting numbers and dead ends show up as path problems.
- **Written rules, not taste.** Findings must cite evidence (file and line, a screenshot, or a test) and a law. "It is deliberate" does not remove a finding.
- **20 laws.** Hick's, Fitts's, Jakob's, Miller's, Tesler's, Occam's, Pareto and the rest, each checked on every path.
- **Severity that means something.** S1 blocks the job or makes the user believe something false. S4 is polish. Silent failures are never below S2. Severity only counts after a second pass in a fresh context.
- **Metrics.** Entry points, ways to finish, screens, steps, decisions, repeated fields, dead ends, silent states and feedback gaps, counted before and after.
- **The owner decides few things, early.** Every serious finding maps to a decision, with a recommendation.
- **Cheap model for volume, strong model for judgement.** The audit runs on Sonnet, the design and the rule check on Opus, and the synthesis is a script.

## Install

```bash
git clone https://github.com/Svixel/ogun-ux-paths ~/.claude/skills/ux-paths
```

Copy `projects/example.json` to `projects/<your-product>.json` and fill it in (`projects/README.md` explains every key). Then:

```bash
node scripts/ux-paths init --project <your-product>
```

Read [`SKILL.md`](SKILL.md) for the commands, then [`PLAN.md`](PLAN.md) and [`reference/METHOD.md`](reference/METHOD.md) for the method.

## Requirements

- Node 24 (tested; Node built-ins only, no npm dependencies).
- The `claude` or `codex` CLI, installed and logged in. The default engine is `claude` (Sonnet, high effort). Run `rulecheck` with `--model opus --effort medium`.
- For screenshots (`capture`): [`maat-autoreview-ui`](https://github.com/Svixel/maat-autoreview-ui) installed at `~/.agents/skills/autoreview-ui` (a symlink is fine) with its dependencies. Its driver uses Chromium.

## Update

```bash
cd ~/.claude/skills/ux-paths
git pull
```

Your project configs in `projects/` and any real-output fixtures are git-ignored, so an update never touches them.

## Tests

`npm test`. The synthesis tests that need real audit output are not included in this public copy.

## Credits

- Companion skills: [`maat-autoreview-ui`](https://github.com/Svixel/maat-autoreview-ui) reviews how a UI renders, and its screenshot driver powers `capture` here. [`autoreview`](https://github.com/openclaw/agent-skills/tree/main/skills/autoreview) from [openclaw/agent-skills](https://github.com/openclaw/agent-skills) (MIT) reviews code.
- The twenty laws are well-known UX principles; [lawsofux.com](https://lawsofux.com) is a good overview of most of them.
- The method was distilled from a real four-step product audit and reduced to this reusable form.

Banner image generated with Grok Imagine 2.0 (xAI) via fal.ai: Ogun in the style of an Ife terracotta plaque.

## Status and licence

Shared as is, maintained by [@Svixel](https://github.com/Svixel). Released under the [MIT licence](LICENSE).
