/**
 * Live manifest health probe. Runs the shipped catalog against the real
 * provider APIs (search → episodes → danmaku, whichever stages a manifest
 * declares) and reports OK / DRIFT / BROKEN / BLOCKED per manifest.
 *
 * Usage:
 *   bun run health                  # sweep the whole catalog
 *   bun run health tencent          # one manifest, fixture query
 *   bun run health tencent "海贼王"  # one manifest, query override
 *
 * NOT wired into `bun test`, hits real network endpoints, and is not
 * deterministic. This is dango's e2e/health layer: it exists to catch when
 * an upstream API's wire format drifts out from under a manifest.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AbortedError,
  HostNotAllowedError,
  JsonataTimeoutError,
  type Manifest,
  ManifestRunner,
  zManifest,
} from '@mr-quin/dango'
import { realFetcher } from './realFetcher.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

const MANIFEST_DELAY_MS = Number(process.env.HEALTH_MANIFEST_DELAY_MS ?? 2000)
const STAGE_DELAY_MS = Number(process.env.HEALTH_STAGE_DELAY_MS ?? 500)
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 20000)
// Danmaku fans out across per-minute segments (a full show can pull tens of
// thousands of comments), so it needs a much larger budget than search/episodes.
const DANMAKU_TIMEOUT_MS = Number(
  process.env.HEALTH_DANMAKU_TIMEOUT_MS ?? 90000
)

const BLOCKED_STATUSES = new Set([403, 451])
const BLOCKED_MESSAGE_PATTERN =
  /geo.?block|region.?block|not available in your (region|country)|network( is)? unreachable|enetunreach|econnrefused|econnreset|eai_again/i

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CatalogEntry {
  id: string
  file: string
}

interface Catalog {
  manifests: CatalogEntry[]
}

interface QueryFixture {
  query: string
  minSearch?: number
  minDanmaku?: number
  config?: Record<string, unknown>
}

function loadCatalog(): CatalogEntry[] {
  const raw = readFileSync(join(packageRoot, 'catalog.json'), 'utf8')
  return (JSON.parse(raw) as Catalog).manifests
}

function loadManifest(entry: CatalogEntry): Manifest {
  const raw = readFileSync(join(packageRoot, entry.file), 'utf8')
  return zManifest.parse(JSON.parse(raw))
}

function loadFixtures(): Record<string, QueryFixture> {
  const raw = readFileSync(join(here, 'health-queries.json'), 'utf8')
  return JSON.parse(raw) as Record<string, QueryFixture>
}

function firstSearchInputName(manifest: Manifest): string {
  const variant = manifest.search?.[0]
  return variant?.inputs[0] ?? 'q'
}

function rowInputs(row: unknown): Record<string, unknown> {
  if (row && typeof row === 'object' && 'providerIds' in row) {
    const providerIds = (row as { providerIds?: unknown }).providerIds
    if (providerIds && typeof providerIds === 'object') {
      return providerIds as Record<string, unknown>
    }
  }
  return row as Record<string, unknown>
}

type StageVerdict = 'ok' | 'drift' | 'broken' | 'blocked' | 'skipped'

interface StageResult {
  capable: boolean
  attempted: boolean
  verdict: StageVerdict
  count: number | null
  note: string
  value: unknown
  diagnostics?: Diagnostics
}

function notAttempted(capable: boolean, note = ''): StageResult {
  return {
    capable,
    attempted: false,
    verdict: 'skipped',
    count: null,
    note,
    value: undefined,
  }
}

interface Diagnostics {
  name: string
  message: string
  stack?: string[]
  code?: string
  url?: string
  cause?: Diagnostics
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str
}

/** `depth` guards against a pathological (e.g. circular) `cause` chain. */
function buildDiagnostics(err: unknown, depth = 0): Diagnostics {
  if (!(err instanceof Error)) {
    return { name: typeof err, message: safeStringify(err) }
  }
  const extras = err as Error & {
    code?: unknown
    url?: unknown
    cause?: unknown
  }
  const diagnostics: Diagnostics = { name: err.name, message: err.message }
  if (err.stack) {
    diagnostics.stack = err.stack
      .split('\n')
      .slice(0, 5)
      .map((line) => line.trim())
  }
  if (extras.code !== undefined) {
    diagnostics.code = String(extras.code)
  }
  if (extras.url !== undefined) {
    diagnostics.url = String(extras.url)
  }
  if (extras.cause !== undefined && depth < 5) {
    diagnostics.cause = buildDiagnostics(extras.cause, depth + 1)
  }
  return diagnostics
}

