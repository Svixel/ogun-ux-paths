export const meta = {
  name: 'ux-paths-build-loop',
  description:
    'ux-paths step 3: foundation, then one builder per target path with a checker→fixer loop and deterministic gates, then a per-lane critic, blocker fixes and a final gate. Args come from `ux-paths loop-args`.',
  phases: [
    { title: 'Foundation', detail: 'shared shell, nav, new shared components; sequential' },
    { title: 'Build', detail: 'one builder per job in parallel; checker→fixer up to maxRounds; Playwright behind a semaphore' },
    { title: 'Review', detail: 'one critic per lane, blockers fixed, polish logged' },
    { title: 'Final', detail: 'final checker runs every gate and audits ownership' },
  ],
}

// ---------------------------------------------------------------------------
// Args (produced by `ux-paths loop-args`; validated there against loop-args.schema.json)
// ---------------------------------------------------------------------------
const A = args
if (!A || !A.root || !A.contract || !Array.isArray(A.jobs) || !A.prompts) {
  throw new Error('build-loop: args missing. Produce them with `ux-paths loop-args --project <name> --contract <path>` and pass the JSON as the Workflow args.')
}
const MAX_ROUNDS = A.maxRounds || 3
const SLOT_COUNT = A.playwrightSlots || 1
const MODELS = A.models || {}

// 'inherit' (or missing) means: do not set a model; the agent inherits the session model.
function modelOpts(role, override) {
  const m = override || MODELS[role]
  return m && m !== 'inherit' ? { model: m } : {}
}

// >>> stage-2 renderer (tests/loop-args.test.mjs slices this block out by these two markers and
// runs it against the real rendered prompts; keep it self-contained) >>>
// Stage-2 placeholder filler for the {{job.*}} style placeholders `ux-paths loop-args` left
// intact. It must understand the same two forms lib/config.mjs renderTemplate() does — {{a.b}}
// and {{#each list}}…{{/each}} — because a preserved root can carry either, and a Workflow
// script cannot import that module. Anything it cannot resolve is left in the text verbatim, so
// a leftover {{token}} in a prompt is visible rather than silently dropped.
// Deliberately the same source as lib/config.mjs TAG_RE, so both stages tokenise alike.
const TAG = /\{\{\s*([#/][a-zA-Z]+)?\s*([^{}]*?)\s*\}\}/g

function lookupIn(path, scopes) {
  if (path === 'this') {
    const last = scopes[scopes.length - 1]
    return { found: true, value: last && last.__this__ !== undefined ? last.__this__ : last }
  }
  const [head, ...rest] = path.split('.')
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i]
    if (scope == null || typeof scope !== 'object' || !(head in scope)) continue
    let value = scope[head]
    for (const key of rest) value = value == null ? undefined : value[key]
    return { found: true, value }
  }
  return { found: false, value: undefined }
}

function stringifyValue(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

// Find the {{/each}} closing the {{#each}} whose opening tag ends at `from`.
function closeEach(text, from) {
  const scanner = new RegExp(TAG.source, 'g')
  scanner.lastIndex = from
  let depth = 1
  let hit
  while ((hit = scanner.exec(text)) !== null) {
    const kind = (hit[1] || '').trim()
    if (kind === '#each') depth++
    else if (kind === '/each') {
      depth--
      if (depth === 0) return { body: text.slice(from, hit.index), end: hit.index + hit[0].length }
    }
  }
  return null
}

function renderInto(text, scopes) {
  const tags = new RegExp(TAG.source, 'g')
  let out = ''
  let cursor = 0
  let match
  while ((match = tags.exec(text)) !== null) {
    const [raw, block, path] = match
    const keyword = (block || '').trim()
    out += text.slice(cursor, match.index)
    if (keyword === '#each') {
      const block = closeEach(text, match.index + raw.length)
      if (!block) {
        out += raw
        cursor = match.index + raw.length
        continue
      }
      const found = lookupIn(path, scopes)
      if (!found.found || !Array.isArray(found.value)) {
        // Not ours to fill (a later stage owns it, or the data is missing): keep it whole.
        out += text.slice(match.index, block.end)
      } else {
        for (const item of found.value) {
          const scope = item !== null && typeof item === 'object' && !Array.isArray(item) ? { ...item } : {}
          scope.__this__ = item
          out += renderInto(block.body, [...scopes, scope])
        }
      }
      cursor = block.end
      tags.lastIndex = block.end
      continue
    }
    if (keyword === '/each') {
      out += raw
      cursor = match.index + raw.length
      continue
    }
    const found = keyword || !path ? { found: false } : lookupIn(path, scopes)
    out += found.found && found.value !== undefined ? stringifyValue(found.value) : raw
    cursor = match.index + raw.length
  }
  return out + text.slice(cursor)
}

function fill(text, data) {
  return renderInto(String(text), [data || {}])
}
// <<< stage-2 renderer <<<

// Literal fallbacks for the stage-2 keys whose value is "there is nothing here yet". The prompts
// have no conditional, so the no-op case has to read as a sentence.
const NO_PREVIOUS = '(none — this is round 1)'
const NO_FOUNDATION_YET = 'No foundation job in this run.'
const NO_FOUNDATION_JOB = { id: 'none', owns: [], spec: null }
const FOUNDATION_INSTEAD_OF_JOB_FILE =
  "(this is the foundation; work from the build contract's foundation section instead of a target path file)"

// Playwright slots: one checkout, one dev-server lock, at most SLOT_COUNT concurrent spec runs.
const BASE_PORT = Number(A.portBase) || 3200
const portFor = (slot) => BASE_PORT + (Number(slot) || 1)
const SLOTS = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)
const waiters = []
async function withSlot(fn) {
  while (SLOTS.length === 0) await new Promise((r) => waiters.push(r))
  const slot = SLOTS.shift()
  try {
    return await fn(slot)
  } finally {
    SLOTS.push(slot)
    const w = waiters.shift()
    if (w) w()
  }
}

// ---------------------------------------------------------------------------
// Schemas — must stay identical to schemas/build.schema.json, check.schema.json, critic.schema.json
// ---------------------------------------------------------------------------
const BUILD = {
  type: 'object',
  additionalProperties: false,
  required: ['routes', 'files', 'checksRun', 'deviations', 'walls', 'wantedFromFoundation'],
  properties: {
    routes: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    checksRun: { type: 'string' },
    deviations: { type: 'string' },
    walls: { type: 'string' },
    wantedFromFoundation: { type: 'array', items: { type: 'string' } },
  },
}

const CHECK = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'fails', 'checks', 'notes'],
  properties: {
    pass: { type: 'boolean' },
    fails: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'evidence', 'fix'],
        properties: { rule: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
      },
    },
    checks: {
      type: 'object',
      additionalProperties: false,
      required: ['lint', 'types', 'extra', 'full', 'e2e', 'paths'],
      properties: {
        lint: { type: 'boolean' },
        types: { type: 'boolean' },
        extra: { type: 'boolean' },
        full: { type: 'boolean' },
        e2e: { type: 'boolean' },
        paths: { type: 'boolean' },
      },
    },
    notes: { type: 'string' },
  },
}