interface ThrowClassification {
  verdict: 'broken' | 'blocked'
  note: string
  diagnostics: Diagnostics
}

function classifyThrow(err: unknown): ThrowClassification {
  const diagnostics = buildDiagnostics(err)
  if (err instanceof HostNotAllowedError) {
    return {
      verdict: 'broken',
      note: `${err.code} for ${err.url}`,
      diagnostics,
    }
  }
  if (err instanceof JsonataTimeoutError) {
    return {
      verdict: 'broken',
      note: 'jsonata evaluation timeout',
      diagnostics,
    }
  }
  const name = err instanceof Error ? err.name : ''
  if (
    err instanceof AbortedError ||
    name === 'AbortError' ||
    name === 'TimeoutError'
  ) {
    return {
      verdict: 'broken',
      note: 'request timed out',
      diagnostics,
    }
  }
  if (!(err instanceof Error)) {
    return {
      verdict: 'broken',
      note: `${diagnostics.name}: ${truncate(diagnostics.message, 120)}`,
      diagnostics,
    }
  }
  const message = err.message
  const httpMatch = message.match(/^HTTP (\d+) for (.+)$/)
  if (httpMatch) {
    const status = Number(httpMatch[1])
    const url = httpMatch[2]
    if (BLOCKED_STATUSES.has(status)) {
      return {
        verdict: 'blocked',
        note: `HTTP ${status} for ${url}`,
        diagnostics,
      }
    }
    return { verdict: 'broken', note: `HTTP ${status} for ${url}`, diagnostics }
  }
  if (BLOCKED_MESSAGE_PATTERN.test(message)) {
    return { verdict: 'blocked', note: message, diagnostics }
  }
  const errorClass = err.constructor.name
  return { verdict: 'broken', note: `${errorClass}: ${message}`, diagnostics }
}

async function runStage(
  stageName: string,
  run: () => Promise<unknown>,
  min: number
): Promise<StageResult> {
  try {
    const result = await run()
    if (!Array.isArray(result)) {
      return {
        capable: true,
        attempted: true,
        verdict: 'drift',
        count: null,
        note: `${stageName} did not return an array`,
        value: result,
      }
    }
    if (result.length < min) {
      return {
        capable: true,
        attempted: true,
        verdict: 'drift',
        count: result.length,
        note: `${stageName} returned ${result.length} row(s), want >= ${min}`,
        value: result,
      }
    }
    return {
      capable: true,
      attempted: true,
      verdict: 'ok',
      count: result.length,
      note: '',
      value: result,
    }
  } catch (err) {
    const classified = classifyThrow(err)
    return {
      capable: true,
      attempted: true,
      verdict: classified.verdict,
      count: null,
      note: `${stageName}: ${classified.note}`,
      value: undefined,
      diagnostics: classified.diagnostics,
    }
  }
}

interface ManifestReport {
  id: string
  search: StageResult
  episodes: StageResult
  danmaku: StageResult
  verdict: 'OK' | 'DRIFT' | 'BROKEN' | 'BLOCKED' | 'SKIPPED'
  note: string
  /** Set only when the whole manifest run threw outside a stage (e.g. loading it). */
  runDiagnostics?: Diagnostics
}

const STAGE_VERDICT_RANK: Record<StageVerdict, number> = {
  skipped: 0,
  ok: 1,
  blocked: 2,
  drift: 3,
  broken: 4,
}