const CRITIC = {
  type: 'object',
  additionalProperties: false,
  required: ['screens', 'blockers', 'polish'],
  properties: {
    screens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['route', 'viewport', 'verdict', 'what', 'fix'],
        properties: {
          route: { type: 'string' },
          viewport: { type: 'string' },
          verdict: { type: 'string', enum: ['OK', 'FIX'] },
          what: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'route', 'what', 'fix', 'file'],
        properties: { id: { type: 'string' }, route: { type: 'string' }, what: { type: 'string' }, fix: { type: 'string' }, file: { type: 'string' } },
      },
    },
    polish: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['route', 'what'], properties: { route: { type: 'string' }, what: { type: 'string' } } },
    },
  },
}

// ---------------------------------------------------------------------------
// One check→fix loop, shared by foundation and jobs.
// ---------------------------------------------------------------------------
async function checkFixLoop({ id, lane, initialReport, checkPromptFor, fixPromptFor, phaseName, models }) {
  let current = initialReport
  let verdict = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    verdict = await withSlot((slot) =>
      agent(checkPromptFor({ round, report: current, slot }), {
        label: `check:${id}:${round}`,
        phase: phaseName,
        effort: 'medium',
        schema: CHECK,
        ...modelOpts('checker', models && models.checker),
      }),
    )
    if (!verdict) {
      log(`${id}: checker returned nothing in round ${round}; stopping this loop`)
      break
    }
    if (verdict.pass) {
      log(`${id}: check ${round} PASS`)
      break
    }
    log(`${id}: check ${round} — ${verdict.fails.length} fail(s): ${verdict.fails.map((f) => f.rule).join('; ')}`)
    if (round === MAX_ROUNDS) {
      log(`${id}: still failing after ${MAX_ROUNDS} rounds; recorded, NOT passed`)
      break
    }
    const fixed = await withSlot((slot) =>
      agent(fixPromptFor({ round, report: current, fails: verdict.fails, slot }), {
        label: `fix:${id}:${round}`,
        phase: phaseName,
        effort: 'medium',
        schema: BUILD,
        ...modelOpts('fixer', models && models.fixer),
      }),
    )
    if (fixed) current = fixed
  }
  return { id, lane, pass: !!(verdict && verdict.pass), fails: verdict ? verdict.fails : [], report: current }
}

// ---------------------------------------------------------------------------
// 1. Foundation
// ---------------------------------------------------------------------------
phase('Foundation')
let foundation = null
let foundationReportText = 'No foundation job in this run.'
if (A.foundation) {
  const F = A.foundation
  // checker.md and fixer.md are written against a job; the foundation has no target path file.
  const FJOB = { id: F.id, file: FOUNDATION_INSTEAD_OF_JOB_FILE, owns: F.owns, spec: F.spec, lane: 'shared', linkOnly: [] }
  const built = await agent(
    fill(A.prompts.foundation, { job: FJOB, foundation: F, round: 1, previousReport: NO_PREVIOUS, fails: NO_PREVIOUS }),
    {
      label: `foundation:${F.id}`,
      phase: 'Foundation',
      effort: 'high',
      schema: BUILD,
      ...modelOpts('foundation', F.model),
    },
  )
  if (!built) {
    log(`foundation ${F.id}: builder returned nothing`)
    foundation = { id: F.id, lane: 'shared', pass: false, fails: [], report: null }
  } else {
    foundation = await checkFixLoop({
      id: F.id,
      lane: 'shared',
      initialReport: built,
      phaseName: 'Foundation',
      models: { checker: F.checkerModel, fixer: F.fixerModel },
      checkPromptFor: ({ round, report, slot }) =>
        fill(A.prompts.checker, { job: FJOB, foundation: F, foundationReport: NO_FOUNDATION_YET, round, build: report, port: portFor(slot) }),
      fixPromptFor: ({ round, report, fails, slot }) =>
        fill(A.prompts.fixer, { job: FJOB, foundation: F, foundationReport: NO_FOUNDATION_YET, round, build: report, fails, port: portFor(slot) }),
    })
  }
  foundationReportText = JSON.stringify(foundation.report, null, 2)
  if (foundation.report && foundation.report.walls && foundation.report.walls.trim() && !/^(none|no walls?)\.?$/i.test(foundation.report.walls.trim())) {
    log(`foundation walls: ${foundation.report.walls}`)
  }
}

// ---------------------------------------------------------------------------
// 2. Build — one builder per job, parallel; check→fix per job; Playwright behind slots
// ---------------------------------------------------------------------------
phase('Build')
const jobResults = await pipeline(
  A.jobs,
  (job) =>
    agent(
      fill(A.prompts.builder, {
        job,
        foundation: A.foundation || NO_FOUNDATION_JOB,
        foundationReport: foundationReportText,
        round: 1,
        previousReport: NO_PREVIOUS,
        fails: NO_PREVIOUS,
      }),
      {
        label: `build:${job.id}`,
        phase: 'Build',
        effort: 'medium',
        schema: BUILD,
        ...modelOpts('builder', job.model),
      },
    ),
  async (built, job) => {
    if (!built) {
      log(`${job.id}: builder returned nothing`)
      return { id: job.id, lane: job.lane, pass: false, fails: [], report: null }
    }
    if (built.walls && built.walls.trim() && !/^(none|no walls?)\.?$/i.test(built.walls.trim())) {
      log(`${job.id} wall: ${built.walls}`)
    }
    return checkFixLoop({
      id: job.id,
      lane: job.lane,
      initialReport: built,
      phaseName: 'Build',
      models: { checker: job.checkerModel, fixer: job.fixerModel },
      checkPromptFor: ({ round, report, slot }) =>
        fill(A.prompts.checker, {
          job,
          foundation: A.foundation || NO_FOUNDATION_JOB,
          foundationReport: foundationReportText,
          round,
          build: report,
          port: portFor(slot),
        }),
      fixPromptFor: ({ round, report, fails, slot }) =>
        fill(A.prompts.fixer, {
          job,
          foundation: A.foundation || NO_FOUNDATION_JOB,
          foundationReport: foundationReportText,
          round,
          build: report,
          fails,
          port: portFor(slot),
        }),
    })
  },
)

const jobs = jobResults.filter(Boolean)
const passed = jobs.filter((j) => j.pass)
log(`build: ${passed.length}/${A.jobs.length} jobs pass their checks; ${A.jobs.length - jobs.length} returned nothing`)
const wanted = Array.from(new Set(jobs.flatMap((j) => (j.report && j.report.wantedFromFoundation) || [])))
if (wanted.length) log(`wanted from foundation (${wanted.length}): ${wanted.join(' | ')}`)