function worstStage(stages: StageResult[]): StageResult {
  return stages.reduce((worst, s) =>
    STAGE_VERDICT_RANK[s.verdict] > STAGE_VERDICT_RANK[worst.verdict]
      ? s
      : worst
  )
}

function overallVerdict(stages: StageResult[]): ManifestReport['verdict'] {
  const worst = worstStage(stages)
  if (worst.verdict === 'skipped') {
    return 'SKIPPED'
  }
  if (worst.verdict === 'ok') {
    return 'OK'
  }
  return worst.verdict.toUpperCase() as 'DRIFT' | 'BROKEN' | 'BLOCKED'
}

async function runManifest(
  entry: CatalogEntry,
  fixtures: Record<string, QueryFixture>,
  cliQueryOverride: string | undefined
): Promise<ManifestReport> {
  const manifest = loadManifest(entry)
  const runner = new ManifestRunner(manifest, { fetcher: realFetcher })
  const fixture = fixtures[entry.id]

  const hasSearch = runner.hasSearch()
  const hasEpisodes = runner.hasEpisodes()
  const hasDanmaku = runner.hasDanmaku()

  const query = cliQueryOverride ?? fixture?.query

  if (hasSearch && !query) {
    return {
      id: entry.id,
      search: notAttempted(true, 'no query'),
      episodes: notAttempted(hasEpisodes, 'no query'),
      danmaku: notAttempted(hasDanmaku, 'no query'),
      verdict: 'SKIPPED',
      note: 'no query',
    }
  }

  const minSearch = fixture?.minSearch ?? 1
  const minDanmaku = fixture?.minDanmaku ?? 1
  const config = fixture?.config ?? {}
  const runOpts = { allowPrivateHosts: true }

  let search = notAttempted(hasSearch)
  let firstSearchRow: unknown

  if (hasSearch) {
    const inputName = firstSearchInputName(manifest)
    search = await runStage(
      'search',
      () =>
        runner.runSearch(
          { ...config, [inputName]: query },
          { ...runOpts, signal: AbortSignal.timeout(TIMEOUT_MS) }
        ),
      minSearch
    )
    if (Array.isArray(search.value) && search.value.length > 0) {
      firstSearchRow = search.value[0]
    }
    await sleep(STAGE_DELAY_MS)
  }

  let episodes = notAttempted(
    hasEpisodes,
    hasEpisodes ? 'no search row to thread' : ''
  )
  let firstEpisodeRow: unknown

  if (hasEpisodes && firstSearchRow !== undefined) {
    episodes = await runStage(
      'episodes',
      () =>
        runner.runEpisodes(
          { ...config, ...rowInputs(firstSearchRow) },
          {
            ...runOpts,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }
        ),
      1
    )
    if (Array.isArray(episodes.value) && episodes.value.length > 0) {
      firstEpisodeRow = episodes.value[0]
    }
    await sleep(STAGE_DELAY_MS)
  }

  let danmaku = notAttempted(
    hasDanmaku,
    hasDanmaku ? 'no episode row to thread' : ''
  )

  if (hasDanmaku && firstEpisodeRow !== undefined) {
    danmaku = await runStage(
      'danmaku',
      () =>
        runner.runDanmaku(
          { ...config, ...rowInputs(firstEpisodeRow) },
          {
            ...runOpts,
            continueOnError: true,
            signal: AbortSignal.timeout(DANMAKU_TIMEOUT_MS),
          }
        ),
      minDanmaku
    )
  }

  const stages = [search, episodes, danmaku]
  return {
    id: entry.id,
    search,
    episodes,
    danmaku,
    verdict: overallVerdict(stages),
    note: worstStage(stages).note,
  }
}