// ---------------------------------------------------------------------------
// 3. Review — one critic per lane, then one blocker fixer per lane (pipeline: lanes do not wait for each other)
// ---------------------------------------------------------------------------
phase('Review')
const lanes = Array.from(new Set(A.jobs.map((j) => j.lane)))
const laneLabel = (id) => ((A.lanes || []).find((l) => l.id === id) || { label: id }).label
// critic.md and blocker-fixer.md read {{lane.id}}, {{lane.label}} and {{#each lane.jobs}}.
const laneView = (id) => ({
  id,
  label: laneLabel(id),
  jobs: A.jobs
    .filter((j) => j.lane === id)
    .map((j) => {
      const result = jobs.find((r) => r.id === j.id)
      return {
        id: j.id,
        file: j.file,
        owns: j.owns,
        spec: j.spec,
        pass: result ? result.pass : false,
        routes: (result && result.report && result.report.routes) || [],
        deviations: (result && result.report && result.report.deviations) || '',
      }
    }),
})
const reviewFileFor = (id) => `${A.auditDir}/REVIEW-${id}.md`
const reviews = await pipeline(
  lanes,
  (lane) =>
    withSlot((slot) =>
      agent(
        fill(A.prompts.critic, {
          lane: laneView(lane),
          port: portFor(slot),
          reviewFile: reviewFileFor(lane),
          // Outside the checkout on purpose: a screenshot inside it would show up in the
          // final checker's `git status --porcelain` ownership audit.
          shotsDir: `/tmp/ux-paths-review/${lane}`,
        }),
        { label: `critic:${lane}`, phase: 'Review', effort: 'high', schema: CRITIC, ...modelOpts('critic') },
      ),
    ),
  async (critic, lane) => {
    if (!critic) return { lane, critic: null, blockerFix: null }
    log(`critic ${lane}: ${critic.blockers.length} blocker(s), ${critic.polish.length} polish`)
    if (critic.blockers.length === 0) return { lane, critic, blockerFix: 'no blockers' }
    const blockerFix = await withSlot((slot) =>
      agent(
        fill(A.prompts.blockerFixer, {
          lane: laneView(lane),
          blockers: critic.blockers,
          port: portFor(slot),
          reviewFile: reviewFileFor(lane),
        }),
        {
          label: `blockers:${lane}`,
          phase: 'Review',
          effort: 'medium',
          ...modelOpts('blockerFixer'),
        },
      ),
    )
    return { lane, critic, blockerFix }
  },
)

// ---------------------------------------------------------------------------
// 4. Final — every gate, every spec, ownership audit
// ---------------------------------------------------------------------------
phase('Final')
const final = await withSlot((slot) =>
  agent(
    fill(A.prompts.finalChecker, {
      port: portFor(slot),
      jobResults: JSON.stringify(
        {
          foundation: foundation ? { id: foundation.id, pass: foundation.pass, fails: foundation.fails } : null,
          jobs: jobs.map((j) => ({ id: j.id, lane: j.lane, pass: j.pass, fails: j.fails })),
          neverPassed: A.jobs.map((j) => j.id).filter((id) => !passed.some((p) => p.id === id)),
        },
        null,
        2,
      ),
      blockerFixerReports: JSON.stringify(
        reviews.filter(Boolean).map((r) => ({ lane: r.lane, blockers: r.critic ? r.critic.blockers : [], blockerFix: r.blockerFix })),
        null,
        2,
      ),
    }),
    { label: 'final-check', phase: 'Final', effort: 'medium', schema: CHECK, ...modelOpts('finalChecker') },
  ),
)
if (final) log(final.pass ? 'final gate: PASS' : `final gate: ${final.fails.length} fail(s) remain`)

return {
  mode: A.mode,
  foundation: foundation ? { id: foundation.id, pass: foundation.pass, fails: foundation.fails, walls: foundation.report && foundation.report.walls } : null,
  jobs: jobs.map((j) => ({ id: j.id, lane: j.lane, pass: j.pass, fails: j.fails, routes: j.report && j.report.routes, deviations: j.report && j.report.deviations, walls: j.report && j.report.walls })),
  notPassed: A.jobs.map((j) => j.id).filter((id) => !passed.some((p) => p.id === id)),
  wantedFromFoundation: wanted,
  reviews: reviews.filter(Boolean).map((r) => ({ lane: r.lane, blockers: r.critic ? r.critic.blockers : null, polish: r.critic ? r.critic.polish.length : null, blockerFix: r.blockerFix })),
  final,
}