function renderStage(stage: StageResult): string {
  if (!stage.capable || !stage.attempted) {
    return '-'
  }
  if (stage.verdict === 'broken' || stage.verdict === 'blocked') {
    return 'x'
  }
  return String(stage.count ?? 0)
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

function printTable(reports: ManifestReport[]): void {
  const header = [
    'manifestId',
    'search',
    'episodes',
    'danmaku',
    'verdict',
    'note',
  ]
  const rows = reports.map((r) => [
    r.id,
    renderStage(r.search),
    renderStage(r.episodes),
    renderStage(r.danmaku),
    r.verdict,
    r.note,
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0))
  )
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i] ?? 0)).join('  ')
  console.log(line(header))
  console.log(line(widths.map((w) => '-'.repeat(w))))
  for (const row of rows) {
    console.log(line(row))
  }
}

function formatDiagnostics(diagnostics: Diagnostics, indent: string): string[] {
  const lines = [`${indent}${diagnostics.name}: ${diagnostics.message}`]
  if (diagnostics.code) {
    lines.push(`${indent}  code: ${diagnostics.code}`)
  }
  if (diagnostics.url) {
    lines.push(`${indent}  url: ${diagnostics.url}`)
  }
  if (diagnostics.stack && diagnostics.stack.length > 0) {
    lines.push(`${indent}  stack:`)
    for (const frame of diagnostics.stack) {
      lines.push(`${indent}    ${frame}`)
    }
  }
  if (diagnostics.cause) {
    lines.push(`${indent}  cause:`)
    lines.push(...formatDiagnostics(diagnostics.cause, `${indent}    `))
  }
  return lines
}

function printDiagnostics(reports: ManifestReport[]): void {
  const broken = reports.filter((r) => r.verdict === 'BROKEN')
  if (broken.length === 0) {
    return
  }
  console.log('\n--- diagnostics ---')
  for (const r of broken) {
    console.log(`\n${r.id}:`)
    const stages: [string, StageResult][] = [
      ['search', r.search],
      ['episodes', r.episodes],
      ['danmaku', r.danmaku],
    ]
    for (const [stageName, stage] of stages) {
      if (stage.verdict === 'broken' && stage.diagnostics) {
        console.log(`  [${stageName}]`)
        for (const line of formatDiagnostics(stage.diagnostics, '  ')) {
          console.log(line)
        }
      }
    }
    if (r.runDiagnostics) {
      console.log('  [run]')
      for (const line of formatDiagnostics(r.runDiagnostics, '  ')) {
        console.log(line)
      }
    }
  }
}

async function main(): Promise<void> {
  const manifestIdArg = process.argv[2]
  const queryArg = process.argv[3]

  const catalog = loadCatalog()
  const fixtures = loadFixtures()

  const entries = manifestIdArg
    ? catalog.filter((e) => e.id === manifestIdArg)
    : catalog

  if (manifestIdArg && entries.length === 0) {
    console.error(`unknown manifest id: ${manifestIdArg}`)
    console.error(`known ids: ${catalog.map((e) => e.id).join(', ')}`)
    process.exit(2)
  }

  const reports: ManifestReport[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) {
      continue
    }
    console.log(`\n[health] ${entry.id}...`)
    try {
      reports.push(await runManifest(entry, fixtures, queryArg))
    } catch (err) {
      const classified = classifyThrow(err)
      reports.push({
        id: entry.id,
        search: notAttempted(false),
        episodes: notAttempted(false),
        danmaku: notAttempted(false),
        verdict: classified.verdict.toUpperCase() as 'BROKEN' | 'BLOCKED',
        note: `manifest run crashed: ${classified.note}`,
        runDiagnostics: classified.diagnostics,
      })
    }
    if (i < entries.length - 1) {
      await sleep(MANIFEST_DELAY_MS)
    }
  }

  console.log('')
  printTable(reports)
  printDiagnostics(reports)

  const counts = { ok: 0, drift: 0, broken: 0, blocked: 0, skipped: 0 }
  for (const r of reports) {
    counts[r.verdict.toLowerCase() as keyof typeof counts] += 1
  }
  console.log(
    `\n${counts.ok} ok / ${counts.drift} drift / ${counts.broken} broken / ${counts.blocked} blocked / ${counts.skipped} skipped`
  )

  process.exit(counts.drift > 0 || counts.broken > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[health] fatal:', err)
  process.exit(1)
})
